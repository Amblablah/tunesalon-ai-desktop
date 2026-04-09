import { useState } from 'react'

export interface TrainingConfig {
  num_epochs: number
  max_seq_length: number
  lora_r: number
  lora_alpha: number
  lora_dropout: number
  learning_rate: number
  batch_size: number
  gradient_accumulation_steps: number
}

const DEFAULTS: TrainingConfig = {
  num_epochs: 3,
  max_seq_length: 1024,
  lora_r: 16,
  lora_alpha: 32,
  lora_dropout: 0.05,
  learning_rate: 0.0001,
  batch_size: 1,
  gradient_accumulation_steps: 4,
}

const SEQ_LENGTH_OPTIONS = [
  { value: 512, label: '512 tokens' },
  { value: 1024, label: '1024 tokens' },
  { value: 2048, label: '2048 tokens' },
]

interface Props {
  config: TrainingConfig
  onChange: (config: TrainingConfig) => void
}

export default function TrainingSettings({ config, onChange }: Props) {
  const [showAdvanced, setShowAdvanced] = useState(false)

  function update<K extends keyof TrainingConfig>(key: K, value: TrainingConfig[K]) {
    onChange({ ...config, [key]: value })
  }

  const isDefault = (key: keyof TrainingConfig) => config[key] === DEFAULTS[key]

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Training Settings</h3>

      {/* Simple settings */}
      <div className="space-y-5">
        {/* Epochs / Training Thoroughness */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-sm font-medium text-gray-900 dark:text-gray-100">
              Training Thoroughness
            </label>
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {config.num_epochs} {config.num_epochs === 1 ? 'pass' : 'passes'}
              {isDefault('num_epochs') && (
                <span className="ml-2 text-xs text-indigo-600 dark:text-indigo-400">Recommended</span>
              )}
            </span>
          </div>
          <input
            type="range"
            min={1}
            max={10}
            value={config.num_epochs}
            onChange={(e) => update('num_epochs', parseInt(e.target.value))}
            className="w-full accent-indigo-500"
          />
          <div className="flex justify-between text-xs text-gray-400 dark:text-gray-500 mt-0.5">
            <span>Quick (1)</span>
            <span>Thorough (10)</span>
          </div>
        </div>

        {/* Max Seq Length / Response Length */}
        <div>
          <label className="text-sm font-medium text-gray-900 dark:text-gray-100 block mb-1.5">
            Response Length
          </label>
          <div className="flex gap-2">
            {SEQ_LENGTH_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => update('max_seq_length', opt.value)}
                className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium border transition-colors ${
                  config.max_seq_length === opt.value
                    ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300'
                    : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-indigo-300 dark:hover:border-indigo-700'
                }`}
              >
                {opt.label}
                {opt.value === DEFAULTS.max_seq_length && (
                  <span className="block text-xs text-indigo-500 dark:text-indigo-400 mt-0.5">Recommended</span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Advanced toggle */}
      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
      >
        <svg
          className={`h-3.5 w-3.5 transition-transform ${showAdvanced ? 'rotate-90' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        Advanced Settings
      </button>

      {showAdvanced && (
        <div className="space-y-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-4">
          {/* LoRA Rank / Learning Intensity */}
          <div>
            <label className="text-sm font-medium text-gray-900 dark:text-gray-100 block mb-1.5">
              Learning Intensity (LoRA Rank)
            </label>
            <div className="flex gap-2">
              {[8, 16, 32].map((r) => (
                <button
                  key={r}
                  onClick={() => update('lora_r', r)}
                  className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium border transition-colors ${
                    config.lora_r === r
                      ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300'
                      : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-indigo-300'
                  }`}
                >
                  {r}
                  {r === DEFAULTS.lora_r && (
                    <span className="block text-xs text-indigo-500 mt-0.5">Recommended</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* LoRA Alpha */}
          <div>
            <label className="text-sm font-medium text-gray-900 dark:text-gray-100 block mb-1.5">
              Alpha
            </label>
            <div className="flex gap-2">
              {[16, 32, 64].map((a) => (
                <button
                  key={a}
                  onClick={() => update('lora_alpha', a)}
                  className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium border transition-colors ${
                    config.lora_alpha === a
                      ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300'
                      : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-indigo-300'
                  }`}
                >
                  {a}
                  {a === DEFAULTS.lora_alpha && (
                    <span className="block text-xs text-indigo-500 mt-0.5">Recommended</span>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Learning Rate */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-medium text-gray-900 dark:text-gray-100">
                Learning Rate
              </label>
              <span className="text-xs text-gray-500 dark:text-gray-400 font-mono">
                {config.learning_rate}
                {isDefault('learning_rate') && (
                  <span className="ml-2 font-sans text-indigo-600 dark:text-indigo-400">Recommended</span>
                )}
              </span>
            </div>
            <input
              type="number"
              step={0.00001}
              min={0.00001}
              max={0.01}
              value={config.learning_rate}
              onChange={(e) => update('learning_rate', parseFloat(e.target.value) || DEFAULTS.learning_rate)}
              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* Batch size */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-900 dark:text-gray-100 block mb-1.5">
                Batch Size
              </label>
              <input
                type="number"
                min={1}
                max={8}
                value={config.batch_size}
                onChange={(e) => update('batch_size', parseInt(e.target.value) || DEFAULTS.batch_size)}
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-gray-900 dark:text-gray-100 block mb-1.5">
                Gradient Steps
              </label>
              <input
                type="number"
                min={1}
                max={16}
                value={config.gradient_accumulation_steps}
                onChange={(e) => update('gradient_accumulation_steps', parseInt(e.target.value) || DEFAULTS.gradient_accumulation_steps)}
                className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          {/* Dropout */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-medium text-gray-900 dark:text-gray-100">
                Dropout
              </label>
              <span className="text-xs text-gray-500 dark:text-gray-400 font-mono">{config.lora_dropout}</span>
            </div>
            <input
              type="range"
              min={0}
              max={0.3}
              step={0.01}
              value={config.lora_dropout}
              onChange={(e) => update('lora_dropout', parseFloat(e.target.value))}
              className="w-full accent-indigo-500"
            />
          </div>

          {/* Reset to defaults */}
          <button
            onClick={() => onChange({ ...DEFAULTS })}
            className="text-xs text-gray-500 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400"
          >
            Reset to recommended settings
          </button>
        </div>
      )}
    </div>
  )
}

export { DEFAULTS as DEFAULT_TRAINING_CONFIG }
