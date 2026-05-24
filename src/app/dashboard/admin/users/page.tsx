'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'

const PortalTab     = dynamic(() => import('./_components/PortalTab'),     { ssr: false })
const FdeTab        = dynamic(() => import('./_components/FdeTab'),        { ssr: false })
const ProspectsTab  = dynamic(() => import('./_components/ProspectsTab'),  { ssr: false })

const TABS = ['Portal Users', 'FDE Accounts', 'Prospects'] as const
type Tab = typeof TABS[number]

const TAB_ICONS: Record<Tab, string> = {
  'Portal Users': '🏢',
  'FDE Accounts': '👷',
  'Prospects':    '🔍',
}

export default function UserConsolePage() {
  const [activeTab, setActiveTab] = useState<Tab>('Portal Users')

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">User Console</h1>
        <p className="text-sm text-gray-500 mt-1">
          Manage Portal accounts, FDE access, and view Discovery prospects
        </p>
      </div>

      {/* Tab navigation */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex gap-1">
          {TABS.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-indigo-600 text-indigo-600 bg-indigo-50'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
              }`}
            >
              <span>{TAB_ICONS[tab]}</span>
              {tab}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === 'Portal Users'  && <PortalTab />}
      {activeTab === 'FDE Accounts'  && <FdeTab />}
      {activeTab === 'Prospects'     && <ProspectsTab />}
    </div>
  )
}
