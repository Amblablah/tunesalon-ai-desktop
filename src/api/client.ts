// In dev (Vite proxy): relative '/api' works via proxy to localhost:8765
// In Tauri production: no Vite proxy, must use absolute URL
const isDev = import.meta.env.DEV
const API_BASE = isDev ? '/api' : 'http://localhost:8765/api'

export async function apiFetch<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${endpoint}`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  })
  if (!res.ok) {
    const error = await res.json().catch(() => ({ detail: 'Unknown error' }))
    throw new Error(error.detail || `API error ${res.status}`)
  }
  return res.json()
}

export function apiStreamUrl(endpoint: string): string {
  return `${API_BASE}${endpoint}`
}

export { API_BASE }
