import { useState, useEffect, useRef } from 'react'
import Spinner from '../shared/Spinner'
import { getCuratedModels, searchModels, startModelDownload, connectDownloadStream, cancelDownload, getDownloadStatus, checkModelDownloaded } from '../../api/train'
import { getModelCompatibility } from '../../api/system'
import type { ModelSearchResult, ModelDownloadStatus } from '../../types/train'
import type { ModelCompatibility } from '../../types/system'

interface Props {
  selectedModel: ModelSearchResult | null
  onSelect: (model: ModelSearchResult | null) => void
  modelReady: boolean
  onModelReady: (ready: boolean) => void
}

export default function ModelSelector({ selectedModel, onSelect, modelReady, onModelReady }: Props) {
  const [curatedModels, setCuratedModels] = useState<ModelSearchResult[]>([])
  const [searchResults, setSearchResults] = useState<ModelSearchResult[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [searching, setSearching] = useState(false)
  const [download, setDownload] = useState<ModelDownloadStatus>({ status: 'idle', model_id: null, progress: null, message: null })
  const [error, setError] = useState('')
  const [compatibility, setCompatibility] = useState<Record<string, ModelCompatibility>>({})
  const esRef = useRef<EventSource | null>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      getCuratedModels(),
      getModelCompatibility().catch(() => [] as ModelCompatibility[]),
    ])
      .then(([models, compat]) => {
        setCuratedModels(models)
        const lookup: Record<string, ModelCompatibility> = {}
        for (const c of compat) lookup[c.name] = c
        setCompatibility(lookup)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))

    // Check if a download is already in progress
    getDownloadStatus()
      .then((status) => {
        if (status.status === 'downloading') {
          setDownload(status)
        }
      })
      .catch(() => {})

    return () => {
      esRef.current?.close()
    }
  }, [])

  function handleSearch(query: string) {
    setSearchQuery(query)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (!query.trim()) {
      setSearchResults([])
      return
    }
    searchTimer.current = setTimeout(async () => {
      setSearching(true)
      try {
        const results = await searchModels(query)
        setSearchResults(results)
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Search failed')
      } finally {
        setSearching(false)
      }
    }, 400)
  }

  async function handleSelectModel(model: ModelSearchResult) {
    onSelect(model)
    onModelReady(false)
    setError('')
    setSearchQuery('')
    setSearchResults([])
    setDownload({ status: 'idle', model_id: null, progress: null, message: null })
    esRef.current?.close()

    // Check if model is already downloaded
    try {
      const alreadyDownloaded = await checkModelDownloaded(model.model_id)
      if (alreadyDownloaded) {
        setDownload({ status: 'complete', model_id: model.model_id, progress: 100, message: 'Model already downloaded' })
        onModelReady(true)
      }
    } catch {
      // Ignore check errors — user can still click Download
    }
  }

  async function handleDownload(model: ModelSearchResult) {
    setError('')
    setDownload({ status: 'downloading', model_id: model.model_id, progress: -1, message: 'Starting download...' })
    esRef.current?.close()

    try {
      // Await POST so backend state is set before SSE connects
      const result = await startModelDownload(model.model_id)
      if (result.status === 'complete') {
        // Already downloaded
        setDownload({ status: 'complete', model_id: model.model_id, progress: 100, message: result.message || 'Model ready' })
        onModelReady(true)
        return
      }

      // Now connect SSE — backend state is guaranteed to be 'downloading'
      esRef.current = connectDownloadStream(
        (data) => {
          setDownload(data)
          if (data.status === 'complete') {
            onModelReady(true)
          }
        },
        (err) => {
          setError(err)
          setDownload((prev) => ({ ...prev, status: 'error' }))
        },
      )
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Download failed')
      setDownload({ status: 'error', model_id: model.model_id, progress: null, message: 'Download failed' })
    }
  }

  async function handleCancelDownload() {
    try {
      await cancelDownload()
      esRef.current?.close()
      setDownload({ status: 'cancelled', model_id: null, progress: null, message: 'Download cancelled' })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to cancel')
    }
  }

  const displayModels = searchQuery.trim() ? searchResults : curatedModels
  const isDownloading = download.status === 'downloading'

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Choose a Model</h3>

      {/* Search input */}
      <div className="relative">
        <input
          type="text"
          placeholder="Search models on HuggingFace..."
          value={searchQuery}
          onChange={(e) => handleSearch(e.target.value)}
          className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2.5 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        {searching && (
          <div className="absolute right-3 top-2.5">
            <Spinner className="h-4 w-4" />
          </div>
        )}
      </div>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}

      {/* Model list */}
      {loading ? (
        <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400 text-sm py-4">
          <Spinner className="h-4 w-4" /> Loading models...
        </div>
      ) : (
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {displayModels.length === 0 && searchQuery.trim() && !searching && (
            <p className="text-sm text-gray-500 dark:text-gray-400 py-2">No models found for "{searchQuery}"</p>
          )}
          {displayModels.map((model) => {
            const isSelected = selectedModel?.model_id === model.model_id
            const compat = compatibility[model.model_id]
            const canTrain = compat?.can_train ?? null
            const isDisabled = canTrain === false
            return (
              <button
                key={model.model_id}
                onClick={() => !isDisabled && handleSelectModel(model)}
                disabled={isDisabled}
                className={`w-full text-left rounded-lg border p-3 transition-colors ${
                  isDisabled
                    ? 'border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50 opacity-60 cursor-not-allowed'
                    : isSelected
                      ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30'
                      : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-indigo-300 dark:hover:border-indigo-700'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`font-medium text-sm truncate ${isDisabled ? 'text-gray-400 dark:text-gray-500' : 'text-gray-900 dark:text-gray-100'}`}>
                        {model.model_id}
                      </span>
                      {canTrain === true && (
                        <span className="shrink-0 text-xs px-1.5 py-0.5 rounded bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300">
                          Fits your GPU
                        </span>
                      )}
                      {canTrain === false && (
                        <span className="shrink-0 text-xs px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300">
                          Too large for your GPU
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1 text-xs text-gray-500 dark:text-gray-400">
                      {model.parameter_count && <span>{model.parameter_count} params</span>}
                      {model.vram_training_gb != null && <span>Train: {model.vram_training_gb} GB VRAM</span>}
                      {model.license && <span>{model.license}</span>}
                      {model.downloads != null && <span>{model.downloads.toLocaleString()} downloads</span>}
                      {compat?.reason && <span className="text-amber-600 dark:text-amber-400">{compat.reason}</span>}
                    </div>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {/* Selected model download section */}
      {selectedModel && !modelReady && (
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                {selectedModel.model_id}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {selectedModel.vram_training_gb != null
                  ? `Estimated ${selectedModel.vram_training_gb} GB VRAM needed for training`
                  : 'VRAM requirements unknown'}
              </p>
            </div>
            {!isDownloading && download.status !== 'complete' && (
              <button
                onClick={() => handleDownload(selectedModel)}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
              >
                Download Model
              </button>
            )}
          </div>

          {isDownloading && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400">
                <span>{download.message || 'Downloading...'}</span>
                {download.progress != null && download.progress >= 0 && (
                  <span>{Math.round(download.progress)}%</span>
                )}
              </div>
              <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 overflow-hidden">
                {download.progress != null && download.progress >= 0 ? (
                  <div
                    className="bg-indigo-500 h-2 rounded-full transition-all"
                    style={{ width: `${download.progress}%` }}
                  />
                ) : (
                  <div className="bg-indigo-500 h-2 rounded-full animate-pulse w-full opacity-60" />
                )}
              </div>
              <button
                onClick={handleCancelDownload}
                className="text-xs text-red-600 dark:text-red-400 hover:underline"
              >
                Cancel download
              </button>
            </div>
          )}
        </div>
      )}

      {selectedModel && modelReady && (
        <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
          <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
          <span>{selectedModel.model_id} ready</span>
        </div>
      )}
    </div>
  )
}
