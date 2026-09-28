'use client'

/**
 * 按阶段看 —— 都卡在哪一步。
 *
 * 7 列对应 7 个阶段。手机上堆成竖排（销售在外面用这一页，横滑七列没法用）。
 */

import { formatRelative, type AgentCustomerRow, type AgentRow } from './AgentsClient'
import {
  TRAVEL_AGENT_CUSTOMER_STAGES,
  TRAVEL_STAGE_LABELS,
  isValidStage,
} from '@/lib/crm/agent-customer-stages'

/** 7 个英文阶段映射成中文；未知阶段原样返回，不假装认识它。 */
export function stageLabelOf(stage: string): string {
  return isValidStage(stage) ? TRAVEL_STAGE_LABELS[stage] : stage
}

export function StageBoard({
  agents,
  onOpen,
}: {
  agents: AgentRow[]
  onOpen: (agent: AgentRow, customer: AgentCustomerRow) => void
}) {
  // 先把 (agent, customer) 摊平，再按阶段分桶 —— 卡片上要同时显示客户和 Agent 名。
  const flat = agents.flatMap((a) => a.customers.map((c) => ({ agent: a, customer: c })))

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-7">
      {TRAVEL_AGENT_CUSTOMER_STAGES.map((stage) => {
        const list = flat.filter((x) => x.customer.stage === stage)
        return (
          <div key={stage} className="rounded-2xl border border-me-charcoal/10 bg-me-ivory/40 p-2.5">
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <span className="text-[14px] font-black text-me-charcoal">{stageLabelOf(stage)}</span>
              <span className="text-[14px] font-black tabular-nums text-me-charcoal/50">{list.length}</span>
            </div>
            <div className="space-y-2">
              {list.map(({ agent, customer }) => (
                <button
                  key={customer.id}
                  type="button"
                  onClick={() => onOpen(agent, customer)}
                  className="block w-full rounded-xl border border-me-charcoal/10 bg-white p-2.5 text-left transition hover:border-me-ochre/50"
                >
                  <p className="truncate text-[14px] font-black text-me-charcoal">
                    {customer.customerName ?? '(无客户名)'}
                  </p>
                  <p className="mt-0.5 truncate text-[12px] text-me-charcoal/50">
                    {agent.displayName ?? '(未命名)'}
                  </p>
                  <p className="mt-0.5 truncate text-[12px] text-me-charcoal/40">
                    {customer.tripType ?? '?'}
                  </p>
                  <p className="mt-1 text-[11px] text-me-charcoal/35">
                    {formatRelative(customer.lastContactAt)}
                  </p>
                </button>
              ))}
              {list.length === 0 && (
                <p className="py-3 text-center text-[12px] text-me-charcoal/25">空</p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
