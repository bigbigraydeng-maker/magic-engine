/**
 * 上线签字 —— 从事件流推出当前状态。纯函数，无 I/O，可完全单测。
 *
 * 规则全部来自设计稿 v0.2（及子牙/魏征对实现的审查）：
 *  · 一项“通过” = 最新的 item_result **且** 有一条**针对这条 item_result 的 id** 的 review=pass，
 *    且复核人 ≠ 执行人；之后再追加新回执，旧复核作废，回到“待复核”。
 *  · halt 之后整份清单“已锁定”，只有 unlock（必带原因）能解开。
 *  · 清单指纹变了：旧的 item_result / review / 签字全部不再算数。
 *  · 能签 = 全通过 + 无 halt + 各项被测提交号一致且等于当前线上提交号（取不到就拒，fail-closed）
 *    + T3–T5 这类声明了 sameRunAs 的项确实用同一条动作记录。
 */

import { checklistHash } from './checklist-hash'
import type {
  Checklist,
  DerivedState,
  ItemStatus,
  ItemView,
  LaunchEvent,
  SignatureView,
} from './types'

export interface DeriveContext {
  /** 当前线上提交号（RENDER_GIT_COMMIT）；取不到传 null → 一律不让签 */
  readonly currentCommit: string | null
}

function runIdOf(event: LaunchEvent | undefined): string | null {
  const v = event?.evidenceRef?.['runId']
  return typeof v === 'string' && v.length > 0 ? v : null
}

function isManual(event: LaunchEvent | undefined): boolean {
  return event?.evidenceSnapshot?.['manual'] === true
}

function gradesOf(fixed: string | undefined, result: LaunchEvent | undefined): string[] {
  const out = fixed ? [fixed] : []
  const extra = result?.evidenceSnapshot?.['grades']
  if (Array.isArray(extra)) for (const g of extra) if (typeof g === 'string' && !out.includes(g)) out.push(g)
  return out
}

function recordLabel(event: LaunchEvent | undefined): string | null {
  const rec = event?.evidenceSnapshot?.['recordRef']
  if (rec && typeof rec === 'object') {
    const r = rec as Record<string, unknown>
    if (typeof r['table'] === 'string' && typeof r['id'] === 'string') return `${r['table']}#${r['id']}`
  }
  return null
}

function latest<T extends LaunchEvent>(events: readonly T[]): T | undefined {
  let best: T | undefined
  for (const e of events) if (best === undefined || e.id > best.id) best = e
  return best
}

