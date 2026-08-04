/**
 * finalize-call job (spec §12). Idempotent: claimCallForFinalize atomically flips
 * pending/failed → running so a re-run or a crash-recovery sweep never double-applies
 * (魏征 #6). Summary failure leaves the call completed with summary_status='failed'
 * for retry — the call is never lost.
 *
 * Lead updates are NON-DESTRUCTIVE: summary-derived crm_updates only fill lead fields
 * that are still null, so tool-confirmed (caller-stated) values are never overwritten
 * by model inference (魏征 #6).
 */
import { getVoiceConfig } from './config'
import { CallSummarySchema, CALL_SUMMARY_JSON_SCHEMA, SUMMARY_SCHEMA_VERSION, type CallSummary } from './summary-schema'
import { leadUpsertKeyForCall } from './domain'
import { bridgeCallToCrm } from './crm-bridge'
import type { VoiceStore, CallRow, LeadRow, TranscriptSegmentRow } from './store/types'

export interface FinalizeOptions {
  requestId?: string
}

export async function finalizeCall(
  store: VoiceStore,
  callId: string,
  opts: FinalizeOptions = {},
): Promise<{ status: 'done' | 'failed' | 'skipped'; summary?: CallSummary }> {
  const claimed = await store.claimCallForFinalize(callId)
  if (!claimed) return { status: 'skipped' } // already running or done

  const transcript = await store.listTranscript(callId)
  const existingLead = claimed.lead_id ? await store.getLeadById(claimed.lead_id) : null

  let summary: CallSummary
  try {
    summary = await generateSummary(claimed, transcript, existingLead)
  } catch (err) {
    await store.updateCall(callId, {
      summary_status: 'failed', transcript_status: 'summary_failed',
      error_code: 'SUMMARY_FAILED', error_message: (err as Error).message,
    })
    return { status: 'failed' }
  }

  await store.updateCall(callId, {
    summary_status: 'done',
    summary: summary.summary,
    outcome: summary.outcome,
    structured_outcome: {
      ...summary,
      _schema_version: SUMMARY_SCHEMA_VERSION,
      _model: summaryModelName(),
    },
  })

  // Non-destructive lead merge (魏征 #6) — never overwrite tool-confirmed values.
  const patch = buildNonDestructiveLeadPatch(existingLead, summary)
  if (Object.keys(patch).length > 0 || summary.next_action) {
    await store.upsertLeadForCall(callId, claimed.tenant_id, {
      ...patch,
      next_action: existingLead?.next_action ?? summary.next_action ?? null,
      last_contact_at: new Date().toISOString(),
    })
  }

  // 把这通电话写进 CRM 的往来记录（见 ./crm-bridge 的文件头）。
  //
  // 在这之前，语音那套跟 CRM 是两个互不相通的世界：电话打完了，看板上那个人
  // 仍然是「新客人，还没人联系过」。分批规则说的每一句话都因此不准。
  //
  // **绝不能让它把 finalize 判失败**：电话已经打完、摘要已经出好并入库，
  // 为一条 CRM 记录整个失败，只会让重试机制反复重跑一通结束了的通话。
  try {
    const bridged = await bridgeCallToCrm({
      id: callId,
      direction: claimed.direction,
      is_simulated: claimed.is_simulated,
      from_number: claimed.from_number,
      to_number: claimed.to_number,
      started_at: claimed.started_at,
      ended_at: claimed.ended_at,
      duration_seconds: claimed.duration_seconds,
      outcome: summary.outcome,
      summary: summary.summary,
    })
    if (!bridged.ok && bridged.reason !== 'simulated') {
      // 挂不上不是错误，但要看得见 —— 这个数字能看出外呼名单跟 CRM 脱节多严重。
      console.warn(`[voice/finalize] 通话 ${callId} 没能挂进 CRM：${bridged.reason} ${bridged.detail ?? ''}`)
    }
  } catch (err) {
    console.error('[voice/finalize] 写 CRM 往来记录失败（不影响通话收尾）:', err)
  }

  await store.audit({
    tenant_id: claimed.tenant_id, actor_type: 'system', operation: 'call.finalized',
    resource_type: 'call', resource_id: callId, call_id: callId,
    changes: { outcome: summary.outcome, intent_level: summary.intent_level }, request_id: opts.requestId,
  })

  return { status: 'done', summary }
}

