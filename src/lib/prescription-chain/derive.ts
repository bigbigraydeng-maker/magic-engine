import { deriveCreative, linkedPlan } from './creative'
import { deriveMeasure } from './measure'
import { chainStep, plainFailure, unreadStep, waitingStep } from './steps'
import {
  SNAPSHOT_STALE_MS,
  type ChainFacts,
  type ChainStatus,
  type ChainStep,
  type DraftFact,
  type PrescriptionFact,
} from './types'

const LIVE_DRAFT = new Set(['awaiting_approval', 'activating', 'active'])

function prescriptionOf(facts: ChainFacts): PrescriptionFact | null | 'unread' {
  if (facts.prescription.read !== 'ok') return 'unread'
  return facts.prescription.value
}

function deriveInspect(facts: ChainFacts): { step: ChainStep; stale: boolean } {
  if (facts.snapshot.read !== 'ok') return { step: unreadStep('inspect'), stale: false }
  const snap = facts.snapshot.value
  if (!snap) return { step: chainStep('inspect', 'blocked', '还没有广告现状快照。'), stale: false }
  const at = Date.parse(snap.capturedAt)
  const now = Date.parse(facts.nowIso)
  if (!Number.isFinite(at) || !Number.isFinite(now)) return { step: unreadStep('inspect'), stale: false }
  if (now - at > SNAPSHOT_STALE_MS) {
    return { step: chainStep('inspect', 'blocked', '广告现状快照超过 12 小时没更新。'), stale: true }
  }
  return { step: chainStep('inspect', 'done', '广告现状快照在 12 小时以内。'), stale: false }
}

function deriveConfirm(facts: ChainFacts): ChainStep {
  const rx = prescriptionOf(facts)
  if (rx === 'unread' || rx === null) return unreadStep('confirm')
  if (!rx.intake) return chainStep('confirm', 'active', '客户需求还没记在这份处方里。')
  const goalOk = rx.intake.businessGoal !== null
  const budgetOk = rx.intake.monthlyBudget !== null && rx.intake.monthlyBudget > 0
  if (goalOk && budgetOk) return chainStep('confirm', 'done', '需求已经记在处方里。')
  return chainStep('confirm', 'blocked', '需求登记缺了推什么或花多少。')
}

function derivePrescribe(facts: ChainFacts): ChainStep {
  const rx = prescriptionOf(facts)
  if (rx === 'unread' || rx === null) return unreadStep('prescribe')
  if (rx.status === 'generating') return chainStep('prescribe', 'active', '正在开方。')
  if (rx.status === 'failed') {
    return chainStep('prescribe', 'blocked', plainFailure(rx.errorMessage, '开方没有写成。'))
  }
  if (rx.status === 'superseded' && !rx.approvedAt) {
    return chainStep('prescribe', 'blocked', '这份处方已经被新版本换掉了。')
  }
  if (!rx.contentPresent) return chainStep('prescribe', 'active', '处方正文还没写出来。')
  if (rx.adPlayCount < 1 && rx.intake?.personalIp) {
    return chainStep('prescribe', 'done', '这份以内容为主，没有广告打法。')
  }
  if (rx.adPlayCount < 1) return chainStep('prescribe', 'blocked', '处方里还没有结构化的广告打法。')
  return chainStep('prescribe', 'done', '处方已经带上广告打法。')
}

function deriveConsent(facts: ChainFacts, prescribe: ChainStep): ChainStep {
  const rx = prescriptionOf(facts)
  if (rx === 'unread' || rx === null) return unreadStep('consent')
  if (rx.status === 'approved') return chainStep('consent', 'done', '已经同意。')
  if (rx.status === 'rejected') return chainStep('consent', 'blocked', '这份处方被退回了。')
  if (rx.status === 'superseded') {
    return rx.approvedAt
      ? chainStep('consent', 'done', '同意过，后来被新版本换掉了。')
      : waitingStep('consent')
  }
  if (prescribe.state !== 'done') return waitingStep('consent')
  return chainStep('consent', 'active', '等内部账号点同意。')
}

