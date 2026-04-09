/**
 * Native Tauri API wrappers.
 * Falls back to browser APIs when running in dev mode (Vite server).
 */

// Check if we're in a Tauri webview
export function isTauri(): boolean {
  return '__TAURI__' in window
}

/**
 * Open a native file dialog. Falls back to browser <input type="file"> if not in Tauri.
 */
export async function openFileDialog(
  accept: string,
  multiple = false
): Promise<File[] | null> {
  if (isTauri()) {
    try {
      // Dynamic import to avoid errors in browser
      const { open } = await import('@tauri-apps/plugin-dialog')
      const filters = accept
        .split(',')
        .map((ext) => ext.trim().replace('.', ''))
      const result = await open({
        multiple,
        filters: [{ name: 'Files', extensions: filters }],
      })
      if (!result) return null
      // Tauri returns path(s), not File objects — read them via fetch
      const paths = Array.isArray(result) ? result : [result]
      // Return paths as pseudo-files (components will use the paths directly)
      return paths.map(
        (p) => new File([], typeof p === 'string' ? p : p.path || 'unknown', { type: 'application/octet-stream' })
      )
    } catch {
      // Fall through to browser fallback
    }
  }

  // Browser fallback
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.multiple = multiple
    input.onchange = () => {
      resolve(input.files ? Array.from(input.files) : null)
    }
    input.click()
  })
}

/**
 * Open a native folder dialog. Only works in Tauri.
 */
export async function openFolderDialog(): Promise<string | null> {
  if (!isTauri()) {
    alert('Folder selection is only available in the desktop app.')
    return null
  }

  try {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const result = await open({ directory: true })
    return typeof result === 'string' ? result : null
  } catch {
    return null
  }
}

/**
 * Native confirm dialog. Uses Tauri's ask() in desktop, window.confirm() in browser.
 */
export async function confirmDialog(message: string, title = 'Confirm'): Promise<boolean> {
  if (isTauri()) {
    try {
      const { ask } = await import('@tauri-apps/plugin-dialog')
      return await ask(message, { title, kind: 'warning' })
    } catch {
      // Fall through to browser
    }
  }
  return window.confirm(message)
}

/**
 * Native alert dialog. Uses Tauri's message() in desktop, window.alert() in browser.
 */
export async function alertDialog(message: string, title = 'Error'): Promise<void> {
  if (isTauri()) {
    try {
      const { message: tauriMessage } = await import('@tauri-apps/plugin-dialog')
      await tauriMessage(message, { title, kind: 'error' })
      return
    } catch {
      // Fall through to browser
    }
  }
  window.alert(message)
}

/**
 * Check sidecar status via Tauri command.
 */
export async function getSidecarStatus(): Promise<boolean> {
  if (!isTauri()) return false
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return await invoke('get_sidecar_status')
  } catch {
    return false
  }
}

/**
 * Restart the Python sidecar via Tauri command.
 */
export async function restartSidecar(): Promise<string> {
  if (!isTauri()) return 'Not in Tauri'
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    return await invoke('restart_sidecar')
  } catch (e) {
    return `Failed: ${e}`
  }
}
