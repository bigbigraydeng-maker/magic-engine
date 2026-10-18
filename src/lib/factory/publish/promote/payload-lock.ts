// 流量记录 payload 的「读-改-写」乐观锁(设计稿第 3 节)。
//
// 互斥锁用 payload.promote_rev(uuid 版本号):该表没有 updated_at 列,且工单 updated_at 会被别的写手碰,不适合当锁。
// 每次写入:读 payload → 合并 → 换新 promote_rev → 带旧版本号条件更新 → 命中恰好 1 行才算成功。
// ⚠️ 若以后有别的写手改这行 payload 却不带 promote_rev,会绕过本锁(见 store.casPayload 注释)。

import { asRecord } from './guards'
import type { PromoteAuthorization, PromoteDeps } from './types'

export type MutateResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; reason: 'row_missing' | 'rejected' | 'conflict'; message: string }

/**
 * fn 拿到最新 payload,返回「完整的下一版 payload」(调用方负责在 cur 基础上合并,不得整体覆盖),
 * 或返回字符串表示拒绝(不写库)。命中 0 行 = 被别人抢先 → 重读重试,最多 tries 次。
 */
export async function mutatePayload(
  deps: Pick<PromoteDeps, 'store' | 'uuid'>,
  ref: { id: string; client_id: string },
  fn: (cur: Record<string, unknown>) => Record<string, unknown> | string,
  tries: number,
): Promise<MutateResult> {
  for (let attempt = 0; attempt < tries; attempt++) {
    const row = await deps.store.loadTrafficRow(ref.id, ref.client_id)
    if (!row) return { ok: false, reason: 'row_missing', message: '流量记录不存在' }
    const cur = asRecord(row.payload)
    const next = fn(cur)
    if (typeof next === 'string') return { ok: false, reason: 'rejected', message: next }
    const expected = typeof cur['promote_rev'] === 'string' ? (cur['promote_rev'] as string) : null
    const nextPayload = { ...next, promote_rev: deps.uuid() }
    if (await deps.store.casPayload(ref.id, ref.client_id, expected, nextPayload)) {
      return { ok: true, payload: nextPayload }
    }
  }
  return { ok: false, reason: 'conflict', message: '有别的请求同时在改这条记录' }
}

export function readAuth(payload: Record<string, unknown>): Partial<PromoteAuthorization> {
  return asRecord(payload['promote_authorization']) as Partial<PromoteAuthorization>
}

/** 在 payload 上合并授权回执字段(不动别的字段)。 */
export function withAuth(
  payload: Record<string, unknown>,
  patch: Partial<PromoteAuthorization>,
): Record<string, unknown> {
  return { ...payload, promote_authorization: { ...readAuth(payload), ...patch } }
}

/**
 * request 栅栏:包装 mutatePayload 的合并函数,授权回执里的 attempt_id 不是自己就拒绝(不写库)。
 * 抢占后到收尾期间租约一直保持 claimed,即便租约过期被别人重抢,旧请求的后续写入也会被这里挡住。
 */
export function fenced(
  attemptId: string,
  fn: (cur: Record<string, unknown>) => Record<string, unknown> | string,
): (cur: Record<string, unknown>) => Record<string, unknown> | string {
  return (cur) => (readAuth(cur).attempt_id === attemptId ? fn(cur) : '这条已被另一个请求接管,本次操作中止')
}
