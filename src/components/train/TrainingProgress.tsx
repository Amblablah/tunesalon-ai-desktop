import { useState, useRef, useEffect } from 'react'
import Spinner from '../shared/Spinner'
import type { TrainProgressEvent } from '../../types/train'

interface Props {
  progress: TrainProgressEvent | null
  onCancel: () => void
  onComplete: () => void
}

const STATUS_LABELS: Record<string, string> = {
  downloading: 'Downloading model...',
  preparing: 'Preparing training...',
  training: 'Training in progress',
  saving: 'Saving results...',
  complete: 'Training complete!',
  error: 'Training failed',
  cancelled: 'Training cancelled',
}

// How long (ms) without any status change before we consider training stalled
const STALL_TIMEOUT_MS = 120_000 // 2 minutes

export default function TrainingProgress({ progress, onCancel, onComplete }: Props) {
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [eta, setEta] = useState<string | null>(null)
  const [stalled, setStalled] = useState(false)
  const startTimeRef = useRef<number | null>(null)
  const startStepRef = useRef<number | null>(null)
  const lastUpdateRef = useRef<number>(Date.now())
  const lastMessageRef = useRef<string>('')

  // Stall detection: if the progress message hasn't changed for STALL_TIMEOUT_MS,
  // show a warning so the user knows something may be wrong
  useEffect(() => {
    const msg = progress?.message ?? ''
    if (msg !== lastMessageRef.current) {
      lastMessageRef.current = msg
      lastUpdateRef.current = Date.now()
      setStalled(false)
    }

    const isActive = progress && ['downloading', 'preparing', 'training', 'saving'].includes(progress.status)
    if (!isActive) {
      setStalled(false)
      return
    }

    const timer = setInterval(() => {
      if (Date.now() - lastUpdateRef.current > STALL_TIMEOUT_MS) {
        setStalled(true)
      }
    }, 10_000)
    return () => clearInterval(timer)
  }, [progress?.message, progress?.status])

  // ETA calculation
  useEffect(() => {
    if (!progress || progress.status !== 'training') {
      startTimeRef.current = null
      startStepRef.current = null
      setEta(null)
      return
    }

    const step = progress.step ?? 0
    const total = progress.total_steps ?? 0
    if (total <= 0 || step <= 0) return

    if (startTimeRef.current === null || startStepRef.current === null) {
      startTimeRef.current = Date.now()
      startStepRef.current = step
      return
    }

    const elapsed = (Date.now() - startTimeRef.current) / 1000
    const stepsCompleted = step - startStepRef.current
    if (stepsCompleted <= 0) return

    const secsPerStep = elapsed / stepsCompleted
    const remaining = (total - step) * secsPerStep

    if (remaining < 60) {
      setEta(`${Math.round(remaining)}s remaining`)
    } else if (remaining < 3600) {
      setEta(`${Math.round(remaining / 60)}m remaining`)
    } else {
      const h = Math.floor(remaining / 3600)
      const m = Math.round((remaining % 3600) / 60)
      setEta(`${h}h ${m}m remaining`)
    }
  }, [progress])

  // Detect completion
  useEffect(() => {
    if (progress?.status === 'complete') {
      onComplete()
    }
  }, [progress?.status, onComplete])

  if (!progress) return null

  const step = progress.step ?? 0
  const total = progress.total_steps ?? 0
  const percent = total > 0 ? Math.round((step / total) * 100) : 0
  const isActive = ['downloading', 'preparing', 'training', 'saving'].includes(progress.status)
  const isDone = progress.status === 'complete'
  const isFailed = progress.status === 'error' || progress.status === 'cancelled'

  function handleCancel() {
    if (confirmCancel) {
      onCancel()
      setConfirmCancel(false)
    } else {
      setConfirmCancel(true)
    }
  }

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
        {STATUS_LABELS[progress.status] || progress.status}
      </h3>

      {/* Status message */}
      <p className="text-sm text-gray-600 dark:text-gray-400">{progress.message}</p>

      {/* Progress bar */}
      {isActive && total > 0 && (
        <div className="space-y-1.5">
          <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-3">
            <div
              className="bg-indigo-500 h-3 rounded-full transition-all duration-300"
              style={{ width: `${percent}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
            <span>Step {step} / {total} ({percent}%)</span>
            {eta && <span>{eta}</span>}
          </div>
        </div>
      )}

      {/* Spinner for non-step phases */}
      {isActive && total === 0 && (
        <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          <Spinner className="h-4 w-4" />
          <span>Please wait...</span>
        </div>
      )}

      {/* Training stats */}
      {progress.status === 'training' && (
        <div className="flex gap-6 text-sm">
          {progress.epoch != null && (
            <div>
              <span className="text-gray-500 dark:text-gray-400">Epoch: </span>
              <span className="font-medium text-gray-900 dark:text-gray-100">
                {Math.floor(progress.epoch) + 1}
              </span>
            </div>
          )}
          {progress.loss != null && (
            <div>
              <span className="text-gray-500 dark:text-gray-400">Loss: </span>
              <span className="font-mono font-medium text-gray-900 dark:text-gray-100">
                {progress.loss.toFixed(4)}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Stall warning */}
      {stalled && isActive && (
        <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 p-3 text-sm text-amber-700 dark:text-amber-400">
          Training appears to have stalled — no progress updates for over 2 minutes.
          This usually means the model ran out of memory or encountered an error silently.
          You can cancel and try with a smaller model or lower settings.
        </div>
      )}

      {/* Cancel button */}
      {isActive && (
        <button
          onClick={handleCancel}
          className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
            confirmCancel
              ? 'bg-red-600 text-white hover:bg-red-700'
              : 'border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/20'
          }`}
        >
          {confirmCancel ? 'Confirm Cancel' : 'Cancel Training'}
        </button>
      )}

      {/* Completion */}
      {isDone && (
        <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
          <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
          <span className="font-medium">Training finished successfully</span>
        </div>
      )}

      {/* Error */}
      {isFailed && (
        <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/20 p-3 text-sm text-red-700 dark:text-red-400">
          {progress.message || 'Something went wrong. Check the logs and try again.'}
        </div>
      )}
    </div>
  )
}
