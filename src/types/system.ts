export interface GpuInfo {
  name: string
  vram_gb: number
  compute_capability?: string
  cuda_version?: string
  driver_version?: string
}

export interface SystemInfo {
  gpu: GpuInfo | null
  has_gpu: boolean
  cpu: string
  ram_gb: number
  os: string
  python_version: string
  disk_free_gb: number
}

export interface ModelCompatibility {
  name: string
  parameters: string
  can_train: boolean
  can_infer: boolean
  vram_training_gb: number
  vram_inference_gb: number
  license: string
  description: string
  gated: boolean
  reason?: string
}
