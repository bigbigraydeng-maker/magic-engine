import { describe, it, expect } from 'vitest'
import { validatePageChange } from '../validate'
import type {
  PageDiffResult,
  PageOptimizationIntent,
  PageOptimizationRequest,
  ProviderCheckInput,
  RedlineCheckInput,
} from '../types'

const OK_INTENTS: readonly PageOptimizationIntent[] = [
  { field: 'meta_title', proposedValue: 'New Title', semanticIntent: { known: false, reason: 'not_applicable' } },
]

function baseRequest(
  doNotTouch: PageOptimizationRequest['constraints']['doNotTouch'] = [],
  intents: readonly PageOptimizationIntent[] = OK_INTENTS,
): PageOptimizationRequest {
  return {
    clientId: 'client-1',
    page: { url: 'https://romanhu.com/listings/123' },
    intents,
    lineage: { findingRefs: ['finding-1'] },
    verification: {
      metricRef: 'geo.owned_page_citation',
      windowDays: 14,
      baseline: 'previous_measurement',
      criteria: { success: 'citation increases', failure: 'citation unchanged or drops', indeterminate: 'not_comparable' },
    },
    constraints: { doNotTouch },
    basedOnVersion: { known: false, reason: 'not_recorded_by_source' },
  }
}

const OK_DIFF: PageDiffResult = {
  ok: true,
  changes: [{ field: 'meta_title', before: 'Old Title', after: 'New Title', changed: true }],
}

const AVAILABLE_NO_REDLINES: RedlineCheckInput = { available: true, phrases: [] }
const PASSED_PROVIDER_CHECK: ProviderCheckInput = { evaluated: true, passed: true }

describe('validatePageChange · doNotTouch', () => {
  it('改动命中 doNotTouch 字段 → 拒绝', () => {
    const result = validatePageChange(baseRequest(['meta_title']), OK_DIFF, AVAILABLE_NO_REDLINES, PASSED_PROVIDER_CHECK)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.violations.some((v) => v.includes('meta_title'))).toBe(true)
  })

  it('doNotTouch 里的字段没被真的改动（changed=false）→ 不算违规', () => {
    const unchangedDiff: PageDiffResult = {
      ok: true,
      changes: [{ field: 'meta_title', before: 'Same', after: 'Same', changed: false }],
    }
    const unchangedIntents: readonly PageOptimizationIntent[] = [
      { field: 'meta_title', proposedValue: 'Same', semanticIntent: { known: false, reason: 'not_applicable' } },
    ]
    const result = validatePageChange(
      baseRequest(['meta_title'], unchangedIntents),
      unchangedDiff,
      AVAILABLE_NO_REDLINES,
      PASSED_PROVIDER_CHECK,
    )
    expect(result.ok).toBe(true)
  })
})

describe('validatePageChange · 红线短语命中', () => {
  it('改动后的值命中红线短语（大小写不敏感子串）→ 拒绝', () => {
    const redline: RedlineCheckInput = { available: true, phrases: ['since 1928'] }
    const diff: PageDiffResult = {
      ok: true,
      changes: [{ field: 'meta_title', before: 'Old', after: 'Auckland Since 1928', changed: true }],
    }
    const intents: readonly PageOptimizationIntent[] = [
      { field: 'meta_title', proposedValue: 'Auckland Since 1928', semanticIntent: { known: false, reason: 'not_applicable' } },
    ]
    const result = validatePageChange(baseRequest([], intents), diff, redline, PASSED_PROVIDER_CHECK)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.violations.some((v) => v.includes('since 1928'))).toBe(true)
  })

  it('没命中任何红线短语 → 不因此被拒', () => {
    const redline: RedlineCheckInput = { available: true, phrases: ['forbidden phrase'] }
    const result = validatePageChange(baseRequest(), OK_DIFF, redline, PASSED_PROVIDER_CHECK)
    expect(result.ok).toBe(true)
  })
})

describe('validatePageChange · 红线状态缺失必须 fail closed', () => {
  it('红线查询失败 → 拒绝，不当成"没有红线"', () => {
    const redline: RedlineCheckInput = { available: false, reason: '红线查询失败' }
    const result = validatePageChange(baseRequest(), OK_DIFF, redline, PASSED_PROVIDER_CHECK)
    expect(result.ok).toBe(false)
  })
})

describe('validatePageChange · provider 校验未评估不能算通过', () => {
  it('provider 校验没跑过（evaluated:false）→ 拒绝，不能被表示成通过', () => {
    const providerCheck: ProviderCheckInput = { evaluated: false, reason: '还没来得及跑 provider 侧校验' }
    const result = validatePageChange(baseRequest(), OK_DIFF, AVAILABLE_NO_REDLINES, providerCheck)
    expect(result.ok).toBe(false)
  })

  it('provider 校验跑过但没通过 → 拒绝，携带 provider 给出的理由', () => {
    const providerCheck: ProviderCheckInput = { evaluated: true, passed: false, violations: ['Yoast meta 字段不可写'] }
    const result = validatePageChange(baseRequest(), OK_DIFF, AVAILABLE_NO_REDLINES, providerCheck)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.violations).toContain('Yoast meta 字段不可写')
  })

  it('provider 校验判定失败但 violations 是空数组 → 仍然拒绝，不能被空数组兜底成通过', () => {
    // 回归用例：passed:false + violations:[] 曾经能一路走到
    // `violations.length === 0` 那句兜底判断，被误判成 ok:true——
    // 这正是把「明确失败」表示成「成功」（2026-08-11 Build Control Room 复审）。
    const providerCheck: ProviderCheckInput = { evaluated: true, passed: false, violations: [] }
    const result = validatePageChange(baseRequest(), OK_DIFF, AVAILABLE_NO_REDLINES, providerCheck)
    expect(result.ok).toBe(false)
  })
})

