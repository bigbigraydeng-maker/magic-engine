/**
 * 激活闸（Issue #930）。
 *
 * 🔴 每一道闸都**单独**直测：拿一份除了那一项以外完全合法的输入去撞它。
 *    不这么写的话，前一道闸会把后面的闸遮住 —— 一堆全绿的断言其实一道都没盯住
 *    （这个仓库真出过：拆掉某一句原子兑换，18 条测试照样全绿）。
 */

import { describe, expect, it, vi } from 'vitest'
import { activateReviewedPlan } from '../activation'
import { applyReviewDecisions, buildInventoryPlan, computePlanHash } from '../plan'
import { FakeInventoryStore } from './fake-store'
import type { ActivateInput } from '../activation'
import type { ActivationDeps, ReviewedInventoryPlan } from '../types'
import type { CrawlResult } from '../../crawler'
import type { EnrichedPage } from '../../page-enrichment'

const CLIENT = '00000000-0000-0000-0000-0000000000aa'
const DOMAIN = 'example.com'
const HOSTS = ['example.com']
const REVIEW = { reviewedBy: 'product-owner', reviewedAt: '2026-08-12T00:00:00.000Z' }
/**
 * 假签名。真实实现必须是**改文件的人算不出来**的东西（带密钥的 HMAC / 非对称签名）——
 * 这里用一个带「密钥」的前缀模拟：测试里改内容却拿不到 SIGN 的一方就伪造不出来。
 */
const SIGN = (planHash: string): string => `sig:${planHash}`
const VERIFY = (planHash: string, signature: string): boolean => signature === SIGN(planHash)

const ACCEPTED = ['https://example.com/a', 'https://example.com/b']
const REJECTED = 'http://example.com/insecure'
const DEFERRED = 'https://example.com/maybe'

function makeCrawl(url: string, over: Partial<CrawlResult> = {}): CrawlResult {
  return {
    url,
    markdown: `# ${url}\nreal page body`,
    title: `Title ${url}`,
    statusCode: 200,
    crawledAt: new Date('2026-08-12T01:00:00.000Z'),
    ...over,
  }
}

function makeEnriched(over: Partial<EnrichedPage> = {}): EnrichedPage {
  return {
    pageType: 'service',
    topics: ['t1'],
    primaryKeyword: 'kw',
    classificationConfidence: 0.9,
    classified: true,
    classificationError: null,
    hasGeoBlock: false,
    geoDetectionMethod: null,
    geoConfidence: 0,
    wordCount: 5,
    ...over,
  }
}

/** 一份「除了被测那一项以外全部合法」的复核计划。 */
function makeReviewedPlan(over?: { hosts?: readonly string[]; domain?: string; clientId?: string }): ReviewedInventoryPlan {
  const plan = buildInventoryPlan({
    clientId: over?.clientId ?? CLIENT,
    requestedDomain: over?.domain ?? DOMAIN,
    approvedHosts: over?.hosts ?? HOSTS,
    discoveredUrls: [...ACCEPTED, REJECTED, DEFERRED],
    // ACCEPTED×2 + REJECTED(http, 同主机) + DEFERRED = 4 条，全在 example.com 下。
    discovery: (over?.hosts ?? HOSTS).map((host) => ({ host, count: 4, foreignCount: 0, error: null })),
  })
  return applyReviewDecisions(plan, {
    decisions: {
      [ACCEPTED[0]]: { decision: 'accepted' },
      [ACCEPTED[1]]: { decision: 'accepted' },
      [DEFERRED]: { decision: 'defer' },
    },
    review: REVIEW,
    sign: SIGN,
  })
}

function makeDeps(over: Partial<ActivationDeps> = {}): ActivationDeps & { store: FakeInventoryStore } {
  const store = (over.store as FakeInventoryStore) ?? new FakeInventoryStore()
  return {
    store,
    verifyReviewSignature: over.verifyReviewSignature ?? VERIFY,
    crawl: over.crawl ?? (async (urls) => urls.map((u) => makeCrawl(u))),
    enrich: over.enrich ?? (async () => makeEnriched()),
    now: over.now ?? (() => '2026-08-12T02:00:00.000Z'),
  }
}

