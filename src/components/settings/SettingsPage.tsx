import { useEffect, useState } from 'react'
import type { AppSettings } from '../../types/settings'
import { getSettings, patchSettings, getStorageUsage } from '../../api/settings'
import { useTheme } from '../../contexts/ThemeContext'
import { alertDialog } from '../../utils/native'
import Spinner from '../shared/Spinner'

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
      <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">{title}</h2>
      {children}
    </div>
  )
}

function Label({ children, tooltip }: { children: React.ReactNode; tooltip?: string }) {
  return (
    <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
      {children}
      {tooltip && (
        <span className="relative group">
          <svg className="h-3.5 w-3.5 text-gray-400 cursor-help" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.065 2.01-1.37 3.272-1.37 1.5 0 2.5.946 2.5 2.37 0 1.5-1.5 1.5-1.5 3M12 17h.01" />
            <circle cx="12" cy="12" r="10" strokeWidth={2} />
          </svg>
          <span className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-48 px-2.5 py-1.5 text-[11px] font-normal text-white bg-gray-900 dark:bg-gray-700 rounded-md shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity leading-snug">
            {tooltip}
          </span>
        </span>
      )}
    </label>
  )
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [storage, setStorage] = useState<{
    models_gb: number
    adapters_mb: number
    gguf_gb: number
    embeddings_gb: number
    total_gb: number
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const { theme: currentTheme, setTheme } = useTheme()

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const [s, u] = await Promise.all([getSettings(), getStorageUsage()])
      setSettings(s)
      setStorage(u)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const save = async (partial: Partial<AppSettings>) => {
    setSaving(true)
    try {
      const updated = await patchSettings(partial)
      setSettings(updated)
    } catch (err) {
      await alertDialog(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  const handleThemeChange = (t: 'light' | 'dark' | 'system') => {
    setTheme(t)
    save({ theme: t })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner className="h-8 w-8" />
        <span className="ml-3 text-gray-500 dark:text-gray-400">Loading settings...</span>
      </div>
    )
  }

  if (error || !settings) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-red-600 dark:text-red-400 mb-4">{error || 'Failed to load settings'}</p>
        <button onClick={load} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">Retry</button>
      </div>
    )
  }

  const paths = settings.storage_paths || {}
  const td = settings.training_defaults || {}

  return (
    <div className="p-6 overflow-y-auto h-full space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-1">Settings</h1>
        <p className="text-gray-500 dark:text-gray-400">Configure your local environment</p>
      </div>

      {/* Storage */}
      <Card title="Storage">
        <div className="space-y-3">
          {Object.entries(paths).map(([key, value]) => {
            // Hide embeddings — internal cache, not user-facing
            if (key === 'embeddings') return null
            return (
              <div key={key} className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300 capitalize">{key.replace(/_/g, ' ')}</span>
                  <p className="text-xs text-gray-500 dark:text-gray-400 font-mono">{value}</p>
                </div>
                <button
                  className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline opacity-50 cursor-not-allowed"
                  title="Folder picker will use native Tauri dialog"
                  disabled
                >
                  Change
                </button>
              </div>
            )
          })}
          {storage && (
            <div className="pt-3 border-t border-gray-100 dark:border-gray-800 space-y-1.5">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Disk Usage</p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-gray-500 dark:text-gray-400">
                <span>Models</span>
                <span className="text-right">{storage.models_gb.toFixed(2)} GB</span>
                <span>Adapters</span>
                <span className="text-right">{storage.adapters_mb.toFixed(0)} MB</span>
                <span>GGUF exports</span>
                <span className="text-right">{storage.gguf_gb.toFixed(2)} GB</span>
              </div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300 pt-1">
                Total: {storage.total_gb.toFixed(2)} GB
              </p>
            </div>
          )}
        </div>
      </Card>

      {/* Appearance */}
      <Card title="Appearance">
        <div className="flex gap-3">
          {(['light', 'dark', 'system'] as const).map(t => (
            <button
              key={t}
              onClick={() => handleThemeChange(t)}
              className={`rounded-lg px-4 py-2 text-sm font-medium border transition-colors ${
                currentTheme === t
                  ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
                  : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600'
              }`}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
      </Card>

      {/* GPU */}
      <Card title="GPU">
        <div className="space-y-4">
          <div>
            <Label>GPU Mode</Label>
            <div className="flex gap-3">
              {(['auto', 'gpu', 'cpu'] as const).map(mode => (
                <button
                  key={mode}
                  onClick={() => save({ gpu_mode: mode })}
                  className={`rounded-lg px-4 py-2 text-sm font-medium border transition-colors ${
                    settings.gpu_mode === mode
                      ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
                      : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600'
                  }`}
                >
                  {mode === 'auto' ? 'Auto' : mode.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label tooltip="Controls how much of a GGUF model runs on your GPU vs CPU. 'All on GPU' is fastest. 'CPU only' is slowest but uses no VRAM. Adjust if you run out of GPU memory.">
              GGUF Speed: {settings.n_gpu_layers === -1 ? 'All on GPU (fastest)' : settings.n_gpu_layers === 0 ? 'CPU only (slowest)' : `${settings.n_gpu_layers} layers on GPU`}
            </Label>
            <input
              type="range"
              min={-1}
              max={100}
              value={settings.n_gpu_layers}
              onChange={e => {
                const val = parseInt(e.target.value)
                setSettings(prev => prev ? { ...prev, n_gpu_layers: val } : prev)
              }}
              onMouseUp={() => save({ n_gpu_layers: settings.n_gpu_layers })}
              onTouchEnd={() => save({ n_gpu_layers: settings.n_gpu_layers })}
              className="w-full max-w-xs accent-indigo-600"
            />
            <div className="flex justify-between text-xs text-gray-400 mt-1 max-w-xs">
              <span>CPU only</span>
              <span>All on GPU</span>
            </div>
          </div>
        </div>
      </Card>

      {/* Training Defaults */}
      <Card title="Training Defaults">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label tooltip="How many times the model reads through your entire dataset. More passes = better learning, but too many can cause overfitting.">Epochs</Label>
            <input
              type="number"
              min={1}
              max={10}
              value={td.epochs ?? 3}
              onChange={e => {
                const v = parseInt(e.target.value) || 3
                setSettings(prev => prev ? { ...prev, training_defaults: { ...prev.training_defaults, epochs: v } } : prev)
              }}
              onBlur={() => save({ training_defaults: { ...td, epochs: td.epochs ?? 3 } })}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <Label tooltip="How fast the model learns. Smaller = more careful learning. 0.0001 works well for most cases.">Learning Rate</Label>
            <input
              type="number"
              step={0.00001}
              min={0.00001}
              max={0.01}
              value={td.learning_rate ?? 0.0001}
              onChange={e => {
                const v = parseFloat(e.target.value) || 0.0001
                setSettings(prev => prev ? { ...prev, training_defaults: { ...prev.training_defaults, learning_rate: v } } : prev)
              }}
              onBlur={() => save({ training_defaults: { ...td, learning_rate: td.learning_rate ?? 0.0001 } })}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <Label tooltip="Controls how much the model can change during training. Higher = more capacity to learn, but uses more memory. 16 is good for most cases.">LoRA Rank</Label>
            <select
              value={td.lora_rank ?? 16}
              onChange={e => {
                const v = parseInt(e.target.value)
                const updated = { ...td, lora_rank: v }
                setSettings(prev => prev ? { ...prev, training_defaults: updated } : prev)
                save({ training_defaults: updated })
              }}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
            >
              <option value={8}>8</option>
              <option value={16}>16</option>
              <option value={32}>32</option>
            </select>
          </div>
          <div>
            <Label tooltip="Scales the learning intensity. Usually set to 2x the LoRA Rank. Higher = stronger changes per training step.">LoRA Alpha</Label>
            <input
              type="number"
              min={1}
              max={128}
              value={td.lora_alpha ?? 32}
              onChange={e => {
                const v = parseInt(e.target.value) || 32
                setSettings(prev => prev ? { ...prev, training_defaults: { ...prev.training_defaults, lora_alpha: v } } : prev)
              }}
              onBlur={() => save({ training_defaults: { ...td, lora_alpha: td.lora_alpha ?? 32 } })}
              className="w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm"
            />
          </div>
        </div>
      </Card>

      {/* About */}
      <Card title="About">
        <div className="space-y-3 text-sm text-gray-600 dark:text-gray-400">
          <p className="font-medium text-gray-900 dark:text-gray-100">TuneSalon Desktop v0.1.0</p>
          <p>Custom AI, Made Simple. Fine-tune models locally with full privacy.</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 pt-2">
            <a href="https://tunesalonai.com" target="_blank" rel="noopener noreferrer" className="text-indigo-600 dark:text-indigo-400 hover:underline">
              Website
            </a>
            <a href="https://tunesalonai.com/terms" target="_blank" rel="noopener noreferrer" className="text-indigo-600 dark:text-indigo-400 hover:underline">
              Terms of Service
            </a>
            <a href="https://tunesalonai.com/privacy" target="_blank" rel="noopener noreferrer" className="text-indigo-600 dark:text-indigo-400 hover:underline">
              Privacy Policy
            </a>
            <a href="https://tunesalonai.com/cookies" target="_blank" rel="noopener noreferrer" className="text-indigo-600 dark:text-indigo-400 hover:underline">
              Cookie Policy
            </a>
            <a href="https://tunesalonai.com/returns" target="_blank" rel="noopener noreferrer" className="text-indigo-600 dark:text-indigo-400 hover:underline">
              Returns Policy
            </a>
          </div>
        </div>
      </Card>

      {saving && (
        <div className="fixed bottom-4 right-4 rounded-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900 px-4 py-2 text-sm shadow-lg flex items-center gap-2">
          <Spinner className="h-4 w-4" />
          Saving...
        </div>
      )}
    </div>
  )
}
