import sys

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="TuneSalon Desktop", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:8765",
        "tauri://localhost",
        "https://tauri.localhost",
        "http://tauri.localhost",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    import glob
    import os
    import shutil
    import tempfile
    from pathlib import Path
    from api.config import get_config

    from api.services.chat_storage import init_db
    await init_db()

    # --- Startup cleanup: recover from previous crashes ---

    # 1. Kill orphaned GGUF server from previous session
    try:
        import requests
        r = requests.get("http://127.0.0.1:8766/health", timeout=1)
        if r.status_code == 200:
            # Orphaned GGUF server found — shut it down
            requests.post("http://127.0.0.1:8766/unload", timeout=2)
            import signal
            # Find and kill the process on port 8766
            import subprocess
            _flags = {"creationflags": subprocess.CREATE_NO_WINDOW} if sys.platform == "win32" else {}
            result = subprocess.run(
                ["netstat", "-ano"], capture_output=True, text=True, timeout=5, **_flags
            )
            for line in result.stdout.splitlines():
                if ":8766" in line and "LISTENING" in line:
                    pid = line.strip().split()[-1]
                    try:
                        os.kill(int(pid), signal.SIGTERM)
                    except (ProcessLookupError, PermissionError, ValueError):
                        pass
    except Exception:
        pass  # No orphaned server — good

    # 2. Clean stale temp directories
    temp_dir = tempfile.gettempdir()
    for pattern in ["tunesalon_rag_*", "tunesalon_adapter_*"]:
        for d in glob.glob(os.path.join(temp_dir, pattern)):
            try:
                shutil.rmtree(d, ignore_errors=True)
            except Exception:
                pass

    # 3. Clean stale _merged_temp in gguf dir
    try:
        cfg = get_config()
        gguf_dir = Path(cfg["paths"]["gguf_dir"])
        merged_temp = gguf_dir / "_merged_temp"
        if merged_temp.exists():
            shutil.rmtree(merged_temp, ignore_errors=True)
    except Exception:
        pass

    # 4. Clean incomplete model downloads (no config.json AND no .safetensors = empty/failed)
    # Only remove truly empty dirs — partial downloads with some files might be resumable
    try:
        cfg = get_config()
        models_dir = Path(cfg["paths"]["models_dir"])
        if models_dir.exists():
            for d in models_dir.iterdir():
                if d.is_dir() and not (d / "config.json").exists():
                    # Check if dir has any substantial files (> 1MB)
                    has_files = any(
                        f.stat().st_size > 1_000_000
                        for f in d.rglob("*") if f.is_file()
                    )
                    if not has_files:
                        # Empty/tiny dir from a failed start — safe to remove
                        shutil.rmtree(d, ignore_errors=True)
    except Exception:
        pass


@app.on_event("shutdown")
async def shutdown():
    """Clean up GGUF subprocess and other resources on sidecar exit."""
    from api.routers.chat import _gguf_model
    if _gguf_model is not None:
        try:
            _gguf_model.unload()
        except Exception:
            pass


@app.get("/api/health")
async def health_check():
    return {"status": "ok", "app": "TuneSalon Desktop"}


# Routers
from api.routers import system, train, chat, library, chat_sessions, settings, setup
app.include_router(setup.router, prefix="/api/setup", tags=["setup"])
app.include_router(system.router, prefix="/api/system", tags=["system"])
app.include_router(train.router, prefix="/api/train", tags=["train"])
app.include_router(chat.router, prefix="/api/chat", tags=["chat"])
app.include_router(library.router, prefix="/api/library", tags=["library"])
app.include_router(chat_sessions.router, prefix="/api/chat", tags=["chat-sessions"])
app.include_router(settings.router, prefix="/api/settings", tags=["settings"])
