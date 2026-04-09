import { useState, useEffect } from 'react'
import Spinner from '../shared/Spinner'
import type { ChatStatus } from '../../types/chat'
import { loadModel, loadGguf, loadAdapter, removeAdapter, unloadModel } from '../../api/chat'
import { getModels, getAdapters, getGgufs } from '../../api/library'
import type { BaseModelEntry, AdapterEntry, GgufEntry } from '../../types/library'

interface Props {
  status: ChatStatus
  onStatusChange: () => void
  onSystemPromptSuggested?: (prompt: string) => void
}

type GpuMode = 'cpu' | 'auto' | 'max'
const GPU_MODE_MAP: Record<GpuMode, number> = { cpu: 0, auto: -1, max: 99 }
const CTX_PRESETS = [2048, 4096, 8192] as const

export default function ModelLoader({ status, onStatusChange, onSystemPromptSuggested }: Props) {
  const [engine, setEngine] = useState<'pytorch' | 'gguf'>(status.engine === 'gguf' ? 'gguf' : 'pytorch')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Library data
  const [models, setModels] = useState<BaseModelEntry[]>([])
  const [adapters, setAdapters] = useState<AdapterEntry[]>([])
  const [ggufs, setGgufs] = useState<GgufEntry[]>([])
  const [libraryLoading, setLibraryLoading] = useState(true)

  // Full Model fields
  const [selectedModel, setSelectedModel] = useState('')
  const [selectedAdapter, setSelectedAdapter] = useState('')

  // GGUF fields
  const [selectedGguf, setSelectedGguf] = useState('')
  const [gpuMode, setGpuMode] = useState<GpuMode>('auto')
  const [nCtx, setNCtx] = useState(4096)

  // Add adapter dropdown
  const [adapterToAdd, setAdapterToAdd] = useState('')

  const isModelLoaded = !!status.model

  // Fetch library data on mount
  useEffect(() => {
    let cancelled = false
    async function fetchLibrary() {
      setLibraryLoading(true)
      try {
        const [m, a, g] = await Promise.all([getModels(), getAdapters(), getGgufs()])
        if (!cancelled) {
          setModels(m)
          setAdapters(a)
          setGgufs(g)
        }
      } catch {
        // silently fail — dropdowns will just be empty
      } finally {
        if (!cancelled) setLibraryLoading(false)
      }
    }
    fetchLibrary()
    return () => { cancelled = true }
  }, [])

  const handleLoadPytorch = async () => {
    if (!selectedModel) return
    setLoading(true)
    setError(null)
    try {
      const result = await loadModel({
        model_name: selectedModel,
        adapter_path: selectedAdapter || null,
      })
      onStatusChange()
      // Auto-fill system prompt from adapter metadata if available
      if (result.system_prompt && onSystemPromptSuggested) {
        onSystemPromptSuggested(result.system_prompt)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load model')
    } finally {
      setLoading(false)
    }
  }

  const handleLoadGguf = async () => {
    if (!selectedGguf) return
    setLoading(true)
    setError(null)
    try {
      await loadGguf({
        gguf_path: selectedGguf,
        n_gpu_layers: GPU_MODE_MAP[gpuMode],
        n_ctx: nCtx,
      })
      onStatusChange()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load model')
    } finally {
      setLoading(false)
    }
  }

  const handleAddAdapter = async () => {
    if (!adapterToAdd) return
    setLoading(true)
    setError(null)
    try {
      const result = await loadAdapter({ adapter_path: adapterToAdd })
      setAdapterToAdd('')
      onStatusChange()
      // Auto-fill system prompt from adapter metadata if available
      if (result.system_prompt && onSystemPromptSuggested) {
        onSystemPromptSuggested(result.system_prompt)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load adapter')
    } finally {
      setLoading(false)
    }
  }

  const handleRemoveAdapter = async (index: number) => {
    setLoading(true)
    setError(null)
    try {
      await removeAdapter(index)
      onStatusChange()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove adapter')
    } finally {
      setLoading(false)
    }
  }

  const handleUnload = async () => {
    setLoading(true)
    setError(null)
    try {
      await unloadModel()
      onStatusChange()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to unload model')
    } finally {
      setLoading(false)
    }
  }

  // Filter out adapters already loaded
  const availableAdapters = adapters.filter(
    (a) => !status.adapters.includes(a.name) && !status.adapters.includes(a.path)
  )

  const selectClass =
    'w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-gray-100'

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
        Model
      </h3>

      {/* Status display when loaded */}
      {isModelLoaded && (
        <div className="rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 p-3">
          <div className="text-sm font-medium text-green-800 dark:text-green-300">
            {status.model}
          </div>
          <div className="text-xs text-green-600 dark:text-green-400 mt-0.5">
            {status.engine === 'gguf'
              ? 'Merged Model (GGUF)'
              : status.adapters.length > 0
                ? `Base + Adapter (${status.adapters.length})`
                : 'Base Model'}
          </div>
        </div>
      )}

      {/* Engine toggle - only when no model loaded */}
      {!isModelLoaded && (
        <div className="flex rounded-lg bg-gray-100 dark:bg-gray-800 p-0.5">
          <button
            onClick={() => setEngine('pytorch')}
            className={`flex-1 text-xs font-medium py-1.5 rounded-md transition-colors ${
              engine === 'pytorch'
                ? 'bg-white dark:bg-gray-700 text-indigo-600 dark:text-indigo-400 shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
            }`}
          >
            Base Model
          </button>
          <button
            onClick={() => setEngine('gguf')}
            className={`flex-1 text-xs font-medium py-1.5 rounded-md transition-colors ${
              engine === 'gguf'
                ? 'bg-white dark:bg-gray-700 text-indigo-600 dark:text-indigo-400 shadow-sm'
                : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
            }`}
          >
            Merged Model (GGUF)
          </button>
        </div>
      )}

      {/* Full Model mode */}
      {!isModelLoaded && engine === 'pytorch' && (
        <div className="space-y-3">
          {libraryLoading ? (
            <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 py-2">
              <Spinner className="h-3 w-3" />
              Loading library...
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  Model
                </label>
                {models.length === 0 ? (
                  <p className="text-xs text-gray-500 dark:text-gray-400 italic py-1">
                    No models downloaded yet. Download one from the Train tab.
                  </p>
                ) : (
                  <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className={selectClass}
                  >
                    <option value="">Select a model...</option>
                    {models.map((m) => (
                      <option key={m.path} value={m.path}>
                        {m.name} ({m.size_gb.toFixed(1)} GB)
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  Adapter (optional)
                </label>
                <select
                  value={selectedAdapter}
                  onChange={(e) => setSelectedAdapter(e.target.value)}
                  className={selectClass}
                >
                  <option value="">None</option>
                  {adapters.map((a) => (
                    <option key={a.path} value={a.path}>
                      {a.name} ({a.size_mb.toFixed(0)} MB)
                      {a.base_model ? ` - ${a.base_model}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <button
                onClick={handleLoadPytorch}
                disabled={loading || !selectedModel}
                className="w-full rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
              >
                {loading && <Spinner className="h-4 w-4 text-white" />}
                Load Model
              </button>
            </>
          )}
        </div>
      )}

      {/* Lightweight (GGUF) mode */}
      {!isModelLoaded && engine === 'gguf' && (
        <div className="space-y-3">
          <div className="rounded-md bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 px-3 py-2">
            <p className="text-xs text-blue-700 dark:text-blue-300">
              Merged GGUF models are self-contained and can run alongside training.
            </p>
          </div>
          {libraryLoading ? (
            <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 py-2">
              <Spinner className="h-3 w-3" />
              Loading library...
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  GGUF File
                </label>
                {ggufs.length === 0 ? (
                  <p className="text-xs text-gray-500 dark:text-gray-400 italic py-1">
                    No GGUF files yet. Export one from the Train tab.
                  </p>
                ) : (
                  <select
                    value={selectedGguf}
                    onChange={(e) => setSelectedGguf(e.target.value)}
                    className={selectClass}
                  >
                    <option value="">Select a file...</option>
                    {ggufs.map((g) => (
                      <option key={g.path} value={g.path}>
                        {g.name} ({g.size_gb.toFixed(1)} GB)
                        {g.quantization ? ` - ${g.quantization}` : ''}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  Processing
                </label>
                <div className="flex rounded-lg bg-gray-100 dark:bg-gray-800 p-0.5">
                  {([
                    ['cpu', 'CPU Only'],
                    ['auto', 'Auto (Recommended)'],
                    ['max', 'Max GPU'],
                  ] as [GpuMode, string][]).map(([mode, label]) => (
                    <button
                      key={mode}
                      onClick={() => setGpuMode(mode)}
                      className={`flex-1 text-xs font-medium py-1.5 rounded-md transition-colors ${
                        gpuMode === mode
                          ? 'bg-white dark:bg-gray-700 text-indigo-600 dark:text-indigo-400 shadow-sm'
                          : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  Context Length
                </label>
                <div className="flex rounded-lg bg-gray-100 dark:bg-gray-800 p-0.5">
                  {CTX_PRESETS.map((preset) => (
                    <button
                      key={preset}
                      onClick={() => setNCtx(preset)}
                      className={`flex-1 text-xs font-medium py-1.5 rounded-md transition-colors ${
                        nCtx === preset
                          ? 'bg-white dark:bg-gray-700 text-indigo-600 dark:text-indigo-400 shadow-sm'
                          : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'
                      }`}
                    >
                      {preset.toLocaleString()}
                    </button>
                  ))}
                </div>
              </div>
              <button
                onClick={handleLoadGguf}
                disabled={loading || !selectedGguf}
                className="w-full rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
              >
                {loading && <Spinner className="h-4 w-4 text-white" />}
                Load Model
              </button>
            </>
          )}
        </div>
      )}

      {/* Adapters section (Full Model only, when model loaded) */}
      {isModelLoaded && status.engine === 'pytorch' && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
              Adapters ({status.adapters.length}/5)
            </span>
          </div>
          {status.adapters.map((adapter, i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-md bg-gray-50 dark:bg-gray-800 px-3 py-1.5"
            >
              <span className="text-xs text-gray-700 dark:text-gray-300 truncate flex-1 mr-2">
                {adapter}
              </span>
              <button
                onClick={() => handleRemoveAdapter(i)}
                disabled={loading}
                className="text-xs text-red-500 hover:text-red-600 disabled:opacity-50"
              >
                Remove
              </button>
            </div>
          ))}
          {status.adapters.length < 5 && (
            <div className="flex gap-2">
              <select
                value={adapterToAdd}
                onChange={(e) => setAdapterToAdd(e.target.value)}
                className={`flex-1 ${selectClass}`}
              >
                <option value="">Add an adapter...</option>
                {availableAdapters.map((a) => (
                  <option key={a.path} value={a.path}>
                    {a.name} ({a.size_mb.toFixed(0)} MB)
                    {a.base_model ? ` - ${a.base_model}` : ''}
                  </option>
                ))}
              </select>
              <button
                onClick={handleAddAdapter}
                disabled={loading || !adapterToAdd}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
              >
                {loading && <Spinner className="h-3 w-3 text-white" />}
                Add
              </button>
            </div>
          )}
        </div>
      )}

      {/* Unload button */}
      {isModelLoaded && (
        <button
          onClick={handleUnload}
          disabled={loading}
          className="w-full rounded-md border border-red-300 dark:border-red-700 px-3 py-2 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
        >
          {loading && <Spinner className="h-4 w-4" />}
          Unload Model
        </button>
      )}

      {error && (
        <div className="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-3 py-2">
          <p className="text-xs text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}
    </div>
  )
}
