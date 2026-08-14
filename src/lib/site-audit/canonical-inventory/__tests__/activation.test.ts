/**
 * 激活闸（Issue #930 · #960）。
 *
 * 🔴 每一道闸都**单独**直测：拿一份除了那一项以外完全合法的输入去撞它。
 *    不这么写的话，前一道闸会把后面的闸遮住 —— 一堆全绿的断言其实一道都没盯住
 *    （这个仓库真出过：拆掉某一句原子兑换，18 条测试照样全绿）。
 *
 * 🔴 测试**持有签名密钥**，所以能封出「签名合法但内容有问题」的信封与凭证。
 *    这正是闸 6–10 存在的意义：它们是纵深防御 —— L1/L2 只证明「没被外人改过」，
 *    证明不了「产出它的那段代码没写错」。用真签名 + 坏内容去撞，才测得到它们。
 */

import { describe, expect, it, vi } from 'vitest'
import { activateReviewedPlan } from '../activation'
import { sealReview } from '../attestation'
import { createHmacVerifier, createUnavailableVerifier } from '../signing'
import { computeGenerationDigest } from '../envelope'
import { computeReviewDigest } from '../attestation'
import { FakeInventoryStore } from './fake-store'
import {
  acceptAllPending,
  CLIENT,
  DOMAIN,
  HOSTS,
  ISSUED_AT,
  makeActivationDeps,
  makeActivationInput,
  makeCore,
  makeCrawlResult,
  makeEnriched,
  makeEnvelope,
  makeSubmission,
  NOW,
  revSigner,
  verifyGeneration,
  verifyReview,
} from './fixtures'
import type { ActivateInput } from '../activation'
import type {
  GeneratedPlanCore,
  InventoryPlanEnvelope,
  ReviewDecisionEntry,
  ReviewSubmission,
  SignedReview,
} from '../types'

const ACCEPTED = ['https://example.com/a', 'https://example.com/b']
const REJECTED = 'http://example.com/insecure'
const DEFERRED = 'https://example.com/maybe'
const ALL = [...ACCEPTED, REJECTED, DEFERRED]

/** 用真密钥把任意一份提交件封成凭证 —— 用来构造「凭证合法但内容有问题」的输入。 */
function seal(submission: ReviewSubmission): SignedReview {
  return sealReview(submission, revSigner)
}

function standardDecisions(): Record<string, ReviewDecisionEntry> {
  return {
    [ACCEPTED[0]]: { decision: 'accepted' },
    [ACCEPTED[1]]: { decision: 'accepted' },
    [DEFERRED]: { decision: 'defer' },
  }
}

/** 一份「除了被测那一项以外全部合法」的信封 + 凭证。 */
function standard(over: { core?: GeneratedPlanCore; decisions?: Record<string, ReviewDecisionEntry> } = {}): {
  envelope: InventoryPlanEnvelope
  review: SignedReview
} {
  const envelope = makeEnvelope(over.core ?? makeCore(ALL))
  return { envelope, review: seal(makeSubmission(envelope, over.decisions ?? standardDecisions())) }
}

function inputWith(over: Partial<ActivateInput> = {}): ReturnType<typeof makeActivationInput> {
  const base = standard()
  return makeActivationInput({
    envelope: (over.envelope as InventoryPlanEnvelope) ?? base.envelope,
    review: (over.review as SignedReview) ?? base.review,
    expected: over.expected,
    deps: over.deps as ReturnType<typeof makeActivationDeps>,
  })
}

