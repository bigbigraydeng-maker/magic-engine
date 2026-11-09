'use client'

/**
 * 客户抽屉 —— 改阶段 / 记备注 / 直接回信。
 *
 * 回信回的是 **Agent 那条邮件线程**（不是终端客户）：终端客户没有直接发过邮件，
 * 我们跟 Agent 谈。所以 conversationId 为空时不给回信入口，并说清为什么。
 */

import { useEffect, useState } from 'react'
import { formatRelative, type AgentCustomerRow, type AgentRow } from './AgentsClient'
import { stageLabelOf } from './StageBoard'
import { TRAVEL_AGENT_CUSTOMER_STAGES } from '@/lib/crm/agent-customer-stages'

export function AgentCustomerDrawer({
  open,
  clientId,
  agent,
  customer,
  onClose,
  onUpdated,
}: {
  open: boolean
  clientId: string
  agent: AgentRow | null
  customer: AgentCustomerRow | null
  onClose: () => void
  onUpdated: () => void
}) {
  const [stage, setStage] = useState(customer?.stage ?? 'new')
  const [notes, setNotes] = useState(customer?.notes ?? '')
  const [body, setBody] = useState('')
  const [savingStage, setSavingStage] = useState(false)
  const [savingNotes, setSavingNotes] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  // 换人时把本地状态对齐到新的那一行 —— 否则会拿着上一个人的备注去保存。
  useEffect(() => {
    setStage(customer?.stage ?? 'new')
    setNotes(customer?.notes ?? '')
    setBody('')
    setError(null)
    setOk(null)
  }, [customer?.id, customer?.stage, customer?.notes])

  if (!open || customer === null) return null

  const flash = (msg: string) => {
    setOk(msg)
    window.setTimeout(() => setOk(null), 2000)
  }

  const patch = async (payload: Record<string, unknown>, done: string) => {
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/agents/customers?id=${customer.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        setError(j.error ?? '保存失败')
        return
      }
      flash(done)
      onUpdated()
    } catch {
      setError('网络不通，没保存')
    }
  }

  const saveStage = async (next: string) => {
    setStage(next)
    setSavingStage(true)
    await patch({ stage: next }, '✔ 阶段已保存')
    setSavingStage(false)
  }

  const saveNotes = async () => {
    setSavingNotes(true)
    await patch({ notes }, '✔ 备注已保存')
    setSavingNotes(false)
  }

  const send = async () => {
    if (!customer.conversationId || body.trim() === '') return
    setSending(true)
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/agents/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: customer.conversationId,
          body,
          agentCustomerId: customer.id,
        }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        setError(j.error ?? '发送失败')
        return
      }
      setBody('')
      flash('✔ 已发出')
      onUpdated()
    } catch {
      setError('网络不通，没发出去')
    } finally {
      setSending(false)
    }
  }

  const field = 'text-[13px] text-me-charcoal/70'
  const label = 'text-[12px] font-bold text-me-charcoal/40'

  return (
    <div className="fixed inset-y-0 right-0 z-40 w-full overflow-y-auto bg-white shadow-xl md:w-[520px]">
      <div className="sticky top-0 flex items-start justify-between gap-3 border-b border-me-charcoal/10 bg-white px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-[16px] font-black text-me-charcoal">
            {agent?.displayName ?? '(未命名)'}
          </p>
          {agent?.primaryEmail && (
            <p className="truncate text-[12px] text-me-charcoal/45">{agent.primaryEmail}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          className="shrink-0 rounded-md px-2 py-1 text-[18px] leading-none text-me-charcoal/40 hover:bg-me-ivory hover:text-me-charcoal"
        >
          ×
        </button>
      </div>

      <div className="space-y-4 px-4 py-4">
        <section className="rounded-xl border border-me-charcoal/10 bg-me-ivory/40 p-3">
          <p className="text-[16px] font-black text-me-charcoal">
            {customer.customerName ?? '(无客户名)'}
          </p>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
            <div><dt className={label}>人数</dt><dd className={field}>{customer.pax ?? '—'}</dd></div>
            <div><dt className={label}>团型</dt><dd className={field}>{customer.tripType ?? '—'}</dd></div>
            <div><dt className={label}>出发日期</dt><dd className={field}>{customer.travelDates ?? '—'}</dd></div>
            <div><dt className={label}>最后联系</dt><dd className={field}>{formatRelative(customer.lastContactAt)}</dd></div>
            <div className="col-span-2">
              <dt className={label}>特殊需求</dt>
              <dd className={field}>{customer.specificNeeds ?? '—'}</dd>
            </div>
          </dl>
          {customer.lastContactSummary && (
            <p className="mt-2 border-t border-me-charcoal/8 pt-2 text-[12px] leading-snug text-me-charcoal/50">
              {customer.lastContactSummary}
            </p>
          )}
        </section>

        <section>
          <label className={label} htmlFor="agent-customer-stage">阶段</label>
          <select
            id="agent-customer-stage"
            value={stage}
            disabled={savingStage}
            onChange={(e) => void saveStage(e.target.value)}
            className="mt-1 w-full rounded-lg border border-me-charcoal/15 bg-white px-3 py-2 text-sm disabled:opacity-50"
          >
            {TRAVEL_AGENT_CUSTOMER_STAGES.map((s) => (
              <option key={s} value={s}>{stageLabelOf(s)}</option>
            ))}
          </select>
        </section>

        <section>
          <label className={label} htmlFor="agent-customer-notes">备注</label>
          <textarea
            id="agent-customer-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="mt-1 w-full rounded-lg border border-me-charcoal/15 px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={savingNotes}
            onClick={() => void saveNotes()}
            className="mt-1.5 rounded-lg bg-me-charcoal px-3 py-1.5 text-[13px] font-bold text-white disabled:opacity-40"
          >
            {savingNotes ? '存着…' : '保存备注'}
          </button>
        </section>

        <section>
          <label className={label} htmlFor="agent-customer-reply">回信给 Agent</label>
          <textarea
            id="agent-customer-reply"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            placeholder="回复这个 Agent…"
            className="mt-1 w-full rounded-lg border border-me-charcoal/15 px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={sending || body.trim() === '' || !customer.conversationId}
            title={customer.conversationId ? undefined : '这条客户还没关联邮件线程，暂时无法回信'}
            onClick={() => void send()}
            className="mt-1.5 rounded-lg bg-me-charcoal px-3 py-1.5 text-[13px] font-bold text-white disabled:bg-me-charcoal/30"
          >
            {sending ? '发着…' : '发送'}
          </button>
          {!customer.conversationId && (
            <p className="mt-1 text-[12px] text-me-charcoal/40">
              这条客户还没关联邮件线程，暂时无法回信
            </p>
          )}
        </section>

        {error && <p className="text-[12px] font-semibold text-[#C2453A]">⚠ {error}</p>}
        {ok && <p className="text-[12px] font-bold text-emerald-700">{ok}</p>}
      </div>
    </div>
  )
}
