/**
 * Smart auto-ack composer (design: docs/specs/2026-10-22-smart-ack-design-v0.md §9).
 * Orchestration only — every external thing (flag, messages, model) is injected, and
 * the function NEVER throws: any failure degrades to the fixed template so the customer
 * always gets an answer. Flag off = identical to the pre-smart behaviour (fixed text, no notice).
 */
import { AUTOACK_TEMPLATE } from '../autoack-identity'
import { shouldSkipRepeatedMessage, isSameAsLastOutbound } from './repeat'
import { triageMessages } from './triage'
import { validateSmartAck } from './validate'
import { buildSmartAckUserPrompt, parseSmartAckModelOutput, SMART_ACK_SYSTEM_PROMPT } from './prompt'
import { AUTOMATED_NOTICE } from './types'

export interface AckContext {
  /** Latest customer inbound texts, oldest first (≤3 used). */
  recentInbound: string[]
  /** The inbound text that triggered this run (last of recentInbound). */
  currentText: string
  /** Earlier inbound texts in the SAME conversation that already got a sent reply. */
  repliedEarlierInbound: string[]
  /** Body of the most recent sent outbound in this conversation, if any. */
  lastOutbound: string | null
}

export interface ComposeDeps {
  readEnabled: () => Promise<{ enabled: boolean; dailyCap: number }>
  loadContext: () => Promise<AckContext>
  smartSentToday: () => Promise<number>
  callModel: (input: { system: string; user: string }) => Promise<string>
}

export type AckPlan =
  | { kind: 'skip'; reason: string }
  | { kind: 'send'; text: string; source: 'fixed' | 'smart'; reason: string }

const fixedWithNotice = (reason: string): AckPlan => ({
  kind: 'send',
  text: `${AUTOACK_TEMPLATE} ${AUTOMATED_NOTICE}`,
  source: 'fixed',
  reason,
})

// The stored outbound body includes the automated notice; strip it so the
// comparison is against the model text only.
function stripNotice(body: string | null): string | null {
  if (body === null) return null
  return body.split(AUTOMATED_NOTICE).join('').trim()
}

async function tryModel(deps: ComposeDeps, ctx: AckContext): Promise<AckPlan> {
  const messages = ctx.recentInbound.slice(-3)
  let raw: string
  try {
    raw = await deps.callModel({
      system: SMART_ACK_SYSTEM_PROMPT,
      user: buildSmartAckUserPrompt(messages),
    })
  } catch {
    return fixedWithNotice('model_error')
  }
  const reply = parseSmartAckModelOutput(raw)
  if (reply === null) return fixedWithNotice('parse_failed')
  const verdict = validateSmartAck(reply, messages)
  if (!verdict.ok) return fixedWithNotice(verdict.reason)
  if (isSameAsLastOutbound(verdict.text, stripNotice(ctx.lastOutbound))) {
    return fixedWithNotice('same_as_last')
  }
  return { kind: 'send', text: `${verdict.text} ${AUTOMATED_NOTICE}`, source: 'smart', reason: 'model_ok' }
}

export async function composeAck(deps: ComposeDeps): Promise<AckPlan> {
  const fixedOff: AckPlan = { kind: 'send', text: AUTOACK_TEMPLATE, source: 'fixed', reason: 'flag_off' }
  let cfg: { enabled: boolean; dailyCap: number }
  try {
    cfg = await deps.readEnabled()
  } catch {
    return fixedOff
  }
  if (!cfg.enabled) return fixedOff

  let ctx: AckContext
  try {
    ctx = await deps.loadContext()
  } catch {
    return fixedWithNotice('context_read_failed')
  }

  if (shouldSkipRepeatedMessage({ current: ctx.currentText, repliedEarlierInbound: ctx.repliedEarlierInbound })) {
    return { kind: 'skip', reason: 'skipped_repeat_message' }
  }

  const triage = triageMessages(ctx.recentInbound.slice(-3))
  if (!triage.useModel) return fixedWithNotice(triage.reason)

  try {
    if ((await deps.smartSentToday()) >= cfg.dailyCap) return fixedWithNotice('daily_cap')
  } catch {
    return fixedWithNotice('cap_read_failed')
  }
  return tryModel(deps, ctx)
}
