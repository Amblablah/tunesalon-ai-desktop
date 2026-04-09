import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'
import { isTauri } from '../utils/native'

type SidecarStatus = 'loading' | 'ready' | 'error'

interface SidecarContextValue {
  status: SidecarStatus
  error: string | null
  retry: () => void
}

const SidecarContext = createContext<SidecarContextValue>({
  status: 'loading',
  error: null,
  retry: () => {},
})

export function useSidecar() {
  return useContext(SidecarContext)
}

// Always use absolute URL for health check — works in both dev and production
const HEALTH_URL = 'http://localhost:8765/api/health'
const HEALTH_CHECK_INTERVAL = 10_000 // 10s periodic check

export function SidecarProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SidecarStatus>('loading')
  const [error, setError] = useState<string | null>(null)

  // Poll health endpoint until ready (used on startup)
  const waitForHealth = useCallback(async () => {
    setStatus('loading')
    setError(null)

    for (let i = 0; i < 60; i++) {
      try {
        const res = await fetch(HEALTH_URL)
        if (res.ok) {
          setStatus('ready')
          return
        }
      } catch {
        // Not ready yet
      }
      await new Promise((r) => setTimeout(r, 500))
    }
    setStatus('error')
    setError('Backend did not start within 30 seconds')
  }, [])

  // Also listen for Tauri events from the Rust side
  useEffect(() => {
    if (!isTauri()) {
      // Dev mode without Tauri — just poll health directly
      waitForHealth()
      return
    }

    // Listen for Tauri events
    let unlisten1: (() => void) | undefined
    let unlisten2: (() => void) | undefined

    async function setup() {
      try {
        const { listen } = await import('@tauri-apps/api/event')
        unlisten1 = await listen('sidecar-ready', () => {
          setStatus('ready')
          setError(null)
        })
        unlisten2 = await listen<string>('sidecar-failed', (event) => {
          setStatus('error')
          setError(event.payload || 'Sidecar failed to start')
        })
      } catch {
        // Tauri event API not available, fall back to polling
      }
      // Also poll as a fallback (in case events are missed)
      waitForHealth()
    }
    setup()

    return () => {
      unlisten1?.()
      unlisten2?.()
    }
  }, [waitForHealth])

  // Periodic health check once ready — detect mid-session crashes
  useEffect(() => {
    if (status !== 'ready') return

    const interval = setInterval(async () => {
      try {
        const res = await fetch(HEALTH_URL)
        if (!res.ok) throw new Error()
      } catch {
        setStatus('error')
        setError('Backend stopped unexpectedly')
      }
    }, HEALTH_CHECK_INTERVAL)

    return () => clearInterval(interval)
  }, [status])

  const retry = useCallback(async () => {
    // Try to restart sidecar via Tauri command
    if (isTauri()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core')
        await invoke('restart_sidecar')
      } catch {
        // Will fall through to health polling
      }
    }
    waitForHealth()
  }, [waitForHealth])

  return (
    <SidecarContext.Provider value={{ status, error, retry }}>
      {children}
    </SidecarContext.Provider>
  )
}
