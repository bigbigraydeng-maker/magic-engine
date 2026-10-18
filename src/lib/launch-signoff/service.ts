/**
 * 上线签字 —— 写事件的全部规则（A 级：授权/签字）。
 *
 * 每个函数都：①重读事件流 ②用 deriveState 重新判定 ③校验 ④追加一条事件。
 * 页面传来的任何“状态”都不信；写库的快照以服务端当时重新读到的为准。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Actor } from './auth'
import { verifyEvidence } from './evidence'
import { LaunchSignoffError } from './errors'
import { deriveState } from './state'
import { appendEvent, loadEvents } from './store'
import { CHECKLISTS } from './checklists/ads-agent'
import type { Checklist, ChecklistItem, DerivedState, LaunchEvent, ResultStatus } from './types'

export function currentCommitFromEnv(env: NodeJS.ProcessEnv = process.env): string | null {
  const v = env.RENDER_GIT_COMMIT
  return v && v.length >= 7 ? v : null
}

export function checklistFor(featureKey: string): Checklist {
  const c = CHECKLISTS[featureKey]
  if (!c) throw new LaunchSignoffError('unknown_feature', 404, '没有这个功能的清单')
  return c
}

function itemFor(checklist: Checklist, key: string): ChecklistItem {
  const item = checklist.items.find((i) => i.key === key)
  if (!item) throw new LaunchSignoffError('unknown_item', 400, `清单里没有 ${key}`)
  return item
}

export interface ServiceDeps {
  readonly db: SupabaseClient
  readonly commit: string | null
}

/** 事件太多说明有窗口在刷（表只追加，删不掉）：到顶就停写，别让读在 20000 行上限处永久失败。 */
const MAX_EVENTS_PER_FEATURE = 5000

async function snapshotState(deps: ServiceDeps, checklist: Checklist): Promise<{ state: DerivedState; events: LaunchEvent[] }> {
  const events = await loadEvents(deps.db, checklist.featureKey)
  return { state: deriveState(checklist, events, { currentCommit: deps.commit }), events }
}

/** 写入口用：同上，但事件数到顶就拒写。 */
async function snapshotForWrite(deps: ServiceDeps, checklist: Checklist) {
  const snap = await snapshotState(deps, checklist)
  if (snap.events.length >= MAX_EVENTS_PER_FEATURE) {
    throw new LaunchSignoffError('too_many_events', 409, '这份清单的事件数已到上限，请联系 18 号处理')
  }
  return snap
}

/** 页面和 GET 接口用：读失败就抛（由路由翻译成“读取失败”，绝不显示成“没测”）。 */
export async function readState(deps: ServiceDeps, featureKey: string): Promise<DerivedState> {
  const checklist = checklistFor(featureKey)
  return (await snapshotState(deps, checklist)).state
}

function requireNote(note: string | undefined, what: string): string {
  const n = (note ?? '').trim()
  if (n.length < 5) throw new LaunchSignoffError('note_required', 400, `${what}必须写明原因（至少 5 个字）`)
  return n
}

// ───────────────────────── item_result ─────────────────────────

export interface ItemResultInput {
  readonly featureKey: string
  readonly itemKey: string
  readonly status: ResultStatus
  readonly evidenceRef: Record<string, unknown>
  readonly note?: string
}

