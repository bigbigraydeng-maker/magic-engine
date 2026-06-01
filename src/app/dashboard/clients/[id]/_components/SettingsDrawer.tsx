'use client'

import { useEffect } from 'react'
import { BriefPanel } from './BriefPanel'
import { CmsPanel } from './CmsPanel'
import Link from 'next/link'
import { UsersPanel } from './UsersPanel'
import { LocaleConfirmBanner } from './LocaleConfirmBanner'
import { MtcBudgetPanel } from './MtcBudgetPanel'

export type SettingsTab = 'brief' | 'client-info' | 'cms' | 'users' | 'platform'

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
  { id: 'platform',     label: '平台连接', code: 'PL' },
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
        className="fixed inset-0 z-40 bg-me-charcoal/35 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="fixed inset-y-0 right-0 z-50 flex w-full flex-col overflow-hidden border-l border-black/10 bg-me-ivory shadow-2xl lg:w-[min(1120px,calc(100vw-360px))]">
        <div className="flex flex-shrink-0 items-start justify-between gap-4 border-b border-black/10 px-5 py-5">
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-[0.14em] text-me-ochre">Client settings</p>
            <h2 className="mt-1 truncate font-display text-2xl font-bold tracking-tight text-me-charcoal">设置 — {client.name}</h2>
          </div>
          <button
            onClick={onClose}
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-black/10 bg-white text-lg font-black text-me-charcoal/45 transition hover:border-black/20 hover:text-me-charcoal/75"
            aria-label="Close settings"
          >
            x
          </button>
        </div>

        <div className="flex flex-shrink-0 gap-2 overflow-x-auto border-b border-black/10 px-5 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {TABS.map(tab => (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`flex min-h-11 items-center gap-2 whitespace-nowrap rounded-lg border px-3 text-sm font-black transition-colors ${
                activeTab === tab.id
                  ? 'border-me-ochre/30 bg-me-ochre/10 text-me-charcoal'
                  : 'border-black/10 bg-white text-me-charcoal/55 hover:border-black/20 hover:text-me-charcoal'
              }`}
            >
              <span className={`flex h-6 w-6 items-center justify-center rounded-md text-[9px] font-black ${
                activeTab === tab.id ? 'bg-me-ochre text-white' : 'bg-me-stone text-me-charcoal/55'
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

          {activeTab === 'platform' && (
            <div className="max-w-3xl">
              <Link
                href={'/dashboard/clients/' + clientId + '/settings'}
                className="inline-flex items-center gap-2 rounded-lg border border-me-ochre/30 bg-me-ochre/10 px-3 py-2 text-sm font-bold text-me-ochre transition hover:bg-me-ochre/15"
              >
                🔗 前往平台连接设置页面
              </Link>
              <p className="mt-2 text-xs text-me-charcoal/45">
                完整的平台授权管理界面（GBP / GSC 等）在独立设置页面完成。
              </p>
            </div>
          )}

          {activeTab === 'client-info' && (
            <div className="max-w-3xl space-y-4">
              <div className="rounded-xl border border-black/10 bg-white p-5 shadow-sm">
                <p className="text-[11px] font-black uppercase tracking-[0.14em] text-me-ochre">Client profile</p>
                <h3 className="mt-1 font-display text-xl font-semibold tracking-tight text-me-charcoal">{client.name}</h3>
              </div>
              <div className="divide-y divide-black/[.06] rounded-xl border border-black/10 bg-white shadow-sm">
                {[
                  { label: '客户名称', value: client.name },
                  {
                    label: '网站域名',
                    value: client.domain
                      ? <a href={`https://${client.domain}`} target="_blank" rel="noreferrer" className="font-black text-me-ochre hover:text-me-charcoal">{client.domain}</a>
                      : <span className="font-semibold text-me-charcoal/45">未设置</span>,
                  },
                  {
                    label: '创建时间',
                    value: new Date(client.created_at).toLocaleDateString('zh-CN'),
                  },
                ].map(({ label, value }) => (
                  <div key={label} className="flex items-center justify-between gap-6 px-5 py-4 text-sm">
                    <span className="font-black text-me-charcoal/45">{label}</span>
                    <span className="text-right font-semibold text-me-charcoal">{value}</span>
                  </div>
                ))}
              </div>

              {/* Locale settings */}
              <div className="rounded-xl border border-black/10 bg-white p-5 shadow-sm">
                <p className="mb-3 text-[11px] font-black uppercase tracking-[0.14em] text-me-ochre">业务地域设置</p>
                <LocaleConfirmBanner clientId={clientId} />
              </div>

              {/* AI Factory monthly MTC budget */}
              <MtcBudgetPanel clientId={clientId} />
            </div>
          )}
        </div>
      </div>
    </>
  )
}
