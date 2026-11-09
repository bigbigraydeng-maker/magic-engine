/**
 * 抽屉上「通话后发邮件」提示条要知道的一切，一次问完（设计稿 §7.1）：
 *   - 功能现在能不能用（featureState）；
 *   - 有哪些启用中的模板；
 *   - 有没有「系统记录的接通电话」（手记不算）——有，而且这通电话之后还没发过邮件，才弹提示。
 * 只读，不写任何东西。
 */

import type { FeatureState } from './feature-state'
import type { SendGateData } from './send-gates'
import type { EmailTemplateVersion } from './types'

export interface PostCallTemplateSummary {
  key: string
  version: number
  name: string
  pickMode: EmailTemplateVersion['pickMode']
  factSource: EmailTemplateVersion['factSource']
}

export interface PostCallState {
  featureState: FeatureState
  templates: PostCallTemplateSummary[]
  /** The most recent connected SYSTEM call within the prompt window; null when none. */
  callEvidenceAt: string | null
  /** An email was already sent to him after that call (our own template send, or any outbound email touchpoint). */
  emailedSinceCall: boolean
}

const OFF: Omit<PostCallState, 'featureState'> = { templates: [], callEvidenceAt: null, emailedSinceCall: false }

export function summariseTemplates(all: readonly EmailTemplateVersion[]): PostCallTemplateSummary[] {
  return all
    .filter((t) => t.status === 'active')
    .map((t) => ({ key: t.templateKey, version: t.version, name: t.name, pickMode: t.pickMode, factSource: t.factSource }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function loadPostCallState(
  args: { clientId: string; contactId: string; featureState: FeatureState; callPromptHours: number; templates: readonly EmailTemplateVersion[]; now: Date },
  data: SendGateData,
): Promise<{ ok: true; state: PostCallState } | { ok: false; status: 404 | 503; error: string }> {
  if (args.featureState !== 'ready') return { ok: true, state: { featureState: args.featureState, ...OFF } }
  const view = await data.loadContactView(args.clientId, args.contactId, args.callPromptHours, args.now)
  if (view === null) return { ok: false, status: 404, error: '找不到这个客人。' }
  const templates = summariseTemplates(args.templates)
  if (view.callEvidenceAt === null) return { ok: true, state: { featureState: 'ready', templates, callEvidenceAt: null, emailedSinceCall: false } }

  const [receipts, touches] = await Promise.all([
    data.sentTemplateReceiptsSince(args.clientId, args.contactId, view.callEvidenceAt),
    data.frequencySources.touchpoints(args.contactId, view.callEvidenceAt),
  ])
  // A touchpoint source that cannot answer must not hide the prompt: the send itself is still guarded by the follow-up gate.
  const emailedSinceCall = receipts.length > 0 || (touches.ok && touches.items.length > 0)
  return { ok: true, state: { featureState: 'ready', templates, callEvidenceAt: view.callEvidenceAt, emailedSinceCall } }
}
