import { useState, useEffect } from 'react'
import { apiFetch } from '../../api/client'
import type { SystemInfo, ModelCompatibility } from '../../types/system'
import Spinner from '../shared/Spinner'

const WELCOME_KEY = 'tunesalon_desktop_welcomed'

interface WelcomeScreenProps {
  onDismiss: () => void
}

export default function WelcomeScreen({ onDismiss }: WelcomeScreenProps) {
  const [info, setInfo] = useState<SystemInfo | null>(null)
  const [models, setModels] = useState<ModelCompatibility[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const [sysInfo, modelList] = await Promise.all([
          apiFetch<SystemInfo>('/system/info'),
          apiFetch<ModelCompatibility[]>('/system/models'),
        ])
        setInfo(sysInfo)
        setModels(modelList)
      } catch {
        // Backend not ready — shouldn't happen since LoadingScreen gates us
      }
      setLoading(false)
    }
    load()
  }, [])

  function handleGetStarted() {
    localStorage.setItem(WELCOME_KEY, 'true')
    onDismiss()
  }

  const trainableModels = models.filter((m) => m.can_train)
  const chatOnlyModels = models.filter((m) => !m.can_train && m.can_infer)

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
      <div className="max-w-lg w-full mx-4">
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-8 shadow-lg text-center">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">
            TuneSalon Desktop
          </h1>
          <p className="text-gray-500 dark:text-gray-400 mb-6">
            Custom AI, Made Simple
          </p>

          {loading ? (
            <div className="py-8">
              <Spinner className="h-8 w-8 mx-auto mb-3" />
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Detecting your hardware...
              </p>
            </div>
          ) : info ? (
            <div className="space-y-4">
              {/* GPU info */}
              {info.has_gpu && info.gpu ? (
                <div className="rounded-xl bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 p-4">
                  <p className="text-lg font-semibold text-green-800 dark:text-green-300">
                    {info.gpu.name}
                  </p>
                  <p className="text-sm text-green-700 dark:text-green-400">
                    {info.gpu.vram_gb} GB VRAM - ready for training and chat
                  </p>
                </div>
              ) : (
                <div className="rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 p-4">
                  <p className="text-lg font-semibold text-amber-800 dark:text-amber-300">
                    CPU Mode
                  </p>
                  <p className="text-sm text-amber-700 dark:text-amber-400">
                    No GPU detected - you can still chat with GGUF models on CPU
                  </p>
                </div>
              )}

              {/* Model compatibility summary */}
              {info.has_gpu && models.length > 0 && (
                <div className="rounded-xl bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 p-4 text-left">
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    What your GPU can run:
                  </p>
                  {trainableModels.length > 0 && (
                    <div className="mb-2">
                      <p className="text-xs font-medium text-green-600 dark:text-green-400 mb-1">
                        Train + Chat ({trainableModels.length})
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {trainableModels.map((m) => `${m.name.split('/').pop()} (${m.parameters})`).join(', ')}
                      </p>
                    </div>
                  )}
                  {chatOnlyModels.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-blue-600 dark:text-blue-400 mb-1">
                        Chat only ({chatOnlyModels.length})
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {chatOnlyModels.map((m) => `${m.name.split('/').pop()} (${m.parameters})`).join(', ')}
                      </p>
                    </div>
                  )}
                  {trainableModels.length === 0 && chatOnlyModels.length === 0 && (
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Your GPU may be too small for the curated models, but you can try smaller ones from Hugging Face.
                    </p>
                  )}
                </div>
              )}

              {/* System summary */}
              <div className="text-sm text-gray-500 dark:text-gray-400 space-y-1">
                <p>{info.cpu} - {info.ram_gb} GB RAM</p>
                <p>{info.disk_free_gb.toFixed(0)} GB free disk space</p>
              </div>

              <button
                onClick={handleGetStarted}
                className="w-full mt-4 px-6 py-3 rounded-xl bg-indigo-600 text-white font-semibold hover:bg-indigo-700 transition-colors"
              >
                Get Started
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4">
                <p className="text-sm text-red-700 dark:text-red-400">
                  Could not detect your hardware. You can still use the app.
                </p>
              </div>
              <button
                onClick={handleGetStarted}
                className="w-full px-6 py-3 rounded-xl bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300 font-medium hover:bg-gray-300 dark:hover:bg-gray-700 transition-colors"
              >
                Continue anyway
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function shouldShowWelcome(): boolean {
  return localStorage.getItem(WELCOME_KEY) !== 'true'
}
