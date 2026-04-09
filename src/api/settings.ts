import { apiFetch } from './client'
import type { AppSettings } from '../types/settings'

export async function getSettings(): Promise<AppSettings> {
  return apiFetch('/settings')
}

export async function updateSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
  return apiFetch('/settings', {
    method: 'PUT',
    body: JSON.stringify(settings),
  })
}

export async function patchSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
  return apiFetch('/settings', {
    method: 'PATCH',
    body: JSON.stringify(settings),
  })
}

export async function getStorageUsage(): Promise<{
  models_gb: number
  adapters_mb: number
  gguf_gb: number
  embeddings_gb: number
  total_gb: number
}> {
  return apiFetch('/settings/storage')
}
