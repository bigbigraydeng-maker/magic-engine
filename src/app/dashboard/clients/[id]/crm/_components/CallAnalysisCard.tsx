'use client'

/**
 * 一通电话的 AI 分析卡片：摘要 + 每条需求带客人原话 + 人工复核（确认 / 驳回）。
 *
 * 分析是 AI 提炼的，复核前不当事实用——所以永远写明「AI 整理，待复核」，
 * 原话摆在每条需求下面，让人自己对。复核只改这份分析的状态，不改客人资料。
 */

import { useState } from 'react'

export interface CallAnalysisData {
  id: string
  summary: string
  reviewStatus: 'pending_review' | 'confirmed' | 'rejected'
  facts: { key: string; value: string; quote: string }[]
}

const FACT_LABEL: Record<string, string> = {
  destination_or_tour: '想去的团',
  travel_window: '出行时间',
  party_size: '人数',
  budget: '预算',
  concern: '顾虑',
  competitor: '提到的竞品',
  decision_maker: '谁拍板',
  next_step: '约定的下一步',
  callback_time: '回电时间',
  do_not_contact: '要求别再联系',
}

const STATUS_TEXT: Record<CallAnalysisData['reviewStatus'], string> = {
  pending_review: 'AI 整理，待复核',
  confirmed: '已确认',
  rejected: '已驳回',
}

export function CallAnalysisCard({ clientId, analysis }: { clientId: string; analysis: CallAnalysisData }) {
  const [status, setStatus] = useState(analysis.reviewStatus)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function review(next: CallAnalysisData['reviewStatus']) {
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/crm/call-analyses/${analysis.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ review: next }),
      })
      if (!res.ok) throw new Error('操作没成功，请重试')
      setStatus(next)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '操作没成功，请重试')
    } finally {
      setBusy(false)
    }
  }

  const rejected = status === 'rejected'
  return (
    <div className="mt-1.5 rounded-lg border border-me-ochre/30 bg-me-ochre/[0.06] px-2 py-1.5">
      <p className="text-[10px] font-bold text-me-ochre">🤖 通话分析 · {STATUS_TEXT[status]}</p>
      {!rejected && (
        <>
          <p className="mt-0.5 text-[12px] leading-relaxed text-me-charcoal/85">{analysis.summary}</p>
          <ul className="mt-1 space-y-1">
            {analysis.facts.map((f, i) => (
              <li key={`${f.key}-${i}`} className="text-[12px] leading-relaxed text-me-charcoal/85">
                <span className="font-bold">{FACT_LABEL[f.key] ?? f.key}：</span>
                {f.value}
                <span className="block text-[11px] text-me-charcoal/50">客人原话：“{f.quote}”</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="mt-1.5 flex items-center gap-2">
        {status === 'pending_review' ? (
          <>
            <button type="button" disabled={busy} onClick={() => review('confirmed')} className="rounded-full bg-me-charcoal px-2.5 py-0.5 text-[11px] font-bold text-white disabled:opacity-50">
              确认无误
            </button>
            <button type="button" disabled={busy} onClick={() => review('rejected')} className="rounded-full border border-me-charcoal/20 px-2.5 py-0.5 text-[11px] font-bold text-me-charcoal/70 disabled:opacity-50">
              驳回
            </button>
          </>
        ) : (
          <button type="button" disabled={busy} onClick={() => review('pending_review')} className="text-[11px] font-bold text-me-charcoal/50 underline disabled:opacity-50">
            撤回，改回待复核
          </button>
        )}
        {err && <span className="text-[11px] text-[#C2453A]">{err}</span>}
      </div>
    </div>
  )
}
