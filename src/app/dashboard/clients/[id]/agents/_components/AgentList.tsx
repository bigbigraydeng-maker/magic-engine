'use client'

/**
 * 按 Agent 看 —— 谁送来的客户。
 *
 * 一个 Agent 一张卡，卡里是他送来的每个终端客户一行。点一行开抽屉。
 */

import { formatRelative, type AgentCustomerRow, type AgentRow } from './AgentsClient'

export function AgentList({
  agents,
  onOpen,
}: {
  agents: AgentRow[]
  onOpen: (agent: AgentRow, customer: AgentCustomerRow) => void
}) {
  return (
    <div className="space-y-4">
      {agents.map((agent) => (
        <section
          key={agent.contactId}
          className="rounded-2xl border border-me-charcoal/10 bg-white p-4"
        >
          <div className="mb-3 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
            <span className="text-[16px] font-black text-me-charcoal">
              {agent.displayName ?? '(未命名)'}
            </span>
            {agent.primaryEmail && (
              <span className="text-[13px] text-me-charcoal/45">{agent.primaryEmail}</span>
            )}
            <span className="text-[12px] text-me-charcoal/35">
              最后联系：{formatRelative(agent.lastContactAt)}
            </span>
          </div>

          {agent.customers.length === 0 ? (
            <p className="rounded-xl border border-dashed border-me-charcoal/10 py-4 text-center text-[13px] text-me-charcoal/30">
              还没有客户 — 等下一次邮件同步（每小时一次），AI 会把这位同行邮件里谈到的客户自动落进来
            </p>
          ) : (
            <div className="space-y-2">
              {agent.customers.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onOpen(agent, c)}
                  className="block w-full rounded-xl border border-me-charcoal/10 bg-me-ivory/40 p-3 text-left transition hover:border-me-ochre/50 hover:bg-me-ivory"
                >
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-[15px] font-black text-me-charcoal">
                      {c.customerName ?? '(无客户名)'}
                    </span>
                    {typeof c.pax === 'number' && (
                      <span className="text-[13px] font-bold text-me-charcoal/55">({c.pax}人)</span>
                    )}
                    <span className="text-[13px] text-me-charcoal/45">— {c.tripType ?? '?'}</span>
                    <span className="text-[13px] text-me-charcoal/45">— {c.travelDates ?? '?'}</span>
                  </div>
                  <p className="mt-1 text-[12px] text-me-charcoal/45">
                    阶段：{c.stage} │ 最后：{formatRelative(c.lastContactAt)}
                    {c.lastContactSummary ? ` · ${c.lastContactSummary.slice(0, 40)}` : ''}
                  </p>
                </button>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  )
}
