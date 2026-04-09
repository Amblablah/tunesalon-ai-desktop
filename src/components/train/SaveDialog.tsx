import { useState, useEffect } from 'react'
import Spinner from '../shared/Spinner'
import { saveAdapter, exportGguf, getSavePaths } from '../../api/train'
import { openFolderDialog } from '../../utils/native'
import type { SaveAdapterRequest, GgufExportRequest } from '../../types/train'

const QUANTIZATION_OPTIONS = [
  { value: 'Q8_0', label: 'Maximum Quality', desc: 'Largest file, closest to original' },
  { value: 'Q5_K_M', label: 'Balanced', desc: 'Good quality with smaller size' },
  { value: 'Q4_K_M', label: 'Fast & Light', desc: 'Smaller file, runs on most hardware' },
  { value: 'Q2_K', label: 'Ultra Compact', desc: 'Smallest file, some quality trade-off' },
]

interface Props {
  baseModel: string
  adapterPath?: string
  onDone: () => void
}

/** Shorten a path for display: show last 3 segments with ... prefix */
function shortenPath(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/')
  if (parts.length <= 3) return p
  return '...' + parts.slice(-3).join('/')
}

export default function SaveDialog({ baseModel, adapterPath, onDone }: Props) {
  // Default paths
  const [defaultAdapterDir, setDefaultAdapterDir] = useState('')
  const [defaultGgufDir, setDefaultGgufDir] = useState('')

  // Adapter save state
  const [adapterName, setAdapterName] = useState('')
  const [adapterDesc, setAdapterDesc] = useState('')
  const [adapterCustomPath, setAdapterCustomPath] = useState<string | null>(null)
  const [savingAdapter, setSavingAdapter] = useState(false)
  const [adapterSaved, setAdapterSaved] = useState(false)
  const [adapterSavedPath, setAdapterSavedPath] = useState('')
  const [adapterError, setAdapterError] = useState('')

  // GGUF export state
  const [quantization, setQuantization] = useState('Q5_K_M')
  const [ggufName, setGgufName] = useState('')
  const [ggufCustomPath, setGgufCustomPath] = useState<string | null>(null)
  const [exportingGguf, setExportingGguf] = useState(false)
  const [ggufResult, setGgufResult] = useState<{ path: string; size_mb: number } | null>(null)
  const [ggufError, setGgufError] = useState('')

  useEffect(() => {
    getSavePaths()
      .then((paths) => {
        setDefaultAdapterDir(paths.adapters_dir)
        setDefaultGgufDir(paths.gguf_dir)
      })
      .catch(() => {})
  }, [])

  async function handleBrowseFolder(setter: (path: string | null) => void) {
    try {
      const path = await openFolderDialog()
      if (path) setter(path)
    } catch {
      // User cancelled or dialog failed — ignore
    }
  }

  async function handleSaveAdapter() {
    if (!adapterName.trim()) {
      setAdapterError('Please enter a name for your adapter')
      return
    }
    setAdapterError('')
    setSavingAdapter(true)
    try {
      const req: SaveAdapterRequest = {
        adapter_name: adapterName.trim(),
        description: adapterDesc.trim() || undefined,
        base_model: baseModel,
        custom_path: adapterCustomPath || undefined,
      }
      const result = await saveAdapter(req)
      setAdapterSaved(true)
      setAdapterSavedPath(result.path)
    } catch (err: unknown) {
      setAdapterError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSavingAdapter(false)
    }
  }

  async function handleExportGguf() {
    setGgufError('')
    setExportingGguf(true)
    try {
      const req: GgufExportRequest = {
        adapter_path: adapterPath || '',
        base_model: baseModel,
        quantization,
        output_name: ggufName.trim() || undefined,
        custom_path: ggufCustomPath || undefined,
      }
      const result = await exportGguf(req)
      setGgufResult(result)
    } catch (err: unknown) {
      setGgufError(err instanceof Error ? err.message : 'Export failed')
    } finally {
      setExportingGguf(false)
    }
  }

  const adapterSaveDir = adapterCustomPath || defaultAdapterDir
  const ggufSaveDir = ggufCustomPath || defaultGgufDir

  return (
    <div className="space-y-6">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Save Your Training Results</h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Save Adapter Card */}
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 space-y-4">
          <div>
            <h4 className="font-medium text-gray-900 dark:text-gray-100">Save Adapter</h4>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Small file (~30-80 MB) that works with the original model
            </p>
          </div>

          {adapterSaved ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-green-700 dark:text-green-400 text-sm">
                <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                Saved!
              </div>
              {adapterSavedPath && (
                <p className="text-xs text-gray-500 dark:text-gray-400 break-all">
                  {adapterSavedPath}
                </p>
              )}
            </div>
          ) : (
            <>
              <div className="space-y-3">
                <div>
                  <label className="text-sm text-gray-700 dark:text-gray-300 block mb-1">Name</label>
                  <input
                    type="text"
                    placeholder="my-custom-adapter"
                    value={adapterName}
                    onChange={(e) => setAdapterName(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="text-sm text-gray-700 dark:text-gray-300 block mb-1">Description (optional)</label>
                  <input
                    type="text"
                    placeholder="What this adapter does..."
                    value={adapterDesc}
                    onChange={(e) => setAdapterDesc(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              {/* Save location */}
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">Save to</label>
                <div className="flex items-center gap-2">
                  <span className="flex-1 text-xs text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-900 rounded px-2 py-1.5 truncate" title={adapterSaveDir}>
                    {shortenPath(adapterSaveDir)}
                  </span>
                  <button
                    onClick={() => handleBrowseFolder(setAdapterCustomPath)}
                    className="shrink-0 text-xs px-2.5 py-1.5 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  >
                    Browse...
                  </button>
                  {adapterCustomPath && (
                    <button
                      onClick={() => setAdapterCustomPath(null)}
                      className="shrink-0 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                      title="Reset to default"
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>

              {adapterError && (
                <p className="text-xs text-red-600 dark:text-red-400">{adapterError}</p>
              )}

              <button
                onClick={handleSaveAdapter}
                disabled={savingAdapter}
                className="w-full py-2.5 px-4 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
              >
                {savingAdapter ? (
                  <>
                    <Spinner className="h-4 w-4" />
                    Saving...
                  </>
                ) : (
                  'Save Adapter'
                )}
              </button>
            </>
          )}
        </div>

        {/* Export GGUF Card */}
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-5 space-y-4">
          <div>
            <h4 className="font-medium text-gray-900 dark:text-gray-100">Export as GGUF</h4>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Standalone file (~1-5 GB) that runs without the original model
            </p>
          </div>

          {ggufResult ? (
            <div className="rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 px-3 py-2 space-y-1">
              <div className="flex items-center gap-2 text-green-700 dark:text-green-400 text-sm font-medium">
                <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                Exported! ({ggufResult.size_mb} MB)
              </div>
              <p className="text-xs text-green-600 dark:text-green-500 break-all">{ggufResult.path}</p>
            </div>
          ) : (
            <>
              <div className="space-y-3">
                <div>
                  <label className="text-sm text-gray-700 dark:text-gray-300 block mb-1">Quality Level</label>
                  <div className="space-y-1.5">
                    {QUANTIZATION_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => setQuantization(opt.value)}
                        className={`w-full text-left rounded-lg border p-2.5 transition-colors ${
                          quantization === opt.value
                            ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30'
                            : 'border-gray-200 dark:border-gray-700 hover:border-indigo-300'
                        }`}
                      >
                        <span className={`text-sm font-medium ${
                          quantization === opt.value
                            ? 'text-indigo-700 dark:text-indigo-300'
                            : 'text-gray-900 dark:text-gray-100'
                        }`}>
                          {opt.label}
                        </span>
                        <span className="block text-xs text-gray-500 dark:text-gray-400">{opt.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-sm text-gray-700 dark:text-gray-300 block mb-1">Output Name (optional)</label>
                  <input
                    type="text"
                    placeholder="my-model"
                    value={ggufName}
                    onChange={(e) => setGgufName(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              </div>

              {/* Save location */}
              <div>
                <label className="text-xs text-gray-500 dark:text-gray-400 block mb-1">Save to</label>
                <div className="flex items-center gap-2">
                  <span className="flex-1 text-xs text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-900 rounded px-2 py-1.5 truncate" title={ggufSaveDir}>
                    {shortenPath(ggufSaveDir)}
                  </span>
                  <button
                    onClick={() => handleBrowseFolder(setGgufCustomPath)}
                    className="shrink-0 text-xs px-2.5 py-1.5 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  >
                    Browse...
                  </button>
                  {ggufCustomPath && (
                    <button
                      onClick={() => setGgufCustomPath(null)}
                      className="shrink-0 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                      title="Reset to default"
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>

              {ggufError && (
                <p className="text-xs text-red-600 dark:text-red-400">{ggufError}</p>
              )}

              <button
                onClick={handleExportGguf}
                disabled={exportingGguf}
                className="w-full py-2.5 px-4 text-sm font-medium rounded-lg border border-indigo-500 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
              >
                {exportingGguf ? (
                  <>
                    <Spinner className="h-4 w-4" />
                    Merging model... this may take several minutes
                  </>
                ) : (
                  'Export GGUF'
                )}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Done / back to start */}
      <div className="text-center">
        <button
          onClick={onDone}
          className="text-sm text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400"
        >
          Train another model
        </button>
      </div>
    </div>
  )
}
