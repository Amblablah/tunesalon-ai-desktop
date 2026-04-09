import { useEffect, useState, useRef } from 'react'
import type { BaseModelEntry } from '../../types/library'
import type { ModelCompatibility } from '../../types/system'
import { getModels, deleteModel } from '../../api/library'
import { getModelCompatibility } from '../../api/system'
import { confirmDialog, alertDialog } from '../../utils/native'
import { startModelDownload, connectDownloadStream, cancelDownload, getDownloadStatus } from '../../api/train'
import type { ModelDownloadStatus } from '../../types/train'
import Spinner from '../shared/Spinner'

export default function BaseModelsTab({ onChanged }: { onChanged: () => void }) {
  const [models, setModels] = useState<BaseModelEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  // Download new model state
  const [catalog, setCatalog] = useState<ModelCompatibility[]>([])
  const [showDownload, setShowDownload] = useState(false)
  const [download, setDownload] = useState<ModelDownloadStatus>({ status: 'idle', model_id: null, progress: null, message: null })
  const [downloadError, setDownloadError] = useState('')
  const esRef = useRef<EventSource | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const [m, c] = await Promise.all([
        getModels(),
        getModelCompatibility().catch(() => [] as ModelCompatibility[]),
      ])
      setModels(m)
      setCatalog(c)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load models')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // Check if a download is already in progress (e.g. navigated away and came back)
    getDownloadStatus().then(status => {
      if (status.status === 'downloading' && status.model_id) {
        setDownload(status)
        setShowDownload(true)
        esRef.current?.close()
        esRef.current = connectDownloadStream(
          (data) => {
            setDownload(data)
            if (data.status === 'complete') {
              load().then(() => onChanged())
            }
          },
          (err) => {
            setDownloadError(err)
            setDownload(prev => ({ ...prev, status: 'error' }))
          },
        )
      }
    }).catch(() => { /* ignore */ })
    return () => { esRef.current?.close() }
  }, [])

  const handleDelete = async (model: BaseModelEntry) => {
    const yes = await confirmDialog(`Delete "${model.name}"?\n\nThis will free ${model.size_gb.toFixed(1)} GB of disk space.`, 'Delete Model')
    if (!yes) return
    setDeleting(model.name)
    try {
      await deleteModel(model.name)
      setModels(prev => prev.filter(m => m.name !== model.name))
      onChanged()
    } catch (err) {
      await alertDialog(err instanceof Error ? err.message : 'Failed to delete model')
    } finally {
      setDeleting(null)
    }
  }

  const downloadedIds = new Set(models.map(m => m.name))

  // Models available to download (curated, not already downloaded)
  const availableModels = catalog.filter(m => !downloadedIds.has(m.name))

  async function handleDownload(modelName: string) {
    setDownloadError('')
    setDownload({ status: 'downloading', model_id: modelName, progress: -1, message: 'Starting download...' })
    esRef.current?.close()

    try {
      const result = await startModelDownload(modelName)
      if (result.status === 'complete') {
        setDownload({ status: 'complete', model_id: modelName, progress: 100, message: 'Download complete' })
        await load()
        onChanged()
        return
      }

      esRef.current = connectDownloadStream(
        (data) => {
          setDownload(data)
          if (data.status === 'complete') {
            load().then(() => onChanged())
          }
        },
        (err) => {
          setDownloadError(err)
          setDownload(prev => ({ ...prev, status: 'error' }))
        },
      )
    } catch (err: unknown) {
      setDownloadError(err instanceof Error ? err.message : 'Download failed')
      setDownload({ status: 'error', model_id: modelName, progress: null, message: 'Download failed' })
    }
  }

  async function handleCancelDownload() {
    try {
      await cancelDownload()
      esRef.current?.close()
      setDownload({ status: 'idle', model_id: null, progress: null, message: null })
    } catch { /* ignore */ }
  }

  const isDownloading = download.status === 'downloading'

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner className="h-6 w-6" />
        <span className="ml-2 text-gray-500 dark:text-gray-400">Loading models...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600 dark:text-red-400 mb-3">{error}</p>
        <button onClick={load} className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">Retry</button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Downloaded models table */}
      {models.length === 0 ? (
        <div className="text-center py-8 text-gray-500 dark:text-gray-400">
          <p className="text-lg mb-1">No models downloaded yet</p>
          <p className="text-sm">Download a model below to get started.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-800 text-left text-gray-500 dark:text-gray-400">
                <th className="pb-2 pr-4 font-medium">Model</th>
                <th className="pb-2 pr-4 font-medium">Size</th>
                <th className="pb-2 pr-4 font-medium">Parameters</th>
                <th className="pb-2 pr-4 font-medium">Downloaded</th>
                <th className="pb-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {models.map(m => (
                <tr key={m.name} className="border-b border-gray-100 dark:border-gray-800/50">
                  <td className="py-3 pr-4 font-medium text-gray-900 dark:text-gray-100">{m.name}</td>
                  <td className="py-3 pr-4 text-gray-600 dark:text-gray-400">{m.size_gb.toFixed(1)} GB</td>
                  <td className="py-3 pr-4 text-gray-600 dark:text-gray-400">{m.parameters ?? '—'}</td>
                  <td className="py-3 pr-4 text-gray-600 dark:text-gray-400">{new Date(m.downloaded_at).toLocaleDateString()}</td>
                  <td className="py-3 text-right">
                    <button
                      onClick={() => handleDelete(m)}
                      disabled={deleting === m.name}
                      className="text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 text-sm disabled:opacity-50"
                    >
                      {deleting === m.name ? 'Deleting...' : 'Delete'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Download new model section */}
      {!showDownload ? (
        <button
          onClick={() => setShowDownload(true)}
          disabled={isDownloading}
          className="w-full py-2.5 text-sm font-medium rounded-lg border border-dashed border-gray-300 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-indigo-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
        >
          + Download New Model
        </button>
      ) : (
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900/50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Available Models</h3>
            <button
              onClick={() => { setShowDownload(false); setDownloadError('') }}
              className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              Close
            </button>
          </div>

          {availableModels.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400 py-2">All curated models are already downloaded.</p>
          ) : (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {availableModels.map(m => {
                const isThisDownloading = isDownloading && download.model_id === m.name
                const usable = m.can_train || m.can_infer
                return (
                  <div
                    key={m.name}
                    className={`flex items-center justify-between rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3 ${!usable ? 'opacity-50' : ''}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-sm font-medium ${usable ? 'text-gray-900 dark:text-gray-100' : 'text-gray-400 dark:text-gray-500'}`}>{m.name}</span>
                        {m.parameters && (
                          <span className="text-xs text-gray-500 dark:text-gray-400">{m.parameters}</span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-x-3 text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {m.can_train && <span className="text-green-600 dark:text-green-400">Can train</span>}
                        {m.can_infer && <span className="text-blue-600 dark:text-blue-400">Can chat</span>}
                        {!usable && <span className="text-gray-400">Too large for your GPU</span>}
                        {m.license && <span>{m.license}</span>}
                        {m.vram_training_gb > 0 && <span>Train: {m.vram_training_gb}GB</span>}
                      </div>
                    </div>
                    <button
                      onClick={() => handleDownload(m.name)}
                      disabled={isDownloading || !usable}
                      className="shrink-0 ml-3 px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {isThisDownloading ? 'Downloading...' : 'Download'}
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {/* Download progress */}
          {isDownloading && (
            <div className="space-y-2 pt-2 border-t border-gray-200 dark:border-gray-700">
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

          {download.status === 'complete' && (
            <p className="text-sm text-green-600 dark:text-green-400">Download complete!</p>
          )}

          {downloadError && (
            <p className="text-xs text-red-600 dark:text-red-400">{downloadError}</p>
          )}
        </div>
      )}
    </div>
  )
}
