import { useState, useRef, useEffect } from 'react'
import ChatMessageComponent from './ChatMessage'
import Spinner from '../shared/Spinner'
import type { ChatMessage } from '../../types/chat'

interface Props {
  messages: ChatMessage[]
  timestamps?: string[]
  streaming: boolean
  streamContent: string
  modelLoaded: boolean
  onSend: (message: string) => void
}

export default function ChatInterface({
  messages,
  timestamps,
  streaming,
  streamContent,
  modelLoaded,
  onSend,
}: Props) {
  const [input, setInput] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamContent])

  const handleSend = () => {
    const trimmed = input.trim()
    if (!trimmed || streaming || !modelLoaded) return
    onSend(trimmed)
    setInput('')
    // Reset textarea height
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    // Auto-resize
    const ta = e.target
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 150) + 'px'
  }

  if (!modelLoaded) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-400 dark:text-gray-500">
        <div className="text-center">
          <svg className="mx-auto h-12 w-12 mb-3 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
          <p className="text-lg font-medium">Load a model to start chatting</p>
          <p className="text-sm mt-1">Use the panel on the right to load a model</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {messages.length === 0 && !streaming && (
          <div className="flex items-center justify-center h-full text-gray-400 dark:text-gray-500 text-sm">
            Send a message to start the conversation
          </div>
        )}
        {messages.map((msg, i) => (
          <ChatMessageComponent
            key={i}
            message={msg}
            timestamp={timestamps?.[i]}
          />
        ))}
        {streaming && streamContent && (
          <ChatMessageComponent
            message={{ role: 'assistant', content: streamContent }}
          />
        )}
        {streaming && !streamContent && (
          <div className="flex justify-start mb-3">
            <div className="bg-gray-100 dark:bg-gray-800 rounded-lg px-4 py-2.5 flex items-center gap-2">
              <Spinner className="h-4 w-4" />
              <span className="text-sm text-gray-500">Thinking...</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="border-t border-gray-200 dark:border-gray-700 px-4 py-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Type a message... (Enter to send, Shift+Enter for newline)"
            rows={1}
            className="flex-1 resize-none rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-gray-100"
            disabled={streaming}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || streaming}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {streaming ? <Spinner className="h-4 w-4 text-white" /> : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}
