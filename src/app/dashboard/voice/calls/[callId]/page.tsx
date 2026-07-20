/**
 * Voice call detail (spec §16.2). Sales-first card: one-line need, intent, next
 * action, and — most prominently — what the AI promised (板桥 #3). Magic Engine style.
 */
import Link from 'next/link'
import { getVoiceStore } from '@/lib/voice/store'
import { MePanel, MePanelHeader, MePill, MeChip } from '@/components/ui/me-primitives'
import type { CallSummary } from '@/lib/voice/summary-schema'

export const dynamic = 'force-dynamic'

export default async function CallDetailPage({ params }: { params: { callId: string } }) {
  let call, transcript, toolCalls, lead
  try {
    const store = await getVoiceStore()
    call = await store.getCallById(params.callId)
    if (!call) return <div className="font-sans px-8 py-7 text-black/60">Call not found.</div>
    transcript = await store.listTranscript(params.callId)
    toolCalls = await store.listToolCalls(params.callId)
    lead = call.lead_id ? await store.getLeadById(call.lead_id) : null
  } catch (e) {
    return <div className="font-sans px-8 py-7 text-[#C4912E]">Voice tables unavailable: {(e as Error).message}</div>
  }

  const so = (call.structured_outcome ?? {}) as Partial<CallSummary>

  return (
    <div className="font-sans">
      <header className="sticky top-0 z-20 border-b border-black/10 bg-[#FBF8F3]/80 px-8 py-5 backdrop-blur-md">
        <Link href="/dashboard/voice" className="text-[13px] text-black/50 hover:text-me-charcoal">← Voice Agent</Link>
        <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-me-charcoal">Call {call.id.slice(0, 8)}</h1>
        <div className="mt-1 flex items-center gap-2 text-[13px] text-black/55">
          <MeChip>{call.direction}</MeChip><MeChip>{call.provider}{call.is_simulated ? '·sim' : ''}</MeChip>
          <MePill tone={call.status === 'completed' || call.status === 'transferred' ? 'track' : call.status === 'failed' ? 'rej' : 'exec'}>{call.status}</MePill>
          <span>{call.duration_seconds ?? 0}s</span>
        </div>
      </header>

      <div className="px-8 py-7 space-y-6 max-w-4xl">
        {/* Sales-first card */}
        <MePanel>
          <div className="grid gap-5 md:grid-cols-2 text-sm">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[.1em] text-black/40 mb-1">摘要</div>
              <div className="text-me-charcoal">{call.summary ?? '—'}</div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[.1em] text-black/40 mb-1">结果 · 意向</div>
              <div className="flex items-center gap-2">{call.outcome ? <MePill tone="track">{call.outcome}</MePill> : '—'}{so.intent_level ? <MeChip>{so.intent_level}</MeChip> : null}</div>
              <div className="text-[11px] font-semibold uppercase tracking-[.1em] text-black/40 mt-4 mb-1">下一步</div>
              <div className="text-me-charcoal">{so.next_action ?? lead?.next_action ?? '—'}</div>
            </div>
          </div>

          {/* promises_made — most prominent (板桥 #3) */}
          <div className="mt-5 rounded-2xl border border-[#5C8A4A]/25 bg-[#5C8A4A]/[.08] p-4">
            <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[.1em] text-[#5C8A4A]">⚑ AI 承诺了什么（必须兑现）</div>
            {so.promises_made?.length ? (
              <ul className="list-inside list-disc text-sm text-me-charcoal">{so.promises_made.map((p, i) => <li key={i}>{p}</li>)}</ul>
            ) : <div className="text-sm text-black/45">无承诺记录。</div>}
          </div>

          {so.risk_flags?.length ? (
            <div className="mt-3 rounded-2xl border border-[#C2453A]/25 bg-[#C2453A]/[.08] p-4 text-sm text-[#C2453A]">⚠ 风险: {so.risk_flags.join(', ')}</div>
          ) : null}
        </MePanel>

        {/* Transcript */}
        <MePanel>
          <MePanelHeader title="通话记录" />
          <div className="space-y-1.5 text-sm">
            {transcript.map((s) => (
              <div key={s.id} className="flex gap-3">
                <span className={`w-20 shrink-0 text-[11px] font-semibold uppercase ${s.speaker === 'assistant' ? 'text-[#C4912E]' : s.speaker === 'user' ? 'text-black/45' : 'text-[#3E6E8C]'}`}>{s.speaker}</span>
                <span className="text-me-charcoal">{s.text}</span>
              </div>
            ))}
            {transcript.length === 0 && <div className="text-black/40">无记录。</div>}
          </div>
        </MePanel>

        {/* Tool calls */}
        <MePanel>
          <MePanelHeader title="工具调用" />
          <div className="space-y-1.5 text-sm">
            {toolCalls.map((t) => (
              <div key={t.id} className="flex justify-between rounded-xl border border-black/[.06] px-3 py-2">
                <span className="font-mono text-me-charcoal">{t.tool_name}</span>
                <span className="text-black/50">{t.status} · {t.latency_ms ?? 0}ms</span>
              </div>
            ))}
            {toolCalls.length === 0 && <div className="text-black/40">无工具调用。</div>}
          </div>
        </MePanel>

        {/* Lead */}
        {lead && (
          <MePanel>
            <MePanelHeader title="线索 Lead" />
            <div className="grid gap-2 text-sm text-me-charcoal md:grid-cols-2">
              <div>需求: {lead.service_interest ?? '—'}</div>
              <div>阶段: {lead.stage} · 意向: {lead.intent_level ?? '—'}</div>
              <div>预算: {lead.budget_min != null ? `${lead.budget_min}-${lead.budget_max ?? ''} ${lead.currency ?? ''}` : '—'}</div>
              <div>地区: {lead.preferred_area ?? '—'} · 时间线: {lead.timeline ?? '—'}</div>
            </div>
          </MePanel>
        )}
      </div>
    </div>
  )
}
