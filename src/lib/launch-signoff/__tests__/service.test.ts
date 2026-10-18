import { describe, expect, it } from 'vitest'
import type { Actor } from '../auth'
import { ADS_AGENT_CHECKLIST, ADS_AGENT_FEATURE_KEY } from '../checklists/ads-agent'
import { checklistHash } from '../checklist-hash'
import { LaunchSignoffError } from '../errors'
import {
  haltChecklist,
  readState,
  revokeSignature,
  signChecklist,
  submitItemResult,
  submitReview,
  unlockChecklist,
  type ServiceDeps,
} from '../service'
import { ALLOW_DECISION_ID, DECISION_ID, DECISION_ID_2, NARRATIVE_ID, OTHER_RUN_ID, ROUND_OLD, RUN_ID, fakeProd, healthyProdTables } from './helpers'

const FEATURE = ADS_AGENT_FEATURE_KEY
const COMMIT = 'abc1234def5678'
const executor: Actor = { id: 'key:executor', role: 'executor', isHuman: false, isSigner: false }
const reviewer: Actor = { id: 'key:reviewer', role: 'reviewer', isHuman: false, isSigner: false }
const pm: Actor = { id: 'pm@example.com', role: 'human', isHuman: true, isSigner: true }
const otherAdmin: Actor = { id: 'admin@example.com', role: 'human', isHuman: true, isSigner: false }

const evidence = {
  T1: { insightDate: '2026-10-20' },
  T2: { description: '2026-10-20 ad_health_narratives 该行判断为 hit，不是 not_comparable', recordRef: { table: 'ad_health_narratives', id: NARRATIVE_ID } },
  T3: { runId: RUN_ID },
  T4: { runId: RUN_ID },
  T5: { runId: RUN_ID },
  T6: { description: '2026-10-21 被拒绝，拒绝原因文本含「距上次设置变动只过了 3 小时，不足 72 小时」', recordRef: { table: 'authorization_decisions', id: DECISION_ID } },
  T7: { description: '2026-10-21 加预算请求被拒，原因：超过客户总闸 100 纽币，可在 O1 页面看到', recordRef: { table: 'authorization_decisions', id: DECISION_ID_2 } },
} as const

function setup(commit: string | null = COMMIT) {
  const prod = fakeProd(healthyProdTables())
  const deps: ServiceDeps = { db: prod.db, commit }
  return { prod, deps }
}

async function recordAll(deps: ServiceDeps, only?: string[]) {
  const written: Record<string, number> = {}
  for (const item of ADS_AGENT_CHECKLIST.items) {
    if (only && !only.includes(item.key)) continue
    const ev = await submitItemResult(deps, executor, {
      featureKey: FEATURE, itemKey: item.key, status: 'pass', evidenceRef: { ...evidence[item.key as keyof typeof evidence] },
    })
    written[item.key] = ev.id
  }
  return written
}

async function reviewAll(deps: ServiceDeps, written: Record<string, number>) {
  for (const [key, id] of Object.entries(written)) {
    await submitReview(deps, reviewer, { featureKey: FEATURE, itemKey: key, refEventId: id, status: 'pass' })
  }
}

const reject = async (p: Promise<unknown>): Promise<LaunchSignoffError> => {
  const err = await p.then(() => null, (e: unknown) => e)
  expect(err).toBeInstanceOf(LaunchSignoffError)
  return err as LaunchSignoffError
}

describe('happy path', () => {
  it('everything tested + reviewed by someone else + same commit => signable, and the signature freezes ids', async () => {
    const { deps } = setup()
    const written = await recordAll(deps)
    await reviewAll(deps, written)
    const state = await readState(deps, FEATURE)
    expect(state.items.every((i) => i.status === 'passed')).toBe(true)
    expect(state.signable).toBe(true)
    expect(state.items.find((i) => i.key === 'T2')?.manual).toBe(true) // machine-unverifiable items are flagged

    const sig = await signChecklist(deps, pm, { featureKey: FEATURE, watermark: state.watermark, checklistHash: state.checklistHash })
    expect(sig.actor).toBe('pm@example.com')
    expect(sig.commitSha).toBe(COMMIT)
    const after = await readState(deps, FEATURE)
    expect(after.signature?.valid).toBe(true)
    expect(after.signable).toBe(false) // already signed
    expect(JSON.stringify(sig.evidenceSnapshot)).toContain('resultEventId')
  })

  it('the signature goes stale when production moves to another commit', async () => {
    const { deps } = setup()
    const written = await recordAll(deps)
    await reviewAll(deps, written)
    const s = await readState(deps, FEATURE)
    await signChecklist(deps, pm, { featureKey: FEATURE, watermark: s.watermark, checklistHash: s.checklistHash })
    const later = await readState({ ...deps, commit: 'zzz9999zzz9999' }, FEATURE)
    expect(later.signature?.valid).toBe(false)
    expect(later.signature?.invalidReason).toContain('线上代码又变过')
  })
})

