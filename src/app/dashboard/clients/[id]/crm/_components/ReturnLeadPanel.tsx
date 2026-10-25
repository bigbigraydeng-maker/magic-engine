'use client'

/**
 * 抽屉里的「不是有效咨询」退回按钮 / 「这是真客人」拉回按钮。
 * 设计稿：docs/specs/2026-10-21-crm-valid-leads-only-design-v0.md §5.3.2
 *
 * 没有新接口：直接用现有的改阶段接口，把阶段改成「非咨询」（退回）或「新线索」（拉回），
 * 原因按固定格式写进改阶段事件的 note —— 每一次点击都是一条带标签的样本，系统之后从这里学
 * （只读对账 → 改判据走评审，不让系统自己改自己）。
 *
 * 人点的改阶段，操作者是人的邮箱 → 机器此后永远不再碰这个人（见 eligibility 第 9 条）。
 * 客户没有「非咨询」阶段 → 整块不渲染（别给一个点了会报错的按钮）。
 */

import { useState } from 'react'
import { NOT_ENQUIRY_STAGE_KEY } from '@/lib/crm/enquiry-screen/types'
import { RETURN_REASONS, buildRealCustomerNote, buildReturnNote, type ReturnReasonCode } from '@/lib/crm/enquiry-screen/feedback'

interface StageLike {
  stageKey: string
}

export function ReturnLeadPanel({
  clientId,
  contactId,
  currentStage,
  stages,
  onDone,
}: {
  clientId: string
  contactId: string
  currentStage: string | null
  stages: StageLike[]
  onDone: (msg: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<ReturnReasonCode | ''>('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!stages.some((s) => s.stageKey === NOT_ENQUIRY_STAGE_KEY)) return null
  const returned = currentStage === NOT_ENQUIRY_STAGE_KEY

  const submit = async (toStage: string, note: string, doneMsg: string): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/crm/contacts/${contactId}/stage`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        // expectedFromStage：两个人同时点同一个客人时，后点的会被 409 拦下，不会盲写覆盖。
        body: JSON.stringify({ toStage, note, expectedFromStage: currentStage }),
      })
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string }
        setError(json.error ?? '没有保存成功，请稍后再试')
        return
      }
      setOpen(false)
      setReason('')
      setText('')
      onDone(doneMsg)
    } catch {
      setError('网络出错，没有保存成功')
    } finally {
      setBusy(false)
    }
  }

  if (returned) {
    return (
      <div className="mt-2" data-testid="return-lead-panel">
        <button
          type="button"
          disabled={busy}
          onClick={() => void submit('new', buildRealCustomerNote(), '✓ 已拉回「今天要联系」')}
          className="rounded-lg border border-me-charcoal/25 bg-white px-3 py-1.5 text-xs font-bold text-me-charcoal/80 disabled:opacity-40"
        >
          这是真客人，拉回来
        </button>
        {error && <p className="mt-1 text-xs font-semibold text-red-700" role="alert">{error}</p>}
      </div>
    )
  }

  return (
    <div className="mt-2" data-testid="return-lead-panel">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-bold text-red-700"
        >
          不是有效咨询（退回）
        </button>
      ) : (
        <div className="rounded-lg border border-me-charcoal/15 bg-white p-2.5">
          <p className="mb-1.5 text-xs font-bold text-me-charcoal/70">为什么不是有效咨询？（选一个，系统会从这里学）</p>
          <div className="flex flex-wrap gap-1.5">
            {RETURN_REASONS.map((r) => (
              <button
                key={r.code}
                type="button"
                onClick={() => setReason(r.code)}
                aria-pressed={reason === r.code}
                className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${reason === r.code ? 'border-red-500 bg-red-50 text-red-700' : 'border-me-stone text-me-charcoal/70'}`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={200}
            placeholder="补一句话（可不填）"
            aria-label="补充说明"
            className="mt-2 w-full rounded-lg border border-me-stone px-2.5 py-1.5 text-xs"
          />
          {error && <p className="mt-1 text-xs font-semibold text-red-700" role="alert">{error}</p>}
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={busy || reason === ''}
              onClick={() => reason !== '' && void submit(NOT_ENQUIRY_STAGE_KEY, buildReturnNote(reason, text), '✓ 已退回，移到「先放着」')}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40"
            >
              确认退回
            </button>
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-3 py-1.5 text-xs font-bold text-me-charcoal/60">
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
