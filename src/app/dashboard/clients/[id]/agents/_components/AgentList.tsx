'use client'

/**
 * 客户总表 —— 所有终端客户平铺，按阶段 + 最后联系排序。
 *
 * 顶部可以按代理名字过滤。每张卡片上左侧是阶段色条，
 * 中间是客户信息，右下角标注来源代理，一眼分清。
 */

import { useMemo, useState } from 'react'
import { formatRelative, type AgentCustomerRow, type AgentRow } from '../page'
import {
  TRAVEL_STAGE_LABELS,
  isValidStage,
} from '@/lib/crm/agent-customer-stages'

const STAGE_ORDER: Record<string, number> = {
  new: 0,
  quoting: 1,
  quoted: 2,
  confirmed: 3,
  deposit_paid: 4,
  completed: 5,
  lost: 6,
}

const STAGE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  new: { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-l-blue-500' },
  quoting: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-l-amber-500' },
  quoted: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-l-orange-500' },
  confirmed: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-l-emerald-500' },
  deposit_paid: { bg: 'bg-green-50', text: 'text-green-800', border: 'border-l-green-600' },
  completed: { bg: 'bg-gray-50', text: 'text-gray-500', border: 'border-l-gray-400' },
  lost: { bg: 'bg-red-50', text: 'text-red-600', border: 'border-l-red-400' },
}

function stageLabel(stage: string): string {
  return isValidStage(stage) ? TRAVEL_STAGE_LABELS[stage] : stage
}

function stageColor(stage: string) {
  return STAGE_COLORS[stage] ?? { bg: 'bg-gray-50', text: 'text-gray-500', border: 'border-l-gray-300' }
}

interface FlatCustomer {
  agent: AgentRow
  customer: AgentCustomerRow
}

export function AgentList({
  agents,
  onOpen,
}: {
  agents: AgentRow[]
  onOpen: (agent: AgentRow, customer: AgentCustomerRow) => void
}) {
  const [agentFilter, setAgentFilter] = useState<string>('all')

  const agentOptions = useMemo(() => {
    const unique = agents
      .filter((a) => a.customers.length > 0)
      .map((a) => ({ id: a.contactId, label: a.displayName ?? a.primaryEmail ?? '(未命名)' }))
    unique.sort((a, b) => a.label.localeCompare(b.label))
    return unique
  }, [agents])

  const flat = useMemo(() => {
    const items: FlatCustomer[] = []
    for (const agent of agents) {
      if (agentFilter !== 'all' && agent.contactId !== agentFilter) continue
      for (const customer of agent.customers) {
        items.push({ agent, customer })
      }
    }
    items.sort((a, b) => {
      const sa = STAGE_ORDER[a.customer.stage] ?? 99
      const sb = STAGE_ORDER[b.customer.stage] ?? 99
      if (sa !== sb) return sa - sb
      const ta = a.customer.lastContactAt ?? ''
      const tb = b.customer.lastContactAt ?? ''
      return tb.localeCompare(ta)
    })
    return items
  }, [agents, agentFilter])

  const noCustomerAgents = useMemo(
    () => agents.filter((a) =>
      a.customers.length === 0 && (agentFilter === 'all' || a.contactId === agentFilter),
    ),
    [agents, agentFilter],
  )

  const totalCustomers = flat.length
  const totalAgents = new Set(flat.map((f) => f.agent.contactId)).size

  return (
    <div>
      {/* 过滤栏 */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select
          value={agentFilter}
          onChange={(e) => setAgentFilter(e.target.value)}
          className="rounded-lg border border-me-charcoal/15 bg-white px-3 py-2 text-sm"
        >
          <option value="all">全部代理</option>
          {agentOptions.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
        <span className="text-[13px] text-me-charcoal/45">
          {totalCustomers} 个客户 · {totalAgents} 个代理
        </span>
      </div>

      {/* 客户卡片 */}
      {flat.length === 0 && noCustomerAgents.length === 0 && (
        <p className="rounded-xl border border-dashed border-me-charcoal/15 py-16 text-center text-sm text-me-charcoal/40">
          暂无客户记录
        </p>
      )}

      <div className="space-y-2">
        {flat.map(({ agent, customer }) => {
          const sc = stageColor(customer.stage)
          return (
            <button
              key={customer.id}
              type="button"
              onClick={() => onOpen(agent, customer)}
              className={`block w-full rounded-xl border border-me-charcoal/10 border-l-4 ${sc.border} bg-white p-3.5 text-left transition hover:shadow-md`}
            >
              <div className="flex flex-wrap items-center gap-2">
                {/* 阶段标签 */}
                <span className={`inline-block rounded-md px-2 py-0.5 text-[12px] font-bold ${sc.bg} ${sc.text}`}>
                  {stageLabel(customer.stage)}
                </span>
                {/* 客户名 */}
                <span className="text-[15px] font-black text-me-charcoal">
                  {customer.customerName ?? '(无客户名)'}
                </span>
                {typeof customer.pax === 'number' && (
                  <span className="text-[13px] font-bold text-me-charcoal/55">
                    {customer.pax}人
                  </span>
                )}
              </div>

              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[13px] text-me-charcoal/50">
                {customer.tripType && <span>🗺 {customer.tripType}</span>}
                {customer.travelDates && <span>📅 {customer.travelDates}</span>}
                <span>🕐 {formatRelative(customer.lastContactAt)}</span>
              </div>

              {/* 来源代理 */}
              <div className="mt-1.5 text-[12px] text-me-charcoal/35">
                来自 <span className="font-bold text-me-charcoal/50">{agent.displayName ?? '(未命名)'}</span>
                {agent.primaryEmail && (
                  <span className="ml-1">({agent.primaryEmail})</span>
                )}
              </div>
            </button>
          )
        })}
      </div>

      {/* 没有客户的代理——折叠到底部 */}
      {noCustomerAgents.length > 0 && (
        <details className="mt-6">
          <summary className="cursor-pointer text-[13px] font-bold text-me-charcoal/40">
            还有 {noCustomerAgents.length} 个代理暂无客户记录
          </summary>
          <div className="mt-2 space-y-1.5">
            {noCustomerAgents.map((a) => (
              <div key={a.contactId} className="rounded-lg border border-dashed border-me-charcoal/10 px-3 py-2 text-[13px] text-me-charcoal/40">
                {a.displayName ?? '(未命名)'}
                {a.primaryEmail && <span className="ml-2 text-me-charcoal/25">{a.primaryEmail}</span>}
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}