function makeInput(over: Partial<ActivateInput> = {}): ActivateInput {
  return {
    plan: over.plan ?? makeReviewedPlan(),
    expected: over.expected ?? { clientId: CLIENT, requestedDomain: DOMAIN, approvedHosts: HOSTS },
    mode: 'first_activation',
    deps: over.deps ?? makeDeps(),
  }
}

/**
 * 改计划内容后重算哈希**并重新签名** —— 用来构造「内容非法但哈希与签名都自洽」的输入，
 * 逼每道闸自己说话。不重签的话，签名闸会先响，后面每一道都被它遮住。
 */
function rehash(plan: ReviewedInventoryPlan): ReviewedInventoryPlan {
  const { planHash: _old, reviewSignature: _sig, ...rest } = plan
  const planHash = computePlanHash(rest)
  return { ...rest, planHash, reviewSignature: SIGN(planHash) } as ReviewedInventoryPlan
}

describe('顺利通过的基线（不先证明它能过，后面的「拒」就证明不了什么）', () => {
  it('闸门全过 → 抓取 → 写入 → 精确对账 → activated', async () => {
    const deps = makeDeps()
    const audit = await activateReviewedPlan(makeInput({ deps }))

    expect(audit.status).toBe('activated')
    expect(audit.blockers).toEqual([])
    expect(audit.writtenUrls).toEqual(ACCEPTED)
    expect(audit.counts).toMatchObject({ accepted: 2, written: 2, crawlFailed: 0 })
    expect(audit.inventoryTouched).toBe(true)
  })

  it('🔴 被拒 / 暂缓的候选一条都没到达持久化', async () => {
    const deps = makeDeps()
    await activateReviewedPlan(makeInput({ deps }))
    expect(deps.store.allWrittenUrls()).toEqual(ACCEPTED)
    expect(deps.store.allWrittenUrls()).not.toContain(REJECTED)
    expect(deps.store.allWrittenUrls()).not.toContain(DEFERRED)
  })

  it('审计逐条列出被拒与暂缓，不做汇总即真相', async () => {
    const audit = await activateReviewedPlan(makeInput())
    expect(audit.rejectedUrls.map((r) => r.url)).toContain(REJECTED)
    expect(audit.deferredUrls.map((r) => r.url)).toEqual([DEFERRED])
    expect(audit.deferredUrls[0].reasonCodes).toEqual(['reviewer_deferred'])
  })

  it('不把 Jina 的 200 当页面状态写进台账；重定向证据如实标为不可得', async () => {
    const deps = makeDeps()
    const audit = await activateReviewedPlan(makeInput({ deps }))
    expect(audit.redirectEvidence).toBe('unavailable')
    const written = deps.store.writes[0].pages[0]
    expect(Object.keys(written)).not.toContain('statusCode')
    expect(Object.keys(written)).not.toContain('status_code')
  })
})

