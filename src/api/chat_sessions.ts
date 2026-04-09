import { apiFetch, API_BASE } from './client'
import type { ChatSession, ChatSessionMessage } from '../types/chat_sessions'

export async function getSessions(): Promise<ChatSession[]> {
  return apiFetch('/chat/sessions')
}

export async function createSession(title?: string): Promise<ChatSession> {
  return apiFetch('/chat/sessions', {
    method: 'POST',
    body: JSON.stringify({ title: title || 'New Chat' }),
  })
}

export async function getSessionMessages(sessionId: string): Promise<ChatSessionMessage[]> {
  return apiFetch(`/chat/sessions/${sessionId}/messages`)
}

export async function deleteSession(sessionId: string): Promise<void> {
  return apiFetch(`/chat/sessions/${sessionId}`, { method: 'DELETE' })
}

export async function renameSession(sessionId: string, title: string): Promise<void> {
  return apiFetch(`/chat/sessions/${sessionId}`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  })
}

export async function addMessage(sessionId: string, role: string, content: string): Promise<void> {
  await apiFetch(`/chat/sessions/${sessionId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ role, content }),
  })
}

export async function exportSession(sessionId: string, format: 'txt' | 'jsonl' | 'pdf'): Promise<Blob> {
  const res = await fetch(`${API_BASE}/chat/sessions/${sessionId}/export?format=${format}`)
  if (!res.ok) throw new Error('Export failed')
  return res.blob()
}
