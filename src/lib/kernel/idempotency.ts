/**
 * 幂等键的计算。
 *
 * 🔴 幂等键必须在**提交时**就能算出来，因为唯一约束建在 action_runs 上
 *    （`UNIQUE (client_id, idempotency_key)`）。所以 keyFields 只能引用
 *    input 里已经存在的字段，不能引用执行中才产生的东西。
 *    这条约束会反向逼着调用方在提交前把「这次到底要处理哪一份东西」说清楚
 *    —— 那正是我们想要的：模糊的提交没有幂等性可言。
 */

import { createHash } from 'crypto'
import type { ActionDefinition } from './types'
import { KernelError } from './errors'

/** 稳定序列化：对象键排序，保证同样的内容永远得到同一个字符串。 */
function canonical(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/**
 * 按定义声明的 keyFields 算幂等键。
 *
 * 缺字段直接抛错，不悄悄用 undefined 参与计算 ——
 * 那样两条其实不同的提交会算出同一把键，重复执行会被误判成幂等命中。
 */
export function computeIdempotencyKey(
  definition: ActionDefinition,
  clientId: string,
  input: Record<string, unknown>,
): string {
  const parts: string[] = []
  for (const field of definition.idempotency.keyFields) {
    const v = input[field]
    if (v === undefined || v === null || v === '') {
      throw new KernelError(
        'INVALID_INPUT',
        `算不出幂等键：这个动作声明了要按「${field}」去重，但提交时这个字段是空的`,
        { detail: { actionKey: definition.actionKey, field } },
      )
    }
    parts.push(`${field}=${canonical(v)}`)
  }

  const scopePrefix =
    definition.idempotency.scope === 'client' ? `client:${clientId}` : 'global'

  const digest = createHash('sha256')
    .update(`${scopePrefix}|${definition.actionKey}|v${definition.version}|${parts.join('|')}`)
    .digest('hex')
    .slice(0, 32)

  // 前缀留可读性：查库时一眼看得出是哪个动作的键
  return `${definition.actionKey}:${digest}`
}

/** 给未知动作用的兜底键 —— 它进不了执行，但也必须有稳定身份才不会天天新增一条 deny。 */
export function computeUnknownActionKey(
  actionKey: string,
  clientId: string,
  input: Record<string, unknown>,
): string {
  const digest = createHash('sha256')
    .update(`client:${clientId}|unknown|${actionKey}|${canonical(input)}`)
    .digest('hex')
    .slice(0, 32)
  return `unknown:${actionKey}:${digest}`
}

export { canonical as canonicalJson }
