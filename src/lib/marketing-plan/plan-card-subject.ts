/**
 * The plan id lives on the confirmation card's subject key.
 * A content stamp is added when the card is issued, so a later edit of the
 * plan cannot be approved by the old card.
 */

export const PLAN_CARD_OPC_ONLY = '计划只认 Magic Lab 内部负责人本人批准。'

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

/** Yellow and red checks are why this card exists. They do not lock the confirm button. */
export function planCardMayConfirmDespiteChecks(subjectKey: string, checks: readonly unknown[]): boolean {
  return isPlanApprovalCard(subjectKey) && checks.length > 0
}
