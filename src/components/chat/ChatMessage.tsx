import type { ChatMessage as ChatMessageType } from '../../types/chat'

interface Props {
  message: ChatMessageType
  timestamp?: string
}

export default function ChatMessage({ message, timestamp }: Props) {
  const isUser = message.role === 'user'

  // Simple code block detection: lines wrapped in ```
  const renderContent = (content: string) => {
    const parts = content.split(/(```[\s\S]*?```)/g)
    return parts.map((part, i) => {
      if (part.startsWith('```') && part.endsWith('```')) {
        const code = part.slice(3, -3).replace(/^\w*\n/, '') // strip language hint
        return (
          <pre
            key={i}
            className="my-2 p-3 rounded bg-gray-100 dark:bg-gray-800 overflow-x-auto text-sm font-mono"
          >
            {code}
          </pre>
        )
      }
      // Inline code
      const inlineParts = part.split(/(`[^`]+`)/g)
      return (
        <span key={i}>
          {inlineParts.map((ip, j) =>
            ip.startsWith('`') && ip.endsWith('`') ? (
              <code
                key={j}
                className="px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-sm font-mono"
              >
                {ip.slice(1, -1)}
              </code>
            ) : (
              <span key={j} className="whitespace-pre-wrap">{ip}</span>
            )
          )}
        </span>
      )
    })
  }

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      <div
        className={`max-w-[75%] rounded-lg px-4 py-2.5 ${
          isUser
            ? 'bg-indigo-600 text-white'
            : 'bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100'
        }`}
      >
        <div className="text-sm leading-relaxed">{renderContent(message.content)}</div>
        {timestamp && (
          <div
            className={`text-[10px] mt-1 ${
              isUser ? 'text-indigo-200' : 'text-gray-400 dark:text-gray-500'
            }`}
          >
            {new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        )}
      </div>
    </div>
  )
}