describe('顺利通过的基线（不先证明它能过，后面的「拒」就证明不了什么）', () => {
  it('十道闸全过 → 抓取 → 写入 → 精确对账 → activated', async () => {
    const input = inputWith()
    const audit = await activateReviewedPlan(input)

    expect(audit.status).toBe('activated')
    expect(audit.blockers).toEqual([])
    expect(audit.writtenUrls).toEqual(ACCEPTED)
    expect(audit.counts).toMatchObject({ accepted: 2, deferred: 1, written: 2, crawlFailed: 0 })
    expect(audit.inventoryTouched).toBe(true)
  })

  it('🔴 被拒 / 暂缓的候选一条都没到达持久化', async () => {
    const input = inputWith()
    await activateReviewedPlan(input)
    expect(input.deps.store.allWrittenUrls()).toEqual(ACCEPTED)
    expect(input.deps.store.allWrittenUrls()).not.toContain(REJECTED)
    expect(input.deps.store.allWrittenUrls()).not.toContain(DEFERRED)
  })

  it('审计逐条列出被拒与暂缓，不做汇总即真相', async () => {
    const audit = await activateReviewedPlan(inputWith())
    expect(audit.rejectedUrls.map((r) => r.url)).toContain(REJECTED)
    expect(audit.deferredUrls.map((r) => r.url)).toEqual([DEFERRED])
    expect(audit.deferredUrls[0].reasonCodes).toEqual(['reviewer_deferred'])
  })

  it('🔴 审计带齐 #960 要求的身份字段（验过什么，账上要看得见）', async () => {
    const { envelope, review } = standard()
    const audit = await activateReviewedPlan(inputWith({ envelope, review }))
    expect(audit).toMatchObject({
      planId: envelope.planId,
      generationDigest: envelope.generationDigest,
      generationKeyId: envelope.keyId,
      reviewKeyId: review.keyId,
      issuedAt: ISSUED_AT,
      reviewerIdentitySource: 'self_reported',
      attestationModel: 'server-hmac@1',
      clientId: CLIENT,
    })
  })

  it('不把 Jina 的 200 当页面状态写进台账；重定向证据如实标为不可得', async () => {
    const input = inputWith()
    const audit = await activateReviewedPlan(input)
    expect(audit.redirectEvidence).toBe('unavailable')
    const written = input.deps.store.writes[0].pages[0]
    expect(Object.keys(written)).not.toContain('statusCode')
    expect(Object.keys(written)).not.toContain('status_code')
  })
})

