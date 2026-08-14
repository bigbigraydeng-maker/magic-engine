/**
 * 计划组装 / 复核 / 哈希（Issue #930）。
 */

import { describe, expect, it } from 'vitest'
import {
  InventoryPlanError,
  applyReviewDecisions,
  buildInventoryPlan,
  computePlanHash,
  verifyPlanHash,
} from '../plan'
import { INVENTORY_PLAN_CONTRACT_VERSION, NORMALIZATION_RULE_VERSION } from '../types'
import type { CanonicalInventoryPlan } from '../types'

const CLIENT = '00000000-0000-0000-0000-0000000000aa'
const REVIEW = { reviewedBy: 'product-owner', reviewedAt: '2026-08-12T00:00:00.000Z' }
/** 假签名：真实实现应当是带密钥的 HMAC —— 改文件的人算不出来。 */
const SIGN = (planHash: string): string => `sig:${planHash}`

/** 清单里属于这个主机的唯一 URL 数 —— 跟适配器的算法一致。 */
function countFor(host: string, urls: readonly string[]): number {
  const own = new Set<string>()
  for (const u of urls) {
    try {
      if (new URL(u.trim()).hostname.toLowerCase() === host.toLowerCase()) own.add(u.trim())
    } catch {
      /* 畸形 URL 不参与对账 */
    }
  }
  return own.size
}

function build(urls: readonly string[], hosts: readonly string[] = ['example.com']): CanonicalInventoryPlan {
  return buildInventoryPlan({
    clientId: CLIENT,
    requestedDomain: 'example.com',
    approvedHosts: hosts,
    discoveredUrls: urls,
    // 🔴 按**真实主机归属**算，不能拿清单长度充数：计划会拿这个数字跟候选对账。
    discovery: hosts.map((host) => ({ host, count: countFor(host, urls), foreignCount: 0, error: null })),
  })
}

describe('计划组装', () => {
  it('🔴 刚生成时一条 accepted 都没有 —— 合规候选一律 pending', () => {
    const plan = build(['https://example.com/a', 'https://example.com/b'])
    expect(plan.counts.accepted).toBe(0)
    expect(plan.counts.pending).toBe(2)
    expect(plan.candidates.every((c) => c.decision === 'pending')).toBe(true)
  })

  it('带上契约版本与规则版本', () => {
    const plan = build(['https://example.com/a'])
    expect(plan.contractVersion).toBe(INVENTORY_PLAN_CONTRACT_VERSION)
    expect(plan.normalizationRuleVersion).toBe(NORMALIZATION_RULE_VERSION)
  })

  it('规则拒掉的候选**留在计划里**并带原因码，不是悄悄丢掉', () => {
    const plan = build([
      'https://example.com/ok',
      'http://example.com/insecure',
      'https://www.example.com/other-host',
      'garbage',
    ])
    expect(plan.counts.discovered).toBe(4)
    const codes = Object.fromEntries(plan.candidates.map((c) => [c.originalUrl, c.reasonCodes]))
    expect(codes['http://example.com/insecure']).toEqual(['insecure_scheme'])
    expect(codes['https://www.example.com/other-host']).toEqual(['host_not_approved'])
    expect(codes['garbage']).toEqual(['malformed_url'])
  })

  it('撞车的候选按字典序留第一条，其余记 duplicate 并指回去', () => {
    const plan = build([
      'https://example.com/a/',
      'https://example.com/a#top',
      'https://example.com/a?utm_source=x',
    ])
    const primaries = plan.candidates.filter((c) => c.decision === 'pending')
    expect(primaries).toHaveLength(1)
    expect(primaries[0].canonicalUrl).toBe('https://example.com/a')
    const dupes = plan.candidates.filter((c) => c.reasonCodes.includes('duplicate_canonical_target'))
    expect(dupes).toHaveLength(2)
    expect(dupes.every((d) => d.duplicateOf === primaries[0].originalUrl)).toBe(true)
  })

  it('撞车主候选与发现顺序无关（哈希才可能稳定）', () => {
    const urls = ['https://example.com/a/', 'https://example.com/a#top', 'https://example.com/b']
    const a = build(urls)
    const b = build([...urls].reverse())
    expect(a.planHash).toBe(b.planHash)
  })

  it('原始串重复只算一条候选', () => {
    const plan = build(['https://example.com/a', 'https://example.com/a', ' https://example.com/a '])
    expect(plan.counts.discovered).toBe(1)
  })

  it('缺租户 / 缺域名 / 主机清单非法都直接抛', () => {
    const base = {
      requestedDomain: 'example.com',
      approvedHosts: ['example.com'],
      discoveredUrls: [],
      discovery: [{ host: 'example.com', count: 1, foreignCount: 0, error: null }],
    }
    expect(() => buildInventoryPlan({ ...base, clientId: ' ' })).toThrow(InventoryPlanError)
    expect(() => buildInventoryPlan({ ...base, clientId: CLIENT, requestedDomain: '' })).toThrow(InventoryPlanError)
    expect(() => buildInventoryPlan({ ...base, clientId: CLIENT, approvedHosts: [] })).toThrow()
  })
})

