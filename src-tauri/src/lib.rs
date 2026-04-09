use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

struct SidecarState {
    child: Mutex<Option<Child>>,
}

/// In production: look for `python/tunesalon.exe` next to the app executable
fn start_sidecar_production() -> Result<Child, String> {
    // Look relative to the running exe: <install_dir>/python/tunesalon.exe
    let exe_dir = std::env::current_exe()
        .map(|p| p.parent().unwrap_or_else(|| std::path::Path::new(".")).to_path_buf())
        .unwrap_or_else(|_| PathBuf::from("."));

    let sidecar_exe = exe_dir.join("python").join("tunesalon.exe");
    if !sidecar_exe.exists() {
        return Err(format!("Bundled sidecar not found at {:?}", sidecar_exe));
    }
    let mut cmd = Command::new(&sidecar_exe);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.spawn()
        .map_err(|e| format!("Failed to start bundled sidecar: {}", e))
}

fn find_python() -> Option<String> {
    for cmd in &["python", "python3", "py"] {
        if let Ok(output) = Command::new(cmd).arg("--version").output() {
            if output.status.success() {
                return Some(cmd.to_string());
            }
        }
    }
    None
}

fn start_sidecar_dev(script_dir: &str) -> Result<Child, String> {
    let python = find_python().ok_or("Python not found on PATH")?;
    let mut cmd = Command::new(&python);
    cmd.arg("start_server.py").current_dir(script_dir);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd.spawn()
        .map_err(|e| format!("Failed to start Python sidecar: {}", e))
}

async fn wait_for_health(max_attempts: u32) -> bool {
    let client = reqwest::Client::new();
    for _ in 0..max_attempts {
        if let Ok(resp) = client.get("http://127.0.0.1:8765/api/health").send().await {
            if resp.status().is_success() {
                return true;
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
    false
}

#[tauri::command]
fn get_sidecar_status(state: tauri::State<'_, SidecarState>) -> bool {
    let child = state.child.lock().unwrap();
    child.is_some()
}

#[tauri::command]
fn restart_sidecar(
    state: tauri::State<'_, SidecarState>,
    _app_handle: tauri::AppHandle,
) -> Result<String, String> {
    // Kill existing
    let mut child = state.child.lock().unwrap();
    if let Some(ref mut c) = *child {
        let _ = c.kill();
        let _ = c.wait();
    }

    let new_child = if cfg!(debug_assertions) {
        let script_dir = std::env::current_dir()
            .map(|d| d.join("python"))
            .unwrap_or_else(|_| PathBuf::from("python"));
        start_sidecar_dev(script_dir.to_str().unwrap_or("python"))?
    } else {
        start_sidecar_production()?
    };

    *child = Some(new_child);
    Ok("Sidecar restarted".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(SidecarState {
            child: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            get_sidecar_status,
            restart_sidecar,
        ])
        .setup(|app| {
            let app_handle = app.handle().clone();

            // Start Python sidecar (production vs dev mode)
            let result = if cfg!(debug_assertions) {
                let script_dir = std::env::current_dir()
                    .unwrap_or_else(|_| PathBuf::from("."))
                    .join("python");
                start_sidecar_dev(script_dir.to_str().unwrap_or("python"))
            } else {
                start_sidecar_production()
            };

            match result {
                Ok(child) => {
                    let state = app_handle.state::<SidecarState>();
                    *state.child.lock().unwrap() = Some(child);
                    println!("Python sidecar started");

                    // Health check in background — emit events to frontend
                    let handle = app_handle.clone();
                    tauri::async_runtime::spawn(async move {
                        if wait_for_health(60).await {
                            println!("Python sidecar is healthy");
                            let _ = handle.emit("sidecar-ready", true);
                        } else {
                            eprintln!("Python sidecar health check failed after 30s");
                            let _ = handle.emit("sidecar-failed", "Health check timed out");
                        }
                    });
                }
                Err(e) => {
                    eprintln!("Sidecar start failed: {}", e);
                    let _ = app_handle.emit("sidecar-failed", &e);
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                let state = window.state::<SidecarState>();
                let mut child = state.child.lock().unwrap();
                if let Some(ref mut c) = *child {
                    let _ = c.kill();
                    let _ = c.wait();
                    println!("Python sidecar killed on exit");
                }
                *child = None;
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