describe('结构闸：反序列化后缺字段也必须返回审计，不许抛出去', () => {
  it.each([
    ['缺 review', (p: ReviewedInventoryPlan) => ({ ...p, review: undefined })],
    ['reviewedBy 不是字符串', (p: ReviewedInventoryPlan) => ({ ...p, review: { reviewedBy: 42, reviewedAt: 'x' } })],
    ['candidates 不是数组', (p: ReviewedInventoryPlan) => ({ ...p, candidates: undefined })],
    ['缺 boundary', (p: ReviewedInventoryPlan) => ({ ...p, boundary: undefined })],
    ['approvedHosts 不是数组', (p: ReviewedInventoryPlan) => ({ ...p, boundary: { ...p.boundary, approvedHosts: 'example.com' } })],
    ['clientId 不是字符串', (p: ReviewedInventoryPlan) => ({ ...p, clientId: null })],
    ['candidates 里有 null', (p: ReviewedInventoryPlan) => ({ ...p, candidates: [...p.candidates, null] })],
    ['候选缺 originalUrl', (p: ReviewedInventoryPlan) => ({ ...p, candidates: [{ decision: 'accepted' }] })],
    ['discovery 不是数组', (p: ReviewedInventoryPlan) => ({ ...p, discovery: 'example.com' })],
    ['discovery 里有畸形项', (p: ReviewedInventoryPlan) => ({ ...p, discovery: [{ host: 'example.com' }] })],
  ])('%s → 返回 rejected 审计（而不是抛异常）', async (_label, mutate) => {
    const broken = mutate(makeReviewedPlan()) as unknown as ReviewedInventoryPlan
    const deps = makeDeps()
    // 🔴 关键是「不抛」：这个模块对外承诺一定返回一份审计，调用方靠 status 判结局。
    const audit = await activateReviewedPlan(makeInput({ plan: broken, deps }))
    expect(audit.status).toBe('rejected')
    // 🔴 必须是结构闸**认出来**的 plan_shape_invalid，而不是兜底 catch 抓到的
    //    plan_shape_unexpected —— 后者意味着闸有洞，只是碰巧没炸出去。
    expect(audit.blockers.map((b) => b.code)).toContain('plan_shape_invalid')
    expect(audit.blockers.map((b) => b.code)).not.toContain('plan_shape_unexpected')
    expect(deps.store.writes).toHaveLength(0)
  })
})

