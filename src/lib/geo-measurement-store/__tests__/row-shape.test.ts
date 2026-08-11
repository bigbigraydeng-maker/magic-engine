/**
 * 行形状 ↔ WP02 冻结契约的一致性（Issue #875）。
 *
 * 🔴 判据不是「两边看起来很像」，而是：**把一行库记录投影成契约对象之后，
 *    WP02 自己的校验器认不认。** 校验器是 WP02 冻结的那一份，不另写一套。
 *
 * 🔴 这里的投影函数**故意只活在测试里**。WP03 不交付 store，也不交付
 *    生产用的 mapper —— 一个能读能写的层离「跑真实测量」只差一步，
 *    那是 WP04 的边界。这里要证明的只有一件事：库里存得下、且存得住。
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'
import {
  validateGeoObservation,
  validateGeoEvidence,
  type GeoMaybeUnknown,
  type GeoObservation,
  type GeoEvidence,
  type GeoCitation,
  type GeoUnknownReason,
} from '@/lib/geo-measurement'
import type {
  GeoBatchStatusColumn,
  GeoEvidenceRow,
  GeoObservationRow,
  GeoQueryRow,
  GeoQuerySetRow,
} from '../types'

// ── 投影助手 ─────────────────────────────────────────────────────────────────

/**
 * 一对 `<field>` / `<field>_unknown_reason` 列 → `GeoMaybeUnknown<T>`。
 *
 * 🔴 两列都空、或两列都非空，都是**非法行**（库层 num_nonnulls(...)=1 拦着）。
 *    这里显式抛错而不是挑一个默认值 —— 悄悄挑一个默认值正是这份契约要防的事。
 */
function fromColumns<T>(value: T | null, reason: GeoUnknownReason | null): GeoMaybeUnknown<T> {
  if (value !== null && reason !== null) {
    throw new Error('非法行：已知值与未知理由同时存在')
  }
  if (value === null && reason === null) {
    throw new Error('非法行：既没有已知值也没有未知理由')
  }
  return value !== null ? { known: true, value } : { known: false, reason: reason as GeoUnknownReason }
}

function rowToGeoObservation(row: GeoObservationRow): GeoObservation {
  return {
    observationId: row.id,
    batchId: row.batch_id,
    acquisition: {
      querySetVersion: fromColumns(row.query_set_version, row.query_set_version_unknown_reason),
      queryKey: fromColumns(row.query_key, row.query_key_unknown_reason),
      engineFamily: fromColumns(row.engine_family, row.engine_family_unknown_reason),
      modelVersion: fromColumns(row.model_version, row.model_version_unknown_reason),
      locale: fromColumns(row.locale, row.locale_unknown_reason),
      market: fromColumns(row.market, row.market_unknown_reason),
      sample: {
        samplePlan:
          row.sample_planned_count !== null
            ? { known: true, value: { plannedCount: row.sample_planned_count } }
            : { known: false, reason: row.sample_planned_count_unknown_reason as GeoUnknownReason },
        sampleIndex: fromColumns(row.sample_index, row.sample_index_unknown_reason),
        samplingParameters:
          row.sampling_parameters !== null
            ? { known: true, value: row.sampling_parameters as { [k: string]: never } }
            : { known: false, reason: row.sampling_parameters_unknown_reason as GeoUnknownReason },
      },
    },
    interpretation: {
      parserVersion: fromColumns(row.parser_version, row.parser_version_unknown_reason),
      metricRulesVersion: fromColumns(row.metric_rules_version, row.metric_rules_version_unknown_reason),
    },
    confidence: fromColumns(row.confidence, row.confidence_unknown_reason),
    observedAt: row.observed_at,
    outcome: row.outcome_ok
      ? // 🔴 evidenceId 在库里是「证据行反过来指着观测」，不是观测上存一份 id。
        // 只有一条边，就不存在两处对不上的可能。这里由调用方把查到的证据 id 传进来。
        { ok: true, evidenceId: 'evidence-looked-up-by-observation-id' }
      : {
          ok: false,
          errorCode: row.error_code as string,
          errorMessage: fromColumns(row.error_message, row.error_message_unknown_reason),
        },
  }
}

function rowToGeoEvidence(row: GeoEvidenceRow): GeoEvidence {
  return {
    evidenceId: row.id,
    observationId: row.observation_id,
    rawResponseLocator: fromColumns(row.raw_response_locator, row.raw_response_unknown_reason),
    citations: row.citations as readonly GeoCitation[],
  }
}

