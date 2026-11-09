import { matchPoolEntry, nzToday, promoVerdict } from '@/lib/ads-strategy/promo-window'
import type { ChainFacts, PlanFact, PoolFact, WorkOrderFact } from './types'
import { REVIEW_WAIT_MS } from './types'
import { chainStep, unreadStep, waitingStep } from './steps'

const STUCK_WORK = new Set(['failed', 'dead_letter', 'review_rejected', 'publish_failed'])
const DOING_WORK = new Set([
  'queued', 'claimed', 'producing', 'rendered', 'in_review',
  'approved', 'publishing', 'measuring',
])

function newest(plans: PlanFact[]): PlanFact | null {
  const sorted = plans.slice().sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  return sorted.find((plan) => plan.status === 'approved' || plan.status === 'completed')
    ?? sorted.find((plan) => plan.status === 'draft')
    ?? null
}

/** The plan a goal's chain follows: newest approved/completed, else newest draft. Archived never counts. */
export function planForGoal(plans: PlanFact[], goalId: string): PlanFact | null {
  return newest(plans.filter((plan) => plan.goalId === goalId && plan.status !== 'archived'))
}

export function linkedPlan(facts: ChainFacts): PlanFact | null | 'unread' | 'no-goal' {
  if (facts.prescription.read !== 'ok' || facts.prescription.value === null) return 'unread'
  const goalId = facts.prescription.value.goalId
  if (!goalId) return 'no-goal'
  if (facts.plans.read !== 'ok') return 'unread'
  return planForGoal(facts.plans.value, goalId)
}

function reviewTooOld(orders: WorkOrderFact[], nowMs: number): boolean {
  return countOldReviews(orders, nowMs) > 0
}

function countOldReviews(orders: WorkOrderFact[], nowMs: number): number {
  return orders.filter((order) => {
    if (order.status !== 'in_review' || !order.updatedAt) return false
    const at = Date.parse(order.updatedAt)
    return Number.isFinite(at) && nowMs - at > REVIEW_WAIT_MS
  }).length
}

function planIsLive(plan: PlanFact): boolean {
  return plan.status === 'approved' || plan.status === 'completed'
}

function covers(pool: PoolFact[], ref: string, today: string): 'yes' | 'no' | 'ambiguous' {
  const match = matchPoolEntry(pool.map((entry) => ({
    ref: entry.ref,
    alias_refs: entry.aliasRefs,
    promo_window: entry.promoWindow ?? undefined,
  })), ref)
  if (match.kind === 'ambiguous') return 'ambiguous'
  if (match.kind !== 'found') return 'no'
  const entry = pool.find((item) => item.ref === match.entry.ref)
  if (!entry || entry.status !== 'approved') return 'no'
  return promoVerdict(entry.promoWindow, today) === 'ok' ? 'yes' : 'no'
}

function namedCreatives(plan: PlanFact, pool: PoolFact[], today: string): ReturnType<typeof chainStep> | null {
  if (plan.adsStepCount === 0) return chainStep('creative', 'active', '计划里还没有广告步骤，看不出要几条素材。')
  if (plan.creativeRefs.length === 0) return chainStep('creative', 'active', '计划没有写要哪几条素材。')
  if (plan.creativeRefs.some((ref) => covers(pool, ref, today) === 'ambiguous')) {
    return chainStep('creative', 'blocked', '同一条素材在池里对上了不止一条，不敢当成已批准。')
  }
  if (plan.creativeRefs.every((ref) => covers(pool, ref, today) === 'yes')) {
    return chainStep('creative', 'done', '计划点名的素材都已批准，推广期也盖得住。')
  }
  return chainStep('creative', 'blocked', '计划点名的素材还没批准，或者推广期盖不住。')
}

function missingPlan(facts: ChainFacts): ReturnType<typeof chainStep> {
  const rx = facts.prescription.read === 'ok' ? facts.prescription.value : null
  if (!rx || rx.status === 'generating' || rx.status === 'failed' || !rx.contentPresent) {
    return waitingStep('creative')
  }
  return chainStep('creative', 'active', '还没有挂在这个目标上的推广计划，素材还没对上。')
}

function fromOrders(orders: WorkOrderFact[], nowMs: number): ReturnType<typeof chainStep> | null {
  if (orders.some((order) => STUCK_WORK.has(order.status))) {
    return chainStep('creative', 'blocked', '有素材工单失败了，还不能拿去投。')
  }
  if (reviewTooOld(orders, nowMs)) {
    return chainStep('creative', 'blocked', '有素材停在待审超过 24 小时。')
  }
  if (orders.some((order) => order.status === 'in_review' && !order.updatedAt)) {
    return chainStep('creative', 'active', '有素材在待审，但看不出等了多久。')
  }
  if (orders.some((order) => DOING_WORK.has(order.status))) {
    return chainStep('creative', 'active', '素材还在做。')
  }
  return null
}

export function deriveCreative(facts: ChainFacts): ReturnType<typeof chainStep> {
  const plan = linkedPlan(facts)
  const strategy = facts.strategy
  if (plan === 'unread' || strategy.read !== 'ok' || strategy.value === null || strategy.value.pool === null) {
    return unreadStep('creative')
  }
  const pool = strategy.value.pool
  if (plan === 'no-goal') {
    const rx = facts.prescription.read === 'ok' ? facts.prescription.value : null
    if (rx && (rx.status === 'draft' || rx.status === 'approved' || rx.contentPresent)) {
      return chainStep('creative', 'blocked', '这份处方没有挂目标，对不上素材。')
    }
    return waitingStep('creative')
  }
  if (facts.workOrders.read === 'unread') return unreadStep('creative')
  const now = Date.parse(facts.nowIso)
  if (!Number.isFinite(now)) return unreadStep('creative')
  const orders = facts.workOrders.read === 'ok' ? facts.workOrders.value : []
  if (orders.some((order) => STUCK_WORK.has(order.status))) {
    return chainStep('creative', 'blocked', '有素材工单失败了，还不能拿去投。')
  }
  const livePlan = plan && planIsLive(plan) ? plan : null
  if (livePlan) {
    const named = namedCreatives(livePlan, pool, nzToday(now))
    if (named.state === 'done') {
      const oldCount = countOldReviews(orders, now)
      if (oldCount > 0) {
        return chainStep(
          'creative',
          'done',
          `${named.detail}另有 ${oldCount} 条素材待审超过 24 小时，不挡这份计划`,
        )
      }
      return named
    }
    if (named.state === 'blocked' || named.state === 'active') return named
  }
  const stuck = fromOrders(orders, now)
  if (stuck) return stuck
  if (!plan) return missingPlan(facts)
  const named = namedCreatives(plan, pool, nzToday(now))
  return named ?? chainStep('creative', 'active', '还没有素材工单，计划也没点名素材。')
}