describe('逐主机发现必须进计划（否则缺整个站没人看得见）', () => {
  const base = {
    clientId: CLIENT,
    requestedDomain: 'example.com',
    approvedHosts: ['example.com', 'shop.example.com'],
    discoveredUrls: ['https://example.com/a'],
  }

  it('🔴 批准了两个主机、发现记录只有一个 → 抛（那个站根本没被找过）', () => {
    expect(() =>
      buildInventoryPlan({ ...base, discovery: [{ host: 'example.com', count: 1, foreignCount: 0, error: null }] }),
    ).toThrow(/根本没被找过/)
  })

  it('🔴 某个主机 0 条且没人认过 → 抛（0 条可能是空站，也可能被挡住）', () => {
    expect(() =>
      buildInventoryPlan({
        ...base,
        discovery: [
          { host: 'example.com', count: 1, foreignCount: 0, error: null },
          { host: 'shop.example.com', count: 0, foreignCount: 0, error: null },
        ],
      }),
    ).toThrow(/必须有人明确认过/)
  })

  it('某个主机发现出错且没人认过 → 抛', () => {
    expect(() =>
      buildInventoryPlan({
        ...base,
        discovery: [
          { host: 'example.com', count: 1, foreignCount: 0, error: null },
          { host: 'shop.example.com', count: 0, foreignCount: 0, error: 'DNS lookup failed' },
        ],
      }),
    ).toThrow(/必须有人明确认过/)
  })

  it('🔴 摘要说 B 站有页面、候选清单里一条都没有 → 抛（两个入参对不上）', () => {
    // discovery 与 discoveredUrls 是两个独立入参。不核对的话，B 整个站缺席
    // 却不需要任何人确认 —— 因为「0 条要有人认」那道闸看的是摘要，而摘要说它不是 0。
    expect(() =>
      buildInventoryPlan({
        ...base,
        discoveredUrls: ['https://example.com/a'],
        discovery: [
          { host: 'example.com', count: 1, foreignCount: 0, error: null },
          { host: 'shop.example.com', count: 1, foreignCount: 0, error: null },
        ],
      }),
    ).toThrow(/两个入参对不上/)
  })

  it('明确认过之后才生得成计划，且这件事记进计划与哈希', () => {
    const plan = buildInventoryPlan({
      ...base,
      discovery: [
        { host: 'example.com', count: 1, foreignCount: 0, error: null },
        { host: 'shop.example.com', count: 0, foreignCount: 0, error: null },
      ],
      acknowledgedIncompleteHosts: ['shop.example.com'],
    })
    expect(plan.discovery).toEqual([
      { host: 'example.com', count: 1, foreignCount: 0, error: null, acknowledged: false },
      { host: 'shop.example.com', count: 0, foreignCount: 0, error: null, acknowledged: true },
    ])
    // 改动发现记录 → 哈希必须变（否则复核人看到的和实际跑的可以分叉）
    const tampered = {
      ...plan,
      discovery: plan.discovery.map((d) => ({ ...d, count: d.count + 1 })),
    }
    expect(computePlanHash(tampered)).not.toBe(plan.planHash)
  })

  it('删掉一条发现记录再重算哈希 → 盖章时仍被挡下', () => {
    const plan = build(['https://example.com/a'])
    const stripped = { ...plan, discovery: [] }
    const { planHash: _drop, ...rest } = stripped
    expect(() =>
      applyReviewDecisions({ ...rest, planHash: computePlanHash(rest) }, {
        decisions: {},
        review: REVIEW,
        sign: SIGN,
      }),
    ).toThrow(/对不上/)
  })

  it('🔴 发现记录还在、但整条候选被删掉 → 盖章时仍被挡下（逐字段比对只看剩下的候选，看不出少了一条）', () => {
    // 摘要仍声称 shop.example.com 有 1 条，candidates 里那条被整条拿掉再重算哈希：
    // assertDiscoveryConsistent 只查主机覆盖（两边都有 shop.example.com 这个主机名），
    // assertCandidatesMachineDerived 只重构剩下的候选、逐字段比对，两关都过不出这条。
    const plan = buildInventoryPlan({
      clientId: CLIENT,
      requestedDomain: 'example.com',
      approvedHosts: ['example.com', 'shop.example.com'],
      discoveredUrls: ['https://example.com/a', 'https://shop.example.com/b'],
      discovery: [
        { host: 'example.com', count: 1, foreignCount: 0, error: null },
        { host: 'shop.example.com', count: 1, foreignCount: 0, error: null },
      ],
    })
    const stripped = {
      ...plan,
      candidates: plan.candidates.filter((c) => c.originalUrl !== 'https://shop.example.com/b'),
    }
    const { planHash: _drop, ...rest } = stripped
    expect(() =>
      applyReviewDecisions({ ...rest, planHash: computePlanHash(rest) }, {
        decisions: {},
        review: REVIEW,
        sign: SIGN,
      }),
    ).toThrow(/两个入参对不上/)
  })

  it('🔴 malformed 候选被整条删掉 → 盖章时仍被挡下（它不属于任何主机，逐主机对账天生看不见，只有计数兜得住）', () => {
    const plan = build(['https://example.com/a', 'garbage'])
    const stripped = { ...plan, candidates: plan.candidates.filter((c) => c.originalUrl !== 'garbage') }
    const { planHash: _drop, ...rest } = stripped
    expect(() =>
      applyReviewDecisions({ ...rest, planHash: computePlanHash(rest) }, {
        decisions: {},
        review: REVIEW,
        sign: SIGN,
      }),
    ).toThrow(/候选被整条删掉/)
  })

  it('🔴 未批准主机的候选被整条删掉 → 盖章时仍被挡下（同上，只是原因码不同）', () => {
    const plan = build(['https://example.com/a', 'https://www.example.com/other-host'])
    const stripped = {
      ...plan,
      candidates: plan.candidates.filter((c) => c.originalUrl !== 'https://www.example.com/other-host'),
    }
    const { planHash: _drop, ...rest } = stripped
    expect(() =>
      applyReviewDecisions({ ...rest, planHash: computePlanHash(rest) }, {
        decisions: {},
        review: REVIEW,
        sign: SIGN,
      }),
    ).toThrow(/候选被整条删掉/)
  })
})