// ── 样本行 ───────────────────────────────────────────────────────────────────

const FULLY_KNOWN_OBSERVATION: GeoObservationRow = {
  id: '11111111-1111-4111-8111-111111111111',
  client_id: '19e025b7-555b-44fd-ba87-debc62a447a7',
  batch_id: '22222222-2222-4222-8222-222222222222',
  query_set_version: 'roman-v1',
  query_set_version_unknown_reason: null,
  query_key: 'best-agent-mission-bay',
  query_key_unknown_reason: null,
  engine_family: 'openai',
  engine_family_unknown_reason: null,
  model_version: 'gpt-4o-mini-2024-07-18',
  model_version_unknown_reason: null,
  locale: 'en-NZ',
  locale_unknown_reason: null,
  market: 'NZ',
  market_unknown_reason: null,
  sample_planned_count: 3,
  sample_planned_count_unknown_reason: null,
  sample_index: 0,
  sample_index_unknown_reason: null,
  sampling_parameters: { temperature: 0 },
  sampling_parameters_unknown_reason: null,
  parser_version: 'geo-parser-v1',
  parser_version_unknown_reason: null,
  metric_rules_version: 'geo-rules-v1',
  metric_rules_version_unknown_reason: null,
  confidence: 0.91,
  confidence_unknown_reason: null,
  observed_at: '2026-08-11T02:00:00.000Z',
  outcome_ok: true,
  error_code: null,
  error_message: null,
  error_message_unknown_reason: null,
  source_observation_id: null,
  created_at: '2026-08-11T02:00:01.000Z',
}