describe('who may do what', () => {
  it('results only from the executor key, reviews only from the reviewer key; humans can do neither', async () => {
    const { deps } = setup()
    const input = { featureKey: FEATURE, itemKey: 'T1', status: 'pass' as const, evidenceRef: { ...evidence.T1 } }
    for (const who of [reviewer, pm, otherAdmin]) {
      expect((await reject(submitItemResult(deps, who, input))).code).toBe('wrong_role')
    }
    const ev = await submitItemResult(deps, executor, input)
    for (const who of [executor, pm, otherAdmin]) {
      expect((await reject(submitReview(deps, who, { featureKey: FEATURE, itemKey: 'T1', refEventId: ev.id, status: 'pass' }))).code).toBe('wrong_role')
    }
  })

  it('two windows with the same key cannot review each other (same actor id)', async () => {
    const { deps } = setup()
    const ev = await submitItemResult(deps, { ...executor, role: 'executor' }, { featureKey: FEATURE, itemKey: 'T1', status: 'pass', evidenceRef: { ...evidence.T1 } })
    // a reviewer key that somehow carries the same actor id as the executor is still refused
    const clone: Actor = { ...reviewer, id: executor.id }
    expect((await reject(submitReview(deps, clone, { featureKey: FEATURE, itemKey: 'T1', refEventId: ev.id, status: 'pass' }))).code).toBe('self_review')
  })

  it('only a whitelisted human session can sign or revoke; keys and other admins cannot', async () => {
    const { deps } = setup()
    const written = await recordAll(deps)
    await reviewAll(deps, written)
    const s = await readState(deps, FEATURE)
    const input = { featureKey: FEATURE, watermark: s.watermark, checklistHash: s.checklistHash }
    for (const who of [executor, reviewer, otherAdmin]) {
      expect((await reject(signChecklist(deps, who, input))).code).toBe('not_signer')
    }
    await signChecklist(deps, pm, input)
    expect((await reject(revokeSignature(deps, otherAdmin, FEATURE, '不应该成功'))).code).toBe('not_signer')
    await revokeSignature(deps, pm, FEATURE, '发现 T3 选错了系列')
    expect((await readState(deps, FEATURE)).signature).toBeNull()
  })

  it('a stale page (state changed after it was rendered) is refused', async () => {
    const { deps } = setup()
    const written = await recordAll(deps)
    await reviewAll(deps, written)
    const s = await readState(deps, FEATURE)
    await haltChecklist(deps, reviewer, FEATURE, '复核发现异常，先锁住')
    expect((await reject(signChecklist(deps, pm, { featureKey: FEATURE, watermark: s.watermark, checklistHash: s.checklistHash }))).code).toBe('stale_page')
  })

  it('a signature stops being valid when anything is recorded or locked after it', async () => {
    const { deps } = setup()
    const written = await recordAll(deps)
    await reviewAll(deps, written)
    const s = await readState(deps, FEATURE)
    await signChecklist(deps, pm, { featureKey: FEATURE, watermark: s.watermark, checklistHash: s.checklistHash })
    await haltChecklist(deps, reviewer, FEATURE, '签字之后发现异常，先锁住')
    const after = await readState(deps, FEATURE)
    expect(after.signature?.valid).toBe(false)
    expect(after.signature?.invalidReason).toContain('锁定')
  })
})

