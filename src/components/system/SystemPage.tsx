import { useEffect, useState } from 'react'
import type { SystemInfo, ModelCompatibility } from '../../types/system'
import { getSystemInfo, getModelCompatibility } from '../../api/system'
import HardwareCard from './HardwareCard'
import ModelTable from './ModelTable'
import Spinner from '../shared/Spinner'

export default function SystemPage() {
  const [info, setInfo] = useState<SystemInfo | null>(null)
  const [models, setModels] = useState<ModelCompatibility[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const [sysInfo, modelList] = await Promise.all([
        getSystemInfo(),
        getModelCompatibility(),
      ])
      setInfo(sysInfo)
      setModels(modelList)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load system info')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner className="h-8 w-8" />
        <span className="ml-3 text-gray-500 dark:text-gray-400">Detecting hardware...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <p className="text-red-600 dark:text-red-400 mb-4">{error}</p>
        <button
          onClick={load}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Retry
        </button>
      </div>
    )
  }

  if (!info) return null

  const gpuSummary = info.gpu
    ? `Your GPU: ${info.gpu.name} (${info.gpu.vram_gb} GB)`
    : 'No GPU detected — you can still chat with GGUF models on CPU'

  return (
    <div className="p-6 overflow-y-auto h-full space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-1">System</h1>
        <p className="text-gray-500 dark:text-gray-400">{gpuSummary}</p>
      </div>

      <HardwareCard info={info} onRefresh={setInfo} />

      <div>
        <h2 className="text-lg font-semibold mb-3">Model Compatibility</h2>
        <ModelTable models={models} />
      </div>
    </div>
  )
}
