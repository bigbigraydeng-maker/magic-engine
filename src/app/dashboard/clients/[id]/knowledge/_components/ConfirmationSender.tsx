'use client'

/**
 * 「ME 已批、等客户签字」的敏感条目 + 发一次性确认链接。
 *
 * 🔴 没有登记过确认人的客户，这里**明说**「还没登记确认人」并且发不出去，
 * 不做成一个点了没反应的按钮。design doc §9.4：确认人只能由全局管理员登记；
 * 这个页面不提供登记入口（那是另一条已上线的接口），但必须让 FDE 一眼看出
 * 卡在哪一步。
 */

import { useState } from 'react'
import type { ConfirmationRequestRow, PendingConfirmationFact } from '../types'

const STATUS_LABEL: Record<string, string> = {
  pending: '等客户点',
  confirmed: '客户已确认',
  rejected: '客户说要改',
  expired: '已过期',
  superseded: '已被新的取代',
}

function formatDay(iso: string | null): string {
  if (!iso) return '—'
  const parsed = Date.parse(iso)
  return Number.isNaN(parsed) ? '—' : new Date(parsed).toLocaleDateString('zh-CN')
}

export interface ConfirmationSenderProps {
  facts: PendingConfirmationFact[]
  confirmers: string[]
  requests: ConfirmationRequestRow[]
  onSend: (factIds: string[], confirmerEmail: string) => Promise<void>
  sending: boolean
}

export function ConfirmationSender({ facts, confirmers, requests, onSend, sending }: ConfirmationSenderProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmer, setConfirmer] = useState(confirmers[0] ?? '')

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const canSend = selected.size > 0 && Boolean(confirmer) && !sending

  return (
    <section className="rounded-xl border border-black/10 bg-white p-4">
      <h2 className="text-base font-black text-me-charcoal">等客户签字</h2>
      <p className="mt-1 text-xs leading-relaxed text-me-charcoal/45">
        价格 / 时效 / 承诺 / 政策这四类，ME 批完还不算数，要客户本人点头 AI 才会对顾客说。
      </p>

      {confirmers.length === 0 && (
        <p className="mt-3 rounded-lg border border-[#C2453A]/30 bg-[#C2453A]/8 p-3 text-sm font-semibold text-[#C2453A]">
          这个客户还没有登记过确认人，现在发不出确认链接。请先让全局管理员登记客户那边的负责人邮箱。
        </p>
      )}

      {facts.length === 0 ? (
        <p className="mt-3 text-sm text-me-charcoal/40">现在没有等客户签字的条目。</p>
      ) : (
        <>
          <div className="mt-3 space-y-2">
            {facts.map((fact) => (
              <label key={fact.id} className="flex cursor-pointer items-start gap-2 rounded-lg border border-me-stone p-2.5">
                <input
                  type="checkbox"
                  checked={selected.has(fact.id)}
                  onChange={() => toggle(fact.id)}
                  className="mt-1"
                />
                <span className="text-sm leading-relaxed text-me-charcoal">
                  {fact.statement}
                  <span className="mt-0.5 block text-[11px] text-me-charcoal/40">
                    有效期到 {formatDay(fact.validUntil)} · 批准人 {fact.approvedByEmail ?? '—'}
                  </span>
                </span>
              </label>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select
              value={confirmer}
              onChange={(e) => setConfirmer(e.target.value)}
              disabled={confirmers.length === 0}
              className="rounded-lg border border-me-stone px-2 py-1.5 text-sm"
            >
              {confirmers.length === 0 && <option value="">（没有已登记的确认人）</option>}
              {confirmers.map((email) => (
                <option key={email} value={email}>
                  {email}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!canSend}
              onClick={() => void onSend(Array.from(selected), confirmer)}
              className="rounded-full bg-me-charcoal px-4 py-2 text-xs font-black text-white disabled:opacity-40"
            >
              {sending ? '发送中…' : `发确认链接（${selected.size} 条）`}
            </button>
          </div>
        </>
      )}

      {requests.length > 0 && (
        <div className="mt-5 border-t border-black/5 pt-3">
          <h3 className="text-xs font-black text-me-charcoal/60">发过的确认链接</h3>
          <ul className="mt-2 space-y-1">
            {requests.map((req) => (
              <li key={req.id} className="text-[11px] text-me-charcoal/45">
                {formatDay(req.created_at)} 发给 {req.confirmer_email} ·{' '}
                <span className="font-semibold">{STATUS_LABEL[req.status] ?? req.status}</span> · 有效期到{' '}
                {formatDay(req.expires_at)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
