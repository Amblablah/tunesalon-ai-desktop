export interface ChatSession {
  id: string
  title: string
  model_name: string | null
  message_count: number
  created_at: string
  updated_at: string
}

export interface ChatSessionMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
}