export function deriveState(
  checklist: Checklist,
  allEvents: readonly LaunchEvent[],
  ctx: DeriveContext,
): DerivedState {
  const hash = checklistHash(checklist)
  const events = allEvents.filter((e) => e.featureKey === checklist.featureKey)
  const watermark = events.reduce((m, e) => (e.id > m ? e.id : m), 0)

  const current = events.filter((e) => e.checklistHash === hash)

  // —— halt / unlock：halt 不看指纹（保守：锁一旦打上，换了清单也不自动解开）。
  //    另外：当前清单下，haltOnFail 项的失败回执**本身**就锁清单 —— 不依赖第二条 halt 事件一定写成功。
  const haltOnFailKeys = new Set(checklist.items.filter((i) => i.haltOnFail).map((i) => i.key))
  let halted = false
  let haltNote: string | null = null
  for (const e of [...events].sort((a, b) => a.id - b.id)) {
    if (e.eventType === 'halt') {
      halted = true
      haltNote = e.note
    } else if (
      e.eventType === 'item_result' &&
      e.status === 'fail' &&
      e.itemKey !== null &&
      haltOnFailKeys.has(e.itemKey) &&
      e.checklistHash === hash
    ) {
      halted = true
      haltNote = `${e.itemKey} 失败，按规则停止，不得重试`
    } else if (e.eventType === 'unlock') {
      halted = false
      haltNote = null
    }
  }

  // —— 每一项
  const items: ItemView[] = checklist.items.map((def) => {
    // 已知例外：状态固定“没测/未验证”，不接受任何回执（也忽略库里意外出现的事件）
    if (def.exception) {
      return {
        key: def.key,
        status: 'untested' as ItemStatus,
        resultEventId: null,
        reviewEventId: null,
        commitSha: null,
        manual: false,
        grades: def.grade ? [def.grade] : [],
        isException: true,
        exceptionLabel: def.exception.label,
        manualDescription: null,
        manualRecord: null,
        resultNote: null,
        reviewNote: null,
        resultActor: null,
        reviewActor: null,
        at: null,
      }
    }
    // 回执只认执行方钥匙写的、复核只认复核方钥匙写的（第二道防线，服务层也强制）
    const results = current.filter(
      (e) => e.eventType === 'item_result' && e.itemKey === def.key && e.actorRole === 'executor',
    )
    const result = latest(results)
    const reviews = result
      ? current.filter(
          (e) =>
            e.eventType === 'review' &&
            e.itemKey === def.key &&
            e.refEventId === result.id &&
            e.actorRole === 'reviewer' &&
            e.actor !== result.actor, // 自己复核自己不算
        )
      : []
    const review = latest(reviews)

    let status: ItemStatus
    if (!result) status = 'untested'
    else if (result.status === 'fail') status = 'failed'
    else if (!review) status = 'pending_review'
    else status = review.status === 'pass' ? 'passed' : 'failed'
    if (halted) status = 'locked'

    return {
      key: def.key,
      status,
      resultEventId: result?.id ?? null,
      reviewEventId: review?.id ?? null,
      commitSha: result?.commitSha ?? null,
      manual: isManual(result),
      grades: gradesOf(def.grade, result),
      isException: false,
      exceptionLabel: null,
      manualDescription: isManual(result) && typeof result?.evidenceSnapshot?.['description'] === 'string' ? String(result.evidenceSnapshot['description']) : null,
      manualRecord: isManual(result) ? recordLabel(result) : null,
      resultNote: result?.note ?? null,
      reviewNote: review?.note ?? null,
      resultActor: result?.actor ?? null,
      reviewActor: review?.actor ?? null,
      at: (review ?? result)?.createdAt ?? null,
    }
  })

  // —— 签字：最新一条未被撤销的 signature
  const revokedIds = new Set(
    events.filter((e) => e.eventType === 'revoke' && e.refEventId !== null).map((e) => e.refEventId),
  )
  const activeSignature = latest(
    events.filter((e) => e.eventType === 'signature' && !revokedIds.has(e.id)),
  )
  let signature: SignatureView | null = null
  if (activeSignature) {
    let invalidReason: string | null = null
    const changedAfter = events.some(
      (e) =>
        e.id > activeSignature.id &&
        (e.eventType === 'item_result' || e.eventType === 'review' || e.eventType === 'halt' || e.eventType === 'unlock'),
    )
    if (activeSignature.checklistHash !== hash) invalidReason = '清单判据在签字之后改过，签字作废'
    else if (halted) invalidReason = '清单已被锁定，签字不再有效'
    else if (
      !deriveState(
        checklist,
        events.filter((e) => e.id < activeSignature.id),
        { currentCommit: activeSignature.commitSha },
      ).signable
    ) {
      // 补偿撤销写失败时的兜底：用“签字之前的事件”再判一次当时是否真的可签
      invalidReason = '签字时的测试状态并不满足可签条件'
    }
    else if (changedAfter) invalidReason = '签字之后又有新的测试回执/复核/锁定，需要重新确认后再签'
    else if (ctx.currentCommit === null) invalidReason = '无法确认线上版本'
    else if (activeSignature.commitSha !== ctx.currentCommit) invalidReason = '签字之后线上代码又变过'
    signature = {
      eventId: activeSignature.id,
      signedBy: activeSignature.actor,
      signedAt: activeSignature.createdAt,
      commitSha: activeSignature.commitSha ?? '',
      valid: invalidReason === null,
      invalidReason,
    }
  }

  // —— 能不能签 + 差什么
  const blockers: string[] = []
  const required = items.filter((i) => !i.isException)
  const names = (pick: (i: ItemView) => boolean): string => required.filter(pick).map((i) => i.key).join('、')

  if (halted) blockers.push(`清单已锁定（${haltNote ?? '已触发停止条件'}），需带原因解锁后重新复核`)
  const untested = names((i) => i.status === 'untested')
  if (untested) blockers.push(`没测：${untested}`)
  const pending = names((i) => i.status === 'pending_review')
  if (pending) blockers.push(`待 18 号复核：${pending}`)
  const failed = names((i) => i.status === 'failed')
  if (failed) blockers.push(`失败：${failed}`)

  // 同一条动作（T4/T5 必须与 T3 同一个 run id）
  const resultOf = (key: string): LaunchEvent | undefined =>
    current.find((e) => e.id === items.find((i) => i.key === key)?.resultEventId)
  for (const def of checklist.items) {
    if (!def.sameRunAs) continue
    const mine = runIdOf(resultOf(def.key))
    const base = runIdOf(resultOf(def.sameRunAs))
    if (mine !== null && base !== null && mine !== base) {
      blockers.push(`${def.key} 与 ${def.sameRunAs} 不是同一条动作记录`)
    }
  }

  // 提交号：各项被测提交号必须一致，且等于当前线上提交号（V1 取严：宁可多复核一次，不放过）
  const commits = new Set(items.map((i) => i.commitSha).filter((c): c is string => c !== null))
  if (ctx.currentCommit === null) {
    blockers.push('无法确认线上版本（取不到当前提交号）')
  } else if (commits.size > 1) {
    blockers.push('各项不是在同一版代码上测的，需执行方在当前版本上重新记录回执并复核')
  } else if (commits.size === 1 && !commits.has(ctx.currentCommit)) {
    blockers.push('测完之后线上代码又变过，需执行方在当前版本上重新记录回执并复核')
  }

  if (signature?.valid) blockers.push('已签字')

  const signable = blockers.length === 0 && required.every((i) => i.status === 'passed')
  const exceptions = checklist.items
    .filter((i) => i.exception)
    .map((i) => ({ key: i.key, title: i.title, label: i.exception?.label ?? '', reason: i.exception?.reason ?? '' }))

  return {
    featureKey: checklist.featureKey,
    checklistHash: hash,
    watermark,
    halted,
    haltNote,
    items,
    exceptions,
    signable,
    blockers,
    signature,
    currentCommit: ctx.currentCommit,
  }
}