function derivePlan(facts: ChainFacts, prescribe: ChainStep): ChainStep {
  const plan = linkedPlan(facts)
  if (plan === 'unread') return unreadStep('plan')
  if (plan === 'no-goal') {
    return prescribe.state === 'waiting'
      ? waitingStep('plan')
      : chainStep('plan', 'blocked', '这份处方没有挂目标，对不上推广计划。')
  }
  if (plan && (plan.status === 'approved' || plan.status === 'completed')) {
    return chainStep('plan', 'done', '推广计划已批准。')
  }
  if (plan) return chainStep('plan', 'active', '推广计划还是草稿。')
  const goalId = facts.prescription.read === 'ok' ? facts.prescription.value?.goalId : null
  const archived = goalId && facts.plans.read === 'ok'
    && facts.plans.value.some((item) => item.goalId === goalId && item.status === 'archived')
  if (archived) return chainStep('plan', 'blocked', '这个目标上的推广计划已归档。')
  if (prescribe.state !== 'done') return waitingStep('plan')
  return chainStep('plan', 'active', '还没有挂在这个目标上的推广计划。')
}

function realDrafts(facts: ChainFacts): DraftFact[] | 'unread' {
  if (facts.drafts.read !== 'ok') return 'unread'
  return facts.drafts.value.filter((row) => row.status !== 'dry_run_logged')
}

function deriveDraft(facts: ChainFacts, creative: ChainStep): ChainStep {
  const rows = realDrafts(facts)
  if (rows === 'unread') return unreadStep('draft')
  if (rows.some((row) => LIVE_DRAFT.has(row.status))) {
    return chainStep('draft', 'done', '广告草稿已经进了审批队列，或已经往下走了。')
  }
  if (rows.some((row) => row.status === 'unknown')) {
    return chainStep('draft', 'blocked', '有一条广告记录的状态读不懂，不能当成没建草稿。')
  }
  if (rows.some((row) => row.status === 'blocked')) {
    return chainStep('draft', 'blocked', '草稿被系统拦住了，还没进审批队列。')
  }
  if (rows.some((row) => row.status === 'failed')) return chainStep('draft', 'blocked', '草稿没建出来。')
  if (rows.some((row) => row.status === 'rejected')) return chainStep('draft', 'blocked', '这份草稿被退回了。')
  if (rows.some((row) => row.status === 'paused')) return chainStep('draft', 'blocked', '广告现在是暂停的。')
  if (creative.state !== 'done') return waitingStep('draft')
  return chainStep('draft', 'active', '还没有广告草稿。')
}

function deriveLaunch(facts: ChainFacts, draft: ChainStep): ChainStep {
  const rows = realDrafts(facts)
  if (rows === 'unread') return unreadStep('launch')
  if (rows.some((row) => row.status === 'active')) return chainStep('launch', 'done', '已经开投。')
  if (rows.some((row) => row.status === 'activating')) return chainStep('launch', 'active', '正在打开。')
  if (rows.some((row) => row.status === 'awaiting_approval')) return chainStep('launch', 'active', '等点开投。')
  if (rows.some((row) => row.status === 'unknown')) {
    return chainStep('launch', 'blocked', '有一条广告记录的状态读不懂，不能当成没开投。')
  }
  if (rows.some((row) => row.status === 'paused')) return chainStep('launch', 'blocked', '广告现在是暂停的。')
  if (draft.state !== 'done') return waitingStep('launch')
  if (rows.some((row) => row.status === 'rejected')) return chainStep('launch', 'blocked', '开投被退回了。')
  return waitingStep('launch')
}

/** Pure. Same facts always produce the same nine steps. Does not read or write. */
export function deriveChainStatus(facts: ChainFacts): ChainStatus {
  const inspected = deriveInspect(facts)
  const prescribe = derivePrescribe(facts)
  const creative = deriveCreative(facts)
  const draft = deriveDraft(facts, creative)
  const steps = [
    inspected.step,
    deriveMeasure(facts),
    deriveConfirm(facts),
    prescribe,
    deriveConsent(facts, prescribe),
    derivePlan(facts, prescribe),
    creative,
    draft,
    deriveLaunch(facts, draft),
  ]
  return { prescriptionId: facts.prescriptionId, steps, snapshotStale: inspected.stale }
}
