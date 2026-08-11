/**
 * validate —— 两层校验，都在这里汇合（Issue #878 / WP06）。
 *
 * 🔴 不查 Supabase。红线短语由调用方作为 `RedlineCheckInput` 显式传入；
 *    provider 侧校验结果由调用方作为 `ProviderCheckInput` 显式传入（或用纯
 *    函数算好再传）——本文件零 provider 客户端 import。
 * 🔴 红线短语缺失 / 查询失败必须 fail closed，绝不能被当成「没有红线」——
 *    与 `src/lib/factory/strategist.ts` 的 `gate1` 同一语义（「查不到红线 ≠
 *    没有红线」），同样大小写不敏感子串匹配。
 * 🔴 provider 校验「没算过」不许被表示成「通过」——`evaluated:false` 直接判
 *    不通过，不是默认放行。
 *
 * 🔴 2026-08-11 Build Control Room PATCH REQUIRED 复审补的两条：
 *    1. `providerCheck` 就算类型收紧成三态判别式联合，仍要在运行时防跨 JSON
 *       边界的畸形对象（例如硬转出来的 `{evaluated:true,passed:true,
 *       violations:[...]}`）——形状不对就 fail closed，不许当成合法值处理。
 *    2. `diff` 必须先证明它确实是"这份 request 的 diff"，再谈校验内容——
 *       否则把 A 请求的 request 和 B 请求的 diff 传进来，只要 B 没撞红线/
 *       约束，这里会诚实地返回 `ok:true`，而那是一次接线错误，不是真的通过。
 */

import { PAGE_OPTIMIZATION_FIELDS } from './types'
import type {
  PageDiffResult,
  PageFieldDiff,
  PageOptimizationField,
  PageOptimizationRequest,
  PageValidationResult,
  ProviderCheckInput,
  RedlineCheckInput,
} from './types'

const FROZEN_FIELDS: readonly string[] = PAGE_OPTIMIZATION_FIELDS

function sameStringSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const sorted = [...b].sort()
  return [...a].sort().every((value, i) => value === sorted[i])
}

/**
 * `ProviderCheckInput` 是三选一判别式联合——但判别式联合只在编译期挡人为
 * 输错，挡不住跨 JSON 边界的畸形对象（`as unknown as ProviderCheckInput`
 * 一转就绕过去了）。运行时按精确 key 白名单逐态核对，多一个字段
 * （典型例子：`passed:true` 却带着 `violations`）就判非法。
 */
function isValidProviderCheckInput(value: unknown): value is ProviderCheckInput {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  const keys = Object.keys(v)

  if (v.evaluated === false) {
    return typeof v.reason === 'string' && sameStringSet(keys, ['evaluated', 'reason'])
  }
  if (v.evaluated === true) {
    if (v.passed === true) {
      return sameStringSet(keys, ['evaluated', 'passed'])
    }
    if (v.passed === false) {
      return (
        sameStringSet(keys, ['evaluated', 'passed', 'violations']) &&
        Array.isArray(v.violations) &&
        v.violations.every((item) => typeof item === 'string')
      )
    }
    return false
  }
  return false
}

/**
 * diff 必须先证明自己是这份 request 的 diff，再谈内容校验——四条缺一不可：
 *   · diff 字段只能是 v1 冻结的三个字段之一，且不重复；
 *   · `changed` 必须等于 `before !== after`（不是随便标的）；
 *   · diff 覆盖的字段集合必须跟 request.intents 的字段集合完全一致；
 *   · 每条 diff.after 必须等于对应 intent 的 proposedValue。
 * 任何一条不成立，都当成接线错误处理——不猜、不放行。
 */
