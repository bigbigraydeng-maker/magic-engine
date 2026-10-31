'use client'

/**
 * 一通电话的 AI 分析卡片：摘要 + 每条需求带原话（标明是客人说的还是员工说的）+ 可展开完整通话文字 + 人工复核（确认 / 驳回）。
 *
 * 分析是 AI 提炼的，复核前不当事实用——所以永远写明「AI 整理，待复核」，
 * 原话摆在每条需求下面，让人自己对。复核只改这份分析的状态，不改客人资料。
 */

import { useState } from 'react'

export interface CallAnalysisData {
  id: string
  summary: string
  reviewStatus: 'pending_review' | 'confirmed' | 'rejected'
  facts: { key: string; value: string; quote: string; speaker?: 'customer' | 'employee' }[]
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
  not_ready_now: '客人说现在还没准备好',
  not_interested: '客人说不感兴趣',
}

const STATUS_TEXT: Record<CallAnalysisData['reviewStatus'], string> = {
  pending_review: 'AI 整理，待复核',
  confirmed: '已确认',
  rejected: '已驳回',
}

/**
 * 复核成功了，但「今天要联系」名单那边没同步上（接口返回 touchpointSync）。
 * 不当成失败（复核已生效），只提醒一句，别让人以为名单已经跟着变了。
 */
export function syncWarning(next: CallAnalysisData['reviewStatus'], body: unknown): string | null {
  const sync = (body as { touchpointSync?: unknown } | null)?.touchpointSync
  if (sync !== 'conflict' && sync !== 'failed') return null
  return `${STATUS_TEXT[next]}，但名单那边没同步上，稍后刷新再看`
}

/** 原话是谁说的：员工说的写「员工原话」，客人说的写「客人原话」，没记说话人就只写「原话」，不乱猜。 */
export function quoteLabel(speaker: 'customer' | 'employee' | undefined): string {
  if (speaker === 'employee') return '员工原话'
  if (speaker === 'customer') return '客人原话'
  return '原话'
}

/** 在完整文字里找到这条原话，用于高亮。原话常以「…」收尾（过长被截），先去掉再找。 */
export function splitAroundQuote(text: string, quote: string): [string, string, string] | null {
  const q = quote.replace(/(\.\.\.|…)+\s*$/, '').trim()
  if (q.length < 6) return null
  const i = text.indexOf(q)
  if (i < 0) return null
  return [text.slice(0, i), text.slice(i, i + q.length), text.slice(i + q.length)]
}

export function CallAnalysisCard({ clientId, analysis }: { clientId: string; analysis: CallAnalysisData }) {
  const [status, setStatus] = useState(analysis.reviewStatus)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [warn, setWarn] = useState<string | null>(null)
  const [transcript, setTranscript] = useState<string | null>(null)
  const [tOpen, setTOpen] = useState(false)
  const [tBusy, setTBusy] = useState(false)
  const [tErr, setTErr] = useState<string | null>(null)
  const [focusQuote, setFocusQuote] = useState<string | null>(null)

  async function openTranscript(quote: string | null) {
    setFocusQuote(quote)
    setTOpen(true)
    if (transcript !== null) return
    setTBusy(true)
    setTErr(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/crm/call-analyses/${analysis.id}/transcript`)
      const body = (await res.json().catch(() => ({}))) as { text?: string; error?: string }
      if (!res.ok || !body.text) throw new Error(body.error ?? '读取失败，请重试')
      setTranscript(body.text)
    } catch (e) {
      setTErr(e instanceof Error ? e.message : '读取失败，请重试')
    } finally {
      setTBusy(false)
    }
  }

  async function review(next: CallAnalysisData['reviewStatus']) {
    setBusy(true)
    setErr(null)
    setWarn(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/crm/call-analyses/${analysis.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ review: next }),
      })
      if (!res.ok) throw new Error('操作没成功，请重试')
      setStatus(next)
      setWarn(syncWarning(next, await res.json().catch(() => null)))
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
                <span className="block text-[11px] text-me-charcoal/50">
                  {quoteLabel(f.speaker)}：“{f.quote}”
                  <button
                    type="button"
                    onClick={() => void openTranscript(f.quote)}
                    className="ml-1 font-bold text-me-ochre underline"
                  >
                    看这句的前后文
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {!rejected && (
        <button
          type="button"
          onClick={() => (tOpen ? setTOpen(false) : void openTranscript(null))}
          className="mt-1 text-[11px] font-bold text-me-ochre underline"
        >
          {tOpen ? '收起完整通话文字' : '看完整通话文字'}
        </button>
      )}
      {tOpen && (
        <div data-testid="call-transcript" className="mt-1 max-h-72 overflow-y-auto whitespace-pre-wrap rounded border border-me-charcoal/10 bg-white px-2 py-1.5 text-[12px] leading-relaxed text-me-charcoal/80">
          {tBusy && '正在读取通话文字…'}
          {tErr && <span className="text-[#C2453A]">{tErr}</span>}
          {transcript !== null &&
            (() => {
              const parts = focusQuote ? splitAroundQuote(transcript, focusQuote) : null
              return parts ? (
                <>
                  {parts[0]}
                  <mark className="rounded bg-yellow-200 px-0.5">{parts[1]}</mark>
                  {parts[2]}
                </>
              ) : (
                transcript
              )
            })()}
        </div>
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
        {warn && <span className="text-[11px] text-me-ochre">{warn}</span>}
      </div>
    </div>
  )
}
