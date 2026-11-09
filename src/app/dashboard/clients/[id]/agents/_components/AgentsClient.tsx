'use client'

/**
 * 同行渠道 · 旅行社客户 —— 客户端交互部分。
 *
 * 服务端鉴权 + 行业闸在 `../page.tsx`（仿 `listings/page.tsx` 的拆法：服务端只做
 * 鉴权和外壳，取数和交互留在这里）。这个组件原来就是整页 `page.tsx`，2026-09-28
 * 从 `'use client'` 页面直接拆出来 —— 原页面没有任何服务端闸，NAL 敲网址能直接
 * 进来看到 CTS 专属的同行数据（见台账 client-custom-features-leak-to-other-clients）。
 *
 * 旅行社（Agent，kind='trade' 的联系人）代终端客户发邮件订团 —— 这一页把
 * 「哪个 Agent 送来了哪些客户、各自走到哪一步」摊开。数据由邮件同步后的
 * AI 提取自动落进 agent_customers 表，这里只做视图层。
 *
 * 两个视角：按 Agent 看（谁送来的）、按阶段看（都卡在哪一步）。
 * 点一个客户从右侧滑出抽屉，改阶段 / 记备注 / 直接回信。
 */

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { AgentList } from './AgentList'
import { StageBoard } from './StageBoard'
import { AgentCustomerDrawer } from './AgentCustomerDrawer'

export interface AgentCustomerRow {
  id: string
  customerName: string | null
  pax: number | null
  tripType: string | null
  travelDates: string | null
  specificNeeds: string | null
  stage: string
  lastContactAt: string | null
  lastContactSummary: string | null
  conversationId: string | null
  notes: string | null
  updatedAt: string
}

export interface AgentRow {
  contactId: string
  displayName: string | null
  primaryEmail: string | null
  lastContactAt: string | null
  customerCount: number
  customers: AgentCustomerRow[]
}

/**
 * 相对时间。自己写，不引 date-fns —— 这一页只需要四种说法。
 * 拿不到时间就返回 '—'，不假装。
 */
export function formatRelative(iso: string | null): string {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return '—'
  const diff = Date.now() - t
  if (diff < 60_000) return '刚刚'
  const hours = Math.floor(diff / 3_600_000)
  if (hours < 1) return `${Math.floor(diff / 60_000)} 分钟前`
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  return new Date(iso).toISOString().slice(0, 10)
}

interface DrawerState {
  open: boolean
  customer: AgentCustomerRow | null
  agent: AgentRow | null
}

export function AgentsClient() {
  const params = useParams()
  const clientId = params.id as string

  const [agents, setAgents] = useState<AgentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'agent' | 'stage'>('agent')
  const [drawer, setDrawer] = useState<DrawerState>({ open: false, customer: null, agent: null })

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/agents`)
      const json = (await res.json()) as { agents?: AgentRow[]; error?: string }
      if (!res.ok) {
        setError(json.error ?? '加载失败')
        return
      }
      setAgents(json.agents ?? [])
    } catch {
      setError('加载失败，检查网络后再试。')
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => { void load() }, [load])

  const open = (agent: AgentRow, customer: AgentCustomerRow) =>
    setDrawer({ open: true, agent, customer })

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-black text-me-charcoal">🤝 同行渠道 · 旅行社客户</h1>
        {/* TODO: 从 mailbox-sync 心跳表读真实同步时间，现在先写死。 */}
        <span className="text-xs text-me-charcoal/40">最后同步：每小时一次</span>
      </header>

      <div className="mb-4 flex overflow-hidden rounded-xl border border-me-charcoal/15 bg-white">
        {([
          { k: 'agent' as const, label: '按 Agent 看' },
          { k: 'stage' as const, label: '按阶段看' },
        ]).map((o) => (
          <button
            key={o.k}
            type="button"
            onClick={() => setTab(o.k)}
            className={`px-4 py-2 text-sm font-bold transition ${
              tab === o.k ? 'bg-me-charcoal text-white' : 'text-me-charcoal/55 hover:bg-me-ivory'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      {loading && <p className="py-16 text-center text-sm text-me-charcoal/40">加载中...</p>}

      {error && (
        <div className="rounded-xl border border-[#C2453A]/30 bg-[#C2453A]/8 p-4">
          <p className="text-sm font-semibold text-[#C2453A]">{error}</p>
          <button onClick={() => void load()} className="mt-2 text-sm font-black underline">重试</button>
        </div>
      )}

      {!loading && !error && agents.length === 0 && (
        <p className="rounded-xl border border-dashed border-me-charcoal/15 py-16 text-center text-sm text-me-charcoal/40">
          还没有同行联系人 —— 先在设置页 → 客户资料 → 同行域名（trade_domains）里添加同行公司的邮箱域名，下一次邮件同步后这里会出现 Agent 卡
        </p>
      )}

      {!loading && !error && agents.length > 0 && (
        tab === 'agent'
          ? <AgentList agents={agents} onOpen={open} />
          : <StageBoard agents={agents} onOpen={open} />
      )}

      <AgentCustomerDrawer
        open={drawer.open}
        clientId={clientId}
        agent={drawer.agent}
        customer={drawer.customer}
        onClose={() => setDrawer((d) => ({ ...d, open: false }))}
        onUpdated={() => void load()}
      />
    </div>
  )
}