function buildNonDestructiveLeadPatch(existing: LeadRow | null, s: CallSummary): Partial<LeadRow> {
  const patch: Partial<LeadRow> = {}
  const u = s.crm_updates
  const fill = <K extends keyof LeadRow>(key: K, value: LeadRow[K] | null | undefined) => {
    if (value != null && (!existing || existing[key] == null)) patch[key] = value as LeadRow[K]
  }
  fill('service_interest', u.service_interest)
  fill('budget_min', u.budget_min)
  fill('budget_max', u.budget_max)
  fill('currency', u.currency)
  fill('preferred_area', u.preferred_area)
  fill('timeline', u.timeline)
  // intent_level is set only when finalize itself is creating the lead — an existing
  // lead already carries the TOOL-confirmed intent (create_or_update_lead always sets
  // it), which the summary must never overwrite. Intentional, not a fill() (子牙 INFO-B).
  if (existing == null && s.intent_level) patch.intent_level = s.intent_level
  return patch
}

function summaryModelName(): string {
  const cfg = getVoiceConfig()
  return cfg.providers.openai === 'real' ? cfg.env.OPENAI_SUMMARY_MODEL : 'mock-summarizer'
}

async function generateSummary(
  call: CallRow,
  transcript: TranscriptSegmentRow[],
  lead: LeadRow | null,
): Promise<CallSummary> {
  const cfg = getVoiceConfig()
  if (cfg.providers.openai === 'real' && cfg.env.OPENAI_API_KEY) {
    try {
      return await openaiSummary(transcript, lead)
    } catch {
      // fall back to deterministic summarizer so the call is never left un-summarized
    }
  }
  return mockSummary(call, transcript, lead)
}

async function openaiSummary(transcript: TranscriptSegmentRow[], lead: LeadRow | null): Promise<CallSummary> {
  const cfg = getVoiceConfig()
  const { default: OpenAI } = await import('openai')
  const client = new OpenAI({ apiKey: cfg.env.OPENAI_API_KEY })
  const convo = transcript.map((t) => `${t.speaker}: ${t.text}`).join('\n')
  const res = await client.responses.create({
    model: cfg.env.OPENAI_SUMMARY_MODEL,
    input: [
      { role: 'system', content: 'Summarize this sales/support phone call into the required JSON. Only use facts stated in the transcript. Put every commitment the agent made into promises_made.' },
      { role: 'user', content: `Transcript:\n${convo}\n\nExisting lead: ${JSON.stringify(lead ?? {})}` },
    ],
    text: { format: { type: 'json_schema', name: 'call_summary', schema: CALL_SUMMARY_JSON_SCHEMA } },
  } as Parameters<typeof client.responses.create>[0])
  const text = (res as { output_text?: string }).output_text ?? '{}'
  return CallSummarySchema.parse(JSON.parse(text))
}

/** Deterministic summarizer for the mock/seed path — no external calls. */
function mockSummary(call: CallRow, transcript: TranscriptSegmentRow[], lead: LeadRow | null): CallSummary {
  const userLines = transcript.filter((t) => t.speaker === 'user').map((t) => t.text)
  const assistantLines = transcript.filter((t) => t.speaker === 'assistant').map((t) => t.text)
  const transferred = call.status === 'transferred' || call.disposition === 'transferred'

  const promises = assistantLines.filter((l) => /\b(we'll|we will|i'll|i will|send|confirm|arrange|call you back|follow up|book)\b/i.test(l))
  const outcome: CallSummary['outcome'] = transferred
    ? 'transferred'
    : lead?.stage === 'qualified'
      ? 'qualified'
      : lead
        ? 'follow_up_required'
        : userLines.length === 0
          ? 'failed'
          : 'follow_up_required'

  const summaryText = [
    `Caller discussed: ${lead?.service_interest ?? userLines[0] ?? 'general enquiry'}.`,
    lead?.preferred_area ? `Area: ${lead.preferred_area}.` : '',
    lead?.timeline ? `Timeline: ${lead.timeline}.` : '',
    transferred ? 'Call was transferred to a human.' : '',
    lead?.next_action ? `Next: ${lead.next_action}.` : '',
  ].filter(Boolean).join(' ')

  return CallSummarySchema.parse({
    summary: summaryText || 'Short call with no substantive content.',
    outcome,
    intent_level: lead?.intent_level ?? 'unknown',
    customer_needs: lead?.service_interest ? [lead.service_interest] : [],
    objections: [],
    facts_confirmed: [],
    promises_made: promises,
    next_action: lead?.next_action ?? null,
    follow_up_due_at: null,
    risk_flags: [],
    crm_updates: {
      service_interest: lead?.service_interest ?? null,
      budget_min: lead?.budget_min ?? null,
      budget_max: lead?.budget_max ?? null,
      currency: lead?.currency ?? null,
      preferred_area: lead?.preferred_area ?? null,
      timeline: lead?.timeline ?? null,
    },
  })
}