describe('validatePageChange · providerCheck 运行时必须是合法形状（不能靠类型系统兜底）', () => {
  it('passed:true 却带着 violations（自相矛盾的畸形对象）→ fail closed', () => {
    const malformed = { evaluated: true, passed: true, violations: ['实际失败'] } as unknown as ProviderCheckInput
    const result = validatePageChange(baseRequest(), OK_DIFF, AVAILABLE_NO_REDLINES, malformed)
    expect(result.ok).toBe(false)
  })

  it('passed:false 却没带 violations → fail closed', () => {
    const malformed = { evaluated: true, passed: false } as unknown as ProviderCheckInput
    const result = validatePageChange(baseRequest(), OK_DIFF, AVAILABLE_NO_REDLINES, malformed)
    expect(result.ok).toBe(false)
  })

  it('evaluated:false 却缺 reason → fail closed', () => {
    const malformed = { evaluated: false } as unknown as ProviderCheckInput
    const result = validatePageChange(baseRequest(), OK_DIFF, AVAILABLE_NO_REDLINES, malformed)
    expect(result.ok).toBe(false)
  })

  it('完全不是对象（比如 null）→ fail closed', () => {
    const malformed = null as unknown as ProviderCheckInput
    const result = validatePageChange(baseRequest(), OK_DIFF, AVAILABLE_NO_REDLINES, malformed)
    expect(result.ok).toBe(false)
  })
})

describe('validatePageChange · diff 必须绑定到这份 request，不能被错配', () => {
  it('diff 覆盖的字段跟 request 意图的字段对不上 → 拒绝（不是"没命中红线就算过"）', () => {
    // request 想改 meta_title，diff 却是另一次调用产出的 meta_description —— 典型接线错误。
    const mismatchedDiff: PageDiffResult = {
      ok: true,
      changes: [{ field: 'meta_description', before: 'Old desc', after: 'New desc', changed: true }],
    }
    const result = validatePageChange(baseRequest(), mismatchedDiff, AVAILABLE_NO_REDLINES, PASSED_PROVIDER_CHECK)
    expect(result.ok).toBe(false)
  })

  it('diff.after 跟 request 里的 proposedValue 不一致 → 拒绝', () => {
    const tamperedDiff: PageDiffResult = {
      ok: true,
      changes: [{ field: 'meta_title', before: 'Old Title', after: '被篡改的值', changed: true }],
    }
    const result = validatePageChange(baseRequest(), tamperedDiff, AVAILABLE_NO_REDLINES, PASSED_PROVIDER_CHECK)
    expect(result.ok).toBe(false)
  })

  it('changed 标记跟 before/after 对不上 → 拒绝', () => {
    const inconsistentDiff: PageDiffResult = {
      ok: true,
      changes: [{ field: 'meta_title', before: 'New Title', after: 'New Title', changed: true }],
    }
    const result = validatePageChange(baseRequest(), inconsistentDiff, AVAILABLE_NO_REDLINES, PASSED_PROVIDER_CHECK)
    expect(result.ok).toBe(false)
  })

  it('diff 里同一字段出现不止一次 → 拒绝', () => {
    const duplicatedDiff: PageDiffResult = {
      ok: true,
      changes: [
        { field: 'meta_title', before: 'Old Title', after: 'New Title', changed: true },
        { field: 'meta_title', before: 'Old Title', after: 'Another Title', changed: true },
      ],
    }
    const result = validatePageChange(baseRequest(), duplicatedDiff, AVAILABLE_NO_REDLINES, PASSED_PROVIDER_CHECK)
    expect(result.ok).toBe(false)
  })

  it('diff 字段不在 v1 冻结集合内 → 拒绝', () => {
    const bogusDiff = {
      ok: true,
      changes: [{ field: 'slug', before: 'a', after: 'b', changed: true }],
    } as unknown as PageDiffResult
    const result = validatePageChange(baseRequest(), bogusDiff, AVAILABLE_NO_REDLINES, PASSED_PROVIDER_CHECK)
    expect(result.ok).toBe(false)
  })
})

describe('validatePageChange · diff 不可用时诚实失败', () => {
  it('diff 是失败态 → validate 直接失败，不假装校验过', () => {
    const result = validatePageChange(baseRequest(), { ok: false, reason: 'diff 失败' }, AVAILABLE_NO_REDLINES, PASSED_PROVIDER_CHECK)
    expect(result.ok).toBe(false)
  })
})

describe('validatePageChange · 全部通过', () => {
  it('绑定一致、没有违规、红线可用且未命中、provider 校验通过 → 通过', () => {
    const result = validatePageChange(baseRequest(), OK_DIFF, AVAILABLE_NO_REDLINES, PASSED_PROVIDER_CHECK)
    expect(result.ok).toBe(true)
  })
})

describe('validatePageChange · 结果 JSON-safe（无损往返）', () => {
  it('ok:true 结果能无损 JSON 往返', () => {
    const result = validatePageChange(baseRequest(), OK_DIFF, AVAILABLE_NO_REDLINES, PASSED_PROVIDER_CHECK)
    expect(JSON.parse(JSON.stringify(result))).toEqual(result)
  })

  it('ok:false 结果（带 violations）能无损 JSON 往返', () => {
    const result = validatePageChange(baseRequest(['meta_title']), OK_DIFF, AVAILABLE_NO_REDLINES, PASSED_PROVIDER_CHECK)
    expect(result.ok).toBe(false)
    expect(JSON.parse(JSON.stringify(result))).toEqual(result)
  })
})
