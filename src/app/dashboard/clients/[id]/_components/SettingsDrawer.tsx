'use client'

import { useEffect } from 'react'
import { BriefPanel } from './BriefPanel'
import { CmsPanel } from './CmsPanel'
import { UsersPanel } from './UsersPanel'

export type SettingsTab = 'brief' | 'client-info' | 'cms' | 'users'

interface Client {
  id: string
  name: string
  domain?: string
  created_at: string
}

interface Props {
  open: boolean
  onClose: () => void
  clientId: string
  client: Client
  activeTab: SettingsTab
  onTabChange: (tab: SettingsTab) => void
}

const TABS: { id: SettingsTab; label: string; code: string }[] = [
  { id: 'brief',       label: 'Master Brief', code: 'MB' },
  { id: 'client-info', label: '客户信息', code: 'CI' },
  { id: 'cms',         label: '网站连接', code: 'CN' },
  { id: 'users',       label: '用户权限', code: 'US' },
]

export function SettingsDrawer({ open, onClose, clientId, client, activeTab, onTabChange }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    if (open) document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-slate-950/35 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="fixed inset-y-0 right-0 z-50 flex w-full flex-col overflow-hidden border-l border-slate-200 bg-[#f6f7f2] shadow-2xl lg:w-[min(1120px,calc(100vw-360px))]">
        <div className="flex flex-shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-5 py-5">
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-[0.14em] text-cyan-800">Client settings</p>
            <h2 className="mt-1 truncate text-2xl font-black text-slate-950">设置 — {client.name}</h2>
          </div>
          <button
            onClick={onClose}
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-lg font-black text-slate-400 transition hover:border-slate-300 hover:text-slate-700"
            aria-label="Close settings"
          >
            x
          </button>
        </div>

        <div className="flex flex-shrink-0 gap-2 overflow-x-auto border-b border-slate-200 px-5 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`flex min-h-11 items-center gap-2 whitespace-nowrap rounded-lg border px-3 text-sm font-black transition-colors ${
                activeTab === tab.id
                  ? 'border-cyan-200 bg-cyan-50 text-cyan-900'
                  : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:text-slate-900'
              }`}
            >
              <span className={`flex h-6 w-6 items-center justify-center rounded-md text-[9px] font-black ${
                activeTab === tab.id ? 'bg-cyan-700 text-white' : 'bg-slate-100 text-slate-500'
              }`}>
                {tab.code}
              </span>
              {tab.label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {activeTab === 'brief' && (
            <BriefPanel clientId={clientId} />
          )}

          {activeTab === 'cms' && (
            <CmsPanel clientId={clientId} />
          )}

          {activeTab === 'users' && (
            <UsersPanel clientId={clientId} />
          )}

          {activeTab === 'client-info' && (
            <div className="max-w-3xl space-y-4">
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-[11px] font-black uppercase tracking-[0.14em] text-cyan-800">Client profile</p>
                <h3 className="mt-1 text-xl font-black text-slate-950">{client.name}</h3>
              </div>
              <div className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white shadow-sm">
                {[
                  { label: '客户名称', value: client.name },
                  {
                    label: '网站域名',
                    value: client.domain
                      ? <a href={`https://${client.domain}`} target="_blank" rel="noreferrer" className="font-black text-cyan-800 hover:text-cyan-950">{client.domain}</a>
                      : <span className="font-semibold text-slate-400">未设置</span>,
                  },
                  {
                    label: '创建时间',
                    value: new Date(client.created_at).toLocaleDateString('zh-CN'),
                  },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between gap-6 px-5 py-4 text-sm">
                    <span className="font-black text-slate-400">{label}</span>
                    <span className="text-right font-semibold text-slate-950">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
