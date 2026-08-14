/**
 * 激活的执行阶段：抓取 + 富集 → 写入 → 精确对账 → 审计（Issue #930 · #960）。
 *
 * 🔴 这一段的所有结局都是 `failed` 而不是 `rejected` —— `rejected` 的契约是
 *    「一次抓取都没发生」，走到这里页面已经抓过了。搞混了，读审计的人会以为
 *    这次没花过网络成本，重试与成本判断都会跟着错。
 *
 * 闸 1–10 在 `activation-gates.test.ts`。
 */

import { describe, expect, it, vi } from 'vitest'
import {
  acceptAllPending,
  ACCEPTED,
  activateReviewedPlan,
  ALL,
  CLIENT,
  computeGenerationDigest,
  computeReviewDigest,
  createHmacVerifier,
  createUnavailableVerifier,
  DEFERRED,
  DOMAIN,
  FakeInventoryStore,
  GEN_SECRET,
  genSigner,
  HOSTS,
  inputWith,
  ISSUED_AT,
  makeActivationDeps,
  makeCore,
  makeCrawlResult,
  makeEnriched,
  makeEnvelope,
  makeSubmission,
  NOW,
  REJECTED,
  REV_SECRET,
  seal,
  sealReview,
  standard,
  standardDecisions,
  verifyGeneration,
  verifyReview,
} from './activation-helpers'
import type { ActivateInput, GeneratedPlanCore, InventoryPlanEnvelope, ReviewDecisionEntry, ReviewSubmission, SignedReview } from './activation-helpers'

describe('闸 11 · 执行阶段：一页失败就不许报完成', () => {
  it('抓取失败 → failed，且一行都不写', async () => {
    const deps = makeActivationDeps({
      crawl: async (urls) => urls.map((u, i) => makeCrawlResult(u, i === 0 ? { error: 'HTTP 500' } : {})),
    })
    const input = inputWith({ deps })
    const audit = await activateReviewedPlan(input)
    expect(audit.status).toBe('failed')
    expect(audit.failedUrls).toEqual([{ url: ACCEPTED[0], error: 'HTTP 500' }])
    expect(input.deps.store.writes).toHaveLength(0)
  })

  it('反爬挑战页（带 error 的抓取结果）不会被当成真页面写进去', async () => {
    const deps = makeActivationDeps({
      crawl: async (urls) => urls.map((u) => makeCrawlResult(u, { error: 'anti-bot challenge detected' })),
    })
    const audit = await activateReviewedPlan(inputWith({ deps }))
    expect(audit.status).toBe('failed')
    expect(audit.counts.crawlFailed).toBe(2)
  })

  it('分类失败 → failed（不许拿兜底的 other 蒙混进台账）', async () => {
    const deps = makeActivationDeps({
      enrich: async () => makeEnriched({ classified: false, classificationError: 'rate limited' }),
    })
    const audit = await activateReviewedPlan(inputWith({ deps }))
    expect(audit.status).toBe('failed')
    expect(audit.failedUrls[0].error).toContain('classification failed')
  })

  it('🔴 富集抛错 → 计成这一页失败并照常返回审计，不许把整个调用炸掉', async () => {
    const deps = makeActivationDeps({
      enrich: async () => {
        throw new Error('classifier exploded')
      },
    })
    const audit = await activateReviewedPlan(inputWith({ deps }))
    expect(audit.status).toBe('failed')
    expect(audit.failedUrls[0].error).toContain('enrichment threw')
  })

  it('抓取器少返回一条 → 当失败处理，不当「跳过」', async () => {
    const deps = makeActivationDeps({ crawl: async (urls) => [makeCrawlResult(urls[0])] })
    const audit = await activateReviewedPlan(inputWith({ deps }))
    expect(audit.status).toBe('failed')
    expect(audit.failedUrls[0].error).toContain('crawler returned no result')
  })

  it('🔴 抓取器返回的 crawledAt 不是 Date → 计成这一页失败并照常交账（不许把整个调用炸掉）', async () => {
    const deps = makeActivationDeps({
      crawl: async (urls) =>
        urls.map((u) => ({ ...makeCrawlResult(u), crawledAt: '2026-08-12T01:30:00.000Z' as unknown as Date })),
    })
    const audit = await activateReviewedPlan(inputWith({ deps }))
    expect(audit.status).toBe('failed')
    expect(audit.failedUrls[0].error).toContain('crawledAt')
  })

  it('整批抓取抛错 → 全部计为失败，一行不写', async () => {
    const deps = makeActivationDeps({
      crawl: async () => {
        throw new Error('network down')
      },
    })
    const input = inputWith({ deps })
    const audit = await activateReviewedPlan(input)
    expect(audit.status).toBe('failed')
    expect(audit.counts.crawlFailed).toBe(2)
    expect(input.deps.store.writes).toHaveLength(0)
  })
})

