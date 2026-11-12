/**
 * One approval for the whole weekly plan.
 * Agreeing stamps the plan. It does not authorise Story, promote a Reel, or publish.
 */

import { confirmBlockReason, contentFingerprint, normalizeFacts, type CardFacts, type HardCheck } from '@/lib/confirmation-card/facts'
import type { CardLifetime } from '@/lib/confirmation-card/view'
import { ConfirmationCardError } from '@/lib/confirmation-card/errors'

import type { PlanApproval } from './digest'
import type { ReadState, WeeklySocialPlan } from './types'

const WHAT = '同意这一周的社媒方案，Story、图文和 Reel 一起批。这次不发布。'

export function weekPlanSubject(clientId: string, weekStart: string): string {
  return `social:week-plan:${clientId.toLowerCase()}:${weekStart}`
}

export function planCardFacts(plan: WeeklySocialPlan, clientId: string, digest: string): CardFacts {
  return {
    subjectKey: weekPlanSubject(clientId, plan.weekStart),
    what: WHAT,
    account: 'Facebook',
    amount: '不涉及广告花费',
    date: `${plan.weekStart} 到 ${plan.weekEnd}`,
    scope: scopeLine(plan, digest),
    hardChecks: [
      planCheck(plan),
      readCheck('目标卡', plan.goal.read, '目标卡只作出稿背景，不当条数。', '没有活跃目标卡。', '目标卡读不到。'),
      readCheck('广告主题', plan.themes.read, '用客户正在用的广告主题。', '没有广告主题，没有编一个。', '广告主题读不到。'),
      { label: '发布', state: 'green', reason: '这张卡不发布。' },
    ],
  }
}

export async function openWeekPlanApproval<T>(
  ports: { issue: (facts: CardFacts, lifetime: CardLifetime) => Promise<T> },
  plan: WeeklySocialPlan,
  clientId: string,
  digest: string,
): Promise<T> {
  return ports.issue(normalizeFacts(planCardFacts(plan, clientId, digest)), 'nz_day')
}

export async function decideWeekPlanApproval<T>(
  ports: {
    decide: (input: { runId: string; resolution: 'confirm' | 'decline'; expectedDecisionId: string; fingerprint: string }) => Promise<T>
    stamp: (approval: PlanApproval) => Promise<boolean>
  },
  args: {
    plan: WeeklySocialPlan
    clientId: string
    digest: string
    resolution: 'confirm' | 'decline'
    runId: string
    expectedDecisionId: string
    fingerprint: string
    now: Date
  },
): Promise<{ card: T; approval: PlanApproval; stamped: boolean }> {
  const facts = normalizeFacts(planCardFacts(args.plan, args.clientId, args.digest))
  if (contentFingerprint(facts) !== args.fingerprint) {
    throw new ConfirmationCardError('stale', '方案已经变了，这张卡不能再点。请重新出卡。')
  }
  if (args.resolution === 'confirm') {
    const block = confirmBlockReason(facts.hardChecks)
    if (block) throw new ConfirmationCardError('hard_check', block)
  }
  const card = await ports.decide({
    runId: args.runId,
    resolution: args.resolution,
    expectedDecisionId: args.expectedDecisionId,
    fingerprint: args.fingerprint,
  })
  const approval: PlanApproval = {
    status: args.resolution === 'confirm' ? 'confirmed' : 'declined',
    at: args.now.toISOString(),
  }
  const stamped = await ports.stamp(approval)
  return { card, approval, stamped }
}

function scopeLine(plan: WeeklySocialPlan, digest: string): string {
  const stage = plan.stage ?? '阶段未下结论'
  return `Story ${show(plan.counts.story)}，图文 ${show(plan.counts.post)}，Reel ${show(plan.counts.reel)}。${stage}。指纹 ${digest}`
}

function show(value: number | null): string {
  return value === null ? '未知' : String(value)
}

function planCheck(plan: WeeklySocialPlan): HardCheck {
  if (plan.status === 'ready') return { label: '方案', state: 'green', reason: '这一周的方案可以批。' }
  if (plan.status === 'held') return { label: '方案', state: 'red', reason: '暂停，这周不出新稿。' }
  return { label: '方案', state: 'red', reason: '方案不完整，没有批。' }
}

function readCheck(label: string, read: ReadState, ok: string, none: string, unread: string): HardCheck {
  if (read === 'unreadable') return { label, state: 'unread', reason: unread }
  if (read === 'none') return { label, state: 'green', reason: none }
  return { label, state: 'green', reason: ok }
}
