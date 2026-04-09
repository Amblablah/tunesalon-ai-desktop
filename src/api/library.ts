import { apiFetch } from './client'
import type { DiskUsage, BaseModelEntry, AdapterEntry, GgufEntry } from '../types/library'

export async function getDiskUsage(): Promise<DiskUsage> {
  return apiFetch('/library/disk-usage')
}

export async function getModels(): Promise<BaseModelEntry[]> {
  return apiFetch('/library/models')
}

export async function deleteModel(name: string): Promise<void> {
  await apiFetch(`/library/models/${encodeURIComponent(name)}`, { method: 'DELETE' })
}

export async function getAdapters(): Promise<AdapterEntry[]> {
  return apiFetch('/library/adapters')
}

export async function deleteAdapter(name: string): Promise<void> {
  await apiFetch(`/library/adapters/${encodeURIComponent(name)}`, { method: 'DELETE' })
}

export async function renameAdapter(name: string, newName: string): Promise<AdapterEntry> {
  return apiFetch(`/library/adapters/${encodeURIComponent(name)}`, {
    method: 'PATCH',
    body: JSON.stringify({ new_name: newName }),
  })
}

export async function getGgufs(): Promise<GgufEntry[]> {
  return apiFetch('/library/gguf')
}

export async function deleteGguf(name: string): Promise<void> {
  await apiFetch(`/library/gguf/${encodeURIComponent(name)}`, { method: 'DELETE' })
}
