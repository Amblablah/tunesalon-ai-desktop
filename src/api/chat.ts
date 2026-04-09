import { apiFetch, API_BASE } from './client'
import type {
  ChatStatus,
  LoadModelRequest,
  LoadAdapterRequest,
  LoadGgufRequest,
  ChatRequest,
} from '../types/chat'

export async function loadModel(request: LoadModelRequest): Promise<{ status: string; system_prompt?: string | null }> {
  return apiFetch('/chat/load-model', {
    method: 'POST',
    body: JSON.stringify(request),
  })
}

export async function loadGguf(request: LoadGgufRequest): Promise<{ status: string }> {
  return apiFetch('/chat/load-gguf', {
    method: 'POST',
    body: JSON.stringify(request),
  })
}

export async function loadAdapter(request: LoadAdapterRequest): Promise<{ status: string; system_prompt?: string | null }> {
  return apiFetch('/chat/load-adapter', {
    method: 'POST',
    body: JSON.stringify(request),
  })
}

export async function removeAdapter(index: number): Promise<{ status: string }> {
  return apiFetch(`/chat/adapter/${index}`, { method: 'DELETE' })
}

export async function getChatStatus(): Promise<ChatStatus> {
  return apiFetch('/chat/status')
}

export async function unloadModel(): Promise<{ status: string }> {
  return apiFetch('/chat/unload', { method: 'POST' })
}

export async function sendMessage(
  request: ChatRequest,
  onToken: (token: string) => void,
  onDone: () => void,
  onError: (err: string) => void
): Promise<void> {
  const res = await fetch(`${API_BASE}/chat/message`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Unknown error' }))
    onError(err.detail || 'Chat error')
    return
  }
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  while (true) {
    const { done, value } = await reader.read()
    if (done) { onDone(); break }
    const text = decoder.decode(value, { stream: true })
    for (const line of text.split('\n')) {
      if (line.startsWith('data: ')) {
        try {
          const event = JSON.parse(line.slice(6))
          if (event.done) { onDone(); return }
          if (event.error) { onError(event.error); return }
          if (event.token) onToken(event.token)
        } catch { /* ignore partial JSON */ }
      }
    }
  }
}

export interface UploadedDocument {
  filename: string
  file_type: string
  pages: number
  chunks: number
  characters: number
}

export async function uploadDocument(file: File): Promise<UploadedDocument> {
  const formData = new FormData()
  formData.append('file', file)
  const res = await fetch(`${API_BASE}/chat/documents/upload`, {
    method: 'POST',
    body: formData,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Upload failed' }))
    throw new Error(err.detail || 'Upload failed')
  }
  return res.json()
}

export async function getDocuments(): Promise<UploadedDocument[]> {
  const res = await apiFetch<{ documents: UploadedDocument[] }>('/chat/documents')
  return res.documents
}

export async function removeDocument(filename: string): Promise<void> {
  return apiFetch(`/chat/documents/${encodeURIComponent(filename)}`, { method: 'DELETE' })
}

export interface DoclingStatus {
  installed: boolean
  installing: boolean
  progress: string | null
}

export async function getDoclingStatus(): Promise<DoclingStatus> {
  return apiFetch('/chat/documents/docling-status')
}

export async function installDocling(): Promise<{ status: string; progress?: string }> {
  return apiFetch('/chat/documents/install-docling', { method: 'POST' })
}