describe('闸 1 · 结构闸：反序列化后缺字段也必须返回审计，不许抛出去', () => {
  it.each([
    ['缺 envelope', (i: ActivateInput) => ({ ...i, envelope: undefined })],
    ['缺 review', (i: ActivateInput) => ({ ...i, review: undefined })],
    ['缺 core', (i: ActivateInput) => ({ ...i, envelope: { ...i.envelope, core: undefined } })],
    ['planId 不是字符串', (i: ActivateInput) => ({ ...i, envelope: { ...i.envelope, planId: 42 } })],
    ['issuedAt 不是字符串', (i: ActivateInput) => ({ ...i, envelope: { ...i.envelope, issuedAt: null } })],
    ['candidates 不是数组', (i: ActivateInput) => ({ ...i, envelope: { ...i.envelope, core: { ...i.envelope.core, candidates: undefined } } })],
    ['candidates 里有 null', (i: ActivateInput) => ({ ...i, envelope: { ...i.envelope, core: { ...i.envelope.core, candidates: [...i.envelope.core.candidates, null] } } })],
    ['候选缺 originalUrl', (i: ActivateInput) => ({ ...i, envelope: { ...i.envelope, core: { ...i.envelope.core, candidates: [{ machineDecision: 'pending' }] } } })],
    ['缺 boundary', (i: ActivateInput) => ({ ...i, envelope: { ...i.envelope, core: { ...i.envelope.core, boundary: undefined } } })],
    ['approvedHosts 不是数组', (i: ActivateInput) => ({ ...i, envelope: { ...i.envelope, core: { ...i.envelope.core, boundary: { ...i.envelope.core.boundary, approvedHosts: 'example.com' } } } })],
    ['discovery 不是数组', (i: ActivateInput) => ({ ...i, envelope: { ...i.envelope, core: { ...i.envelope.core, discovery: 'x' } } })],
    ['discovery 里有畸形项', (i: ActivateInput) => ({ ...i, envelope: { ...i.envelope, core: { ...i.envelope.core, discovery: [{ host: 'example.com' }] } } })],
    ['counts 缺字段', (i: ActivateInput) => ({ ...i, envelope: { ...i.envelope, core: { ...i.envelope.core, counts: { discovered: 1 } } } })],
    ['缺 submission', (i: ActivateInput) => ({ ...i, review: { ...i.review, submission: undefined } })],
    ['reviewedBy 不是字符串', (i: ActivateInput) => ({ ...i, review: { ...i.review, submission: { ...i.review.submission, reviewedBy: 42 } } })],
    ['decisions 不是对象', (i: ActivateInput) => ({ ...i, review: { ...i.review, submission: { ...i.review.submission, decisions: [] as unknown } } })],
    ['acknowledgements 不是对象', (i: ActivateInput) => ({ ...i, review: { ...i.review, submission: { ...i.review.submission, acknowledgements: null } } })],
  ])('%s → 返回 rejected 审计（而不是抛异常）', async (_label, mutate) => {
    const input = inputWith()
    const broken = mutate(input as unknown as ActivateInput) as unknown as ActivateInput
    // 🔴 关键是「不抛」：这个模块对外承诺一定返回一份审计，调用方靠 status 判结局。
    const audit = await activateReviewedPlan({ ...broken, deps: input.deps })
    expect(audit.status).toBe('rejected')
    // 🔴 必须是结构闸**认出来**的 plan_shape_invalid，而不是兜底 catch 抓到的
    //    plan_shape_unexpected —— 后者意味着闸有洞，只是碰巧没炸出去。
    expect(audit.blockers.map((b) => b.code)).toContain('plan_shape_invalid')
    expect(audit.blockers.map((b) => b.code)).not.toContain('plan_shape_unexpected')
    expect(input.deps.crawlSpy).not.toHaveBeenCalled()
    expect(input.deps.store.writes).toHaveLength(0)
  })

  it('🔴 mode 不是 first_activation → fail closed（增量激活尚未设计）', async () => {
    const input = inputWith()
    const audit = await activateReviewedPlan({ ...input, mode: 'incremental' } as unknown as ActivateInput)
    expect(audit.status).toBe('rejected')
    expect(audit.blockers.map((b) => b.code)).toEqual(['unsupported_activation_mode'])
    expect(input.deps.crawlSpy).not.toHaveBeenCalled()
  })
})

describe('闸 2 · L1 生成签名', () => {
  it('内容被改过（digest 没跟着改）→ 拒，一次抓取都没发生', async () => {
    const { envelope, review } = standard()
    const tampered = { ...envelope, core: { ...envelope.core, clientId: 'other-tenant' } }
    const input = inputWith({ envelope: tampered, review })
    const audit = await activateReviewedPlan(input)
    expect(audit.status).toBe('rejected')
    expect(audit.blockers.map((b) => b.code)).toContain('generation_digest_mismatch')
    expect(input.deps.crawlSpy).not.toHaveBeenCalled()
  })

  it('未知 keyId → unknown_key（密钥已作废）', async () => {
    const { envelope, review } = standard()
    const stranger = { ...envelope, keyId: 'gen-retired' }
    const rehashed = { ...stranger, generationDigest: computeGenerationDigest(stranger) }
    const audit = await activateReviewedPlan(inputWith({ envelope: rehashed, review }))
    expect(audit.blockers.map((b) => b.code)).toContain('generation_unknown_key')
  })

  it('🔴 一把生成密钥都没配 → rejected（验不了 ≠ 验过了），且一次抓取都没发生', async () => {
    const deps = makeActivationDeps({ verifyGenerationSignature: createUnavailableVerifier() })
    const input = inputWith({ deps })
    const audit = await activateReviewedPlan(input)
    expect(audit.status).toBe('rejected')
    expect(audit.blockers.map((b) => b.code)).toContain('generation_key_unavailable')
    expect(input.deps.crawlSpy).not.toHaveBeenCalled()
    expect(input.deps.store.countCalls).toBe(0)
  })

  it('验签器自己抛 → 也拒（验不了 ≠ 验过了）', async () => {
    const deps = makeActivationDeps({
      verifyGenerationSignature: () => {
        throw new Error('HSM offline')
      },
    })
    const audit = await activateReviewedPlan(inputWith({ deps }))
    expect(audit.blockers.map((b) => b.code)).toContain('generation_signature_unverifiable')
  })
})