describe('观测行 → GeoObservation', () => {
  it('全维度已知的行，WP02 校验器直接认', () => {
    const result = validateGeoObservation(rowToGeoObservation(FULLY_KNOWN_OBSERVATION))
    expect(result).toEqual({ ok: true })
  })

  it('七项采集身份 + 三层 sample 一项不少', () => {
    const observation = rowToGeoObservation(FULLY_KNOWN_OBSERVATION)
    expect(Object.keys(observation.acquisition).sort()).toEqual(
      ['engineFamily', 'locale', 'market', 'modelVersion', 'queryKey', 'querySetVersion', 'sample'].sort(),
    )
    expect(Object.keys(observation.acquisition.sample).sort()).toEqual(
      ['samplePlan', 'sampleIndex', 'samplingParameters'].sort(),
    )
  })

  it('未知维度投影成带理由的「不知道」，不是 null、不是 0、不是省略', () => {
    const row: GeoObservationRow = {
      ...FULLY_KNOWN_OBSERVATION,
      market: null,
      market_unknown_reason: 'not_recorded_by_source',
      sample_index: null,
      sample_index_unknown_reason: 'not_recorded_by_source',
      confidence: null,
      confidence_unknown_reason: 'not_applicable',
    }
    const observation = rowToGeoObservation(row)

    expect(observation.acquisition.market).toEqual({
      known: false,
      reason: 'not_recorded_by_source',
    })
    // 🔴 这一条是重点：0 是一个合法的样本序号。把「不知道第几次」压成 0
    //    会让两条根本不可比的观测看起来是同一次复本。
    expect(observation.acquisition.sample.sampleIndex).not.toEqual({ known: true, value: 0 })
    expect(observation.acquisition.sample.sampleIndex).toEqual({
      known: false,
      reason: 'not_recorded_by_source',
    })
    expect(observation.confidence).toEqual({ known: false, reason: 'not_applicable' })
    expect(validateGeoObservation(observation)).toEqual({ ok: true })
  })

  it('样本序号 0 与「样本序号未知」是两件事，不许互相塌陷', () => {
    const zero = rowToGeoObservation({ ...FULLY_KNOWN_OBSERVATION, sample_index: 0 })
    const unknown = rowToGeoObservation({
      ...FULLY_KNOWN_OBSERVATION,
      sample_index: null,
      sample_index_unknown_reason: 'source_ambiguous',
    })
    expect(zero.acquisition.sample.sampleIndex).toEqual({ known: true, value: 0 })
    expect(unknown.acquisition.sample.sampleIndex).toEqual({
      known: false,
      reason: 'source_ambiguous',
    })
    expect(zero.acquisition.sample.sampleIndex).not.toEqual(unknown.acquisition.sample.sampleIndex)
  })

  it('失败观测照样是一条合法观测（不落行会让「问了但失败」和「根本没问」长得一样）', () => {
    const failed: GeoObservationRow = {
      ...FULLY_KNOWN_OBSERVATION,
      outcome_ok: false,
      error_code: 'provider_timeout',
      error_message: 'upstream timed out after 30s',
      error_message_unknown_reason: null,
    }
    const observation = rowToGeoObservation(failed)
    expect(observation.outcome).toEqual({
      ok: false,
      errorCode: 'provider_timeout',
      errorMessage: { known: true, value: 'upstream timed out after 30s' },
    })
    expect(validateGeoObservation(observation)).toEqual({ ok: true })
  })

  it('失败观测的错误消息也可以诚实地记未知', () => {
    const observation = rowToGeoObservation({
      ...FULLY_KNOWN_OBSERVATION,
      outcome_ok: false,
      error_code: 'unknown_provider_error',
      error_message: null,
      error_message_unknown_reason: 'not_recorded_by_source',
    })
    expect(validateGeoObservation(observation)).toEqual({ ok: true })
  })

  it('两列都空的行是非法的 —— 投影时当场抛错，不悄悄挑个默认值', () => {
    expect(() =>
      rowToGeoObservation({
        ...FULLY_KNOWN_OBSERVATION,
        market: null,
        market_unknown_reason: null,
      }),
    ).toThrow(/既没有已知值也没有未知理由/)
  })

  it('重新解析的观测带着来源血缘，且来源不是自己', () => {
    const reinterpreted: GeoObservationRow = {
      ...FULLY_KNOWN_OBSERVATION,
      id: '33333333-3333-4333-8333-333333333333',
      batch_id: '44444444-4444-4444-8444-444444444444',
      parser_version: 'geo-parser-v2',
      source_observation_id: FULLY_KNOWN_OBSERVATION.id,
    }
    // 重新解析 = 新批次 + 新观测，原观测一个字不动
    expect(reinterpreted.batch_id).not.toBe(FULLY_KNOWN_OBSERVATION.batch_id)
    expect(reinterpreted.id).not.toBe(FULLY_KNOWN_OBSERVATION.id)
    expect(reinterpreted.source_observation_id).toBe(FULLY_KNOWN_OBSERVATION.id)
    expect(reinterpreted.source_observation_id).not.toBe(reinterpreted.id)
    expect(validateGeoObservation(rowToGeoObservation(reinterpreted))).toEqual({ ok: true })
  })

  it('正常采集的观测没有来源血缘', () => {
    expect(FULLY_KNOWN_OBSERVATION.source_observation_id).toBeNull()
  })
})