function verifyDiffMatchesRequest(
  request: PageOptimizationRequest,
  changes: readonly PageFieldDiff[],
): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  const seenDiffFields = new Set<PageOptimizationField>()
  for (const change of changes) {
    if (!FROZEN_FIELDS.includes(change.field)) {
      return { ok: false, reason: `diff 字段 "${change.field}" 不在 v1 冻结字段集合内` }
    }
    if (seenDiffFields.has(change.field)) {
      return { ok: false, reason: `diff 里字段 "${change.field}" 出现了不止一次` }
    }
    seenDiffFields.add(change.field)
    if (change.changed !== (change.before !== change.after)) {
      return { ok: false, reason: `字段 "${change.field}" 的 changed 标记跟 before/after 对不上` }
    }
  }

  const intentByField = new Map<PageOptimizationField, string>()
  for (const intent of request.intents) {
    if (!FROZEN_FIELDS.includes(intent.field)) {
      return { ok: false, reason: `请求里字段 "${intent.field}" 不在 v1 冻结字段集合内` }
    }
    if (intentByField.has(intent.field)) {
      return { ok: false, reason: `请求里字段 "${intent.field}" 出现了不止一次意图` }
    }
    intentByField.set(intent.field, intent.proposedValue)
  }

  if (!sameStringSet(Array.from(seenDiffFields), Array.from(intentByField.keys()))) {
    return {
      ok: false,
      reason: 'diff 覆盖的字段集合跟请求意图的字段集合对不上——请求和 diff 可能被错配了',
    }
  }

  for (const change of changes) {
    if (intentByField.get(change.field) !== change.after) {
      return {
        ok: false,
        reason: `字段 "${change.field}" 的 diff.after 跟请求里的 proposedValue 对不上——请求和 diff 可能被错配了`,
      }
    }
  }

  return { ok: true }
}

export function validatePageChange(
  request: PageOptimizationRequest,
  diff: PageDiffResult,
  redline: RedlineCheckInput,
  providerCheck: ProviderCheckInput,
): PageValidationResult {
  if (!diff.ok) {
    return { ok: false, reason: `diff 不可用：${diff.reason}`, violations: [] }
  }

  const binding = verifyDiffMatchesRequest(request, diff.changes)
  if (!binding.ok) {
    return { ok: false, reason: binding.reason, violations: [] }
  }

  if (!isValidProviderCheckInput(providerCheck)) {
    return {
      ok: false,
      reason: 'provider 侧校验结果形状不合法（跨 JSON 边界的畸形对象）——按 fail-closed 处理',
      violations: [],
    }
  }

  const violations: string[] = []

  for (const change of diff.changes) {
    if (!change.changed) continue
    if (request.constraints.doNotTouch.includes(change.field)) {
      violations.push(`字段 "${change.field}" 在 doNotTouch 名单内，不许改动`)
    }
  }

  if (!redline.available) {
    return {
      ok: false,
      reason: `客户红线短语不可用：${redline.reason}——按 fail-closed 原则一律拒绝，不当成"没有红线"`,
      violations,
    }
  }

  const changedSurface = diff.changes
    .filter((c) => c.changed)
    .map((c) => c.after)
    .join(' | ')
    .toLowerCase()
  for (const phrase of redline.phrases) {
    const needle = phrase.trim().toLowerCase()
    if (needle && changedSurface.includes(needle)) {
      violations.push(`命中客户红线短语："${phrase}"`)
    }
  }

  if (!providerCheck.evaluated) {
    return {
      ok: false,
      reason: `provider 侧校验未执行：${providerCheck.reason}——没算过不能算通过`,
      violations,
    }
  }
  if (!providerCheck.passed) {
    // 🔴 无论 providerCheck.violations 是不是空数组，passed:false 本身就是
    // 明确的失败结论——绝不能因为「这次没列出具体违规」就被后面的
    // `violations.length === 0` 兜底成 ok:true（2026-08-11 Build Control Room
    // 复审：这仍然是把「明确失败」表示成「成功」）。
    return {
      ok: false,
      reason: 'provider 侧校验判定失败',
      violations: [...violations, ...providerCheck.violations],
    }
  }

  return violations.length === 0 ? { ok: true } : { ok: false, reason: '校验未通过', violations }
}