export async function submitItemResult(deps: ServiceDeps, actor: Actor, input: ItemResultInput): Promise<LaunchEvent> {
  if (actor.role !== 'executor') {
    throw new LaunchSignoffError('wrong_role', 403, '测试回执只收执行方钥匙；真人账号和复核方都不能写')
  }
  const checklist = checklistFor(input.featureKey)
  const item = itemFor(checklist, input.itemKey)
  if (deps.commit === null) throw new LaunchSignoffError('no_commit', 409, '无法确认线上版本，不能记录回执')
  const { state, events } = await snapshotForWrite(deps, checklist)
  if (state.halted) throw new LaunchSignoffError('locked', 409, '清单已锁定，需带原因解锁')

  let snapshot: Record<string, unknown>
  if (input.status === 'pass') {
    const check = await verifyEvidence(deps.db, checklist, item, input.evidenceRef)
    if (!check.ok) throw new LaunchSignoffError('evidence_rejected', 422, check.reason)
    snapshot = check.snapshot
    if (check.manual) {
      const rec = JSON.stringify(check.snapshot['recordRef'])
      const reused = state.items.some((v) => {
        if (v.key === item.key || !v.manual) return false
        const ev = events.find((e) => e.id === v.resultEventId)
        return JSON.stringify(ev?.evidenceSnapshot?.['recordRef']) === rec
      })
      if (reused) throw new LaunchSignoffError('evidence_reused', 422, '这条记录已经被另一项人工确认用过了，每项要有自己的证据')
    }
    if (item.sameRunAs) {
      const base = state.items.find((i) => i.key === item.sameRunAs)
      const baseEvent = events.find((e) => e.id === base?.resultEventId)
      const baseRun = baseEvent?.evidenceRef?.['runId']
      if (typeof baseRun !== 'string' || baseEvent?.status !== 'pass') {
        throw new LaunchSignoffError('depends_on', 409, `先记录并通过 ${item.sameRunAs}，再记录 ${item.key}`)
      }
      if (input.evidenceRef['runId'] !== baseRun) {
        throw new LaunchSignoffError('different_run', 422, `${item.key} 必须与 ${item.sameRunAs} 是同一条动作记录`)
      }
    }
  } else {
    snapshot = { reported: 'fail' }
  }

  const written = await appendEvent(deps.db, {
    featureKey: checklist.featureKey,
    eventType: 'item_result',
    itemKey: item.key,
    status: input.status,
    evidenceRef: input.evidenceRef,
    evidenceSnapshot: snapshot,
    actor: actor.id,
    actorRole: actor.role,
    commitSha: deps.commit,
    checklistHash: state.checklistHash,
    note: input.note?.trim() || null,
  })

  // 失败即停（T3 等）：锁定由 deriveState 直接从这条失败回执推出，不另写 halt 事件（少一次可能失败的写）。
  return written
}

// ───────────────────────── review ─────────────────────────

export interface ReviewInput {
  readonly featureKey: string
  readonly itemKey: string
  readonly refEventId: number
  readonly status: ResultStatus
  readonly note?: string
}

export async function submitReview(deps: ServiceDeps, actor: Actor, input: ReviewInput): Promise<LaunchEvent> {
  if (actor.role !== 'reviewer') {
    throw new LaunchSignoffError('wrong_role', 403, '复核只收复核方钥匙；真人账号和执行方都不能复核')
  }
  const checklist = checklistFor(input.featureKey)
  itemFor(checklist, input.itemKey)
  const { state, events } = await snapshotForWrite(deps, checklist)
  if (state.halted) throw new LaunchSignoffError('locked', 409, '清单已锁定，需带原因解锁')

  const view = state.items.find((i) => i.key === input.itemKey)
  if (!view || view.resultEventId === null || view.resultEventId !== input.refEventId) {
    throw new LaunchSignoffError('stale_review', 409, '复核的不是这一项最新的测试回执（回执已更新，请刷新）')
  }
  const target = events.find((e) => e.id === input.refEventId)
  if (!target || target.itemKey !== input.itemKey || target.eventType !== 'item_result') {
    throw new LaunchSignoffError('bad_ref', 400, '复核必须指向一条测试回执')
  }
  if (target.actor === actor.id) {
    throw new LaunchSignoffError('self_review', 403, '不能复核自己写的回执')
  }
  if (input.status === 'fail') requireNote(input.note, '退回')

  return appendEvent(deps.db, {
    featureKey: checklist.featureKey,
    eventType: 'review',
    itemKey: input.itemKey,
    status: input.status,
    refEventId: input.refEventId,
    actor: actor.id,
    actorRole: actor.role,
    checklistHash: state.checklistHash,
    note: input.note?.trim() || null,
  })
}

// ───────────────────────── halt / unlock ─────────────────────────

export async function haltChecklist(deps: ServiceDeps, actor: Actor, featureKey: string, note: string): Promise<LaunchEvent> {
  const checklist = checklistFor(featureKey)
  const { state } = await snapshotForWrite(deps, checklist) // halt 也受事件数上限；解锁/撤销豁免，保证总能解开
  return appendEvent(deps.db, {
    featureKey,
    eventType: 'halt',
    actor: actor.id,
    actorRole: actor.role,
    checklistHash: state.checklistHash,
    note: requireNote(note, '锁定'),
  })
}