describe('review must point at the latest result', () => {
  it('a newer result voids the older review and a review of the old one is refused', async () => {
    const { deps } = setup()
    const first = await submitItemResult(deps, executor, { featureKey: FEATURE, itemKey: 'T1', status: 'pass', evidenceRef: { ...evidence.T1 } })
    await submitReview(deps, reviewer, { featureKey: FEATURE, itemKey: 'T1', refEventId: first.id, status: 'pass' })
    expect((await readState(deps, FEATURE)).items[0]?.status).toBe('passed')
    const second = await submitItemResult(deps, executor, { featureKey: FEATURE, itemKey: 'T1', status: 'pass', evidenceRef: { ...evidence.T1 } })
    expect((await readState(deps, FEATURE)).items[0]?.status).toBe('pending_review')
    expect((await reject(submitReview(deps, reviewer, { featureKey: FEATURE, itemKey: 'T1', refEventId: first.id, status: 'pass' }))).code).toBe('stale_review')
    await submitReview(deps, reviewer, { featureKey: FEATURE, itemKey: 'T1', refEventId: second.id, status: 'pass' })
    expect((await readState(deps, FEATURE)).items[0]?.status).toBe('passed')
  })
})

describe('evidence is read back from production', () => {
  it('refuses a "pass" whose record does not exist', async () => {
    const { deps } = setup()
    const err = await reject(submitItemResult(deps, executor, { featureKey: FEATURE, itemKey: 'T1', status: 'pass', evidenceRef: { insightDate: '2026-10-18' } }))
    expect(err.code).toBe('evidence_rejected')
  })

  it('T4 and T5 must use the same run id as T3', async () => {
    const { deps } = setup()
    await submitItemResult(deps, executor, { featureKey: FEATURE, itemKey: 'T3', status: 'pass', evidenceRef: { ...evidence.T3 } })
    const err = await reject(submitItemResult(deps, executor, { featureKey: FEATURE, itemKey: 'T4', status: 'pass', evidenceRef: { runId: OTHER_RUN_ID } }))
    expect(['different_run', 'evidence_rejected']).toContain(err.code)
  })

  it('T4 before T3 is refused (depends on the same action)', async () => {
    const { deps } = setup()
    expect((await reject(submitItemResult(deps, executor, { featureKey: FEATURE, itemKey: 'T4', status: 'pass', evidenceRef: { ...evidence.T4 } }))).code).toBe('depends_on')
  })

  it('a manual-confirm item needs a real description AND a record that exists, is the target client\'s and is from this round', async () => {
    const { deps, prod } = setup()
    const base = { featureKey: FEATURE, itemKey: 'T6', status: 'pass' as const }
    expect((await reject(submitItemResult(deps, executor, { ...base, evidenceRef: { description: '过了' } }))).code).toBe('evidence_rejected')
    expect((await reject(submitItemResult(deps, executor, { ...base, evidenceRef: { description: evidence.T6.description } }))).code).toBe('evidence_rejected') // no recordRef
    expect((await reject(submitItemResult(deps, executor, { ...base, evidenceRef: { ...evidence.T6, recordRef: { table: 'clients', id: DECISION_ID } } }))).code).toBe('evidence_rejected') // table not allowed
    for (const row of prod.data['authorization_decisions'] ?? []) row['created_at'] = ROUND_OLD
    expect((await reject(submitItemResult(deps, executor, { ...base, evidenceRef: { ...evidence.T6 } }))).code).toBe('evidence_rejected') // older than the round
  })

  it('manual evidence is tied to its own item: right table, not an "allow", not reused', async () => {
    const { deps } = setup()
    const base = { featureKey: FEATURE, status: 'pass' as const }
    // T7 must come from authorization_decisions, not from the health narratives
    expect((await reject(submitItemResult(deps, executor, { ...base, itemKey: 'T7', evidenceRef: { ...evidence.T2 } }))).code).toBe('evidence_rejected')
    // an "allow" decision is not a refusal
    expect((await reject(submitItemResult(deps, executor, { ...base, itemKey: 'T6', evidenceRef: { ...evidence.T6, recordRef: { table: 'authorization_decisions', id: ALLOW_DECISION_ID } } }))).code).toBe('evidence_rejected')
    await submitItemResult(deps, executor, { ...base, itemKey: 'T6', evidenceRef: { ...evidence.T6 } })
    // the same decision cannot back a second item
    expect((await reject(submitItemResult(deps, executor, { ...base, itemKey: 'T7', evidenceRef: { ...evidence.T7, recordRef: evidence.T6.recordRef } }))).code).toBe('evidence_reused')
  })

  it('evidence must be the right row: old rows, other clients and a failed readback are refused', async () => {
    const { deps, prod } = setup()
    const t3 = { featureKey: FEATURE, itemKey: 'T3', status: 'pass' as const }
    expect((await reject(submitItemResult(deps, executor, { ...t3, evidenceRef: { runId: OTHER_RUN_ID } }))).code).toBe('evidence_rejected') // another client's run
    for (const row of prod.data['action_runs'] ?? []) if (row['id'] === RUN_ID) row['finished_at'] = ROUND_OLD
    expect((await reject(submitItemResult(deps, executor, { ...t3, evidenceRef: { runId: RUN_ID } }))).code).toBe('evidence_rejected') // before the round
    for (const row of prod.data['action_runs'] ?? []) if (row['id'] === RUN_ID) row['finished_at'] = '2026-10-20T03:00:00Z'
    await submitItemResult(deps, executor, { ...t3, evidenceRef: { runId: RUN_ID } })
    for (const row of prod.data['action_run_steps'] ?? []) row['verification'] = { passed: false }
    expect((await reject(submitItemResult(deps, executor, { featureKey: FEATURE, itemKey: 'T4', status: 'pass', evidenceRef: { runId: RUN_ID } }))).code).toBe('evidence_rejected')
  })

  it('an unknown commit (cannot tell what is live) fails closed', async () => {
    const { deps } = setup(null)
    expect((await reject(submitItemResult(deps, executor, { featureKey: FEATURE, itemKey: 'T1', status: 'pass', evidenceRef: { ...evidence.T1 } }))).code).toBe('no_commit')
    const state = await readState(deps, FEATURE)
    expect(state.signable).toBe(false)
    expect(state.blockers.join()).toContain('无法确认线上版本')
  })
})