describe('证据行 → GeoEvidence', () => {
  const EVIDENCE: GeoEvidenceRow = {
    id: '55555555-5555-4555-8555-555555555555',
    client_id: FULLY_KNOWN_OBSERVATION.client_id,
    observation_id: FULLY_KNOWN_OBSERVATION.id,
    raw_response: '{"answer":"..."}',
    raw_response_unknown_reason: null,
    raw_response_locator:
      'db://public.geo_evidence/55555555-5555-4555-8555-555555555555/raw_response',
    citations: [],
    created_at: '2026-08-11T02:00:02.000Z',
  }

  it('原始响应在场时，定位符指向这一行自己', () => {
    const evidence = rowToGeoEvidence(EVIDENCE)
    expect(evidence.rawResponseLocator).toEqual({
      known: true,
      value: `db://public.geo_evidence/${EVIDENCE.id}/raw_response`,
    })
    expect(validateGeoEvidence(evidence)).toEqual({ ok: true })
  })

  it('原始响应记未知时，定位符是诚实的「不知道」，不是一个指向空气的地址', () => {
    const evidence = rowToGeoEvidence({
      ...EVIDENCE,
      raw_response: null,
      raw_response_unknown_reason: 'not_recorded_by_source',
      raw_response_locator: null,
    })
    expect(evidence.rawResponseLocator).toEqual({
      known: false,
      reason: 'not_recorded_by_source',
    })
    expect(validateGeoEvidence(evidence)).toEqual({ ok: true })
  })

  it('域名归属与页面关联是两档，分别独立地保留原状', () => {
    const citations: GeoCitation[] = [
      {
        url: 'https://romanhu.com/listings/30-kiteroa',
        domain: 'romanhu.com',
        ownedDomain: { known: true, value: true },
        ownedPage: { status: 'associated', pageRef: 'page-30-kiteroa' },
      },
      {
        url: 'https://example.co.nz/blog/agents',
        domain: 'example.co.nz',
        ownedDomain: { known: true, value: false },
        ownedPage: { status: 'not_associated' },
      },
      {
        // 🔴 Roman 没有页面台账时的诚实结论。
        url: 'https://romanhu.com/about',
        domain: 'romanhu.com',
        ownedDomain: { known: false, reason: 'not_recorded_by_source' },
        ownedPage: {
          status: 'not_computable',
          reason: 'no canonical page inventory for this client',
        },
      },
    ]
    const evidence = rowToGeoEvidence({ ...EVIDENCE, citations })
    expect(validateGeoEvidence(evidence)).toEqual({ ok: true })

    const [owned, external, notComputable] = evidence.citations
    expect(owned.ownedPage).toEqual({ status: 'associated', pageRef: 'page-30-kiteroa' })
    expect(external.ownedPage).toEqual({ status: 'not_associated' })

    // 🔴 「算不出来」绝不能塌陷成 0 / false / 缺字段 —— 报 0 会被读成
    //    「一次都没被引用」，那是一个不同的、而且是错的事实（GEO 契约 §5 冻结第 3 条）。
    expect(notComputable.ownedPage).toEqual({
      status: 'not_computable',
      reason: 'no canonical page inventory for this client',
    })
    expect(notComputable.ownedPage).not.toEqual({ status: 'not_associated' })
    expect(notComputable.ownedDomain).toEqual({
      known: false,
      reason: 'not_recorded_by_source',
    })
    expect(notComputable.ownedDomain).not.toEqual({ known: true, value: false })
  })

  it('失败的观测不该有证据行（库层由 BEFORE INSERT 触发器挡）', () => {
    const failed = rowToGeoObservation({
      ...FULLY_KNOWN_OBSERVATION,
      outcome_ok: false,
      error_code: 'provider_timeout',
      error_message: 'upstream timed out after 30s',
      error_message_unknown_reason: null,
    })
    // 🔴 冻结契约里，失败那一支**结构上就没有 evidenceId** ——
    //    库里若真挂上一条证据，这一行就投影不出合法的契约对象了。
    expect(failed.outcome.ok).toBe(false)
    expect('evidenceId' in failed.outcome).toBe(false)
  })

  it('证据与观测之间只有一条边：证据指向观测', () => {
    expect(rowToGeoEvidence(EVIDENCE).observationId).toBe(FULLY_KNOWN_OBSERVATION.id)
    // 观测行上没有 evidence_id 列 —— 少一个能跟事实对不上的地方
    expect('evidence_id' in FULLY_KNOWN_OBSERVATION).toBe(false)
  })
})

