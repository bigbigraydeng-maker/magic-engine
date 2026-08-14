/**
 * 计划核心的组装（Issue #930 · #960）。
 *
 * 🔴 #960 之后这一层**只负责机器候选**：人工决策已经移出去了（`ReviewSubmission`），
 *    `planHash` 也没了（身份由 L1 信封的 `generationDigest` 承担）。
 *    所以这里测的是「机器会不会生成错」，不再是「篡改能不能被发现」——
 *    后者归 `envelope.test.ts` 与 `adversary.test.ts`。
 */

import { describe, expect, it } from 'vitest'
import { assertCoreIntact, buildInventoryPlan, countMachineCandidates, InventoryPlanError } from '../plan'
import { INVENTORY_PLAN_CONTRACT_VERSION, NORMALIZATION_RULE_VERSION } from '../types'
import type { GeneratedPlanCore } from '../types'
import { CLIENT, discoveryFor, makeCore } from './fixtures'

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn()
  } catch (err) {
    expect(err, `抛的不是 InventoryPlanError：${String(err)}`).toBeInstanceOf(InventoryPlanError)
    expect((err as InventoryPlanError).code).toBe(code)
    return
  }
  throw new Error(`本该抛 ${code}，结果一点事都没有`)
}

describe('计划组装', () => {
  it('🔴 刚生成时一条 accepted 都没有 —— 合规候选一律 pending', () => {
    const core = makeCore(['https://example.com/a', 'https://example.com/b'])
    expect(core.counts).toMatchObject({ discovered: 2, pending: 2, rejected: 0 })
    expect(core.candidates.every((c) => c.machineDecision === 'pending')).toBe(true)
    // 🔴 `accepted` 根本不在 MachineDecision 里 —— 「发现即接受」在类型层就没有入口。
    expect(Object.keys(core.counts).sort()).toEqual(['discovered', 'pending', 'rejected'])
  })

  it('带上契约版本与规则版本', () => {
    const core = makeCore(['https://example.com/a'])
    expect(core.contractVersion).toBe(INVENTORY_PLAN_CONTRACT_VERSION)
    expect(core.normalizationRuleVersion).toBe(NORMALIZATION_RULE_VERSION)
    expect(INVENTORY_PLAN_CONTRACT_VERSION).toBe('canonical-inventory-plan@2')
  })

  it('规则拒掉的候选**留在计划里**并带原因码，不是悄悄丢掉', () => {
    const core = makeCore([
      'https://example.com/ok',
      'http://example.com/insecure',
      'https://www.example.com/other-host',
      'garbage',
    ])
    expect(core.counts.discovered).toBe(4)
    const codes = Object.fromEntries(core.candidates.map((c) => [c.originalUrl, c.reasonCodes]))
    expect(codes['http://example.com/insecure']).toEqual(['insecure_scheme'])
    expect(codes['https://www.example.com/other-host']).toEqual(['host_not_approved'])
    expect(codes['garbage']).toEqual(['malformed_url'])
  })

  it('撞车的候选按字典序留第一条，其余记 duplicate 并指回去', () => {
    const core = makeCore([
      'https://example.com/a/',
      'https://example.com/a#top',
      'https://example.com/a?utm_source=x',
    ])
    const primaries = core.candidates.filter((c) => c.machineDecision === 'pending')
    expect(primaries).toHaveLength(1)
    expect(primaries[0].canonicalUrl).toBe('https://example.com/a')
    const dupes = core.candidates.filter((c) => c.reasonCodes.includes('duplicate_canonical_target'))
    expect(dupes).toHaveLength(2)
    expect(dupes.every((d) => d.duplicateOf === primaries[0].originalUrl)).toBe(true)
  })

  it('撞车主候选与发现顺序无关（digest 才可能稳定）', () => {
    const urls = ['https://example.com/a/', 'https://example.com/a#top', 'https://example.com/b']
    expect(makeCore(urls)).toEqual(makeCore([...urls].reverse()))
  })

  it('原始串重复只算一条候选', () => {
    const core = makeCore(['https://example.com/a', 'https://example.com/a', ' https://example.com/a '])
    expect(core.counts.discovered).toBe(1)
  })

  it('缺租户 / 缺域名 / 主机清单非法都直接抛', () => {
    const discovery = discoveryFor(['https://example.com/a'], ['example.com'])
    const base = { requestedDomain: 'example.com', approvedHosts: ['example.com'], discovery }
    expectCode(() => buildInventoryPlan({ ...base, clientId: ' ' }), 'missing_client_id')
    expectCode(() => buildInventoryPlan({ ...base, clientId: CLIENT, requestedDomain: '' }), 'missing_domain')
    expect(() => buildInventoryPlan({ ...base, clientId: CLIENT, approvedHosts: [] })).toThrow()
  })
})

