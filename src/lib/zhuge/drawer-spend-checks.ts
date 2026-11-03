/**
 * Hard checks the drawer must attach to a confirmation card.
 * Unreadable stays unread. Nothing here is filled in as zero or as passed.
 */

import type { CardClicker, CardFacts, HardCheck, HardCheckState } from '@/lib/confirmation-card'
import type { SpendKind } from './drawer-spend-ask'

export type CapFact = 'unread' | 'missing' | { readonly cents: number }
export type AmountVerdict = 'within' | 'over' | 'unknown'

export interface SpendEvidence {
  readonly dailyCap: CapFact
  readonly amountVerdict: AmountVerdict
  readonly leadCrm: HardCheckState
  readonly leadCrmReason: string
  readonly creative: HardCheckState
  readonly creativeReason: string
  readonly ownership: HardCheckState
  readonly ownershipReason: string
  readonly speaker: CardClicker
  readonly clientId: string
}

const WHAT: Record<SpendKind, string> = {
  'paused-draft': '批准建暂停草稿并送审',
  launch: '开投',
  'raise-budget': '加预算',
  'cut-budget': '减预算',
  pause: '暂停系列',
  publish: '发布',
  'meta-write': '改广告账户',
  spend: '花钱',
}

const SUBJECT: Record<SpendKind, string> = {
  'paused-draft': 'drawer-paused-draft',
  launch: 'drawer-launch',
  'raise-budget': 'drawer-raise-budget',
  'cut-budget': 'drawer-cut-budget',
  pause: 'drawer-pause',
  publish: 'drawer-publish',
  'meta-write': 'drawer-meta-write',
  spend: 'drawer-spend',
}

function one(label: string, state: HardCheckState, reason: string): HardCheck {
  return { label, state, reason }
}

function capCheck(kind: SpendKind, evidence: SpendEvidence): HardCheck {
  if (evidence.dailyCap === 'unread') return one('日上限', 'unread', '日上限读不到')
  if (evidence.dailyCap === 'missing') return one('日上限', 'red', '日上限还没设置')
  if (kind === 'pause') return one('日上限', 'green', '这一下是暂停，不增加花费')
  if (evidence.amountVerdict === 'within') return one('日上限', 'green', '没有超过已读到的日上限')
  if (evidence.amountVerdict === 'over') return one('日上限', 'red', '超过已读到的日上限')
  return one('日上限', 'unread', '金额和日上限的币种对不上，没有比较')
}

function internalCheck(speaker: CardClicker, clientId: string): HardCheck {
  if (speaker.kind === 'opc') return one('内部账号', 'green', '')
  if (speaker.kind === 'fde' && speaker.clientId === clientId) return one('内部账号', 'green', '')
  if (speaker.kind === 'agent') return one('内部账号', 'unread', '发起的是代理人，还不能确认')
  return one('内部账号', 'red', '认不出内部账号')
}

export function checksForSpend(kind: SpendKind, evidence: SpendEvidence): HardCheck[] {
  return [
    capCheck(kind, evidence),
    one('线索进 CRM', evidence.leadCrm, evidence.leadCrmReason),
    one('素材已批准', evidence.creative, evidence.creativeReason),
    one('系列归属', evidence.ownership, evidence.ownershipReason),
    one('确认卡', 'green', '只出卡，不执行'),
    internalCheck(evidence.speaker, evidence.clientId),
  ]
}

export function factsForSpend(kind: SpendKind, summary: string, evidence: SpendEvidence): CardFacts {
  const amount = kind === 'pause' ? '不增加花费' : '读不到'
  return {
    subjectKey: SUBJECT[kind],
    what: WHAT[kind],
    account: '读不到具体账户',
    amount,
    date: '读不到具体日期',
    scope: `工具：确认卡。只出卡，不执行。原话：${summary}`,
    hardChecks: checksForSpend(kind, evidence),
  }
}
