import { useState, useRef, useCallback } from 'react'
import Spinner from '../shared/Spinner'
import { uploadDataset } from '../../api/train'
import type { DatasetValidation } from '../../types/train'

interface Props {
  dataset: DatasetValidation | null
  datasetPath: string | null
  onDatasetReady: (validation: DatasetValidation | null, path: string | null) => void
}

export default function DatasetUploader({ dataset, datasetPath, onDatasetReady }: Props) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.endsWith('.jsonl') && !file.name.endsWith('.json')) {
      setError('Please upload a JSONL file (.jsonl or .json)')
      return
    }

    setError('')
    setUploading(true)
    try {
      const validation = await uploadDataset(file)
      if (validation.valid) {
        onDatasetReady(validation, validation.path)
      } else {
        setError(validation.errors.join(', ') || 'Invalid dataset format')
        onDatasetReady(null, null)
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upload failed')
      onDatasetReady(null, null)
    } finally {
      setUploading(false)
    }
  }, [onDatasetReady])

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    // Reset input so same file can be re-selected
    e.target.value = ''
  }

  function handleClear() {
    onDatasetReady(null, null)
    setError('')
  }


  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Upload Training Data</h3>

      {!dataset ? (
        <>
          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
              dragOver
                ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/20'
                : 'border-gray-300 dark:border-gray-600 hover:border-indigo-400 dark:hover:border-indigo-600'
            }`}
          >
            {uploading ? (
              <div className="flex flex-col items-center gap-2">
                <Spinner className="h-8 w-8" />
                <p className="text-sm text-gray-600 dark:text-gray-400">Uploading and validating...</p>
              </div>
            ) : (
              <>
                <svg className="mx-auto h-10 w-10 text-gray-400 dark:text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
                <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
                  Drag and drop a JSONL file, or <span className="text-indigo-600 dark:text-indigo-400 font-medium">browse</span>
                </p>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-500">
                  JSONL format — each line needs a "messages" array with role/content pairs
                </p>
              </>
            )}
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".jsonl,.json"
            onChange={handleInputChange}
            className="hidden"
          />
        </>
      ) : (
        /* Dataset loaded — show info */
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-3">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{datasetPath?.split(/[/\\]/).pop() || datasetPath}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {dataset.example_count} examples &middot; {dataset.format} format
              </p>
            </div>
            <button
              onClick={handleClear}
              className="text-xs text-red-600 dark:text-red-400 hover:underline"
            >
              Remove
            </button>
          </div>

          {/* Preview */}
          {dataset.preview.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-gray-600 dark:text-gray-400">Preview (first {dataset.preview.length} examples)</p>
              {dataset.preview.slice(0, 3).map((ex, i) => (
                <div key={i} className="rounded border border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-2.5 text-xs">
                  <p className="text-gray-700 dark:text-gray-300">
                    <span className="font-medium text-gray-900 dark:text-gray-100">Q:</span> {ex.instruction.slice(0, 120)}{ex.instruction.length > 120 ? '...' : ''}
                  </p>
                  <p className="text-gray-600 dark:text-gray-400 mt-1">
                    <span className="font-medium text-gray-900 dark:text-gray-100">A:</span> {ex.output.slice(0, 120)}{ex.output.length > 120 ? '...' : ''}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  )
}