describe('逐主机发现必须进计划（否则缺整个站没人看得见）', () => {
  const base = {
    clientId: CLIENT,
    requestedDomain: 'example.com',
    approvedHosts: ['example.com', 'shop.example.com'],
  }

  it('🔴 批准了两个主机、发现记录只有一个 → 抛（那个站根本没被找过）', () => {
    expectCode(
      () =>
        buildInventoryPlan({
          ...base,
          discovery: {
            urls: ['https://example.com/a'],
            perHost: [{ host: 'example.com', count: 1, foreignCount: 0, error: null }],
          },
        }),
      'discovery_host_missing',
    )
  })

  it('🔴 摘要说 B 站有页面、候选清单里一条都没有 → 抛（两边对不上）', () => {
    expectCode(
      () =>
        buildInventoryPlan({
          ...base,
          discovery: {
            urls: ['https://example.com/a'],
            perHost: [
              { host: 'example.com', count: 1, foreignCount: 0, error: null },
              { host: 'shop.example.com', count: 1, foreignCount: 0, error: null },
            ],
          },
        }),
      'discovery_count_mismatch',
    )
  })

  it('同一个主机在发现结果里出现两次 → 抛', () => {
    expectCode(
      () =>
        buildInventoryPlan({
          clientId: CLIENT,
          requestedDomain: 'example.com',
          approvedHosts: ['example.com'],
          discovery: {
            urls: ['https://example.com/a'],
            perHost: [
              { host: 'example.com', count: 1, foreignCount: 0, error: null },
              { host: 'example.com', count: 1, foreignCount: 0, error: null },
            ],
          },
        }),
      'duplicate_discovery_host',
    )
  })

  it('🔴 某个主机 0 条 / 出错**不再在生成阶段抛** —— 如实记进 core，由复核人署名认账', () => {
    // #930 时代这里会抛，因为「认账」是生成入参 —— 自动化调用方自己补一下就绕过去了。
    // 现在它进被签名保护的 core，谁也改不动，认账必须由复核人写在提交件里（见 review.test.ts）。
    const core = buildInventoryPlan({
      ...base,
      discovery: {
        urls: ['https://example.com/a'],
        perHost: [
          { host: 'example.com', count: 1, foreignCount: 0, error: null },
          { host: 'shop.example.com', count: 0, foreignCount: 0, error: null },
        ],
      },
    })
    expect(core.discovery).toEqual([
      { host: 'example.com', count: 1, foreignCount: 0, error: null },
      { host: 'shop.example.com', count: 0, foreignCount: 0, error: null },
    ])
    // 🔴 `acknowledged` 这个字段已经不在发现摘要里了 —— 它现在是复核提交项。
    expect(Object.keys(core.discovery[1])).not.toContain('acknowledged')
  })
})

describe('assertCoreIntact —— 纵深：这份 core 还是机器生成的那一份吗', () => {
  const good = (): GeneratedPlanCore => makeCore(['https://example.com/a', 'garbage'])

  it('机器刚生成的 core 直接通过', () => {
    expect(() => assertCoreIntact(good())).not.toThrow()
  })

  it('契约版本 / 规则版本不对 → 抛', () => {
    expectCode(() => assertCoreIntact({ ...good(), contractVersion: 'canonical-inventory-plan@1' }), 'contract_version_mismatch')
    expectCode(
      () => assertCoreIntact({ ...good(), normalizationRuleVersion: 'inventory-url-rules@0' }),
      'rule_version_mismatch',
    )
  })

  it('发现记录与批准主机对不上 → 抛', () => {
    expectCode(() => assertCoreIntact({ ...good(), discovery: [] }), 'discovery_coverage_mismatch')
  })

  it('🔴 手写的 core 里预置一条 accepted 是不可能的，但预置一条「机器不会那样判」的候选要抓出来', () => {
    const core = good()
    const tampered = {
      ...core,
      candidates: core.candidates.map((c) =>
        c.originalUrl === 'garbage' ? { ...c, machineDecision: 'pending' as const } : c,
      ),
      counts: { discovered: 2, pending: 2, rejected: 0 },
    }
    expectCode(() => assertCoreIntact(tampered), 'candidate_not_machine_derived')
  })

  it('批准主机下的候选被整条删掉 → 逐主机对账先响', () => {
    const core = good()
    expectCode(
      () =>
        assertCoreIntact({
          ...core,
          candidates: core.candidates.filter((c) => c.originalUrl !== 'https://example.com/a'),
        }),
      'discovery_count_mismatch',
    )
  })

  it('🔴 malformed 候选被删 —— 它不属于任何主机，逐主机对账天生看不见，只有计数兜得住', () => {
    const core = makeCore(['https://example.com/a', 'garbage'])
    const stripped = { ...core, candidates: core.candidates.filter((c) => c.originalUrl !== 'garbage') }
    expectCode(() => assertCoreIntact(stripped), 'counts_not_machine_derived')
  })

  it('同一条原始 URL 出现两次 → 抛（机器不会这么生成）', () => {
    const core = good()
    expectCode(
      () => assertCoreIntact({ ...core, candidates: [...core.candidates, core.candidates[0]] }),
      'duplicate_original_url',
    )
  })
})

describe('countMachineCandidates', () => {
  it('只数机器决策的三种状态', () => {
    const core = makeCore(['https://example.com/a', 'garbage', 'http://example.com/x'])
    expect(countMachineCandidates(core.candidates)).toEqual({ discovered: 3, pending: 1, rejected: 2 })
  })
})
