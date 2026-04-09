import { useSidecar } from '../contexts/SidecarContext'

export default function SidecarBanner() {
  const { status, error, retry } = useSidecar()

  if (status !== 'error') return null

  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-red-600 text-white px-4 py-2 flex items-center justify-between text-sm">
      <span>{error || 'Backend stopped unexpectedly'}</span>
      <button
        onClick={retry}
        className="ml-4 px-3 py-1 bg-white/20 hover:bg-white/30 rounded text-sm font-medium transition-colors"
      >
        Restart Backend
      </button>
    </div>
  )
}
