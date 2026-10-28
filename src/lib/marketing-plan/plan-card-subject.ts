/**
 * The plan id lives on the confirmation card's subject key.
 * A content stamp is added when the card is issued, so a later edit of the
 * plan cannot be approved by the old card.
 */

export const PLAN_CARD_OPC_ONLY = '计划只认 Magic Lab 内部负责人本人批准。'
export const PLAN_CARD_WHAT = '批准推广计划草稿（只改计划状态，不开投）'
export const PLAN_CARD_ACCOUNT = '不操作任何广告账户'
export const PLAN_CARD_AMOUNT = '批准计划本身不花钱，不改预算'
export const PLAN_CARD_SCOPE = '只改这份计划的状态，不建广告草稿，不写 Meta'

export interface PlanCardWords {
  readonly subjectKey: string
  readonly what: string
  readonly account: string
  readonly amount: string
  readonly scope: string
}

/** A card may approve a plan only when it shows the real approval words and a content stamp. */
export function trustedPlanCard(card: PlanCardWords): { planId: string; contentHash: string } | null {
  const parsed = parsePlanCardSubject(card.subjectKey)
  if (!parsed?.contentHash) return null
  if (card.what !== PLAN_CARD_WHAT || card.account !== PLAN_CARD_ACCOUNT) return null
  if (card.amount !== PLAN_CARD_AMOUNT || card.scope !== PLAN_CARD_SCOPE) return null
  return { planId: parsed.planId, contentHash: parsed.contentHash }
}

const PREFIX = 'plan-approve:'
const HASH_RE = /^[a-f0-9]{16}$/

export function planCardSubject(planId: string, contentHash: string | null): string {
  const id = planId.trim().toLowerCase()
  if (contentHash && HASH_RE.test(contentHash)) return `${PREFIX}${id}:${contentHash}`
  return `${PREFIX}${id}`
}

export function parsePlanCardSubject(subjectKey: string): { planId: string; contentHash: string | null } | null {
  if (!subjectKey.startsWith(PREFIX)) return null
  const rest = subjectKey.slice(PREFIX.length)
  const split = rest.lastIndexOf(':')
  if (split > 0) {
    const planId = rest.slice(0, split)
    const contentHash = rest.slice(split + 1)
    if (planId && !planId.includes(':') && HASH_RE.test(contentHash)) return { planId, contentHash }
  }
  if (rest && !rest.includes(':')) return { planId: rest, contentHash: null }
  return null
}

export function isPlanApprovalCard(subjectKey: string): boolean {
  return parsePlanCardSubject(subjectKey) !== null
}

/** Yellow and red checks are why this card exists. They do not lock confirm on a trusted plan card. */
export function planCardMayConfirmDespiteChecks(card: PlanCardWords & { readonly hardChecks: readonly unknown[] }): boolean {
  return trustedPlanCard(card) !== null && card.hardChecks.length > 0
}