describe('身份闸：计划与当前上下文对不上就一次抓取都不发', () => {
  const crawlSpy = () => vi.fn(async (urls: readonly string[]) => urls.map((u) => makeCrawl(u)))

  it('租户不符', async () => {
    const crawl = crawlSpy()
    const audit = await activateReviewedPlan(
      makeInput({
        expected: { clientId: 'other-tenant', requestedDomain: DOMAIN, approvedHosts: HOSTS },
        deps: makeDeps({ crawl }),
      }),
    )
    expect(audit.status).toBe('rejected')
    expect(audit.blockers.map((b) => b.code)).toContain('client_mismatch')
    expect(crawl).not.toHaveBeenCalled()
  })

  it('域名不符', async () => {
    const audit = await activateReviewedPlan(
      makeInput({ expected: { clientId: CLIENT, requestedDomain: 'other.com', approvedHosts: HOSTS } }),
    )
    expect(audit.blockers.map((b) => b.code)).toContain('domain_mismatch')
  })

  it('🔴 发现记录少了一个批准主机 → 拒（那个站根本没被找过）', async () => {
    const base = makeReviewedPlan()
    const plan = rehash({ ...base, discovery: [] })
    const deps = makeDeps()
    const audit = await activateReviewedPlan(makeInput({ plan, deps }))
    expect(audit.status).toBe('rejected')
    expect(audit.blockers.map((b) => b.code)).toContain('discovery_host_missing')
    expect(deps.store.writes).toHaveLength(0)
  })

  it('发现记录里有未批准的主机 → 拒', async () => {
    const base = makeReviewedPlan()
    const plan = rehash({
      ...base,
      discovery: [...base.discovery, { host: 'www.example.com', count: 3, foreignCount: 0, error: null, acknowledged: false }],
    })
    const audit = await activateReviewedPlan(makeInput({ plan }))
    expect(audit.blockers.map((b) => b.code)).toContain('discovery_host_unapproved')
  })

  it('🔴 某个主机 0 条 / 出错且没人认过 → 拒', async () => {
    const base = makeReviewedPlan()
    const plan = rehash({
      ...base,
      discovery: base.discovery.map((d) => ({ ...d, count: 0, acknowledged: false })),
    })
    const audit = await activateReviewedPlan(makeInput({ plan }))
    expect(audit.blockers.map((b) => b.code)).toContain('incomplete_discovery_not_acknowledged')
  })

  it('认过的 0 条主机不再拦（人已经分清楚了）', async () => {
    const base = makeReviewedPlan()
    const plan = rehash({
      ...base,
      discovery: base.discovery.map((d) => ({ ...d, count: 0, acknowledged: true })),
    })
    const audit = await activateReviewedPlan(makeInput({ plan }))
    expect(audit.blockers.map((b) => b.code)).not.toContain('incomplete_discovery_not_acknowledged')
  })

  it('🔴 批准主机清单不符（上下文多批了一个 www，计划里没有）', async () => {
    const audit = await activateReviewedPlan(
      makeInput({
        expected: { clientId: CLIENT, requestedDomain: DOMAIN, approvedHosts: ['example.com', 'www.example.com'] },
      }),
    )
    expect(audit.blockers.map((b) => b.code)).toContain('approved_hosts_mismatch')
  })

  it('主机清单只是大小写 / 顺序不同 → 不算不符', async () => {
    const audit = await activateReviewedPlan(
      makeInput({ expected: { clientId: CLIENT, requestedDomain: 'Example.com', approvedHosts: ['EXAMPLE.com'] } }),
    )
    expect(audit.status).toBe('activated')
  })

  it('规则版本不符', async () => {
    const plan = rehash({ ...makeReviewedPlan(), normalizationRuleVersion: 'inventory-url-rules@0' })
    const audit = await activateReviewedPlan(makeInput({ plan }))
    expect(audit.blockers.map((b) => b.code)).toContain('rule_version_mismatch')
  })

  it('契约版本不符', async () => {
    const plan = rehash({ ...makeReviewedPlan(), contractVersion: 'canonical-inventory-plan@0' })
    const audit = await activateReviewedPlan(makeInput({ plan }))
    expect(audit.blockers.map((b) => b.code)).toContain('contract_version_mismatch')
  })

  it('哈希对不上（批准之后内容被改过）', async () => {
    const base = makeReviewedPlan()
    const tampered: ReviewedInventoryPlan = {
      ...base,
      candidates: base.candidates.map((c) =>
        c.originalUrl === DEFERRED ? { ...c, decision: 'accepted' as const } : c,
      ),
    }
    const audit = await activateReviewedPlan(makeInput({ plan: tampered }))
    expect(audit.status).toBe('rejected')
    expect(audit.blockers.map((b) => b.code)).toContain('plan_hash_mismatch')
  })

  it('🔴 成对改掉已接受候选的 originalUrl 与 canonicalUrl、再自己重算哈希 → 签名对不上，拒', async () => {
    // Codex 第五轮点名的那条：自带哈希是公开函数算的，改内容的人能自己重算；
    // 哈希闸与推导闸都会放行（/hacked 是个规范且主机合法的串，也确实由它自己推导得出）。
    // 唯一挡得住的是一枚改文件的人算不出来的签名。
    const base = makeReviewedPlan()
    const swapped: ReviewedInventoryPlan = {
      ...base,
      candidates: base.candidates.map((c) =>
        c.originalUrl === ACCEPTED[0]
          ? { ...c, originalUrl: 'https://example.com/hacked', canonicalUrl: 'https://example.com/hacked' }
          : c,
      ),
    }
    // 攻击者手里没有签名密钥，所以只能重算哈希、留着旧签名。
    const { planHash: _old, ...rest } = swapped
    const forged = { ...rest, planHash: computePlanHash(rest) } as ReviewedInventoryPlan

    const deps = makeDeps()
    const audit = await activateReviewedPlan(makeInput({ plan: forged, deps }))
    expect(audit.status).toBe('rejected')
    expect(audit.blockers.map((b) => b.code)).toContain('review_signature_invalid')
    expect(deps.store.writes).toHaveLength(0)
    // 证明这道闸不是被别的闸顺带拦下的：哈希与推导本身都是自洽的。
    expect(audit.blockers.map((b) => b.code)).not.toContain('plan_hash_mismatch')
    expect(audit.blockers.map((b) => b.code)).not.toContain('accepted_url_not_derived')
  })

  it('签名缺失 → 拒', async () => {
    const plan = { ...makeReviewedPlan(), reviewSignature: '  ' }
    const audit = await activateReviewedPlan(makeInput({ plan }))
    expect(audit.blockers.map((b) => b.code)).toContain('review_signature_missing')
  })

  it('验签函数自己抛 → 也拒（验不了 ≠ 验过了）', async () => {
    const deps = makeDeps({
      verifyReviewSignature: () => {
        throw new Error('key material unavailable')
      },
    })
    const audit = await activateReviewedPlan(makeInput({ deps }))
    expect(audit.status).toBe('rejected')
    expect(audit.blockers.map((b) => b.code)).toContain('review_signature_unverifiable')
    expect(deps.store.writes).toHaveLength(0)
  })

  it('没有复核签名', async () => {
    const base = makeReviewedPlan()
    const plan = rehash({ ...base, review: { reviewedBy: '', reviewedAt: REVIEW.reviewedAt } })
    const audit = await activateReviewedPlan(makeInput({ plan }))
    expect(audit.blockers.map((b) => b.code)).toContain('plan_not_reviewed')
  })
})

