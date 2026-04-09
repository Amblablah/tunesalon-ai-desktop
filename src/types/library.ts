export interface DiskUsage {
  models_gb: number
  adapters_mb: number
  gguf_gb: number
  embeddings_gb: number
  total_gb: number
}

export interface BaseModelEntry {
  name: string
  path: string
  size_gb: number
  parameters: string | null
  downloaded_at: string
}

export interface AdapterEntry {
  name: string
  path: string
  size_mb: number
  base_model: string | null
  created_at: string
}

export interface GgufEntry {
  name: string
  path: string
  size_gb: number
  quantization: string | null
  created_at: string
}
