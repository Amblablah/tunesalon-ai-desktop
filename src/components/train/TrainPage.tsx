import { useState, useEffect, useRef, useCallback } from 'react'
import ModelSelector from './ModelSelector'
import DatasetUploader from './DatasetUploader'
import TrainingSettings, { DEFAULT_TRAINING_CONFIG, type TrainingConfig } from './TrainingSettings'
import TrainingProgress from './TrainingProgress'
import SaveDialog from './SaveDialog'
import { startTraining, connectTrainingStream, getTrainingResult, cancelTraining, resetTraining } from '../../api/train'
import type { ModelSearchResult, TrainProgressEvent, TrainRequest, DatasetValidation } from '../../types/train'

type Phase = 'idle' | 'configuring' | 'training' | 'complete'

export default function TrainPage() {
  const [phase, setPhase] = useState<Phase>('idle')

  // Step 1: Model
  const [selectedModel, setSelectedModel] = useState<ModelSearchResult | null>(null)
  const [modelReady, setModelReady] = useState(false)

  // Step 2: Dataset
  const [dataset, setDataset] = useState<DatasetValidation | null>(null)
  const [datasetPath, setDatasetPath] = useState<string | null>(null)

  // Step 3: Settings
  const [config, setConfig] = useState<TrainingConfig>({ ...DEFAULT_TRAINING_CONFIG })

  // Step 5: Training progress
  const [progress, setProgress] = useState<TrainProgressEvent | null>(null)
  const [trainError, setTrainError] = useState('')
  const [adapterPath, setAdapterPath] = useState<string | null>(null)
  const esRef = useRef<EventSource | null>(null)

  // On mount, check if training is running or complete
  useEffect(() => {
    getTrainingResult()
      .then((result) => {
        if (['downloading', 'preparing', 'training', 'saving'].includes(result.status)) {
          setProgress(result)
          setPhase('training')
          if (result.base_model) {
            setSelectedModel({ model_id: result.base_model, is_curated: true } as ModelSearchResult)
          }
          // Reconnect to SSE
          esRef.current = connectTrainingStream(
            (data) => setProgress(data),
            () => { /* ignore reconnect errors */ },
          )
        } else if (result.status === 'complete') {
          setProgress(result)
          setPhase('complete')
          if (result.base_model) {
            setSelectedModel({ model_id: result.base_model, is_curated: true } as ModelSearchResult)
          }
          if (result.adapter_path) {
            setAdapterPath(result.adapter_path)
          }
        }
      })
      .catch(() => {
        // No active training, stay in idle
      })

    return () => {
      esRef.current?.close()
    }
  }, [])

  // When model and dataset are both ready, move to configuring
  useEffect(() => {
    if (modelReady && dataset && phase === 'idle') {
      setPhase('configuring')
    }
  }, [modelReady, dataset, phase])

  function handleDatasetReady(validation: DatasetValidation | null, path: string | null) {
    setDataset(validation)
    setDatasetPath(path)
  }

  async function handleStartTraining() {
    if (!selectedModel || !datasetPath) return

    setTrainError('')
    setPhase('training')

    const trainReq: TrainRequest = {
      model_name: selectedModel.model_id,
      dataset_path: datasetPath,
      lora_r: config.lora_r,
      lora_alpha: config.lora_alpha,
      lora_dropout: config.lora_dropout,
      learning_rate: config.learning_rate,
      num_epochs: config.num_epochs,
      batch_size: config.batch_size,
      gradient_accumulation_steps: config.gradient_accumulation_steps,
      max_seq_length: config.max_seq_length,
    }

    esRef.current?.close()

    try {
      await startTraining(trainReq)
      // POST succeeded — now connect SSE
      esRef.current = connectTrainingStream(
        (data) => setProgress(data),
        (err) => {
          setTrainError(err)
          setProgress((prev) => prev ? { ...prev, status: 'error', message: err } : null)
        },
      )
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to start training'
      setTrainError(msg)
      setProgress({ status: 'error', message: msg, step: null, total_steps: null, loss: null, epoch: null })
    }
  }

  async function handleCancelTraining() {
    try {
      await cancelTraining()
      esRef.current?.close()
      // Wait for training thread to actually stop before resetting
      for (let i = 0; i < 10; i++) {
        const result = await getTrainingResult()
        if (result.status === 'cancelled' || result.status === 'idle' || result.status === 'error') break
        await new Promise(r => setTimeout(r, 500))
      }
      await resetTraining()
      setPhase('idle')
      setProgress(null)
      setTrainError('')
    } catch (err: unknown) {
      setTrainError(err instanceof Error ? err.message : 'Failed to cancel')
    }
  }

  const handleTrainingComplete = useCallback(() => {
    setPhase('complete')
    // Fetch adapter path from backend
    getTrainingResult().then((r) => {
      if (r.adapter_path) setAdapterPath(r.adapter_path)
    }).catch(() => {})
  }, [])

  function handleReset() {
    // Clear persisted result on backend so it doesn't reappear after restart
    resetTraining().catch(() => {})
    setPhase('idle')
    setSelectedModel(null)
    setModelReady(false)
    setDataset(null)
    setDatasetPath(null)
    setConfig({ ...DEFAULT_TRAINING_CONFIG })
    setProgress(null)
    setTrainError('')
  }

  const canStartTraining = modelReady && dataset && phase === 'configuring'

  return (
    <div className="p-6 overflow-y-auto h-full">
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Train</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Fine-tune an AI model on your own data, right on your computer
        </p>
      </div>

      {/* Phase: Training in progress */}
      {phase === 'training' && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
          <TrainingProgress
            progress={progress}
            onCancel={handleCancelTraining}
            onComplete={handleTrainingComplete}
          />
          {trainError && !progress?.message && (
            <p className="mt-3 text-sm text-red-600 dark:text-red-400">{trainError}</p>
          )}
          {(progress?.status === 'error' || progress?.status === 'cancelled') && (
            <button
              onClick={handleReset}
              className="mt-4 text-sm text-indigo-600 dark:text-indigo-400 hover:underline"
            >
              Start over
            </button>
          )}
        </div>
      )}

      {/* Phase: Complete — show save dialog */}
      {phase === 'complete' && selectedModel && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
          <SaveDialog baseModel={selectedModel.model_id} adapterPath={adapterPath || undefined} onDone={handleReset} />
        </div>
      )}

      {/* Phase: Idle / Configuring — show setup steps */}
      {(phase === 'idle' || phase === 'configuring') && (
        <>
          {/* Step 1: Model Selection */}
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
            <ModelSelector
              selectedModel={selectedModel}
              onSelect={setSelectedModel}
              modelReady={modelReady}
              onModelReady={setModelReady}
            />
          </div>

          {/* Step 2: Dataset Upload */}
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
            <DatasetUploader
              dataset={dataset}
              datasetPath={datasetPath}
              onDatasetReady={handleDatasetReady}
            />
          </div>

          {/* Step 3: Training Settings */}
          {modelReady && dataset && (
            <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
              <TrainingSettings config={config} onChange={setConfig} />
            </div>
          )}

          {/* Step 4: Start Training Button */}
          {canStartTraining && (
            <div className="flex justify-center">
              <button
                onClick={handleStartTraining}
                className="px-8 py-3 text-base font-semibold rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm transition-colors"
              >
                Start Training
              </button>
            </div>
          )}
        </>
      )}
    </div>
    </div>
  )
}