export async function unlockChecklist(deps: ServiceDeps, actor: Actor, featureKey: string, note: string): Promise<LaunchEvent> {
  // 失败即停的锁只有白名单真人能解 —— AI 窗口（执行方/复核方）不能自己解开自己的锁
  if (!actor.isHuman || !actor.isSigner) {
    throw new LaunchSignoffError('not_signer', 403, '解锁只收白名单里的真人账号')
  }
  const checklist = checklistFor(featureKey)
  const { state } = await snapshotState(deps, checklist)
  if (!state.halted) throw new LaunchSignoffError('not_locked', 409, '清单没有被锁定')
  return appendEvent(deps.db, {
    featureKey,
    eventType: 'unlock',
    actor: actor.id,
    actorRole: actor.role,
    checklistHash: state.checklistHash,
    note: requireNote(note, '解锁'),
  })
}

// ───────────────────────── signature / revoke ─────────────────────────

export interface SignInput {
  readonly featureKey: string
  /** 页面当时看到的事件水位与清单指纹；对不上就拒签 */
  readonly watermark: number
  readonly checklistHash: string
}

export async function signChecklist(deps: ServiceDeps, actor: Actor, input: SignInput): Promise<LaunchEvent> {
  if (!actor.isHuman || !actor.isSigner) {
    throw new LaunchSignoffError('not_signer', 403, '只有白名单里的真人账号能签字')
  }
  const checklist = checklistFor(input.featureKey)
  const { state, events } = await snapshotForWrite(deps, checklist)
  if (state.watermark !== input.watermark || state.checklistHash !== input.checklistHash) {
    throw new LaunchSignoffError('stale_page', 409, '页面已过期（状态在你打开之后变过），请刷新后再看一遍')
  }
  if (!state.signable || deps.commit === null) {
    throw new LaunchSignoffError('not_signable', 409, `现在不能签字：${state.blockers.join('；') || '条件不满足'}`)
  }
  const byId = new Map(events.map((e) => [e.id, e] as const))
  const frozen = state.items.map((i) => ({
    key: i.key,
    resultEventId: i.resultEventId,
    reviewEventId: i.reviewEventId,
    commitSha: i.commitSha,
    manual: i.manual,
    resultActor: byId.get(i.resultEventId ?? -1)?.actor ?? null,
    reviewActor: byId.get(i.reviewEventId ?? -1)?.actor ?? null,
  }))
  const written = await appendEvent(deps.db, {
    featureKey: checklist.featureKey,
    eventType: 'signature',
    actor: actor.id,
    actorRole: 'human',
    commitSha: deps.commit,
    checklistHash: state.checklistHash,
    evidenceSnapshot: { watermark: state.watermark, items: frozen },
  })

  // 补偿校验（检查后使用的缝）：水位校验和写入之间可能有别的窗口抢先写了事件。
  // 重读，用“签字之前的全部事件”再判一次；不可签就当场写一条撤销，并告诉签字人。
  const after = await loadEvents(deps.db, checklist.featureKey)
  const before = deriveState(checklist, after.filter((e) => e.id < written.id), { currentCommit: deps.commit })
  if (!before.signable) {
    await appendEvent(deps.db, {
      featureKey: checklist.featureKey,
      eventType: 'revoke',
      actor: actor.id,
      actorRole: 'human',
      refEventId: written.id,
      checklistHash: state.checklistHash,
      note: '自动撤销：签字写入时发现状态在点击之后变过',
    })
    throw new LaunchSignoffError('raced', 409, '签字的一瞬间状态变了，这次签字已自动撤销，请刷新后重看')
  }
  return written
}

export async function revokeSignature(deps: ServiceDeps, actor: Actor, featureKey: string, note: string): Promise<LaunchEvent> {
  if (!actor.isHuman || !actor.isSigner) {
    throw new LaunchSignoffError('not_signer', 403, '只有白名单里的真人账号能撤销签字')
  }
  const checklist = checklistFor(featureKey)
  const { state } = await snapshotState(deps, checklist)
  if (!state.signature) throw new LaunchSignoffError('no_signature', 409, '当前没有有效的签字可撤销')
  return appendEvent(deps.db, {
    featureKey,
    eventType: 'revoke',
    actor: actor.id,
    actorRole: 'human',
    refEventId: state.signature.eventId,
    checklistHash: state.checklistHash,
    note: requireNote(note, '撤销'),
  })
}
