import { useState, useEffect } from 'react'

interface Props {
  temperature: number
  maxTokens: number
  systemPrompt: string
  onTemperatureChange: (v: number) => void
  onMaxTokensChange: (v: number) => void
  onSystemPromptChange: (v: string) => void
}

const DEFAULTS = { temperature: 0.7, maxTokens: 512, systemPrompt: '' }

export default function ChatSettings({
  temperature,
  maxTokens,
  systemPrompt,
  onTemperatureChange,
  onMaxTokensChange,
  onSystemPromptChange,
}: Props) {
  const [localTemp, setLocalTemp] = useState(temperature)
  const [localTokens, setLocalTokens] = useState(maxTokens)

  useEffect(() => { setLocalTemp(temperature) }, [temperature])
  useEffect(() => { setLocalTokens(maxTokens) }, [maxTokens])

  const handleReset = () => {
    onTemperatureChange(DEFAULTS.temperature)
    onMaxTokensChange(DEFAULTS.maxTokens)
    onSystemPromptChange(DEFAULTS.systemPrompt)
  }

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
        Settings
      </h3>

      {/* Creativity (Temperature) */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-gray-600 dark:text-gray-400 flex items-center gap-1">
            Creativity
            <span className="relative group">
              <svg className="h-3 w-3 text-gray-400 cursor-help" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.065 2.01-1.37 3.272-1.37 1.5 0 2.5.946 2.5 2.37 0 1.5-1.5 1.5-1.5 3M12 17h.01" />
                <circle cx="12" cy="12" r="10" strokeWidth={2} />
              </svg>
              <span className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-44 px-2 py-1.5 text-[10px] font-normal text-white bg-gray-900 dark:bg-gray-700 rounded-md shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity leading-snug">
                Lower = more focused and consistent. Higher = more varied and creative.
              </span>
            </span>
          </label>
          <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums">
            {localTemp.toFixed(1)}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={2}
          step={0.1}
          value={localTemp}
          onChange={(e) => {
            const v = parseFloat(e.target.value)
            setLocalTemp(v)
            onTemperatureChange(v)
          }}
          className="w-full h-1.5 rounded-lg appearance-none cursor-pointer bg-gray-200 dark:bg-gray-700 accent-indigo-600"
        />
        <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
          <span>Precise</span>
          <span>Creative</span>
        </div>
      </div>

      {/* Response Length (Max Tokens) */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium text-gray-600 dark:text-gray-400 flex items-center gap-1">
            Response Length
            <span className="relative group">
              <svg className="h-3 w-3 text-gray-400 cursor-help" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.065 2.01-1.37 3.272-1.37 1.5 0 2.5.946 2.5 2.37 0 1.5-1.5 1.5-1.5 3M12 17h.01" />
                <circle cx="12" cy="12" r="10" strokeWidth={2} />
              </svg>
              <span className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-44 px-2 py-1.5 text-[10px] font-normal text-white bg-gray-900 dark:bg-gray-700 rounded-md shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity leading-snug">
                Maximum words the AI can generate. Higher = longer answers but takes more time.
              </span>
            </span>
          </label>
          <span className="text-xs text-gray-500 dark:text-gray-400 tabular-nums">
            {localTokens}
          </span>
        </div>
        <input
          type="range"
          min={128}
          max={4096}
          step={128}
          value={localTokens}
          onChange={(e) => {
            const v = parseInt(e.target.value)
            setLocalTokens(v)
            onMaxTokensChange(v)
          }}
          className="w-full h-1.5 rounded-lg appearance-none cursor-pointer bg-gray-200 dark:bg-gray-700 accent-indigo-600"
        />
        <div className="flex justify-between text-[10px] text-gray-400 mt-0.5">
          <span>Short</span>
          <span>Long</span>
        </div>
      </div>

      {/* System Prompt */}
      <div>
        <label className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1 flex items-center gap-1">
          System Prompt
          <span className="relative group">
            <svg className="h-3 w-3 text-gray-400 cursor-help" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.065 2.01-1.37 3.272-1.37 1.5 0 2.5.946 2.5 2.37 0 1.5-1.5 1.5-1.5 3M12 17h.01" />
              <circle cx="12" cy="12" r="10" strokeWidth={2} />
            </svg>
            <span className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-44 px-2 py-1.5 text-[10px] font-normal text-white bg-gray-900 dark:bg-gray-700 rounded-md shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity leading-snug">
              Instructions that shape how the AI behaves, like its personality or role.
            </span>
          </span>
        </label>
        <textarea
          value={systemPrompt}
          onChange={(e) => onSystemPromptChange(e.target.value)}
          placeholder="Optional instructions for the model..."
          rows={3}
          className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:text-gray-100"
        />
      </div>

      {/* Reset */}
      <button
        onClick={handleReset}
        className="text-xs text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
      >
        Reset to defaults
      </button>
    </div>
  )
}
