export interface AppSettings {
  theme: string  // "light" | "dark" | "system"
  gpu_mode: string  // "auto" | "cpu" | "gpu"
  n_gpu_layers: number  // -1 = auto
  training_defaults: Record<string, any>
  chat_defaults: Record<string, any>
  storage_paths: Record<string, string>
}
