import { useState } from 'react'
import type { ChatSession } from '../../types/chat_sessions'
import { deleteSession, renameSession, exportSession } from '../../api/chat_sessions'
import { confirmDialog } from '../../utils/native'

interface Props {
  sessions: ChatSession[]
  activeSessionId: string | null
  onSelect: (sessionId: string) => void
  onNewChat: () => void
  onSessionsChange: () => void
}

export default function ChatSidebar({
  sessions,
  activeSessionId,
  onSelect,
  onNewChat,
  onSessionsChange,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [exportMenuId, setExportMenuId] = useState<string | null>(null)

  const handleDoubleClick = (session: ChatSession) => {
    setEditingId(session.id)
    setEditTitle(session.title)
  }

  const handleRenameSubmit = async (sessionId: string) => {
    const trimmed = editTitle.trim()
    if (trimmed) {
      try {
        await renameSession(sessionId, trimmed)
        onSessionsChange()
      } catch { /* ignore */ }
    }
    setEditingId(null)
  }

  const handleDelete = async (sessionId: string) => {
    const yes = await confirmDialog('Delete this chat session?', 'Delete Chat')
    if (!yes) return
    try {
      await deleteSession(sessionId)
      onSessionsChange()
    } catch { /* ignore */ }
  }

  const handleExport = async (sessionId: string, format: 'txt' | 'jsonl' | 'pdf') => {
    setExportMenuId(null)
    try {
      const blob = await exportSession(sessionId, format)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `chat-export.${format}`
      a.click()
      URL.revokeObjectURL(url)
    } catch { /* ignore */ }
  }

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - d.getTime()
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
    if (diffDays === 0) return 'Today'
    if (diffDays === 1) return 'Yesterday'
    if (diffDays < 7) return `${diffDays}d ago`
    return d.toLocaleDateString()
  }

  return (
    <div className="flex flex-col h-full">
      {/* New Chat button */}
      <div className="p-3">
        <button
          onClick={onNewChat}
          className="w-full rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 transition-colors flex items-center justify-center gap-1.5"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Chat
        </button>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {sessions.length === 0 && (
          <p className="text-xs text-gray-400 dark:text-gray-500 text-center mt-4">
            No chat sessions yet
          </p>
        )}
        {sessions.map((session) => (
          <div
            key={session.id}
            onClick={() => onSelect(session.id)}
            className={`group relative rounded-md px-3 py-2 mb-1 cursor-pointer transition-colors ${
              activeSessionId === session.id
                ? 'bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-800'
                : 'hover:bg-gray-50 dark:hover:bg-gray-800'
            }`}
          >
            {editingId === session.id ? (
              <input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onBlur={() => handleRenameSubmit(session.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRenameSubmit(session.id)
                  if (e.key === 'Escape') setEditingId(null)
                }}
                autoFocus
                className="w-full text-sm bg-transparent border-b border-indigo-400 focus:outline-none dark:text-gray-100"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <div onDoubleClick={() => handleDoubleClick(session)}>
                <div className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate pr-12">
                  {session.title}
                </div>
                <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
                  {session.message_count} messages · {formatDate(session.updated_at)}
                </div>
              </div>
            )}

            {/* Action buttons (visible on hover) */}
            <div className="absolute right-2 top-2 hidden group-hover:flex items-center gap-1">
              {/* Export */}
              <div className="relative">
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setExportMenuId(exportMenuId === session.id ? null : session.id)
                  }}
                  className="p-1 rounded text-gray-400 hover:text-indigo-600 hover:bg-gray-100 dark:hover:bg-gray-700"
                  title="Export"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </button>
                {exportMenuId === session.id && (
                  <div className="absolute right-0 top-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg z-10 py-1 min-w-[80px]">
                    {(['txt', 'jsonl', 'pdf'] as const).map((fmt) => (
                      <button
                        key={fmt}
                        onClick={(e) => {
                          e.stopPropagation()
                          handleExport(session.id, fmt)
                        }}
                        className="block w-full text-left px-3 py-1 text-xs text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                      >
                        {fmt.toUpperCase()}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {/* Delete */}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  handleDelete(session.id)
                }}
                className="p-1 rounded text-gray-400 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                title="Delete"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
