'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { BriefPanel } from './BriefPanel'
import { CmsPanel } from './CmsPanel'
import { UsersPanel } from './UsersPanel'
import { LocaleSettingsPanel } from './LocaleSettingsPanel'
import { MtcBudgetPanel } from './MtcBudgetPanel'
import { MetaAdAccountPanel } from './MetaAdAccountPanel'
import { PrimaryKeywordsPanel } from '../settings/_components/PrimaryKeywordsPanel'
import { BrandAliasesPanel } from '../settings/_components/BrandAliasesPanel'
import { CompetitorDomainsPanel } from '../settings/_components/CompetitorDomainsPanel'

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
  { id: 'brief',       label: 'Master Brief',     code: 'MB' },
  { id: 'client-info', label: '客户信息 & SEO',   code: 'CI' },
  { id: 'cms',         label: '网站连接',         code: 'CN' },
  { id: 'users',       label: '用户权限',         code: 'US' },
  { id: 'platform',    label: '平台连接',         code: 'PL' },
]

export function SettingsDrawer({ open, onClose, clientId, client, activeTab, onTabChange }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)

  // BUG-FMT-S02: reset scroll to top when modal opens or tab changes
  useEffect(() => {
    if (open && scrollRef.current) {
      scrollRef.current.scrollTop = 0
    }
  }, [open, activeTab])

  // BUG-FMT-S01: lock body scroll while drawer is open
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

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

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
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
            <div className="max-w-3xl space-y-6">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.14em] text-me-ochre">广告账户</p>
                <h3 className="mt-1 font-display text-lg font-semibold tracking-tight text-me-charcoal">Meta 广告账户</h3>
                <p className="mt-1 text-xs text-me-charcoal/55">
                  绑定 Meta（Facebook）广告账户后，每日 cron 自动同步广告花费/CTR/ROAS 到 ME 飞轮。
                </p>
                <div className="mt-3">
                  <MetaAdAccountPanel clientId={clientId} />
                </div>
              </div>

              <div className="border-t border-black/[.06] pt-5">
                <p className="text-[11px] font-black uppercase tracking-[0.14em] text-me-ochre">OAuth 授权</p>
                <h3 className="mt-1 font-display text-lg font-semibold tracking-tight text-me-charcoal">需要授权的平台</h3>
                <p className="mt-1 text-xs text-me-charcoal/55">
                  以下连接器走 OAuth 授权流程，在独立的连接器页面完成（点击进入对应平台）。
                </p>
                <div className="mt-3 space-y-2">
                  {[
                    // GBP OAuth lives in /settings (GbpPanel), NOT /connectors/gbp
                    // — that route does not exist (only gsc/ga4/google-ads/meta-ads do).
                    // Until GBP is migrated to /connectors/gbp, route GBP separately below.
                    { anchor: 'gbp',         label: 'Google Business Profile', icon: '📍', hint: '商家资料 + 评论 + 评分' },
                    { anchor: 'gsc',         label: 'Google Search Console',   icon: '🔍', hint: 'GSC 搜索表现 + Indexing API' },
                    { anchor: 'ga4',         label: 'Google Analytics 4',      icon: '📈', hint: '网站真实流量数据' },
                    { anchor: 'google-ads',  label: 'Google 广告（公开扫描）',  icon: '📢', hint: '透明度中心抓取' },
                    { anchor: 'meta-ads',    label: 'Facebook 主页',           icon: '📊', hint: 'Meta 广告库 + 公开粉丝数' },
                  ].map(p => (
                    <Link
                      key={p.anchor}
                      href={
                        p.anchor === 'gbp'
                          ? `/dashboard/clients/${clientId}/settings`
                          : `/dashboard/clients/${clientId}/connectors/${p.anchor}`
                      }
                      className="group flex items-center gap-3 rounded-lg border border-black/10 bg-white px-4 py-3 text-sm text-me-charcoal transition hover:border-me-ochre/30 hover:bg-me-ochre/5"
                    >
                      <span>{p.icon}</span>
                      <div className="min-w-0 flex-1">
                        <div className="font-bold">{p.label}</div>
                        <div className="text-xs text-me-charcoal/55">{p.hint}</div>
                      </div>
                      <span className="text-me-ochre opacity-0 transition group-hover:opacity-100">→</span>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'client-info' && (
            <div className="max-w-3xl space-y-6">
              {/* §1 Client profile */}
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.14em] text-me-ochre">§ 1 · Client profile</p>
                <div className="mt-2 rounded-xl border border-black/10 bg-white p-5 shadow-sm">
                  <h3 className="font-display text-xl font-semibold tracking-tight text-me-charcoal">{client.name}</h3>
                </div>
                <div className="mt-2 divide-y divide-black/[.06] rounded-xl border border-black/10 bg-white shadow-sm">
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
              </div>

              {/* §2 Locale */}
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.14em] text-me-ochre">§ 2 · 业务地域</p>
                <p className="mt-1 text-xs text-me-charcoal/55">
                  国家 / 州 / 城市 / 服务范围 — 多模块共用（reputation/competitor 诊断、AI Tracker market-context、DataForSEO 路由）。
                </p>
                <div className="mt-2">
                  <LocaleSettingsPanel clientId={clientId} />
                </div>
              </div>

              {/* §3 MTC budget */}
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.14em] text-me-ochre">§ 3 · AI Factory 预算</p>
                <div className="mt-2">
                  <MtcBudgetPanel clientId={clientId} />
                </div>
              </div>

              {/* §4 SEO base metadata (PrimaryKeywords + BrandAliases + CompetitorDomains) */}
              <div className="border-t border-black/[.06] pt-5">
                <p className="text-[11px] font-black uppercase tracking-[0.14em] text-me-ochre">§ 4 · SEO 基础信息</p>
                <p className="mt-1 text-xs text-me-charcoal/55">
                  多支柱共用的客户元数据。消费方：SEO Intelligence · AI Tracker · GEO Composer · Goal 主指标 brand_search_volume。
                </p>
                <div className="mt-3 space-y-4">
                  <div>
                    <div className="mb-2 flex items-center gap-2">
                      <span className="text-base">🎯</span>
                      <h4 className="text-sm font-black text-me-charcoal">主关键词清单</h4>
                    </div>
                    <PrimaryKeywordsPanel clientId={clientId} />
                  </div>

                  <div>
                    <div className="mb-2 flex items-center gap-2">
                      <span className="text-base">🏷️</span>
                      <h4 className="text-sm font-black text-me-charcoal">品牌词别名</h4>
                    </div>
                    <BrandAliasesPanel clientId={clientId} />
                  </div>

                  <div>
                    <div className="mb-2 flex items-center gap-2">
                      <span className="text-base">🥊</span>
                      <h4 className="text-sm font-black text-me-charcoal">竞品域名清单</h4>
                    </div>
                    <CompetitorDomainsPanel clientId={clientId} />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}
