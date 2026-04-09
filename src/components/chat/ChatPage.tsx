import { useState, useEffect, useCallback, useRef } from 'react'
import ChatSidebar from './ChatSidebar'
import ChatInterface from './ChatInterface'
import ModelLoader from './ModelLoader'
import ChatSettings from './ChatSettings'
import DocumentUpload from './DocumentUpload'
import Spinner from '../shared/Spinner'
import { getChatStatus, sendMessage } from '../../api/chat'
import { getSessions, createSession, getSessionMessages, addMessage } from '../../api/chat_sessions'
import type { ChatStatus, ChatMessage } from '../../types/chat'
import type { ChatSession, ChatSessionMessage } from '../../types/chat_sessions'

export default function ChatPage() {
  // Chat status
  const [status, setStatus] = useState<ChatStatus>({ model: null, adapters: [], engine: null })
  const [statusLoading, setStatusLoading] = useState(true)

  // Sessions
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)

  // Messages for active session
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [timestamps, setTimestamps] = useState<string[]>([])

  // Streaming
  const [streaming, setStreaming] = useState(false)
  const [streamContent, setStreamContent] = useState('')

  // Settings
  const [temperature, setTemperature] = useState(0.7)
  const [maxTokens, setMaxTokens] = useState(512)
  const [systemPrompt, setSystemPrompt] = useState('')

  // Right panel visibility
  const [rightPanelOpen, setRightPanelOpen] = useState(true)

  // Fetch chat status
  const refreshStatus = useCallback(async () => {
    try {
      const s = await getChatStatus()
      setStatus(s)
    } catch { /* backend may not be running */ }
  }, [])

  // Fetch sessions
  const refreshSessions = useCallback(async () => {
    try {
      const s = await getSessions()
      // Sort by updated_at descending
      s.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
      setSessions(s)
    } catch { /* ignore */ }
  }, [])

  // Load messages for a session
  const loadSessionMessages = useCallback(async (sessionId: string) => {
    try {
      const msgs: ChatSessionMessage[] = await getSessionMessages(sessionId)
      setMessages(msgs.map((m) => ({ role: m.role, content: m.content })))
      setTimestamps(msgs.map((m) => m.created_at))
    } catch {
      setMessages([])
      setTimestamps([])
    }
  }, [])

  // Initial load
  useEffect(() => {
    const init = async () => {
      setStatusLoading(true)
      await Promise.all([refreshStatus(), refreshSessions()])
      setStatusLoading(false)
    }
    init()
  }, [refreshStatus, refreshSessions])

  // Track whether we're creating a new session (to skip message reload)
  const creatingSessionRef = useRef(false)

  // When active session changes, load its messages (unless we just created it)
  useEffect(() => {
    if (creatingSessionRef.current) {
      creatingSessionRef.current = false
      return // skip — we just created this session, messages are already in state
    }
    if (activeSessionId) {
      loadSessionMessages(activeSessionId)
    } else {
      setMessages([])
      setTimestamps([])
    }
  }, [activeSessionId, loadSessionMessages])

  // Handle sending a message
  const handleSend = async (text: string) => {
    // Add user message to local state FIRST (before session creation)
    const userMsg: ChatMessage = { role: 'user', content: text }
    const now = new Date().toISOString()
    setMessages((prev) => [...prev, userMsg])
    setTimestamps((prev) => [...prev, now])

    // If no active session, create one
    let sessionId = activeSessionId
    if (!sessionId) {
      try {
        creatingSessionRef.current = true // prevent useEffect from clearing messages
        const session = await createSession(text.slice(0, 50))
        sessionId = session.id
        setActiveSessionId(session.id)
        await refreshSessions()
      } catch {
        // If sessions endpoint not available, just chat without persistence
      }
    }

    // Persist user message to storage
    if (sessionId) {
      addMessage(sessionId, 'user', text).catch(() => {})
    }

    // Build history for the API (previous messages only — current message sent separately)
    const history = [...messages]

    setStreaming(true)
    setStreamContent('')

    let fullResponse = ''
    const currentSessionId = sessionId // capture for closure

    await sendMessage(
      {
        message: text,
        system_prompt: systemPrompt || null,
        history,
        temperature,
        max_tokens: maxTokens,
      },
      (token) => {
        fullResponse += token
        setStreamContent(fullResponse)
      },
      () => {
        // Done — add assistant message
        setMessages((prev) => [...prev, { role: 'assistant', content: fullResponse }])
        setTimestamps((prev) => [...prev, new Date().toISOString()])
        setStreaming(false)
        setStreamContent('')
        // Persist assistant message to storage
        if (currentSessionId) {
          addMessage(currentSessionId, 'assistant', fullResponse).catch(() => {})
        }
        refreshSessions() // update message count
      },
      (err) => {
        // Error — show as assistant message
        setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${err}` }])
        setTimestamps((prev) => [...prev, new Date().toISOString()])
        setStreaming(false)
        setStreamContent('')
      }
    )
  }

  // Handle new chat
  const handleNewChat = async () => {
    setActiveSessionId(null)
    setMessages([])
    setTimestamps([])
  }

  // Handle session select
  const handleSelectSession = (sessionId: string) => {
    if (streaming) return // don't switch while streaming
    setActiveSessionId(sessionId)
  }

  if (statusLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spinner className="h-8 w-8" />
      </div>
    )
  }

  return (
    <div className="flex h-full overflow-hidden relative">
      {/* Left sidebar — chat history */}
      <div className="w-64 flex-shrink-0 border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 overflow-y-auto">
        <ChatSidebar
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelect={handleSelectSession}
          onNewChat={handleNewChat}
          onSessionsChange={refreshSessions}
        />
      </div>

      {/* Center — chat interface */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        <ChatInterface
          messages={messages}
          timestamps={timestamps}
          streaming={streaming}
          streamContent={streamContent}
          modelLoaded={!!status.model}
          onSend={handleSend}
        />
      </div>

      {/* Right panel toggle */}
      <button
        onClick={() => setRightPanelOpen(!rightPanelOpen)}
        className="absolute top-3 right-3 z-10 p-1.5 rounded-md bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-indigo-600 transition-colors"
        title={rightPanelOpen ? 'Hide settings' : 'Show settings'}
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          {rightPanelOpen ? (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
          )}
        </svg>
      </button>

      {/* Right panel — model loader + settings + documents */}
      {rightPanelOpen && (
        <div className="w-80 flex-shrink-0 border-l border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 overflow-y-auto">
          <div className="p-4 space-y-6">
            <ModelLoader status={status} onStatusChange={refreshStatus} onSystemPromptSuggested={setSystemPrompt} />
            <hr className="border-gray-200 dark:border-gray-700" />
            <ChatSettings
              temperature={temperature}
              maxTokens={maxTokens}
              systemPrompt={systemPrompt}
              onTemperatureChange={setTemperature}
              onMaxTokensChange={setMaxTokens}
              onSystemPromptChange={setSystemPrompt}
            />
            <hr className="border-gray-200 dark:border-gray-700" />
            <DocumentUpload />
          </div>
        </div>
      )}
    </div>
  )
}