describe('被接受集合闸', () => {
  it('还有 pending 没判 → 拒', async () => {
    const plan = buildInventoryPlan({
      clientId: CLIENT,
      requestedDomain: DOMAIN,
      approvedHosts: HOSTS,
      discoveredUrls: ACCEPTED,
      discovery: HOSTS.map((host) => ({ host, count: 2, foreignCount: 0, error: null })),
    })
    const reviewed = applyReviewDecisions(plan, {
      decisions: { [ACCEPTED[0]]: { decision: 'accepted' } },
      review: REVIEW,
      sign: SIGN,
    })
    const audit = await activateReviewedPlan(makeInput({ plan: reviewed }))
    expect(audit.blockers.map((b) => b.code)).toContain('unreviewed_candidates')
  })

  it('🔴 计划里带着认不出来的决策值 → 拒（它会从每一份账里消失）', async () => {
    const base = makeReviewedPlan()
    const plan = rehash({
      ...base,
      candidates: base.candidates.map((c) =>
        c.originalUrl === ACCEPTED[0] ? { ...c, decision: 'accept' as never } : c,
      ),
    })
    const deps = makeDeps()
    const audit = await activateReviewedPlan(makeInput({ plan, deps }))
    expect(audit.status).toBe('rejected')
    expect(audit.blockers.map((b) => b.code)).toContain('unknown_decision')
    expect(deps.store.writes).toHaveLength(0)
  })

  it('被接受集合为空 → 拒（没有可激活的台账）', async () => {
    const plan = buildInventoryPlan({
      clientId: CLIENT,
      requestedDomain: DOMAIN,
      approvedHosts: HOSTS,
      discoveredUrls: ACCEPTED,
      discovery: HOSTS.map((host) => ({ host, count: 2, foreignCount: 0, error: null })),
    })
    const reviewed = applyReviewDecisions(plan, {
      decisions: { [ACCEPTED[0]]: { decision: 'rejected' }, [ACCEPTED[1]]: { decision: 'defer' } },
      review: REVIEW,
      sign: SIGN,
    })
    const audit = await activateReviewedPlan(makeInput({ plan: reviewed }))
    expect(audit.blockers.map((b) => b.code)).toContain('empty_accepted_set')
  })

  it('🔴 canonical 被换成同一主机下的另一页（串本身完全规范）→ 仍然拒', async () => {
    // Codex 复审点名的那条：/hacked 自己是规范的，只验「规不规范」拦不住，
    // 必须拿原始 URL 重新推导才发现它不是这条候选的东西。
    const base = makeReviewedPlan()
    const plan = rehash({
      ...base,
      candidates: base.candidates.map((c) =>
        c.originalUrl === ACCEPTED[0] ? { ...c, canonicalUrl: 'https://example.com/hacked' } : c,
      ),
    })
    const deps = makeDeps()
    const audit = await activateReviewedPlan(makeInput({ plan, deps }))
    expect(audit.status).toBe('rejected')
    expect(audit.blockers.map((b) => b.code)).toContain('accepted_url_not_derived')
    expect(deps.store.writes).toHaveLength(0)
  })

  it('🔴 被接受的 URL 主机被改成未批准的（且哈希已重算）→ 仍然拒', async () => {
    const base = makeReviewedPlan()
    const plan = rehash({
      ...base,
      candidates: base.candidates.map((c) =>
        c.originalUrl === ACCEPTED[0] ? { ...c, canonicalUrl: 'https://www.example.com/a' } : c,
      ),
    })
    const audit = await activateReviewedPlan(makeInput({ plan }))
    expect(audit.status).toBe('rejected')
    expect(audit.blockers.map((b) => b.code)).toContain('accepted_url_not_derived')
  })

  it('被接受的 URL 被手改成未归一的串 → 拒（尾斜杠 / 片段 / http 都算）', async () => {
    const base = makeReviewedPlan()
    for (const bad of ['https://example.com/a/', 'https://example.com/a#x', 'http://example.com/a']) {
      const plan = rehash({
        ...base,
        candidates: base.candidates.map((c) =>
          c.originalUrl === ACCEPTED[0] ? { ...c, canonicalUrl: bad } : c,
        ),
      })
      const audit = await activateReviewedPlan(makeInput({ plan }))
      expect(audit.blockers.map((b) => b.code), bad).toContain('accepted_url_not_derived')
    }
  })

  it('被接受集合里出现重复 canonical → 拒', async () => {
    // 手写的计划里同一条原始 URL 出现两次：两条都能通过推导校验，
    // 所以这道去重闸不会被上一道遮住，是它自己在说话。
    const base = makeReviewedPlan()
    const first = base.candidates.find((c) => c.originalUrl === ACCEPTED[0])
    const plan = rehash({ ...base, candidates: [...base.candidates, { ...first! }] })
    const audit = await activateReviewedPlan(makeInput({ plan }))
    expect(audit.status).toBe('rejected')
    expect(audit.blockers.map((b) => b.code)).toContain('duplicate_accepted_target')
  })

  it('被接受但没有 canonical URL → 拒', async () => {
    const base = makeReviewedPlan()
    const plan = rehash({
      ...base,
      candidates: base.candidates.map((c) =>
        c.originalUrl === ACCEPTED[0] ? { ...c, canonicalUrl: null } : c,
      ),
    })
    const audit = await activateReviewedPlan(makeInput({ plan }))
    expect(audit.blockers.map((b) => b.code)).toContain('accepted_without_canonical')
  })
})

