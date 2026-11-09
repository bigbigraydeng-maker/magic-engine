/**
 * 把「准入 → 第一层规则 → 硬否决 → 模型 → 三道校验」串成一次判定（只读，不写库）。
 * 写阶段的动作在别处，且只在开关打开、PM 点头之后才会跑。
 * 设计稿：docs/specs/2026-10-21-crm-valid-leads-only-design-v0.md
 *
 * 任何一步拿不准都是 keep（留在名单里）：宁可漏筛，不错筛真客人。
 */

import { SCREEN_NOTE_PREFIX, type NonEnquiryCategory, type ScreenTouch } from './types'
import { checkEligibility, type EligibilityInput } from './eligibility'
import { hasEnquiryEvidence, layerOneVerdict, type MessageText } from './rules'
import { acceptNonEnquiry, callScreenModel, type Acceptance, type ScreenModelDeps } from './classify'

type Rejected = Extract<Acceptance, { accept: false }>['why']

export const CATEGORY_LABEL: Record<NonEnquiryCategory, string> = {
  solicitation: '疑似供应商 / 合作方推销',
  bulk_marketing: '疑似群发营销',
  system_notice: '疑似系统通知',
  auto_reply: '自动回复',
  protest: '疑似抗议 / 表态群发信',
}

export type KeepWhy =
  | `ineligible:${string}`
  | 'no_message'
  | 'veto'
  | 'model_no_verdict'
  | 'model_not_non_enquiry'
  | 'model_low_confidence'
  | 'model_quote_missing'

export type ScreenDecision =
  | { action: 'keep'; why: KeepWhy; detail?: string }
  | {
      action: 'move'
      layer: 'rules' | 'model'
      category: NonEnquiryCategory
      reason: string
      note: string
    }

export interface DecideInput {
  eligibility: EligibilityInput
  /** 这个人的发件地址（用于第一层的中转域名判断）。 */
  fromAddress: string | null
  vetoTerms: readonly string[]
  staffNames: readonly string[]
  businessDescription: string
  model: ScreenModelDeps
}

const MAX_MODEL_MESSAGES = 3

const MODEL_KEEP_WHY = {
  no_verdict: 'model_no_verdict',
  not_non_enquiry: 'model_not_non_enquiry',
  low_confidence: 'model_low_confidence',
  quote_missing: 'model_quote_missing',
} as const satisfies Record<Rejected, KeepWhy>

function toMessage(t: ScreenTouch, fromAddress: string | null): MessageText {
  return { subject: t.subject, preview: t.preview, fromAddress }
}

/** 最新的几条入站消息（新 → 旧取，再还原成时间正序）。 */
function recentMessages(touches: ScreenTouch[], fromAddress: string | null): MessageText[] {
  return [...touches]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, MAX_MODEL_MESSAGES)
    .reverse()
    .map((t) => toMessage(t, fromAddress))
}

function noteFor(category: NonEnquiryCategory, reason: string, layer: 'rules' | 'model'): string {
  const base = `${SCREEN_NOTE_PREFIX}${CATEGORY_LABEL[category]}`
  const detail = reason.trim()
  return `${base}${detail ? `（${detail}）` : ''} [${layer}]`
}

export async function decideScreen(input: DecideInput): Promise<ScreenDecision> {
  const elig = checkEligibility(input.eligibility)
  if (!elig.eligible) return { action: 'keep', why: `ineligible:${elig.why}` }

  const touches = input.eligibility.touches
  const all = touches.map((t) => toMessage(t, input.fromAddress))
  if (all.length === 0) return { action: 'keep', why: 'no_message' }

  // 第一层：必须**每一条**都命中（一个真咨询后面跟一封自动回复，不能整个人被判走）。
  const newestFirst = [...touches].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  const verdicts = newestFirst.map((t) => layerOneVerdict(toMessage(t, input.fromAddress)))
  const ruled = verdicts[0]
  if (ruled && verdicts.every((v) => v !== null)) {
    return {
      action: 'move',
      layer: 'rules',
      category: ruled.category,
      reason: ruled.reason,
      note: noteFor(ruled.category, ruled.reason, 'rules'),
    }
  }

  // 硬否决：只约束第二层。命中任一询价词 / 员工名就不筛，模型说什么都不改。
  const evidence = hasEnquiryEvidence(all, { terms: input.vetoTerms, staffNames: input.staffNames })
  if (evidence.hit) return { action: 'keep', why: 'veto', detail: evidence.term }

  const messages = recentMessages(touches, input.fromAddress)
  const verdict = await callScreenModel(input.model, {
    businessDescription: input.businessDescription,
    messages,
  })
  const accepted = acceptNonEnquiry(verdict, messages, input.eligibility.config.confidenceThreshold)
  if (!accepted.accept) return { action: 'keep', why: MODEL_KEEP_WHY[accepted.why] }
  return {
    action: 'move',
    layer: 'model',
    category: accepted.category,
    reason: accepted.reason,
    note: noteFor(accepted.category, accepted.reason, 'model'),
  }
}