describe('复核时间必须是合法 ISO 8601', () => {
  it.each(['not-a-date', '2026-13-45', '昨天'])('%s → 抛（排不了序也证明不了复核时间）', (bad) => {
    const plan = build(['https://example.com/a'])
    expect(() =>
      applyReviewDecisions(plan, {
        decisions: {},
        review: { reviewedBy: 'po', reviewedAt: bad },
        sign: SIGN,
      }),
    ).toThrow(/ISO 8601/)
  })

  it('合法 ISO 时间照常通过', () => {
    const plan = build(['https://example.com/a'])
    const reviewed = applyReviewDecisions(plan, {
      decisions: {},
      review: { reviewedBy: 'po', reviewedAt: '2026-08-12T03:04:05.000Z' },
      sign: SIGN,
    })
    expect(reviewed.review.reviewedAt).toBe('2026-08-12T03:04:05.000Z')
  })
})

describe('计划哈希', () => {
  it('同样输入 → 同一个哈希；自校验通过', () => {
    const a = build(['https://example.com/a', 'https://example.com/b'])
    const b = build(['https://example.com/b', 'https://example.com/a'])
    expect(a.planHash).toBe(b.planHash)
    expect(verifyPlanHash(a)).toBe(true)
  })

  it.each([
    ['改决策', (p: CanonicalInventoryPlan) => ({ ...p, candidates: p.candidates.map((c) => ({ ...c, decision: 'defer' as const })) })],
    ['改 canonical', (p: CanonicalInventoryPlan) => ({ ...p, candidates: p.candidates.map((c) => ({ ...c, canonicalUrl: 'https://example.com/hacked' })) })],
    ['改租户', (p: CanonicalInventoryPlan) => ({ ...p, clientId: 'other-tenant' })],
    ['改批准主机', (p: CanonicalInventoryPlan) => ({ ...p, boundary: { ...p.boundary, approvedHosts: ['example.com', 'www.example.com'] } })],
    ['改规则版本', (p: CanonicalInventoryPlan) => ({ ...p, normalizationRuleVersion: 'inventory-url-rules@0' })],
    ['改复核签名', (p: CanonicalInventoryPlan) => ({ ...p, review: { reviewedBy: 'someone-else', reviewedAt: REVIEW.reviewedAt } })],
  ])('批准后被%s → 哈希对不上', (_label, mutate) => {
    const plan = build(['https://example.com/a'])
    const reviewed = applyReviewDecisions(plan, {
      decisions: { 'https://example.com/a': { decision: 'accepted' } },
      review: REVIEW,
      sign: SIGN,
    })
    expect(verifyPlanHash(mutate(reviewed))).toBe(false)
  })

  it('哈希覆盖原因码与备注（不只是 URL 清单）', () => {
    const plan = build(['https://example.com/a'])
    const tampered = {
      ...plan,
      candidates: plan.candidates.map((c) => ({ ...c, notes: [...c.notes, 'fragment_removed' as const] })),
    }
    expect(computePlanHash(tampered)).not.toBe(plan.planHash)
  })

  it('哈希覆盖计数（不是只看候选清单本身）', () => {
    const plan = build(['https://example.com/a'])
    const tampered = { ...plan, counts: { ...plan.counts, accepted: plan.counts.accepted + 1 } }
    expect(computePlanHash(tampered)).not.toBe(plan.planHash)
  })
})

