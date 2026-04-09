import type { ModelCompatibility } from '../../types/system'

/** Strip org prefix (e.g. "microsoft/") and -Instruct/-it suffixes */
function modelShortName(fullName: string): string {
  let name = fullName.includes('/') ? fullName.split('/').pop()! : fullName
  name = name.replace(/-(I|i)nstruct$/, '').replace(/-(I|i)t$/, '')
  return name
}

function CheckIcon() {
  return (
    <svg className="h-5 w-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  )
}

function XIcon() {
  return (
    <svg className="h-5 w-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}

interface ModelTableProps {
  models: ModelCompatibility[]
}

export default function ModelTable({ models }: ModelTableProps) {
  if (models.length === 0) {
    return (
      <p className="text-gray-500 dark:text-gray-400 text-sm">No model compatibility data available.</p>
    )
  }

  return (
    <div>
      {/* Desktop table */}
      <div className="hidden sm:block overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
        <table className="w-full text-sm">
          <thead className="bg-gray-100 dark:bg-gray-800 text-left text-gray-600 dark:text-gray-300">
            <tr>
              <th className="px-4 py-3 font-medium">Model</th>
              <th className="px-4 py-3 font-medium">Parameters</th>
              <th className="px-4 py-3 font-medium">VRAM (Train)</th>
              <th className="px-4 py-3 font-medium">VRAM (Chat)</th>
              <th className="px-4 py-3 font-medium">License</th>
              <th className="px-4 py-3 font-medium text-center">Can Train</th>
              <th className="px-4 py-3 font-medium text-center">Can Chat</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
            {models.map((m) => (
              <tr key={m.name} className="bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800/60">
                <td className="px-4 py-3">
                  <span className="font-medium">{modelShortName(m.name)}</span>
                  {m.gated && (
                    <span className="ml-2 inline-block rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 text-xs px-1.5 py-0.5">
                      Requires HF approval
                    </span>
                  )}
                  {m.reason && (
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{m.reason}</p>
                  )}
                </td>
                <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{m.parameters}</td>
                <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{m.vram_training_gb} GB</td>
                <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{m.vram_inference_gb} GB</td>
                <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{m.license}</td>
                <td className="px-4 py-3 text-center">{m.can_train ? <CheckIcon /> : <XIcon />}</td>
                <td className="px-4 py-3 text-center">{m.can_infer ? <CheckIcon /> : <XIcon />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile card layout */}
      <div className="sm:hidden space-y-3">
        {models.map((m) => (
          <div
            key={m.name}
            className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4"
          >
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium">{modelShortName(m.name)}</span>
              <span className="text-xs text-gray-500 dark:text-gray-400">{m.parameters}</span>
            </div>

            {m.gated && (
              <span className="inline-block rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 text-xs px-1.5 py-0.5 mb-2">
                Requires HF approval
              </span>
            )}

            <div className="grid grid-cols-2 gap-2 text-sm mb-2">
              <div>
                <span className="text-gray-500 dark:text-gray-400 text-xs block">VRAM (Train)</span>
                <span>{m.vram_training_gb} GB</span>
              </div>
              <div>
                <span className="text-gray-500 dark:text-gray-400 text-xs block">VRAM (Chat)</span>
                <span>{m.vram_inference_gb} GB</span>
              </div>
              <div>
                <span className="text-gray-500 dark:text-gray-400 text-xs block">License</span>
                <span>{m.license}</span>
              </div>
            </div>

            <div className="flex items-center gap-4 text-sm">
              <span className="flex items-center gap-1">
                {m.can_train ? <CheckIcon /> : <XIcon />}
                Train
              </span>
              <span className="flex items-center gap-1">
                {m.can_infer ? <CheckIcon /> : <XIcon />}
                Chat
              </span>
            </div>

            {m.reason && (
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">{m.reason}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