describe('批次状态与查询集：库与契约不许分家', () => {
  it('状态列的类型就是 WP02 冻结的那个联合', () => {
    const statuses: GeoBatchStatusColumn[] = ['completed', 'partial', 'failed']
    expect(statuses).toHaveLength(3)
  })

  it("存储层没有偷偷加 'running'", () => {
    // @ts-expect-error 'running' 不在 WP02 冻结的 GeoBatch['status'] 联合里。
    // 这一行如果**没有**类型错误，说明有人把在途状态塞进了证据表。
    const notAStatus: GeoBatchStatusColumn = 'running'
    expect(notAStatus).toBe('running')
  })

  it('查询集的 locked_at 只有两种读法，且映射是钉死的', () => {
    // 🔴 WP02 的 GeoQuerySet.lockedAt 是 GeoMaybeUnknown<string>（三态），
    //    而库里是一个普通的可空 timestamptz —— 存储比契约**窄**。
    //    这是刻意的：上锁与否是我们自己掌握的事实，不存在「不知道锁没锁」。
    //    窄下来的代价是映射必须钉死，否则 NULL 到底读成哪一种「未知」就成了各写各的。
    const toLockedAt = (row: GeoQuerySetRow): GeoMaybeUnknown<string> =>
      row.locked_at !== null
        ? { known: true, value: row.locked_at }
        : { known: false, reason: 'not_applicable' }

    const unlocked: GeoQuerySetRow = {
      id: '88888888-8888-4888-8888-888888888888',
      client_id: FULLY_KNOWN_OBSERVATION.client_id,
      query_set_version: 'roman-v1',
      locked_at: null,
      created_by: 'fde@magicengine.com.au',
      created_at: '2026-08-11T01:00:00.000Z',
    }
    const locked: GeoQuerySetRow = { ...unlocked, locked_at: '2026-08-11T02:00:00.000Z' }

    expect(toLockedAt(unlocked)).toEqual({ known: false, reason: 'not_applicable' })
    expect(toLockedAt(locked)).toEqual({ known: true, value: '2026-08-11T02:00:00.000Z' })
    // 「还没锁」不是「来源没记」——后者会暗示我们本该知道却丢了
    expect(toLockedAt(unlocked)).not.toEqual({ known: false, reason: 'not_recorded_by_source' })
  })

  it('geo_queries 行自带 client_id（子表不靠父表间接说明自己属于谁）', () => {
    const query: GeoQueryRow = {
      id: '66666666-6666-4666-8666-666666666666',
      client_id: FULLY_KNOWN_OBSERVATION.client_id,
      query_set_id: '77777777-7777-4777-8777-777777777777',
      query_key: 'best-agent-mission-bay',
      question_text: 'Who is the best real estate agent in Mission Bay?',
      locale: 'en-NZ',
      locale_unknown_reason: null,
      market: 'NZ',
      market_unknown_reason: null,
      is_active: true,
      created_at: '2026-08-11T01:00:00.000Z',
    }
    expect(query.client_id).toBe(FULLY_KNOWN_OBSERVATION.client_id)
  })
})

// ── 覆盖率计数的语义（与库层 CHECK 对齐）─────────────────────────────────────

/**
 * 🔴 WP02 没有 GeoCoverageDescriptor 的校验器（validators.ts 只导出五个，都不管它），
 *    所以这两张表的覆盖率字段**只有这里和库层 CHECK 在守**。
 *    这些断言把库里的判据在 TypeScript 侧写一遍，两边分家时能当场看出来。
 */
describe('覆盖率计数：计数就得是计数', () => {
  const isCount = (v: unknown): boolean =>
    typeof v === 'number' && Number.isInteger(v) && v >= 0

  const countsAddUp = (c: { attempted: number; succeeded: number; failed: number }): boolean =>
    c.attempted === c.succeeded + c.failed

  it('三个计数必须是非负整数 —— 负数 / 小数都不算数', () => {
    expect(isCount(0)).toBe(true)
    expect(isCount(12)).toBe(true)
    expect(isCount(-9)).toBe(false)
    expect(isCount(1.5)).toBe(false)
    expect(isCount(Number.NaN)).toBe(false)
  })

  it('实际覆盖：尝试 = 成功 + 失败', () => {
    expect(countsAddUp({ attempted: 12, succeeded: 10, failed: 2 })).toBe(true)
    expect(countsAddUp({ attempted: 12, succeeded: 10, failed: 1 })).toBe(false)
  })

  it('🔴 两条判据缺一不可：复审举的那条反例，加总其实是对的', () => {
    const codexExample = { attempted: 1, succeeded: 10, failed: -9 }
    // 10 + (-9) = 1 —— 等式成立，**加总这条判据根本拦不住它**。
    expect(countsAddUp(codexExample)).toBe(true)
    // 真正拦住它的是「计数必须是非负整数」那一条。
    expect(isCount(codexExample.failed)).toBe(false)
    expect(
      [codexExample.attempted, codexExample.succeeded, codexExample.failed].every(isCount),
      '只加一条加总约束会漏掉这个形状；只加非负整数约束又漏掉 10+1≠12 那种。两条都要。',
    ).toBe(false)
  })

  it('部分完成是一等结论：失败不为零照样是一条合法的实际覆盖', () => {
    const partial = { attempted: 10, succeeded: 7, failed: 3 }
    expect(countsAddUp(partial)).toBe(true)
    expect([partial.attempted, partial.succeeded, partial.failed].every(isCount)).toBe(true)
  })

  it('🔴 这条等式不适用于计划覆盖 —— 计划里 succeeded / failed 就是 0', () => {
    const planned = { attempted: 100, succeeded: 0, failed: 0 }
    expect([planned.attempted, planned.succeeded, planned.failed].every(isCount)).toBe(true)
    expect(
      countsAddUp(planned),
      '计划覆盖在下单那一刻还没跑，等式本来就不成立 —— ' +
        '库层的 add_up 约束只挂在 actual 上，挂到 planned 上会拦下每一次合法的计划。',
    ).toBe(false)
  })
})

