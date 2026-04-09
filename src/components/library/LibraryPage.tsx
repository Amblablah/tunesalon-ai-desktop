import { useState, useCallback } from 'react'
import DiskUsageBanner from './DiskUsageBanner'
import BaseModelsTab from './BaseModelsTab'
import AdaptersTab from './AdaptersTab'
import GgufTab from './GgufTab'

const TABS = ['Base Models', 'Adapters', 'GGUF'] as const
type Tab = typeof TABS[number]

export default function LibraryPage() {
  const [activeTab, setActiveTab] = useState<Tab>('Base Models')
  const [refreshKey, setRefreshKey] = useState(0)

  const triggerRefresh = useCallback(() => {
    setRefreshKey(k => k + 1)
  }, [])

  return (
    <div className="p-6 overflow-y-auto h-full space-y-6">
      <div>
        <h1 className="text-2xl font-bold mb-1">Library</h1>
        <p className="text-gray-500 dark:text-gray-400">Manage your local models, adapters, and GGUF files</p>
      </div>

      <DiskUsageBanner refreshKey={refreshKey} />

      {/* Subtab navigation */}
      <div className="border-b border-gray-200 dark:border-gray-800">
        <nav className="flex gap-6">
          {TABS.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`pb-2 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              {tab}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content — all tabs stay mounted so downloads survive tab switches */}
      <div className={activeTab === 'Base Models' ? '' : 'hidden'}><BaseModelsTab onChanged={triggerRefresh} /></div>
      <div className={activeTab === 'Adapters' ? '' : 'hidden'}><AdaptersTab onChanged={triggerRefresh} /></div>
      <div className={activeTab === 'GGUF' ? '' : 'hidden'}><GgufTab onChanged={triggerRefresh} /></div>
    </div>
  )
}
