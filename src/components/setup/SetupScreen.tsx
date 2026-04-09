import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '../../api/client'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ComponentInfo {
  name: string
  display_name: string
  description: string
  required: boolean
  installed: boolean
  version: string | null
  min_version: string | null
  outdated: boolean
  download_size: string | null
}

interface DetectResponse {
  gpu_name: string | null
  gpu_driver: string | null
  components: ComponentInfo[]
  needs_setup: boolean
}

type ProgressStatus = 'queued' | 'starting' | 'downloading' | 'installing' | 'done' | 'error' | 'timeout'

interface ComponentProgress {
  status: ProgressStatus
  pct: number
}

interface StatusResponse {
  running: boolean
  current_component: string | null
  progress: Record<string, ComponentProgress>
  error: string | null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function statusLabel(s: ProgressStatus): string {
  switch (s) {
    case 'queued': return 'Waiting...'
    case 'starting': return 'Starting...'
    case 'downloading': return 'Downloading...'
    case 'installing': return 'Installing...'
    case 'done': return 'Done'
    case 'error': return 'Failed'
    case 'timeout': return 'Timed out'
  }
}

function statusColor(s: ProgressStatus): string {
  if (s === 'done') return 'bg-green-500'
  if (s === 'error' || s === 'timeout') return 'bg-red-500'
  return 'bg-indigo-500'
}

function barTrackColor(s: ProgressStatus): string {
  if (s === 'done') return 'bg-green-100 dark:bg-green-900/30'
  if (s === 'error' || s === 'timeout') return 'bg-red-100 dark:bg-red-900/30'
  return 'bg-indigo-100 dark:bg-indigo-900/30'
}

// ─── Main Component ──────────────────────────────────────────────────────────

interface SetupScreenProps {
  onComplete: () => void
}

type Phase = 'detecting' | 'results' | 'installing' | 'done' | 'error'

export default function SetupScreen({ onComplete }: SetupScreenProps) {
  const [phase, setPhase] = useState<Phase>('detecting')
  const [detectData, setDetectData] = useState<DetectResponse | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [statusData, setStatusData] = useState<StatusResponse | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [pollInterval, setPollInterval] = useState<ReturnType<typeof setInterval> | null>(null)

  // ── Detection ──────────────────────────────────────────────────────────────

  const runDetect = useCallback(async () => {
    setPhase('detecting')
    setErrorMsg(null)
    try {
      const data = await apiFetch<DetectResponse>('/setup/detect')
      setDetectData(data)

      // Auto-skip: all required deps present
      if (!data.needs_setup) {
        onComplete()
        return
      }

      // Pre-select: required components always selected, optional only if not installed
      const initial = new Set<string>()
      for (const c of data.components) {
        if (c.required) {
          initial.add(c.name)
        } else if (!c.installed) {
          initial.add(c.name)
        }
      }
      setSelected(initial)
      setPhase('results')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Detection failed')
      setPhase('error')
    }
  }, [onComplete])

  useEffect(() => {
    runDetect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Install ────────────────────────────────────────────────────────────────

  async function startInstall() {
    if (!detectData) return
    setPhase('installing')
    setStatusData(null)
    setErrorMsg(null)

    try {
      await apiFetch('/setup/install', {
        method: 'POST',
        body: JSON.stringify({ components: Array.from(selected) }),
      })
      beginPolling()
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Install failed to start')
      setPhase('error')
    }
  }

  function beginPolling() {
    const id = setInterval(async () => {
      try {
        const s = await apiFetch<StatusResponse>('/setup/status')
        setStatusData(s)

        if (!s.running) {
          clearInterval(id)
          setPollInterval(null)
          if (s.error) {
            setErrorMsg(s.error)
            setPhase('error')
          } else {
            setPhase('done')
          }
        }
      } catch {
        // transient; keep polling
      }
    }, 1000)
    setPollInterval(id)
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollInterval) clearInterval(pollInterval)
    }
  }, [pollInterval])

  // ── Toggle optional component ──────────────────────────────────────────────

