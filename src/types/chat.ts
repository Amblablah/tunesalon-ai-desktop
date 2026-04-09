export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatStatus {
  model: string | null
  adapters: string[]
  engine: string | null  // "pytorch", "gguf", or null
}

export interface ChatStreamEvent {
  token: string
  done: boolean
  error?: string
}

export interface LoadModelRequest {
  model_name: string
  adapter_path?: string | null
}

export interface LoadAdapterRequest {
  adapter_path: string
}

export interface LoadGgufRequest {
  gguf_path: string
  n_gpu_layers?: number
  n_ctx?: number
}

export interface ChatRequest {
  message: string
  system_prompt?: string | null
  history?: ChatMessage[]
  temperature?: number
  max_tokens?: number
}