describe('写入对账', () => {
  it('写入方少写一条 → failed 并标明台账已被改动', async () => {
    const store = new FakeInventoryStore({ writeResult: (pages) => pages.slice(1).map((p) => p.canonicalUrl) })
    const audit = await activateReviewedPlan(inputWith({ deps: makeActivationDeps({ store }) }))
    expect(audit.status).toBe('failed')
    expect(audit.blockers.map((b) => b.code)).toContain('write_set_mismatch')
    expect(audit.inventoryTouched).toBe(true)
  })

  it('写入方多写一条（写了没被批准的 URL）→ failed', async () => {
    const store = new FakeInventoryStore({
      writeResult: (pages) => [...pages.map((p) => p.canonicalUrl), 'https://example.com/sneaky'],
    })
    const audit = await activateReviewedPlan(inputWith({ deps: makeActivationDeps({ store }) }))
    expect(audit.status).toBe('failed')
    expect(audit.blockers[0].message).toContain('sneaky')
  })

  it('🔴 落库口返回的不是数组 → failed 并标明台账已被改动（不许把整个调用炸掉）', async () => {
    const store = new FakeInventoryStore({ writeResult: () => 'oops' as unknown as string[] })
    const audit = await activateReviewedPlan(inputWith({ deps: makeActivationDeps({ store }) }))
    expect(audit.status).toBe('failed')
    expect(audit.blockers.map((b) => b.code)).toContain('write_result_malformed')
    expect(audit.inventoryTouched).toBe(true)
  })

  it('写入抛错 → failed 并提示可能已有半截行，别直接重跑', async () => {
    const store = new FakeInventoryStore({ writeError: 'deadlock detected' })
    const audit = await activateReviewedPlan(inputWith({ deps: makeActivationDeps({ store }) }))
    expect(audit.status).toBe('failed')
    expect(audit.blockers.map((b) => b.code)).toContain('write_failed')
    expect(audit.inventoryTouched).toBe(true)
  })
})

describe('#930 现场形状：裸域进台账、www 进不去', () => {
  it('只批准裸域时，www 的页面连候选都过不了，激活后台账里只有裸域页面', async () => {
    const core = makeCore(['https://example.com/a', 'https://www.example.com/legacy'])
    const envelope = makeEnvelope(core)
    const review = seal(makeSubmission(envelope, acceptAllPending(core)))
    const input = inputWith({ envelope, review })
    const audit = await activateReviewedPlan(input)

    expect(audit.status).toBe('activated')
    expect(audit.writtenUrls).toEqual(['https://example.com/a'])
    expect(audit.rejectedUrls.map((r) => r.reasonCodes).flat()).toContain('host_not_approved')
    expect(input.deps.store.allWrittenUrls()).not.toContain('https://www.example.com/legacy')
  })
})

describe('审计对象自己绝不能抛', () => {
  it('候选是一堆垃圾时也要交得出账', async () => {
    const input = inputWith()
    const broken = {
      ...input,
      envelope: { ...input.envelope, core: { ...input.envelope.core, candidates: [null, 1, 'x'] } },
    } as unknown as ActivateInput
    const audit = await activateReviewedPlan({ ...broken, deps: input.deps })
    expect(audit.status).toBe('rejected')
    expect(audit.acceptedUrls).toEqual([])
    expect(vi.isMockFunction(input.deps.crawlSpy)).toBe(true)
    expect(input.deps.crawlSpy).not.toHaveBeenCalled()
  })

  it('🔴 入参本身是 null 也要交得出账（结构闸报了 blocker，审计构造不许跟着抛）', async () => {
    const audit = await activateReviewedPlan(null as unknown as ActivateInput)
    expect(audit.status).toBe('rejected')
    expect(audit.blockers.map((b) => b.code)).toEqual(['plan_shape_invalid'])
    expect(audit.clientId).toBe('')
    expect(audit.acceptedUrls).toEqual([])
  })

  it('闸门在决策解析之前就失败时，账里仍然看得见机器拒了哪些', async () => {
    const deps = makeActivationDeps({ now: () => '2026-09-19T00:00:00.000Z' })
    const audit = await activateReviewedPlan(inputWith({ deps }))
    expect(audit.status).toBe('rejected')
    expect(audit.rejectedUrls.map((r) => r.url)).toContain(REJECTED)
  })
})

describe('夹具自身的前提', () => {
  it('基线用的 NOW 稳稳在有效期内（免得整组测试靠运气）', () => {
    expect(Date.parse(NOW) - Date.parse(ISSUED_AT)).toBeLessThan(7 * 24 * 60 * 60 * 1000)
  })

  it('🔴 两把密钥的 **secret 本身**不同（断言两个闭包引用不同是自欺，改成断言行为）', () => {
    expect(GEN_SECRET).not.toBe(REV_SECRET)
    // 行为判据：拿生成密钥环去验一份 L2 凭证，必须验不过。
    const { envelope, review } = standard()
    expect(verifyGeneration({ keyId: review.keyId, payload: 'x', signature: review.reviewAttestation })).toBe(
      'unknown_key',
    )
    expect(verifyReview({ keyId: envelope.keyId, payload: 'x', signature: envelope.generationSignature })).toBe(
      'unknown_key',
    )
  })
})