  function toggleComponent(name: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) {
        next.delete(name)
      } else {
        next.add(name)
      }
      return next
    })
  }

  // ── Derived values ─────────────────────────────────────────────────────────

  const hasPython = detectData?.components.find((c) => c.name === 'python')?.installed ?? false

  const allRequiredInstalled = detectData
    ? detectData.components.filter((c) => c.required).every((c) => c.installed && !c.outdated)
    : false

  const nothingSelected = selected.size === 0

  const totalDownloadMb = detectData
    ? detectData.components
        .filter((c) => selected.has(c.name) && c.download_size && !c.installed)
        .reduce((acc, c) => {
          const match = c.download_size?.match(/([\d.]+)\s*(MB|GB)/i)
          if (!match) return acc
          const val = parseFloat(match[1])
          return acc + (match[2].toUpperCase() === 'GB' ? val * 1024 : val)
        }, 0)
    : 0

  const downloadLabel =
    totalDownloadMb >= 1024
      ? `${(totalDownloadMb / 1024).toFixed(1)} GB`
      : totalDownloadMb > 0
      ? `${Math.round(totalDownloadMb)} MB`
      : null

  // ── Installing phase items ─────────────────────────────────────────────────

  const installingItems = detectData
    ? detectData.components.filter((c) => selected.has(c.name))
    : []

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 p-4">
      <div className="max-w-lg w-full">
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-lg overflow-hidden">

          {/* Header */}
          <div className="px-8 pt-8 pb-4 text-center">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              TuneSalon Desktop
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {phase === 'detecting' && 'Detecting your system...'}
              {phase === 'results' && 'First-time setup'}
              {phase === 'installing' && 'Installing dependencies'}
              {phase === 'done' && 'Setup complete'}
              {phase === 'error' && 'Setup error'}
            </p>
          </div>

          <div className="px-8 pb-8 space-y-4">

            {/* ── DETECTING ──────────────────────────────────────────────── */}
            {phase === 'detecting' && (
              <div className="py-10 flex flex-col items-center gap-4">
                <div className="w-10 h-10 border-4 border-indigo-200 dark:border-indigo-800 border-t-indigo-600 rounded-full animate-spin" />
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Detecting your system...
                </p>
              </div>
            )}

            {/* ── RESULTS ────────────────────────────────────────────────── */}
            {phase === 'results' && detectData && (
              <>
                {/* Error banner */}
                {errorMsg && (
                  <div className="rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3 text-sm text-red-700 dark:text-red-400">
                    {errorMsg}
                  </div>
                )}

                {/* GPU info */}
                {detectData.gpu_name ? (
                  <div className="rounded-xl bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 p-4">
                    <p className="font-semibold text-green-800 dark:text-green-300">
                      {detectData.gpu_name}
                    </p>
                    {detectData.gpu_driver && (
                      <p className="text-xs text-green-700 dark:text-green-400 mt-0.5">
                        Driver {detectData.gpu_driver}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-4">
                    <p className="font-semibold text-amber-800 dark:text-amber-300">No GPU detected</p>
                    <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                      CPU mode — you can still chat with GGUF models
                    </p>
                  </div>
                )}

                {/* Python missing warning */}
                {!hasPython && (
                  <div className="rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4">
                    <p className="font-semibold text-red-800 dark:text-red-300 mb-1">
                      Python 3.10+ required
                    </p>
                    <p className="text-xs text-red-700 dark:text-red-400">
                      Python is not installed on your system. Please install it from{' '}
                      <a
                        href="https://python.org"
                        target="_blank"
                        rel="noreferrer"
                        className="underline hover:text-red-600 dark:hover:text-red-300"
                      >
                        python.org
                      </a>{' '}
                      before continuing.
                    </p>
                  </div>
                )}

                {/* Component lists */}
                <ComponentSection
                  title="Required"
                  components={detectData.components.filter((c) => c.required)}
                  selected={selected}
                  onToggle={toggleComponent}
                  forceLocked
                />
                <ComponentSection
                  title="Optional"
                  components={detectData.components.filter((c) => !c.required)}
                  selected={selected}
                  onToggle={toggleComponent}
                  forceLocked={false}
                />

                {/* Download size */}
                {downloadLabel && (
                  <p className="text-xs text-gray-400 dark:text-gray-500 text-center">
                    Total download: ~{downloadLabel}
                  </p>
                )}

                {/* Actions */}
                <div className="flex gap-3 pt-1">
                  {allRequiredInstalled && (
                    <button
                      onClick={onComplete}
                      className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                    >
                      Skip
                    </button>
                  )}
                  <button
                    onClick={startInstall}
                    disabled={!hasPython || nothingSelected}
                    className="flex-1 px-4 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Install
                  </button>
                </div>
              </>
            )}

            {/* ── INSTALLING ─────────────────────────────────────────────── */}
            {phase === 'installing' && (
              <>
                <div className="space-y-3">
                  {installingItems.map((c) => {
                    const prog = statusData?.progress[c.name]
                    const s: ProgressStatus = prog?.status ?? 'queued'
                    const pct = prog?.pct ?? 0

                    return (
                      <div key={c.name}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                            {c.display_name}
                          </span>
                          <span className={`text-xs font-medium ${
                            s === 'done'
                              ? 'text-green-600 dark:text-green-400'
                              : s === 'error' || s === 'timeout'
                              ? 'text-red-600 dark:text-red-400'
                              : 'text-indigo-600 dark:text-indigo-400'
                          }`}>
                            {statusLabel(s)}
                          </span>
                        </div>
                        <div className={`w-full h-2 rounded-full overflow-hidden ${barTrackColor(s)}`}>
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${statusColor(s)}`}
                            style={{ width: `${s === 'done' ? 100 : pct}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>

                <p className="text-xs text-center text-gray-400 dark:text-gray-500 pt-2">
                  This may take several minutes — please keep the app open
                </p>
              </>
            )}

            {/* ── DONE ───────────────────────────────────────────────────── */}
            {phase === 'done' && (
              <div className="py-6 flex flex-col items-center gap-4">
                <div className="w-14 h-14 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                  <svg className="w-7 h-7 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div className="text-center">
                  <p className="font-semibold text-gray-900 dark:text-gray-100">All set!</p>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Dependencies installed successfully.
                  </p>
                </div>
                <button
                  onClick={onComplete}
                  className="w-full px-6 py-3 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-700 transition-colors"
                >
                  Continue
                </button>
              </div>
            )}

            {/* ── ERROR ──────────────────────────────────────────────────── */}
            {phase === 'error' && (
              <div className="py-6 flex flex-col items-center gap-4">
                <div className="w-14 h-14 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                  <svg className="w-7 h-7 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                </div>
                <div className="text-center">
                  <p className="font-semibold text-gray-900 dark:text-gray-100">Something went wrong</p>
                  {errorMsg && (
                    <p className="text-sm text-red-600 dark:text-red-400 mt-1 max-w-xs">
                      {errorMsg}
                    </p>
                  )}
                </div>
                <button
                  onClick={runDetect}
                  className="px-6 py-2.5 rounded-xl bg-indigo-600 text-white font-medium hover:bg-indigo-700 transition-colors"
                >
                  Retry
                </button>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  )
}

// ─── ComponentSection sub-component ──────────────────────────────────────────

interface ComponentSectionProps {
  title: string
  components: ComponentInfo[]
  selected: Set<string>
  onToggle: (name: string) => void
  forceLocked: boolean
}

function ComponentSection({ title, components, selected, onToggle, forceLocked }: ComponentSectionProps) {
  if (components.length === 0) return null

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-2">
        {title}
      </p>
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden divide-y divide-gray-200 dark:divide-gray-700">
        {components.map((c) => {
          const isSelected = selected.has(c.name)
          const isLocked = forceLocked // required items are always locked

          return (
            <div
              key={c.name}
              className={`flex items-start gap-3 p-3 ${
                !isLocked ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors' : ''
              }`}
              onClick={() => !isLocked && onToggle(c.name)}
            >
              {/* Checkbox */}
              <div className="mt-0.5 flex-shrink-0">
                <input
                  type="checkbox"
                  checked={isSelected}
                  disabled={isLocked}
                  onChange={() => !isLocked && onToggle(c.name)}
                  onClick={(e) => e.stopPropagation()}
                  className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-indigo-600 focus:ring-indigo-500 disabled:opacity-60 cursor-pointer disabled:cursor-not-allowed"
                />
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-200">
                    {c.display_name}
                  </span>

                  {/* Status badge */}
                  {c.installed && !c.outdated && (
                    <span className="inline-flex items-center gap-1 text-xs text-green-600 dark:text-green-400 font-medium">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                      {c.version ? `v${c.version}` : 'Installed'}
                    </span>
                  )}
                  {c.outdated && (
                    <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                      Outdated (v{c.version})
                    </span>
                  )}
                  {!c.installed && (
                    <span className="text-xs text-red-500 dark:text-red-400 font-medium">
                      Not found{c.download_size ? ` — ${c.download_size}` : ''}
                    </span>
                  )}
                </div>

                {c.description && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">
                    {c.description}
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
