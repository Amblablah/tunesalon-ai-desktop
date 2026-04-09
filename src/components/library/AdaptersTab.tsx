import { useEffect, useState } from 'react'
import type { AdapterEntry } from '../../types/library'
import { getAdapters, deleteAdapter, renameAdapter } from '../../api/library'
import { confirmDialog, alertDialog } from '../../utils/native'
import Spinner from '../shared/Spinner'

export default function AdaptersTab({ onChanged }: { onChanged: () => void }) {
  const [adapters, setAdapters] = useState<AdapterEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      setAdapters(await getAdapters())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load adapters')
    } finally {
      setLoading(false)
    }
  }

  const refresh = async () => {
    setRefreshing(true)
    setError(null)
    try {
      setAdapters(await getAdapters())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load adapters')
    } finally {
      setRefreshing(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleDelete = async (adapter: AdapterEntry) => {
    const yes = await confirmDialog(`Delete adapter "${adapter.name}"?`, 'Delete Adapter')
    if (!yes) return
    setDeleting(adapter.name)
    try {
      await deleteAdapter(adapter.name)
      setAdapters(prev => prev.filter(a => a.name !== adapter.name))
      onChanged()
    } catch (err) {
      await alertDialog(err instanceof Error ? err.message : 'Failed to delete adapter')
    } finally {
      setDeleting(null)
    }
  }

  const startRename = (adapter: AdapterEntry) => {
    setEditing(adapter.name)
    setEditName(adapter.name)
  }

  const handleRename = async (oldName: string) => {
    const newName = editName.trim()
    if (!newName || newName === oldName) {
      setEditing(null)
      return
    }
    try {
      const updated = await renameAdapter(oldName, newName)
      setAdapters(prev => prev.map(a => a.name === oldName ? updated : a))
      onChanged()
    } catch (err) {
      await alertDialog(err instanceof Error ? err.message : 'Failed to rename adapter')
    } finally {
      setEditing(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner className="h-6 w-6" />
        <span className="ml-2 text-gray-500 dark:text-gray-400">Loading adapters...</span>
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

      {adapters.length === 0 ? (
        <div className="text-center py-12 text-gray-500 dark:text-gray-400">
          <p className="text-lg mb-1">No adapters yet</p>
          <p className="text-sm">Train a model to create one.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-800 text-left text-gray-500 dark:text-gray-400">
                <th className="pb-2 pr-4 font-medium">Name</th>
                <th className="pb-2 pr-4 font-medium">Size</th>
                <th className="pb-2 pr-4 font-medium">Base Model</th>
                <th className="pb-2 pr-4 font-medium">Created</th>
                <th className="pb-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {adapters.map(a => (
                <tr key={a.name} className="border-b border-gray-100 dark:border-gray-800/50">
                  <td className="py-3 pr-4 font-medium text-gray-900 dark:text-gray-100">
                    {editing === a.name ? (
                      <input
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        onBlur={() => handleRename(a.name)}
                        onKeyDown={e => { if (e.key === 'Enter') handleRename(a.name); if (e.key === 'Escape') setEditing(null) }}
                        autoFocus
                        className="rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 px-2 py-1 text-sm w-48"
                      />
                    ) : (
                      a.name
                    )}
                  </td>
                  <td className="py-3 pr-4 text-gray-600 dark:text-gray-400">{a.size_mb.toFixed(0)} MB</td>
                  <td className="py-3 pr-4 text-gray-600 dark:text-gray-400">{a.base_model ?? '—'}</td>
                  <td className="py-3 pr-4 text-gray-600 dark:text-gray-400">{new Date(a.created_at).toLocaleDateString()}</td>
                  <td className="py-3 text-right space-x-3">
                    <button
                      onClick={() => startRename(a)}
                      className="text-indigo-600 dark:text-indigo-400 hover:underline text-sm"
                    >
                      Rename
                    </button>
                    <button
                      onClick={() => handleDelete(a)}
                      disabled={deleting === a.name}
                      className="text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 text-sm disabled:opacity-50"
                    >
                      {deleting === a.name ? 'Deleting...' : 'Delete'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-xs text-gray-500 dark:text-gray-400">
        Place .adapter files in your adapters folder to see them here.
      </p>
    </div>
  )
}