describe('空库闸（首次激活）', () => {
  it('台账已有行 → 拒，一条都不写', async () => {
    const deps = makeDeps({ store: new FakeInventoryStore({ existingCount: 3 }) })
    const audit = await activateReviewedPlan(makeInput({ deps }))
    expect(audit.status).toBe('rejected')
    expect(audit.blockers.map((b) => b.code)).toContain('inventory_not_empty')
    expect(deps.store.writes).toHaveLength(0)
    expect(audit.inventoryTouched).toBe(false)
  })

  it('🔴 读不到行数 ≠ 行数为 0 —— 读失败也拒，而且一次抓取都不发', async () => {
    // 只让**第一次**读失败：这样这道闸如果被拆掉，流程会往下走到抓取，
    // 断言 crawl 没被调用就会变红 —— 不会被写入前那道复查悄悄接住。
    const store = new FakeInventoryStore()
    let call = 0
    store.countExistingPages = async () => {
      call++
      if (call === 1) throw new Error('connection reset')
      return 0
    }
    const crawl = vi.fn(async (urls: readonly string[]) => urls.map((u) => makeCrawl(u)))
    const deps = makeDeps({ store, crawl })
    const audit = await activateReviewedPlan(makeInput({ deps }))
    expect(audit.status).toBe('rejected')
    expect(audit.blockers.map((b) => b.code)).toContain('inventory_count_unavailable')
    expect(crawl).not.toHaveBeenCalled()
    expect(store.writes).toHaveLength(0)
  })

  it('🔴 抓取期间台账被别人写了（第一次读 0、写之前读到 4）→ 停手，一行不写', async () => {
    const deps = makeDeps({ store: new FakeInventoryStore({ countSequence: [0, 4] }) })
    const audit = await activateReviewedPlan(makeInput({ deps }))
    // 🔴 这里是 failed 不是 rejected：页面已经抓过了。rejected 的契约是「一次抓取都没发生」，
    //    用错会让读审计的人以为这次没花过网络成本。
    expect(audit.status).toBe('failed')
    expect(audit.blockers.map((b) => b.code)).toContain('inventory_changed_during_crawl')
    expect(deps.store.writes).toHaveLength(0)
    expect(audit.inventoryTouched).toBe(false)
  })

  it('写入前那次复查读失败 → 也停手（读不到 ≠ 仍然是空的）', async () => {
    const store = new FakeInventoryStore()
    let call = 0
    store.countExistingPages = async () => {
      call++
      if (call === 1) return 0
      throw new Error('connection reset')
    }
    const deps = makeDeps({ store })
    const audit = await activateReviewedPlan(makeInput({ deps }))
    expect(audit.status).toBe('failed')
    expect(audit.blockers.map((b) => b.code)).toContain('inventory_count_unavailable')
    expect(store.writes).toHaveLength(0)
    expect(audit.inventoryTouched).toBe(false)
  })

  it('🔴 写入时把「必须仍为空」的要求传给 store（实现方得在事务里再确认一次）', async () => {
    const deps = makeDeps()
    await activateReviewedPlan(makeInput({ deps }))
    expect(deps.store.requireEmptyFlags).toEqual([true])
  })

  it('身份闸没过时不去打数据库（先拦纯校验，别浪费查询）', async () => {
    const deps = makeDeps()
    await activateReviewedPlan(
      makeInput({ expected: { clientId: 'other', requestedDomain: DOMAIN, approvedHosts: HOSTS }, deps }),
    )
    expect(deps.store.countCalls).toBe(0)
  })
})

