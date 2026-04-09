export interface ModelSearchResult {
  model_id: string
  description: string
  downloads: number | null
  parameter_count: string | null
  last_modified: string | null
  is_curated: boolean
  vram_training_gb: number | null
  vram_inference_gb: number | null
  license: string | null
  gated: boolean
}

export interface TrainRequest {
  model_name: string
  dataset_path: string
  eval_dataset_path?: string | null
  adapter_name?: string | null
  lora_r?: number | null
  lora_alpha?: number | null
  lora_dropout?: number | null
  learning_rate?: number | null
  num_epochs?: number | null
  batch_size?: number | null
  gradient_accumulation_steps?: number | null
  max_seq_length?: number | null
}

export interface TrainProgressEvent {
  status: string  // downloading, preparing, training, saving, complete, error, cancelled
  message: string
  step: number | null
  total_steps: number | null
  loss: number | null
  epoch: number | null
}

export interface SaveAdapterRequest {
  adapter_name: string
  description?: string | null
  base_model?: string | null
  custom_path?: string | null
}

export interface GgufExportRequest {
  adapter_path: string
  base_model: string
  quantization?: string | null
  output_name?: string | null
  custom_path?: string | null
}

export interface ModelDownloadStatus {
  status: string  // idle, downloading, complete, error, cancelled
  model_id: string | null
  progress: number | null
  message: string | null
}

export interface DatasetValidation {
  valid: boolean
  example_count: number
  format: string
  errors: string[]
  preview: Array<{ instruction: string; output: string }>
  path: string
}
