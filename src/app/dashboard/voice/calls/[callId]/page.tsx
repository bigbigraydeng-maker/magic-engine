/**
 * Voice call detail (spec §16.2). Sales-first card: one-line need, intent, next
 * action, and — most prominently — what the AI promised (板桥 #3). Transcript, tool
 * calls, and lead below.
 */
import Link from 'next/link'
import { getVoiceStore } from '@/lib/voice/store'
import type { CallSummary } from '@/lib/voice/summary-schema'

export const dynamic = 'force-dynamic'

export default async function CallDetailPage({ params }: { params: { callId: string } }) {
  let call, transcript, toolCalls, lead
  try {
    const store = await getVoiceStore()
    call = await store.getCallById(params.callId)
    if (!call) return <div className="p-6 text-slate-300">Call not found.</div>
    transcript = await store.listTranscript(params.callId)
    toolCalls = await store.listToolCalls(params.callId)
    lead = call.lead_id ? await store.getLeadById(call.lead_id) : null
  } catch (e) {
    return <div className="p-6 text-amber-300">Voice tables unavailable: {(e as Error).message}</div>
  }

  const so = (call.structured_outcome ?? {}) as Partial<CallSummary>

  return (
    <div className="p-6 max-w-4xl mx-auto text-slate-100">
      <Link href="/dashboard/voice" className="text-sm text-slate-400 hover:text-slate-200">← Voice Agent</Link>
      <h1 className="text-xl font-semibold mt-2 mb-1">Call {call.id.slice(0, 8)}</h1>
      <p className="text-sm text-slate-400 mb-4">
        {call.direction} · {call.status} · {call.provider}{call.is_simulated ? ' (simulated)' : ''} · {call.duration_seconds ?? 0}s
      </p>

      {/* Sales-first card */}
      <div className="rounded-lg border border-slate-700 bg-slate-800/40 p-4 mb-6">
        <div className="grid md:grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-slate-400 text-xs uppercase mb-1">Summary</div>
            <div>{call.summary ?? '—'}</div>
          </div>
          <div>
            <div className="text-slate-400 text-xs uppercase mb-1">Outcome · Intent</div>
            <div>{call.outcome ?? '—'} · {so.intent_level ?? '—'}</div>
            <div className="text-slate-400 text-xs uppercase mt-3 mb-1">Next action</div>
            <div>{so.next_action ?? lead?.next_action ?? '—'}</div>
          </div>
        </div>

        {/* promises_made — most prominent (板桥 #3) */}
        <div className="mt-4 rounded-md border border-emerald-700/50 bg-emerald-900/20 p-3">
          <div className="text-emerald-300 text-xs uppercase mb-1 font-medium">⚑ What the AI promised (must honour)</div>
          {so.promises_made?.length ? (
            <ul className="list-disc list-inside text-sm text-emerald-100">
              {so.promises_made.map((p, i) => <li key={i}>{p}</li>)}
            </ul>
          ) : <div className="text-sm text-slate-400">No commitments recorded.</div>}
        </div>

        {so.risk_flags?.length ? (
          <div className="mt-3 rounded-md border border-red-700/50 bg-red-900/20 p-3 text-sm text-red-200">
            ⚠ Risk flags: {so.risk_flags.join(', ')}
          </div>
        ) : null}
      </div>

      {/* Transcript */}
      <h2 className="text-lg font-medium mb-2">Transcript</h2>
      <div className="space-y-1 mb-6 text-sm">
        {transcript.map((s) => (
          <div key={s.id} className="flex gap-2">
            <span className={`w-20 shrink-0 text-xs uppercase ${s.speaker === 'assistant' ? 'text-sky-400' : s.speaker === 'user' ? 'text-slate-400' : 'text-amber-400'}`}>{s.speaker}</span>
            <span>{s.text}</span>
          </div>
        ))}
        {transcript.length === 0 && <div className="text-slate-500">No transcript.</div>}
      </div>

      {/* Tool calls */}
      <h2 className="text-lg font-medium mb-2">Tool calls</h2>
      <div className="space-y-1 mb-6 text-sm">
        {toolCalls.map((t) => (
          <div key={t.id} className="flex justify-between rounded border border-slate-800 px-3 py-1.5">
            <span className="font-mono">{t.tool_name}</span>
            <span className="text-slate-400">{t.status} · {t.latency_ms ?? 0}ms</span>
          </div>
        ))}
        {toolCalls.length === 0 && <div className="text-slate-500">No tool calls.</div>}
      </div>

      {/* Lead */}
      {lead && (
        <>
          <h2 className="text-lg font-medium mb-2">Lead</h2>
          <div className="rounded-lg border border-slate-700 bg-slate-800/40 p-4 text-sm grid md:grid-cols-2 gap-2">
            <div>Interest: {lead.service_interest ?? '—'}</div>
            <div>Stage: {lead.stage} · Intent: {lead.intent_level ?? '—'}</div>
            <div>Budget: {lead.budget_min != null ? `${lead.budget_min}-${lead.budget_max ?? ''} ${lead.currency ?? ''}` : '—'}</div>
            <div>Area: {lead.preferred_area ?? '—'} · Timeline: {lead.timeline ?? '—'}</div>
          </div>
        </>
      )}
    </div>
  )
}