describe('halt on failure', () => {
  it('a failed T3 locks the whole list; nothing can be recorded until someone unlocks it with a reason', async () => {
    const { deps } = setup()
    await submitItemResult(deps, executor, { featureKey: FEATURE, itemKey: 'T3', status: 'fail', evidenceRef: { note: 'x' }, note: '误动了别的系列' })
    const locked = await readState(deps, FEATURE)
    expect(locked.halted).toBe(true)
    expect(locked.items.every((i) => i.status === 'locked')).toBe(true)
    expect((await reject(submitItemResult(deps, executor, { featureKey: FEATURE, itemKey: 'T3', status: 'pass', evidenceRef: { ...evidence.T3 } }))).code).toBe('locked')
    for (const who of [executor, reviewer, otherAdmin]) {
      expect((await reject(unlockChecklist(deps, who, FEATURE, '想重试一次试试，换个目标'))).code).toBe('not_signer')
    }
    expect((await reject(unlockChecklist(deps, pm, FEATURE, '短'))).code).toBe('note_required')
    await unlockChecklist(deps, pm, FEATURE, '已查明原因：选错了目标系列，重新选目标')
    expect((await readState(deps, FEATURE)).halted).toBe(false)
  })
})

describe('the lock does not depend on a second write', () => {
  it('a failed T3 locks the list even if the extra halt event never gets written', async () => {
    const { deps, prod } = setup()
    await submitItemResult(deps, executor, { featureKey: FEATURE, itemKey: 'T3', status: 'fail', evidenceRef: { note: 'x' }, note: '误动' })
    prod.data['launch_signoff_events'] = (prod.data['launch_signoff_events'] ?? []).filter((r) => r['event_type'] !== 'halt')
    expect((await readState(deps, FEATURE)).halted).toBe(true)
  })
})

describe('checklist changes void earlier work', () => {
  it('results recorded under another checklist fingerprint do not count', async () => {
    const { deps, prod } = setup()
    await submitItemResult(deps, executor, { featureKey: FEATURE, itemKey: 'T1', status: 'pass', evidenceRef: { ...evidence.T1 } })
    for (const row of prod.data['launch_signoff_events'] ?? []) row['checklist_hash'] = 'f'.repeat(64) // as if the criteria text changed later
    const state = await readState(deps, FEATURE)
    expect(state.items[0]?.status).toBe('untested')
    expect(checklistHash(ADS_AGENT_CHECKLIST)).not.toBe('f'.repeat(64))
  })
})
