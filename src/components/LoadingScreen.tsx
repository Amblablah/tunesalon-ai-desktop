import { useSidecar } from '../contexts/SidecarContext'

export default function LoadingScreen() {
  const { status, error, retry } = useSidecar()

  if (status === 'error') {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center max-w-md px-6">
          <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
            <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
            Backend Not Available
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            {error || 'The AI backend could not be started.'}
          </p>
          <button
            onClick={retry}
            className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-medium transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  // Loading state
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
      <div className="text-center">
        <div className="w-12 h-12 mx-auto mb-6 border-4 border-indigo-200 dark:border-indigo-800 border-t-indigo-600 rounded-full animate-spin" />
        <h2 className="text-lg font-medium text-gray-900 dark:text-white mb-1">
          Starting backend...
        </h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          This may take a moment on first launch
        </p>
      </div>
    </div>
  )
}