describe(`闸 3 · 七天有效期`, () => {
  it('🔴 超过 7 天 → rejected，且一次抓取都没发生', async () => {
    const deps = makeActivationDeps({ now: () => '2026-08-19T00:00:00.001Z' })
    const input = inputWith({ deps })
    const audit = await activateReviewedPlan(input)
    expect(audit.status).toBe('rejected')
    expect(audit.blockers.map((b) => b.code)).toEqual(['generation_envelope_expired'])
    expect(input.deps.crawlSpy).not.toHaveBeenCalled()
    expect(input.deps.store.countCalls).toBe(0)
  })

  it('第 7 天当天还能激活（边界写死，免得将来靠猜）', async () => {
    const deps = makeActivationDeps({ now: () => '2026-08-19T00:00:00.000Z' })
    const audit = await activateReviewedPlan(inputWith({ deps }))
    expect(audit.status).toBe('activated')
  })

  it('签发时间解析不了 → 拒（不是「当作没过期」）', async () => {
    const badCore = makeCore(ALL)
    const envelope = makeEnvelope(badCore, { issuedAt: 'not-a-date' })
    const review = seal(makeSubmission(envelope, standardDecisions()))
    const audit = await activateReviewedPlan(inputWith({ envelope, review }))
    expect(audit.blockers.map((b) => b.code)).toEqual(['generation_envelope_invalid_timestamp'])
  })

  it('时钟自己抛 → 拒（判不了有效期就不许激活）', async () => {
    const deps = makeActivationDeps({
      now: () => {
        throw new Error('clock skew')
      },
    })
    const audit = await activateReviewedPlan(inputWith({ deps }))
    expect(audit.blockers.map((b) => b.code)).toEqual(['clock_unavailable'])
  })
})

describe('闸 4 · L2 复核凭证', () => {
  it('提交件被改过 → 拒', async () => {
    const { envelope, review } = standard()
    const tampered = { ...review, submission: { ...review.submission, reviewedBy: 'someone-else' } }
    const audit = await activateReviewedPlan(inputWith({ envelope, review: tampered }))
    expect(audit.blockers.map((b) => b.code)).toContain('review_attestation_digest_mismatch')
  })

  it('提交件被改过并重算了 reviewDigest → 仍然拒（重签需要密钥）', async () => {
    const { envelope, review } = standard()
    const submission = { ...review.submission, reviewedBy: 'someone-else' }
    const forged = { ...review, submission, reviewDigest: computeReviewDigest(submission) }
    const audit = await activateReviewedPlan(inputWith({ envelope, review: forged }))
    expect(audit.blockers.map((b) => b.code)).toContain('review_attestation_attestation_invalid')
  })

  it('🔴 一把复核密钥都没配 → rejected（不是「跳过这道闸」）', async () => {
    const deps = makeActivationDeps({ verifyReviewAttestation: createHmacVerifier({ keys: {} }) })
    const input = inputWith({ deps })
    const audit = await activateReviewedPlan(input)
    expect(audit.blockers.map((b) => b.code)).toContain('review_attestation_key_unavailable')
    expect(input.deps.crawlSpy).not.toHaveBeenCalled()
  })

  it('验签器自己抛 → 也拒', async () => {
    const deps = makeActivationDeps({
      verifyReviewAttestation: () => {
        throw new Error('boom')
      },
    })
    const audit = await activateReviewedPlan(inputWith({ deps }))
    expect(audit.blockers.map((b) => b.code)).toContain('review_attestation_unverifiable')
  })
})

