import { useState } from 'react'
import type { SystemInfo } from '../../types/system'
import { refreshHardware } from '../../api/system'
import Spinner from '../shared/Spinner'

interface HardwareCardProps {
  info: SystemInfo
  onRefresh: (info: SystemInfo) => void
}

export default function HardwareCard({ info, onRefresh }: HardwareCardProps) {
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      const updated = await refreshHardware()
      onRefresh(updated)
    } catch {
      // silently fail — user can retry
    } finally {
      setRefreshing(false)
    }
  }

  const gpu = info.gpu

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Local Hardware</h2>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-sm hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
        >
          {refreshing ? <Spinner className="h-4 w-4" /> : (
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          )}
          Refresh
        </button>
      </div>

      {/* GPU section */}
      {gpu ? (
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-1">
            <svg className="h-5 w-5 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <span className="text-xl font-bold">{gpu.name}</span>
          </div>
          <span className="text-indigo-600 dark:text-indigo-400 font-semibold text-lg">{gpu.vram_gb} GB VRAM</span>
        </div>
      ) : (
        <div className="mb-4 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 p-3">
          <div className="flex items-center gap-2">
            <svg className="h-5 w-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="font-semibold text-amber-800 dark:text-amber-200">No GPU detected — CPU mode</span>
          </div>
          <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
            You can still chat with GGUF models using your CPU.
          </p>
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-3 gap-4 text-sm">
        <div>
          <span className="text-gray-500 dark:text-gray-400 block">CPU</span>
          <span className="font-medium">{info.cpu}</span>
        </div>
        <div>
          <span className="text-gray-500 dark:text-gray-400 block">RAM</span>
          <span className="font-medium">{info.ram_gb} GB</span>
        </div>
        <div>
          <span className="text-gray-500 dark:text-gray-400 block">Disk Free</span>
          <span className="font-medium">{info.disk_free_gb} GB</span>
        </div>
      </div>

      {/* Advanced details toggle */}
      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="mt-4 text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
      >
        {showAdvanced ? 'Hide' : 'Show'} Advanced Details
      </button>

      {showAdvanced && (
        <div className="mt-3 rounded-lg bg-gray-50 dark:bg-gray-800/50 p-3 text-sm grid grid-cols-2 gap-3">
          <div>
            <span className="text-gray-500 dark:text-gray-400 block">OS</span>
            <span className="font-medium">{info.os}</span>
          </div>
          {gpu?.cuda_version && (
            <div>
              <span className="text-gray-500 dark:text-gray-400 block">CUDA Version</span>
              <span className="font-medium">{gpu.cuda_version}</span>
            </div>
          )}
          {gpu?.driver_version && (
            <div>
              <span className="text-gray-500 dark:text-gray-400 block">Driver Version</span>
              <span className="font-medium">{gpu.driver_version}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
