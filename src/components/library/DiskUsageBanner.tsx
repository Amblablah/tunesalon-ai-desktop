import { useEffect, useState } from 'react'
import type { DiskUsage } from '../../types/library'
import { getDiskUsage } from '../../api/library'
import Spinner from '../shared/Spinner'

export default function DiskUsageBanner({ refreshKey }: { refreshKey: number }) {
  const [usage, setUsage] = useState<DiskUsage | null>(null)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      setUsage(await getDiskUsage())
    } catch {
      // silently fail — banner is non-critical
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [refreshKey])

  if (loading && !usage) {
    return (
      <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 flex items-center gap-2">
        <Spinner className="h-4 w-4" />
        <span className="text-sm text-gray-500 dark:text-gray-400">Calculating storage...</span>
      </div>
    )
  }

  if (!usage) return null

  const total = usage.total_gb || 0.01
  const modelsPct = (usage.models_gb / total) * 100
  const adaptersPct = ((usage.adapters_mb / 1024) / total) * 100
  const ggufPct = (usage.gguf_gb / total) * 100

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <span className="text-gray-700 dark:text-gray-300">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500 mr-1.5" />
            Models: {usage.models_gb.toFixed(1)} GB
          </span>
          <span className="text-gray-700 dark:text-gray-300">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-blue-500 mr-1.5" />
            Adapters: {usage.adapters_mb.toFixed(0)} MB
          </span>
          <span className="text-gray-700 dark:text-gray-300">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-500 mr-1.5" />
            GGUF: {usage.gguf_gb.toFixed(1)} GB
          </span>
          <span className="font-medium text-gray-900 dark:text-gray-100">
            Total: {usage.total_gb.toFixed(1)} GB
          </span>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline disabled:opacity-50"
        >
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {/* Color bar */}
      <div className="h-3 w-full rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden flex">
        {modelsPct > 0 && (
          <div className="bg-emerald-500 h-full" style={{ width: `${modelsPct}%` }} />
        )}
        {adaptersPct > 0 && (
          <div className="bg-blue-500 h-full" style={{ width: `${adaptersPct}%` }} />
        )}
        {ggufPct > 0 && (
          <div className="bg-amber-500 h-full" style={{ width: `${ggufPct}%` }} />
        )}
      </div>
    </div>
  )
}