// ── 模块边界 ─────────────────────────────────────────────────────────────────

/**
 * 🔴 为什么这一节必须存在：WP02 的纯度守卫只扫 `src/lib/geo-measurement/`
 *    （那个文件里写死了目录），所以**同级新目录 `geo-measurement-store/`
 *    一行都不会被它检查**。契约层是干净的，不等于挨着它的新目录也是干净的。
 */
describe('模块边界：契约层与存储层各自待在自己那边', () => {
  const ROOT = process.cwd()
  const STORE_DIR = join(ROOT, 'src/lib/geo-measurement-store')
  const CONTRACT_DIR = join(ROOT, 'src/lib/geo-measurement')

  function productionFiles(dir: string): string[] {
    const out: string[] = []
    const walk = (d: string): void => {
      for (const entry of readdirSync(d)) {
        const full = join(d, entry)
        if (statSync(full).isDirectory()) walk(full)
        else if (entry.endsWith('.ts')) out.push(full)
      }
    }
    walk(dir)
    return out
      .map((f) => relative(ROOT, f).split('\\').join('/'))
      .filter((f) => !f.includes('/__tests__/') && !f.endsWith('.test.ts'))
  }

  const STORE_FILES = productionFiles(STORE_DIR)
  const CONTRACT_FILES = productionFiles(CONTRACT_DIR)

  it('两边都真的扫到了文件（判据不许因为路径写错而空跑）', () => {
    expect(STORE_FILES.length).toBeGreaterThan(0)
    expect(CONTRACT_FILES.length).toBeGreaterThan(0)
  })

  it('纯契约层不许反过来 import 存储层', () => {
    const violations = CONTRACT_FILES.filter((f) =>
      readFileSync(join(ROOT, f), 'utf8').includes('geo-measurement-store'),
    )
    expect(
      violations,
      'WP02 是纯类型与纯函数，反向依赖存储层会把它拖下水。\n' + violations.join('\n'),
    ).toEqual([])
  })

  it('存储层 v1 只有行形状：不碰数据库客户端、不碰执行内核', () => {
    const forbidden = [
      '@/lib/supabase',
      '@supabase/supabase-js',
      'supabaseAdmin',
      '@/lib/kernel',
      '@/lib/execution',
      '@/lib/capabilities',
      'action_runs',
      'execution_items',
    ]
    const violations: string[] = []
    for (const file of STORE_FILES) {
      const src = readFileSync(join(ROOT, file), 'utf8')
      for (const symbol of forbidden) {
        if (src.includes(symbol)) violations.push(`${file} → ${symbol}`)
      }
    }
    expect(
      violations,
      'WP03 交付 migration + 行形状，**不交付能读能写的 store** ——\n' +
        '一个能插能读的层离「跑真实测量」只差一步，那是 WP04 的边界。\n' +
        violations.join('\n'),
    ).toEqual([])
  })

  it('存储层没有导出任何写入 / 变更语义的函数', () => {
    const mutators: string[] = []
    for (const file of STORE_FILES) {
      const src = readFileSync(join(ROOT, file), 'utf8')
      const matches = Array.from(
        src.matchAll(
          /export\s+(?:async\s+)?function\s+(insert|update|upsert|delete|save|persist|write|create)[A-Z]\w*/g,
        ),
      )
      for (const m of matches) {
        mutators.push(`${file} → ${m[1]}`)
      }
    }
    expect(mutators, '不可变存储的写入方是 WP04，不是 WP03。\n' + mutators.join('\n')).toEqual([])
  })

  it('存储层没有 any', () => {
    const violations = STORE_FILES.filter((f) =>
      /:\s*any\b|<any>|as\s+any\b/.test(readFileSync(join(ROOT, f), 'utf8')),
    )
    expect(violations, 'CLAUDE.md 铁律 7：TypeScript strict，无 any。\n' + violations.join('\n')).toEqual(
      [],
    )
  })
})
