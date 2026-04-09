import { useEffect, useState } from 'react'
import type { GgufEntry } from '../../types/library'
import { getGgufs, deleteGguf } from '../../api/library'
import { confirmDialog, alertDialog } from '../../utils/native'
import Spinner from '../shared/Spinner'

export default function GgufTab({ onChanged }: { onChanged: () => void }) {
  const [ggufs, setGgufs] = useState<GgufEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      setGgufs(await getGgufs())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load GGUF files')
    } finally {
      setLoading(false)
    }
  }

  const refresh = async () => {
    setRefreshing(true)
    setError(null)
    try {
      setGgufs(await getGgufs())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load GGUF files')
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleDelete = async (gguf: GgufEntry) => {
    const yes = await confirmDialog(`Delete "${gguf.name}"?\n\nThis will free ${gguf.size_gb.toFixed(1)} GB of disk space.`, 'Delete GGUF File')
    if (!yes) return
    setDeleting(gguf.name)
    try {
      await deleteGguf(gguf.name)
      setGgufs(prev => prev.filter(g => g.name !== gguf.name))
      onChanged()
    } catch (err) {
      await alertDialog(err instanceof Error ? err.message : 'Failed to delete GGUF file')
    } finally {
      setDeleting(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner className="h-6 w-6" />
        <span className="ml-2 text-gray-500 dark:text-gray-400">Loading GGUF files...</span>
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
    <div>
      <div className="flex items-center gap-3 mb-4">
        <button
          onClick={refresh}
          disabled={refreshing}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2"
        >
          {refreshing ? (
            <Spinner className="h-4 w-4" />
          ) : (
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h5M20 20v-5h-5M4.929 9A8 8 0 0119.07 9M19.071 15A8 8 0 014.93 15" />
            </svg>
          )}
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {ggufs.length === 0 ? (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          <p className="text-lg mb-1">No GGUF files yet</p>
          <p className="text-sm">Export from Train or place .gguf files in your GGUF folder.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-800 text-left text-gray-500 dark:text-gray-400">
                <th className="pb-2 pr-4 font-medium">Name</th>
                <th className="pb-2 pr-4 font-medium">Size</th>
                <th className="pb-2 pr-4 font-medium">Quantization</th>
                <th className="pb-2 pr-4 font-medium">Created</th>
                <th className="pb-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {ggufs.map(g => (
                <tr key={g.name} className="border-b border-gray-100 dark:border-gray-800/50">
                  <td className="py-3 pr-4 font-medium text-gray-900 dark:text-gray-100">{g.name}</td>
                  <td className="py-3 pr-4 text-gray-600 dark:text-gray-400">{g.size_gb.toFixed(1)} GB</td>
                  <td className="py-3 pr-4 text-gray-600 dark:text-gray-400">{g.quantization ?? '—'}</td>
                  <td className="py-3 pr-4 text-gray-600 dark:text-gray-400">{new Date(g.created_at).toLocaleDateString()}</td>
                  <td className="py-3 text-right">
                    <button
                      onClick={() => handleDelete(g)}
                      disabled={deleting === g.name}
                      className="text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 text-sm disabled:opacity-50"
                    >
                      {deleting === g.name ? 'Deleting...' : 'Delete'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
        Place .gguf files in your GGUF folder to see them here.
      </p>
    </div>
  )
}