describe('闸 5 · L1/L2 绑定', () => {
  it('🔴 planId 对不上 → 拒（一份合法凭证不许配另一份信封）', async () => {
    const { envelope } = standard()
    const other = makeEnvelope(makeCore(ALL), { planId: 'plan-0002' })
    const review = seal(makeSubmission(other, standardDecisions()))
    const input = inputWith({ envelope, review })
    const audit = await activateReviewedPlan(input)
    expect(audit.blockers.map((b) => b.code)).toContain('review_plan_binding_mismatch')
    expect(input.deps.crawlSpy).not.toHaveBeenCalled()
  })

  it('generationDigest 对不上 → 拒', async () => {
    const { envelope } = standard()
    const review = seal({ ...makeSubmission(envelope, standardDecisions()), generationDigest: 'deadbeef' })
    const audit = await activateReviewedPlan(inputWith({ envelope, review }))
    expect(audit.blockers.map((b) => b.code)).toContain('review_digest_binding_mismatch')
  })

  it('🔴 reviewerIdentitySource 不是逐字的 self_reported → 拒（凭证合法也不行）', async () => {
    const { envelope } = standard()
    const review = seal({
      ...makeSubmission(envelope, standardDecisions()),
      reviewerIdentitySource: 'authenticated_session',
    } as unknown as ReviewSubmission)
    const input = inputWith({ envelope, review })
    const audit = await activateReviewedPlan(input)
    expect(audit.blockers.map((b) => b.code)).toContain('invalid_reviewer_identity_source')
    expect(input.deps.crawlSpy).not.toHaveBeenCalled()
  })
})

describe('闸 6 · 版本', () => {
  it.each([
    ['契约版本', { contractVersion: 'canonical-inventory-plan@1' }, 'contract_version_mismatch'],
    ['规则版本', { normalizationRuleVersion: 'inventory-url-rules@0' }, 'rule_version_mismatch'],
  ])('%s 不符 → 拒', async (_label, patch, code) => {
    const core = { ...makeCore(ALL), ...patch }
    const { envelope, review } = standard({ core })
    const input = inputWith({ envelope, review })
    const audit = await activateReviewedPlan(input)
    expect(audit.blockers.map((b) => b.code)).toContain(code)
    expect(input.deps.crawlSpy).not.toHaveBeenCalled()
  })
})

describe('闸 7 · 身份：计划与当前上下文对不上就一次抓取都不发', () => {
  it('租户不符', async () => {
    const input = inputWith({ expected: { clientId: 'other-tenant', requestedDomain: DOMAIN, approvedHosts: HOSTS } })
    const audit = await activateReviewedPlan(input)
    expect(audit.status).toBe('rejected')
    expect(audit.blockers.map((b) => b.code)).toContain('client_mismatch')
    expect(input.deps.crawlSpy).not.toHaveBeenCalled()
  })

  it('域名不符', async () => {
    const audit = await activateReviewedPlan(
      inputWith({ expected: { clientId: CLIENT, requestedDomain: 'other.com', approvedHosts: HOSTS } }),
    )
    expect(audit.blockers.map((b) => b.code)).toContain('domain_mismatch')
  })

  it('🔴 批准主机清单不符（上下文多批了一个 www，计划里没有）', async () => {
    const audit = await activateReviewedPlan(
      inputWith({
        expected: { clientId: CLIENT, requestedDomain: DOMAIN, approvedHosts: ['example.com', 'www.example.com'] },
      }),
    )
    expect(audit.blockers.map((b) => b.code)).toContain('approved_hosts_mismatch')
  })

  it('主机清单只是大小写 / 顺序不同 → 不算不符', async () => {
    const core = makeCore(ALL, { hosts: ['example.com', 'shop.example.com'] })
    const envelope = makeEnvelope(core)
    const review = seal(
      makeSubmission(envelope, standardDecisions(), {
        acknowledgements: { 'shop.example.com': { acknowledgedBy: 'po', reason: '旧站已下线' } },
      }),
    )
    const audit = await activateReviewedPlan(
      inputWith({
        envelope,
        review,
        expected: { clientId: CLIENT, requestedDomain: 'EXAMPLE.com', approvedHosts: ['SHOP.example.com', 'Example.com'] },
      }),
    )
    expect(audit.status).toBe('activated')
  })

  it('身份闸没过时不去打数据库（先拦纯校验，别浪费查询）', async () => {
    const input = inputWith({ expected: { clientId: 'other', requestedDomain: DOMAIN, approvedHosts: HOSTS } })
    await activateReviewedPlan(input)
    expect(input.deps.store.countCalls).toBe(0)
  })
})