describe('执行阶段：一页失败就不许报完成', () => {
  it('抓取失败 → failed，且一行都不写', async () => {
    const deps = makeDeps({
      crawl: async (urls) => urls.map((u, i) => makeCrawl(u, i === 0 ? { error: 'Timeout after 10000ms' } : {})),
    })
    const audit = await activateReviewedPlan(makeInput({ deps }))
    expect(audit.status).toBe('failed')
    expect(audit.counts.crawlFailed).toBe(1)
    expect(audit.failedUrls[0]).toMatchObject({ url: ACCEPTED[0] })
    expect(deps.store.writes).toHaveLength(0)
    expect(audit.inventoryTouched).toBe(false)
  })

  it('反爬挑战页（带 error 的抓取结果）不会被当成真页面写进去', async () => {
    const deps = makeDeps({
      crawl: async (urls) =>
        urls.map((u, i) =>
          makeCrawl(
            u,
            i === 0
              ? { markdown: '', title: '', error: 'antibot_siteground: Robot Challenge Screen', antibot: { kind: 'siteground', evidence: 'Robot Challenge Screen' } }
              : {},
          ),
        ),
    })
    const audit = await activateReviewedPlan(makeInput({ deps }))
    expect(audit.status).toBe('failed')
    expect(deps.store.writes).toHaveLength(0)
  })

  it('分类失败 → failed（不许拿兜底的 other 蒙混进台账）', async () => {
    const deps = makeDeps({
      enrich: async ({ url }) =>
        url === ACCEPTED[1]
          ? makeEnriched({ classified: false, classificationError: 'openai timeout', pageType: 'other' })
          : makeEnriched(),
    })
    const audit = await activateReviewedPlan(makeInput({ deps }))
    expect(audit.status).toBe('failed')
    expect(audit.failedUrls[0].error).toContain('classification failed')
    expect(deps.store.writes).toHaveLength(0)
  })

  it('🔴 富集抛错 → 计成这一页失败并照常返回审计，不许把整个调用炸掉', async () => {
    // 富集契约上「永不抛」，但注入进来的实现不归我们管。让它 reject 掉整个调用，
    // 调用方就既拿不到审计、也没法按 status 判结局 —— 而这个模块对外的承诺正是「一定返回审计」。
    const deps = makeDeps({
      enrich: async ({ url }) => {
        if (url === ACCEPTED[1]) throw new Error('openai client blew up')
        return makeEnriched()
      },
    })
    const audit = await activateReviewedPlan(makeInput({ deps }))
    expect(audit.status).toBe('failed')
    expect(audit.failedUrls).toEqual([{ url: ACCEPTED[1], error: expect.stringContaining('enrichment threw') }])
    expect(deps.store.writes).toHaveLength(0)
  })

  it('抓取器少返回一条 → 当失败处理，不当「跳过」', async () => {
    const deps = makeDeps({ crawl: async (urls) => [makeCrawl(urls[0])] })
    const audit = await activateReviewedPlan(makeInput({ deps }))
    expect(audit.status).toBe('failed')
    expect(audit.failedUrls.map((f) => f.url)).toEqual([ACCEPTED[1]])
    expect(deps.store.writes).toHaveLength(0)
  })

  it('整批抓取抛错 → 全部计为失败，一行不写', async () => {
    const deps = makeDeps({
      crawl: async () => {
        throw new Error('network down')
      },
    })
    const audit = await activateReviewedPlan(makeInput({ deps }))
    expect(audit.status).toBe('failed')
    expect(audit.counts.crawlFailed).toBe(2)
    expect(deps.store.writes).toHaveLength(0)
  })
})

