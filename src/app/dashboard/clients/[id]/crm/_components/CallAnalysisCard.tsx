'use client'

/**
 * CRM 时间线中的通话分析：默认突出出行意向、跟进安排和邮箱；
 * 完整通话记录按需读取，AI 提炼内容仍须人工复核。
 */

import { useState } from 'react'
import { isCoreCrmCallFact } from '@/lib/telephony/transcribe/analysis-schema'

type CallFact = {
  key: string
  value: string
  quote: string
  speaker?: 'customer' | 'employee' | 'unclear'
}

export interface CallAnalysisData {
  id: string
  summary: string
  reviewStatus: 'pending_review' | 'confirmed' | 'rejected'
  facts: CallFact[]
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
  const [transcriptOpen, setTranscriptOpen] = useState(false)
  const [transcript, setTranscript] = useState<string | null>(null)
  const [transcriptLoading, setTranscriptLoading] = useState(false)
  const [transcriptError, setTranscriptError] = useState<string | null>(null)

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

  async function toggleTranscript() {
    if (transcriptOpen) {
      setTranscriptOpen(false)
      return
    }
    setTranscriptOpen(true)
    if (transcript !== null || transcriptLoading) return

    setTranscriptLoading(true)
    setTranscriptError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/crm/call-analyses/${analysis.id}`, {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      })
      if (!res.ok) throw new Error('暂时无法读取通话记录，请稍后重试')
      const body = (await res.json()) as { transcript?: unknown }
      if (typeof body.transcript !== 'string') throw new Error('通话记录暂不可用')
      setTranscript(body.transcript)
    } catch (e) {
      setTranscriptError(e instanceof Error ? e.message : '暂时无法读取通话记录，请稍后重试')
    } finally {
      setTranscriptLoading(false)
    }
  }

  const rejected = status === 'rejected'
  const coreFacts = rejected ? [] : analysis.facts.filter(isCoreCrmCallFact)
  const fact = (key: string) => {
    const values = [...new Set(coreFacts.filter((item) => item.key === key).map((item) => item.value))]
    if (values.length > 1) return '识别到多个候选，请展开通话记录核对'
    return values[0]
  }
  const followUp = () => {
    const valuesByKey = ['next_step', 'callback_time'].map((key) =>
      [...new Set(coreFacts.filter((item) => item.key === key).map((item) => item.value))],
    )
    if (valuesByKey.some((values) => values.length > 1)) return '识别到多个候选，请展开通话记录核对'
    const values = [...new Set(valuesByKey.flatMap((items) => items))]
    return values.length > 0 ? values.join('；') : 'AI 未能确认，请展开通话记录核对'
  }

  return (
    <div className="mt-1.5 rounded-lg border border-me-ochre/30 bg-me-ochre/[0.06] px-2 py-1.5">
      <p className="text-[10px] font-bold text-me-ochre">🤖 通话分析 · {STATUS_TEXT[status]}</p>
      {!rejected && (
        <dl className="mt-1 space-y-1 text-[12px] leading-relaxed text-me-charcoal/85">
          <div>
            <dt className="inline font-bold">客户提到的出行时间：</dt>
            <dd className="inline">{fact('travel_window') ?? 'AI 未能确认，请展开通话记录核对'}</dd>
          </div>
          <div>
            <dt className="inline font-bold">跟进时间/安排：</dt>
            <dd className="inline">{followUp()}</dd>
          </div>
          <div>
            <dt className="inline font-bold">客户邮箱（电话中）：</dt>
            <dd className="inline">{fact('contact_email') ?? 'AI 未能确认，请展开通话记录核对'}</dd>
          </div>
        </dl>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-expanded={transcriptOpen}
          onClick={toggleTranscript}
          className="text-[11px] font-bold text-me-charcoal/65 underline"
        >
          {transcriptOpen ? '收起通话记录' : '查看通话记录'}
        </button>
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
      {transcriptOpen && (
        <div className="mt-2 rounded-md border border-me-charcoal/10 bg-white/70 p-2">
          {transcriptLoading && <p className="text-[12px] text-me-charcoal/60">正在读取通话记录…</p>}
          {transcriptError && <p role="alert" className="text-[12px] text-[#C2453A]">{transcriptError}</p>}
          {transcript !== null && (
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-[12px] leading-relaxed text-me-charcoal/80">{transcript}</pre>
          )}
        </div>
      )}
    </div>
  )
}