describe('闸 8 · 发现覆盖 + 认账', () => {
  it('🔴 发现记录少了一个批准主机 → 拒（那个站根本没被找过）', async () => {
    const base = makeCore(ALL)
    const core: GeneratedPlanCore = {
      ...base,
      boundary: { ...base.boundary, approvedHosts: ['example.com', 'shop.example.com'] },
    }
    const { envelope, review } = standard({ core })
    const audit = await activateReviewedPlan(
      inputWith({
        envelope,
        review,
        expected: { clientId: CLIENT, requestedDomain: DOMAIN, approvedHosts: ['example.com', 'shop.example.com'] },
      }),
    )
    expect(audit.blockers.map((b) => b.code)).toContain('discovery_host_missing')
  })

  it('发现记录里有未批准的主机 → 拒', async () => {
    const base = makeCore(ALL)
    const core: GeneratedPlanCore = {
      ...base,
      discovery: [...base.discovery, { host: 'ghost.example.com', count: 3, foreignCount: 0, error: null }],
    }
    const { envelope, review } = standard({ core })
    const audit = await activateReviewedPlan(inputWith({ envelope, review }))
    expect(audit.blockers.map((b) => b.code)).toContain('discovery_host_unapproved')
  })

  it('🔴 某个主机 0 条 / 出错且没人署名认过 → 拒', async () => {
    const core = makeCore(['https://example.com/a'], { hosts: ['example.com', 'shop.example.com'] })
    const envelope = makeEnvelope(core)
    const review = seal(makeSubmission(envelope, acceptAllPending(core)))
    const input = inputWith({
      envelope,
      review,
      expected: { clientId: CLIENT, requestedDomain: DOMAIN, approvedHosts: ['example.com', 'shop.example.com'] },
    })
    const audit = await activateReviewedPlan(input)
    expect(audit.blockers.map((b) => b.code)).toContain('incomplete_discovery_not_acknowledged')
    expect(input.deps.crawlSpy).not.toHaveBeenCalled()
  })

  it('认过的 0 条主机不再拦（人已经分清楚了）', async () => {
    const core = makeCore(['https://example.com/a'], { hosts: ['example.com', 'shop.example.com'] })
    const envelope = makeEnvelope(core)
    const review = seal(
      makeSubmission(envelope, acceptAllPending(core), {
        acknowledgements: { 'shop.example.com': { acknowledgedBy: 'po', reason: '旧品牌站已下线' } },
      }),
    )
    const audit = await activateReviewedPlan(
      inputWith({
        envelope,
        review,
        expected: { clientId: CLIENT, requestedDomain: DOMAIN, approvedHosts: ['example.com', 'shop.example.com'] },
      }),
    )
    expect(audit.status).toBe('activated')
  })
})