describe('写入对账', () => {
  it('写入方少写一条 → failed 并标明台账已被改动', async () => {
    const deps = makeDeps({
      store: new FakeInventoryStore({ writeResult: (pages) => pages.slice(0, 1).map((p) => p.canonicalUrl) }),
    })
    const audit = await activateReviewedPlan(makeInput({ deps }))
    expect(audit.status).toBe('failed')
    expect(audit.blockers[0].code).toBe('write_set_mismatch')
    expect(audit.inventoryTouched).toBe(true)
  })

  it('写入方多写一条（写了没被批准的 URL）→ failed', async () => {
    const deps = makeDeps({
      store: new FakeInventoryStore({
        writeResult: (pages) => [...pages.map((p) => p.canonicalUrl), 'https://example.com/sneaky'],
      }),
    })
    const audit = await activateReviewedPlan(makeInput({ deps }))
    expect(audit.status).toBe('failed')
    expect(audit.blockers[0].message).toContain('https://example.com/sneaky')
  })

  it('写入抛错 → failed 并提示可能已有半截行，别直接重跑', async () => {
    const deps = makeDeps({ store: new FakeInventoryStore({ writeError: 'deadlock detected' }) })
    const audit = await activateReviewedPlan(makeInput({ deps }))
    expect(audit.status).toBe('failed')
    expect(audit.blockers[0].code).toBe('write_failed')
    expect(audit.inventoryTouched).toBe(true)
  })
})

describe('#930 现场形状：裸域进台账、www 进不去', () => {
  const HOST = 'romanhu.com'

  it('只批准裸域时，www 的页面连候选都过不了，激活后台账里只有裸域页面', async () => {
    const plan = buildInventoryPlan({
      clientId: CLIENT,
      requestedDomain: HOST,
      approvedHosts: [HOST],
      discoveredUrls: [`https://${HOST}/about`, `https://www.${HOST}/about`],
      // 清单里属于裸域的只有 1 条（另一条是 www，不属于这个主机）。
      discovery: [{ host: HOST, count: 1, foreignCount: 0, error: null }],
    })
    const pendingUrls = plan.candidates.filter((c) => c.decision === 'pending').map((c) => c.originalUrl)
    expect(pendingUrls).toEqual([`https://${HOST}/about`])

    const reviewed = applyReviewDecisions(plan, {
      decisions: { [`https://${HOST}/about`]: { decision: 'accepted' } },
      review: REVIEW,
      sign: SIGN,
    })
    const deps = makeDeps()
    const audit = await activateReviewedPlan({
      plan: reviewed,
      expected: { clientId: CLIENT, requestedDomain: HOST, approvedHosts: [HOST] },
      mode: 'first_activation',
      deps,
    })
    expect(audit.status).toBe('activated')
    expect(deps.store.allWrittenUrls()).toEqual([`https://${HOST}/about`])
  })
})
