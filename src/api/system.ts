import { apiFetch } from './client'
import type { SystemInfo, ModelCompatibility } from '../types/system'

export async function getSystemInfo(): Promise<SystemInfo> {
  return apiFetch('/system/info')
}

export async function getModelCompatibility(): Promise<ModelCompatibility[]> {
  return apiFetch('/system/models')
}

export async function refreshHardware(): Promise<SystemInfo> {
  return apiFetch('/system/refresh', { method: 'POST' })
}