describe('闸 9 · 被接受集合', () => {
  it('🔴 还有 pending 没判 → 拒', async () => {
    const { envelope } = standard()
    const review = seal(makeSubmission(envelope, { [ACCEPTED[0]]: { decision: 'accepted' } }))
    const input = inputWith({ envelope, review })
    const audit = await activateReviewedPlan(input)
    expect(audit.blockers.map((b) => b.code)).toContain('unreviewed_candidate')
    expect(input.deps.crawlSpy).not.toHaveBeenCalled()
  })

  it('🔴 决策值认不出来 → 拒（它会从每一份账里消失）', async () => {
    const { envelope } = standard()
    const review = seal(
      makeSubmission(envelope, {
        ...standardDecisions(),
        [ACCEPTED[0]]: { decision: 'accept' },
      } as unknown as Record<string, ReviewDecisionEntry>),
    )
    const audit = await activateReviewedPlan(inputWith({ envelope, review }))
    expect(audit.blockers.map((b) => b.code)).toContain('invalid_decision')
  })

  it('🔴 规则自动拒的候选被人改成 accepted → 拒', async () => {
    const { envelope } = standard()
    const review = seal(makeSubmission(envelope, { ...standardDecisions(), [REJECTED]: { decision: 'accepted' } }))
    const audit = await activateReviewedPlan(inputWith({ envelope, review }))
    expect(audit.blockers.map((b) => b.code)).toContain('auto_rejected_not_overridable')
  })

  it('决策指向不存在的候选 → 拒', async () => {
    const { envelope } = standard()
    const review = seal(
      makeSubmission(envelope, { ...standardDecisions(), 'https://example.com/typo': { decision: 'accepted' } }),
    )
    const audit = await activateReviewedPlan(inputWith({ envelope, review }))
    expect(audit.blockers.map((b) => b.code)).toContain('unknown_candidate')
  })

  it('被接受集合为空 → 拒（没有可激活的台账）', async () => {
    const { envelope } = standard()
    const review = seal(
      makeSubmission(envelope, {
        [ACCEPTED[0]]: { decision: 'rejected' },
        [ACCEPTED[1]]: { decision: 'rejected' },
        [DEFERRED]: { decision: 'defer' },
      }),
    )
    const input = inputWith({ envelope, review })
    const audit = await activateReviewedPlan(input)
    expect(audit.blockers.map((b) => b.code)).toContain('empty_accepted_set')
    expect(input.deps.crawlSpy).not.toHaveBeenCalled()
  })

  it('🔴 canonical 被换成同一主机下的另一页（串本身完全规范）→ 仍然拒', async () => {
    const base = makeCore(ALL)
    const core: GeneratedPlanCore = {
      ...base,
      candidates: base.candidates.map((c) =>
        c.originalUrl === ACCEPTED[0] ? { ...c, canonicalUrl: 'https://example.com/hacked' } : c,
      ),
    }
    const { envelope, review } = standard({ core })
    const input = inputWith({ envelope, review })
    const audit = await activateReviewedPlan(input)
    expect(audit.blockers.map((b) => b.code)).toContain('accepted_url_not_derived')
    expect(input.deps.crawlSpy).not.toHaveBeenCalled()
  })

  it('被接受但没有 canonical URL → 拒', async () => {
    const base = makeCore(ALL)
    const core: GeneratedPlanCore = {
      ...base,
      candidates: base.candidates.map((c) => (c.originalUrl === ACCEPTED[0] ? { ...c, canonicalUrl: null } : c)),
    }
    const { envelope, review } = standard({ core })
    const audit = await activateReviewedPlan(inputWith({ envelope, review }))
    expect(audit.blockers.map((b) => b.code)).toContain('accepted_without_canonical')
  })

  it('被接受集合里出现重复 canonical → 拒', async () => {
    const base = makeCore(ALL)
    const core: GeneratedPlanCore = {
      ...base,
      candidates: base.candidates.map((c) =>
        c.originalUrl === ACCEPTED[1] ? { ...c, originalUrl: ACCEPTED[0], canonicalUrl: ACCEPTED[0] } : c,
      ),
    }
    const envelope = makeEnvelope(core)
    const review = seal(
      makeSubmission(envelope, { [ACCEPTED[0]]: { decision: 'accepted' }, [DEFERRED]: { decision: 'defer' } }),
    )
    const audit = await activateReviewedPlan(inputWith({ envelope, review }))
    expect(audit.blockers.map((b) => b.code)).toContain('duplicate_accepted_target')
  })
})