describe('人工复核', () => {
  it('决策落到候选上，计数与哈希跟着变', () => {
    const plan = build(['https://example.com/a', 'https://example.com/b', 'https://example.com/c'])
    const reviewed = applyReviewDecisions(plan, {
      decisions: {
        'https://example.com/a': { decision: 'accepted' },
        'https://example.com/b': { decision: 'rejected' },
        'https://example.com/c': { decision: 'defer' },
      },
      review: REVIEW,
      sign: SIGN,
    })
    expect(reviewed.counts).toMatchObject({ accepted: 1, rejected: 1, deferred: 1, pending: 0 })
    expect(reviewed.planHash).not.toBe(plan.planHash)
    expect(verifyPlanHash(reviewed)).toBe(true)
    expect(reviewed.review.reviewedBy).toBe('product-owner')
  })

  it('人工拒 / 暂缓自动补机器可读原因码', () => {
    const plan = build(['https://example.com/a', 'https://example.com/b'])
    const reviewed = applyReviewDecisions(plan, {
      decisions: {
        'https://example.com/a': { decision: 'rejected' },
        'https://example.com/b': { decision: 'defer' },
      },
      review: REVIEW,
      sign: SIGN,
    })
    const codes = Object.fromEntries(reviewed.candidates.map((c) => [c.originalUrl, c.reasonCodes]))
    expect(codes['https://example.com/a']).toEqual(['reviewer_rejected'])
    expect(codes['https://example.com/b']).toEqual(['reviewer_deferred'])
  })

  it('🔴 规则自动拒掉的候选不许被人改成 accepted', () => {
    // 带一条本主机的正常页面：否则本主机 0 条会触发「发现不完整必须有人认」那道闸，
    // 那样这条用例测的就不是它想测的东西了。
    const plan = build(['https://www.example.com/x', 'https://example.com/ok'])
    expect(() =>
      applyReviewDecisions(plan, {
        decisions: { 'https://www.example.com/x': { decision: 'accepted' } },
        review: REVIEW,
        sign: SIGN,
      }),
    ).toThrow(/不接受人工覆盖/)
  })

  it('决策指向不存在的候选 → 抛（防止复核文件与计划脱节）', () => {
    const plan = build(['https://example.com/a'])
    expect(() =>
      applyReviewDecisions(plan, {
        decisions: { 'https://example.com/typo': { decision: 'accepted' } },
        review: REVIEW,
        sign: SIGN,
      }),
    ).toThrow(InventoryPlanError)
  })

  it('没判到的候选留在 pending（漏判不会被当成拒绝）', () => {
    const plan = build(['https://example.com/a', 'https://example.com/b'])
    const reviewed = applyReviewDecisions(plan, {
      decisions: { 'https://example.com/a': { decision: 'accepted' } },
      review: REVIEW,
      sign: SIGN,
    })
    expect(reviewed.counts.pending).toBe(1)
  })

  it('🔴 计划在外面被改过（canonical 换成同主机下的另一页）→ 不许盖章', () => {
    const plan = build(['https://example.com/a'])
    const tampered = {
      ...plan,
      candidates: plan.candidates.map((c) => ({ ...c, canonicalUrl: 'https://example.com/hacked' })),
    }
    // 连哈希一起重算，模拟「改完再自洽」的情形 —— 只验哈希是拦不住的。
    const { planHash: _drop, ...rest } = tampered
    const rehashed = { ...rest, planHash: computePlanHash(rest) }
    expect(() =>
      applyReviewDecisions(rehashed, {
        decisions: { 'https://example.com/a': { decision: 'accepted' } },
        review: REVIEW,
        sign: SIGN,
      }),
    ).toThrow(/不是机器刚产出的那一份/)
  })

  it('计划哈希对不上 → 不许盖章（不给任意输入重新背书）', () => {
    const plan = build(['https://example.com/a'])
    const tampered = { ...plan, clientId: 'someone-else' }
    expect(() => applyReviewDecisions(tampered, { decisions: {}, review: REVIEW, sign: SIGN })).toThrow(/哈希对不上/)
  })

  it('旧规则版本生成的计划 → 不许被悄悄「升级」成当前规则', () => {
    const plan = build(['https://example.com/a'])
    const old = { ...plan, normalizationRuleVersion: 'inventory-url-rules@0' }
    const { planHash: _drop, ...rest } = old
    const rehashed = { ...rest, planHash: computePlanHash(rest) }
    expect(() => applyReviewDecisions(rehashed, { decisions: {}, review: REVIEW, sign: SIGN })).toThrow(/规则变了/)
  })

  it('🔴 计划里预置了 accepted（哈希也重算过）→ 不许盖章', () => {
    // Codex 第四轮点名的那条：把合规候选的 decision 从 pending 直接改成 accepted、
    // 再用公开的 computePlanHash 重算，版本/哈希/canonical 推导三关全过；
    // 然后 applyReviewDecisions(..., decisions: {}) 会原样保留它并盖上签名 ——
    // 最终写入一条复核人从没接受过的页面。
    const plan = build(['https://example.com/a', 'https://example.com/b'])
    const preAccepted = {
      ...plan,
      candidates: plan.candidates.map((c) =>
        c.originalUrl === 'https://example.com/a' ? { ...c, decision: 'accepted' as const } : c,
      ),
    }
    const { planHash: _drop, ...rest } = preAccepted
    const rehashed = { ...rest, planHash: computePlanHash(rest) }
    expect(() => applyReviewDecisions(rehashed, { decisions: {}, review: REVIEW, sign: SIGN })).toThrow(
      /不是机器刚产出的那一份/,
    )
  })

  it('原因码 / 归一留痕 / 撞车指向被改过 → 同样不许盖章', () => {
    const plan = build(['https://example.com/a/', 'https://example.com/a#x'])
    for (const mutate of [
      (c: (typeof plan.candidates)[number]) => ({ ...c, reasonCodes: [] as never[] }),
      (c: (typeof plan.candidates)[number]) => ({ ...c, notes: [] as never[] }),
      (c: (typeof plan.candidates)[number]) => ({ ...c, duplicateOf: 'https://example.com/elsewhere' }),
    ]) {
      const tampered = {
        ...plan,
        candidates: plan.candidates.map((c) => (c.decision === 'rejected' ? mutate(c) : c)),
      }
      const { planHash: _drop, ...rest } = tampered
      expect(() =>
        applyReviewDecisions({ ...rest, planHash: computePlanHash(rest) }, { decisions: {}, review: REVIEW, sign: SIGN }),
      ).toThrow(/不是机器刚产出的那一份/)
    }
  })

  it('同一条原始 URL 出现两次 → 不许盖章（机器不会这么生成）', () => {
    const plan = build(['https://example.com/a'])
    const doubled = { ...plan, candidates: [...plan.candidates, { ...plan.candidates[0] }] }
    const { planHash: _drop, ...rest } = doubled
    expect(() =>
      applyReviewDecisions({ ...rest, planHash: computePlanHash(rest) }, { decisions: {}, review: REVIEW, sign: SIGN }),
    ).toThrow(/出现了多次/)
  })

  it('🔴 已经签过名的计划不许再盖一次章', () => {
    const plan = build(['https://example.com/a'])
    const reviewed = applyReviewDecisions(plan, {
      decisions: { 'https://example.com/a': { decision: 'rejected' } },
      review: REVIEW,
      sign: SIGN,
    })
    expect(() =>
      applyReviewDecisions(reviewed, {
        decisions: {},
        review: { reviewedBy: 'someone-else', reviewedAt: REVIEW.reviewedAt },
        sign: SIGN,
      }),
    ).toThrow(/只盖一次章/)
  })

  it('🔴 决策值拼错（accept 少个 ed）→ 当场抛，不许带着签名往下走', () => {
    // 决策是从文件 / 界面反序列化进来的，联合类型在运行时不拦任何东西。
    // 放过去它就从 accepted/rejected/deferred/pending 每一份账里消失，
    // 而只要还有另一条合法 accepted，整次激活会写完其余页面然后报「完成」。
    const plan = build(['https://example.com/a', 'https://example.com/b'])
    expect(() =>
      applyReviewDecisions(plan, {
        decisions: {
          'https://example.com/a': { decision: 'accept' as never },
          'https://example.com/b': { decision: 'accepted' },
        },
        review: REVIEW,
        sign: SIGN,
      }),
    ).toThrow(/只接受 accepted \/ rejected \/ defer/)
  })

  it('🔴 人工原因码拼错 → 当场抛，不许带着签名往下走', () => {
    // decisions 从文件 / UI 反序列化进来，reasonCodes 里混进一个枚举外的字符串时，
    // 联合类型在运行时不拦任何东西 —— 不校验的话它会被原样哈希、签名，
    // 破坏「审计要能按机器原因码分组统计」这条契约唯一的保证。
    const plan = build(['https://example.com/a'])
    expect(() =>
      applyReviewDecisions(plan, {
        decisions: {
          'https://example.com/a': { decision: 'rejected', reasonCodes: ['reviewr_rejected' as never] },
        },
        review: REVIEW,
        sign: SIGN,
      }),
    ).toThrow(/原因码「reviewr_rejected」不认识/)
  })

  it('合法的人工原因码照常通过', () => {
    const plan = build(['https://example.com/a'])
    const reviewed = applyReviewDecisions(plan, {
      decisions: {
        'https://example.com/a': { decision: 'rejected', reasonCodes: ['host_not_approved'] },
      },
      review: REVIEW,
      sign: SIGN,
    })
    expect(reviewed.candidates[0].reasonCodes).toEqual(['host_not_approved'])
  })

  it('复核必须署名并带时间', () => {
    const plan = build(['https://example.com/a'])
    expect(() =>
      applyReviewDecisions(plan, { decisions: {}, review: { reviewedBy: '  ', reviewedAt: REVIEW.reviewedAt }, sign: SIGN }),
    ).toThrow(InventoryPlanError)
    expect(() =>
      applyReviewDecisions(plan, { decisions: {}, review: { reviewedBy: 'x', reviewedAt: '' }, sign: SIGN }),
    ).toThrow(InventoryPlanError)
  })
})
