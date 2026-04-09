import { apiFetch, apiStreamUrl, API_BASE } from './client'
import type {
  ModelSearchResult,
  TrainRequest,
  TrainProgressEvent,
  SaveAdapterRequest,
  GgufExportRequest,
  ModelDownloadStatus,
  DatasetValidation,
} from '../types/train'

export async function searchModels(query: string): Promise<ModelSearchResult[]> {
  return apiFetch(`/train/models/search?q=${encodeURIComponent(query)}`)
}

export async function getCuratedModels(): Promise<ModelSearchResult[]> {
  return apiFetch('/train/models/curated')
}

export async function startModelDownload(modelId: string): Promise<{ status: string; message: string }> {
  return apiFetch('/train/models/download', {
    method: 'POST',
    body: JSON.stringify({ model_id: modelId }),
  })
}

export function connectDownloadStream(
  onProgress: (data: ModelDownloadStatus) => void,
  onError: (err: string) => void,
): EventSource {
  const url = apiStreamUrl('/train/models/download/stream')
  const es = new EventSource(url)
  es.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data) as ModelDownloadStatus
      onProgress(data)
      if (data.status === 'complete' || data.status === 'error' || data.status === 'cancelled') {
        es.close()
      }
    } catch { /* ignore parse errors */ }
  }
  es.onerror = () => {
    onError('Connection to download stream lost')
    es.close()
  }
  return es
}

export async function checkModelDownloaded(modelId: string): Promise<boolean> {
  const result: { downloaded: boolean } = await apiFetch(
    `/train/models/check?model_id=${encodeURIComponent(modelId)}`
  )
  return result.downloaded
}

export async function cancelDownload(): Promise<void> {
  await apiFetch('/train/models/download', { method: 'DELETE' })
}

export async function getDownloadStatus(): Promise<ModelDownloadStatus> {
  return apiFetch('/train/models/download/status')
}

export async function uploadDataset(file: File): Promise<DatasetValidation> {
  const formData = new FormData()
  formData.append('file', file)
  const res = await fetch(`${API_BASE}/train/dataset/upload`, {
    method: 'POST',
    body: formData,
  })
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: 'Upload failed' }))
    throw new Error(error.detail || `Upload error ${res.status}`)
  }
  return res.json()
}

export async function startTraining(config: TrainRequest): Promise<{ status: string; message: string }> {
  return apiFetch('/train/start', {
    method: 'POST',
    body: JSON.stringify(config),
  })
}

export function connectTrainingStream(
  onProgress: (data: TrainProgressEvent) => void,
  onError: (err: string) => void,
): EventSource {
  const url = apiStreamUrl('/train/status')
  const es = new EventSource(url)
  es.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data) as TrainProgressEvent
      onProgress(data)
      if (data.status === 'complete' || data.status === 'error' || data.status === 'cancelled') {
        es.close()
      }
    } catch { /* ignore parse errors */ }
  }
  es.onerror = () => {
    onError('Connection to training stream lost')
    es.close()
  }
  return es
}

export async function getTrainingStatus(): Promise<TrainProgressEvent> {
  return apiFetch('/train/status')
}

export async function getTrainingResult(): Promise<TrainProgressEvent & { base_model: string | null; adapter_path: string | null }> {
  return apiFetch('/train/result')
}

export async function cancelTraining(): Promise<void> {
  await apiFetch('/train/cancel', { method: 'POST' })
}

export async function resetTraining(): Promise<void> {
  await apiFetch('/train/reset', { method: 'POST' })
}

export async function getSavePaths(): Promise<{ adapters_dir: string; gguf_dir: string }> {
  return apiFetch('/train/save-paths')
}


export async function saveAdapter(request: SaveAdapterRequest): Promise<{ path: string }> {
  return apiFetch('/train/save-adapter', {
    method: 'POST',
    body: JSON.stringify(request),
  })
}

export async function exportGguf(request: GgufExportRequest): Promise<{ path: string; size_mb: number }> {
  // GGUF export blocks until done (merge + convert can take 10-30 min)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30 * 60 * 1000)
  try {
    const res = await fetch(`${API_BASE}/train/export-gguf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: controller.signal,
    })
    clearTimeout(timeout)
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }))
      throw new Error(err.detail || `Export failed: ${res.status}`)
    }
    return res.json()
  } catch (err: unknown) {
    clearTimeout(timeout)
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('GGUF export timed out. Large models can take 10-30 minutes. Please try again.')
    }
    throw err
  }
}