describe('闸 10 · 空库闸（首次激活）', () => {
  it('台账已有行 → 拒，一条都不写', async () => {
    const deps = makeActivationDeps({ store: new FakeInventoryStore({ existingCount: 4 }) })
    const input = inputWith({ deps })
    const audit = await activateReviewedPlan(input)
    expect(audit.status).toBe('rejected')
    expect(audit.blockers.map((b) => b.code)).toContain('inventory_not_empty')
    expect(input.deps.store.writes).toHaveLength(0)
    expect(input.deps.crawlSpy).not.toHaveBeenCalled()
  })

  it('🔴 读不到行数 ≠ 行数为 0 —— 读失败也拒，而且一次抓取都不发', async () => {
    const deps = makeActivationDeps({ store: new FakeInventoryStore({ countError: 'connection reset' }) })
    const input = inputWith({ deps })
    const audit = await activateReviewedPlan(input)
    expect(audit.status).toBe('rejected')
    expect(audit.blockers.map((b) => b.code)).toContain('inventory_count_unavailable')
    expect(input.deps.crawlSpy).not.toHaveBeenCalled()
  })

  it('🔴 抓取期间台账被别人写了（第一次读 0、写之前读到 4）→ 停手，一行不写', async () => {
    const deps = makeActivationDeps({ store: new FakeInventoryStore({ countSequence: [0, 4] }) })
    const input = inputWith({ deps })
    const audit = await activateReviewedPlan(input)
    expect(audit.status).toBe('failed')
    expect(audit.blockers.map((b) => b.code)).toContain('inventory_changed_during_crawl')
    expect(input.deps.store.writes).toHaveLength(0)
    expect(audit.inventoryTouched).toBe(false)
  })

  it('写入前那次复查读失败 → 也停手（读不到 ≠ 仍然是空的）', async () => {
    const store = new FakeInventoryStore({ countSequence: [0] })
    let calls = 0
    store.countExistingPages = async () => {
      calls++
      if (calls === 1) return 0
      throw new Error('read timeout')
    }
    const audit = await activateReviewedPlan(inputWith({ deps: makeActivationDeps({ store }) }))
    expect(audit.status).toBe('failed')
    expect(audit.blockers.map((b) => b.code)).toContain('inventory_count_unavailable')
  })

  it('🔴 写入时把「必须仍为空」的要求传给 store（实现方得在事务里再确认一次）', async () => {
    const input = inputWith()
    await activateReviewedPlan(input)
    expect(input.deps.store.requireEmptyFlags).toEqual([true])
  })
})

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

  it('闸门在决策解析之前就失败时，账里仍然看得见机器拒了哪些', async () => {
    const deps = makeActivationDeps({ now: () => '2026-09-19T00:00:00.000Z' })
    const audit = await activateReviewedPlan(inputWith({ deps }))
    expect(audit.status).toBe('rejected')
    expect(audit.rejectedUrls.map((r) => r.url)).toContain(REJECTED)
  })
})

describe('时间源', () => {
  it('基线用的 NOW 稳稳在有效期内（免得整组测试靠运气）', () => {
    expect(Date.parse(NOW) - Date.parse(ISSUED_AT)).toBeLessThan(7 * 24 * 60 * 60 * 1000)
    expect(verifyGeneration).not.toBe(verifyReview)
  })
})
