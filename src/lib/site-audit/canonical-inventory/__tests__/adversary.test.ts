/**
 * 对抗测试（Issue #960）—— 这一组是本次改动的**核心证据**。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 对手模型
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 对手 = **计划编辑者**：他拿得到工件全文和全部公开代码（`computeGenerationDigest`、
 * `computeReviewDigest`、`canonicaliseUrl` 都是导出的），**拿不到任何密钥**。
 *
 * 所以每一条攻击都按「一个足够细心的人会怎么做」来构造：改内容之后，
 * 把 digest、绑定字段、计数**全部同步改到自洽**，只有签名改不动。
 * 这正是 #930 那套「重新推导再对账」全部失效的地方 ——
 * 它比对的两边都来自同一份可编辑对象。
 *
 * 🔴 判据是三条一起看，缺一条这组测试就是自欺：
 *    1. `status === 'rejected'`；
 *    2. **一次抓取都没发生**（crawl spy 零调用）；
 *    3. **一行都没写**（store 零写入）。
 *
 * ⚠️ **诚实说明这一组的射程**：A–F 六条攻击都改了 `core` 或信封顶层，因而全部落在
 *    **同一道闸（L1）的同一条分支**上 —— 它们是「签名覆盖面包含哪些字段」的六种取值，
 *    不是六种独立防御。字段级的穷举证明在 `envelope.test.ts`（20 个 coreCases）。
 *    这一组的价值是**端到端**：证明这些篡改在真实激活链路上确实走不到抓取和写入。
 *    另外两条（只伪造 L2、重放）才是不同的防御维度，单独列在下面。
 */

import { describe, expect, it } from 'vitest'
import { activateReviewedPlan } from '../activation'
import { computeGenerationDigest } from '../envelope'
import { computeReviewDigest } from '../attestation'
import {
  acceptAllPending,
  CLIENT,
  DOMAIN,
  HOSTS,
  makeActivationDeps,
  makeActivationInput,
  makeCore,
  makeEnvelope,
  makeSubmission,
  revSigner,
  verifyGeneration,
} from './fixtures'
import { FakeInventoryStore } from './fake-store'
import { signReview } from '../review'
import type { GeneratedPlanCore, InventoryPlanEnvelope, ReviewDecisionEntry, SignedReview } from '../types'

const URLS = ['https://example.com/a', 'https://example.com/b', 'http://example.com/insecure', 'garbage']

/** 一份**完全合法**的信封 + 凭证 —— 攻击都从它出发。 */
function legitimate(): { envelope: InventoryPlanEnvelope; review: SignedReview } {
  const envelope = makeEnvelope(makeCore(URLS))
  const review = signReview(envelope, makeSubmission(envelope, acceptAllPending(envelope.core)), {
    verifyGenerationSignature: verifyGeneration,
    signer: revSigner,
  })
  return { envelope, review }
}

/**
 * 编辑者拿到工件之后能做的**全部**善后工作：
 * 重算 generationDigest、把凭证里的绑定字段改到一致、重算 reviewDigest。
 * 两枚签名原样保留 —— 那两样需要密钥。
 */
function forge(
  envelope: InventoryPlanEnvelope,
  review: SignedReview,
  mutate: (core: GeneratedPlanCore) => GeneratedPlanCore,
  extraDecisions: Record<string, ReviewDecisionEntry> = {},
): { envelope: InventoryPlanEnvelope; review: SignedReview } {
  const tamperedCore = mutate(envelope.core)
  const withCore = { ...envelope, core: tamperedCore }
  const forgedEnvelope = { ...withCore, generationDigest: computeGenerationDigest(withCore) }
  const submission = {
    ...review.submission,
    generationDigest: forgedEnvelope.generationDigest,
    decisions: { ...review.submission.decisions, ...extraDecisions },
  }
  return {
    envelope: forgedEnvelope,
    review: { ...review, submission, reviewDigest: computeReviewDigest(submission) },
  }
}

async function expectBlocked(
  forged: { envelope: InventoryPlanEnvelope; review: SignedReview },
  label: string,
): Promise<void> {
  const input = makeActivationInput(forged)
  const audit = await activateReviewedPlan(input)

  expect(audit.status, `${label}：状态`).toBe('rejected')
  expect(audit.blockers.map((b) => b.code), `${label}：blocker`).toContain('generation_signature_invalid')
  expect(input.deps.crawlSpy, `${label}：不许发生任何抓取`).not.toHaveBeenCalled()
  expect(input.deps.store.writes, `${label}：不许写任何一行`).toHaveLength(0)
}

describe('基线：不动手脚的同一条链路真的能激活（否则下面的「拒」证明不了什么）', () => {
  it('合法信封 + 合法凭证 → activated，写入的正是被接受的两条', async () => {
    const input = makeActivationInput(legitimate())
    const audit = await activateReviewedPlan(input)

    expect(audit.status).toBe('activated')
    expect(audit.writtenUrls).toEqual(['https://example.com/a', 'https://example.com/b'])
    expect(input.deps.crawlSpy).toHaveBeenCalledTimes(1)
  })
})

describe('🔴 六种协调一致的篡改，全部被 L1 拒于抓取之前', () => {
  it('攻击 A · 插入一条已批准主机上、discovery 从未发现过的 URL（这条在 #930 会写进生产台账）', async () => {
    // #960 与 PR #958 的描述里都写着「不影响生产写入」——那句只对**删除**成立。
    // 插入一条落在批准主机上、能通过归一规则的 URL，再把 discovery 计数与 counts
    // 同步改齐、重算哈希，#930 的每一道闸都会放行，最终抓取并写入一个没人复核过的页面。
    const { envelope, review } = legitimate()
    const injected = 'https://example.com/never-discovered'
    const forged = forge(
      envelope,
      review,
      (core) => ({
        ...core,
        // 插在字典序正确的位置，连「重新构造逐字段比对」都骗得过
        candidates: [
          ...core.candidates.filter((c) => c.originalUrl < injected),
          {
            originalUrl: injected,
            canonicalUrl: injected,
            machineDecision: 'pending' as const,
            reasonCodes: [],
            notes: [],
          },
          ...core.candidates.filter((c) => c.originalUrl > injected),
        ],
        discovery: core.discovery.map((d) => (d.host === 'example.com' ? { ...d, count: d.count + 1 } : d)),
        counts: { ...core.counts, discovered: core.counts.discovered + 1, pending: core.counts.pending + 1 },
      }),
      { [injected]: { decision: 'accepted' } },
    )
    await expectBlocked(forged, '攻击 A · 插入')
  })

  it('攻击 B · 删掉一条 malformed 候选（它不进任何主机统计，逐主机对账天生看不见）', async () => {
    const { envelope, review } = legitimate()
    const forged = forge(envelope, review, (core) => ({
      ...core,
      candidates: core.candidates.filter((c) => c.originalUrl !== 'garbage'),
      counts: { ...core.counts, discovered: core.counts.discovered - 1, rejected: core.counts.rejected - 1 },
    }))
    await expectBlocked(forged, '攻击 B · 删除 malformed')
  })

  it('攻击 C · 成对替换 originalUrl 与 canonicalUrl（换成同主机下的另一个真实页面）', async () => {
    const { envelope, review } = legitimate()
    const forged = forge(envelope, review, (core) => ({
      ...core,
      candidates: core.candidates.map((c) =>
        c.originalUrl === 'https://example.com/a'
          ? { ...c, originalUrl: 'https://example.com/hacked', canonicalUrl: 'https://example.com/hacked' }
          : c,
      ),
    }))
    // 决策也要跟着换 key，否则会先被「有 pending 没判」拦下 —— 那样测的就不是 L1 了。
    const submission = {
      ...forged.review.submission,
      decisions: {
        'https://example.com/hacked': { decision: 'accepted' as const },
        'https://example.com/b': { decision: 'accepted' as const },
      },
    }
    await expectBlocked(
      {
        envelope: forged.envelope,
        review: { ...forged.review, submission, reviewDigest: computeReviewDigest(submission) },
      },
      '攻击 C · 成对替换',
    )
  })

  it('攻击 D · 整条删掉某个主机的全部候选，并同步改小该主机的发现计数', async () => {
    const twoHostCore = makeCore(['https://example.com/a', 'https://shop.example.com/b'], {
      hosts: ['example.com', 'shop.example.com'],
    })
    const envelope = makeEnvelope(twoHostCore)
    const review = signReview(envelope, makeSubmission(envelope, acceptAllPending(envelope.core)), {
      verifyGenerationSignature: verifyGeneration,
      signer: revSigner,
    })
    const forged = forge(envelope, review, (core) => ({
      ...core,
      candidates: core.candidates.filter((c) => !c.originalUrl.startsWith('https://shop.')),
      discovery: core.discovery.map((d) =>
        d.host === 'shop.example.com' ? { ...d, count: 0, error: null } : d,
      ),
      counts: { ...core.counts, discovered: core.counts.discovered - 1, pending: core.counts.pending - 1 },
    }))
    const submission = {
      ...forged.review.submission,
      decisions: { 'https://example.com/a': { decision: 'accepted' as const } },
      // 顺手把「0 条」的认账也补齐 —— 这一步没有密钥也做得到
      acknowledgements: { 'shop.example.com': { acknowledgedBy: 'me', reason: '我说没有就没有' } },
    }
    await expectBlocked(
      {
        envelope: forged.envelope,
        review: { ...forged.review, submission, reviewDigest: computeReviewDigest(submission) },
      },
      '攻击 D · 删整站',
    )
  })

  it('攻击 E · 改 issuedAt 绕过七天有效期（第一版设计漏签的字段之一）', async () => {
    const { envelope, review } = legitimate()
    const moved = { ...envelope, issuedAt: '2026-08-20T00:00:00.000Z' }
    const forgedEnvelope = { ...moved, generationDigest: computeGenerationDigest(moved) }
    const submission = { ...review.submission, generationDigest: forgedEnvelope.generationDigest }
    await expectBlocked(
      {
        envelope: forgedEnvelope,
        review: { ...review, submission, reviewDigest: computeReviewDigest(submission) },
      },
      '攻击 E · 改 issuedAt',
    )
  })

  it('攻击 F · 改 planId 破坏 L1/L2 的重放身份绑定（第一版设计漏签的另一个字段）', async () => {
    const { envelope, review } = legitimate()
    const renamed = { ...envelope, planId: 'plan-forged' }
    const forgedEnvelope = { ...renamed, generationDigest: computeGenerationDigest(renamed) }
    const submission = {
      ...review.submission,
      planId: 'plan-forged',
      generationDigest: forgedEnvelope.generationDigest,
    }
    await expectBlocked(
      {
        envelope: forgedEnvelope,
        review: { ...review, submission, reviewDigest: computeReviewDigest(submission) },
      },
      '攻击 F · 改 planId',
    )
  })
})

describe('🔴 只伪造 L2、L1 保持完好（另一条防御维度）', () => {
  it('把复核人拒掉的一页改成 accepted + 重算 reviewDigest（L1 一个字节没动）→ 被 L2 拒，零抓取零写入', async () => {
    // 复核人明确拒了 /b，编辑者想把它改回 accepted。
    // L1 完好 ⇒ 闸 2 放行；真正拦下它的是闸 4（L2 凭证）。
    const envelope = makeEnvelope(makeCore(URLS))
    const review = signReview(
      envelope,
      makeSubmission(envelope, {
        'https://example.com/a': { decision: 'accepted' },
        'https://example.com/b': { decision: 'rejected' },
      }),
      { verifyGenerationSignature: verifyGeneration, signer: revSigner },
    )
    const submission = {
      ...review.submission,
      decisions: { ...review.submission.decisions, 'https://example.com/b': { decision: 'accepted' as const } },
    }
    expect(computeReviewDigest(submission), '构造无效：提交件必须真的变了').not.toBe(review.reviewDigest)
    const input = makeActivationInput({
      envelope,
      review: { ...review, submission, reviewDigest: computeReviewDigest(submission) },
    })
    const audit = await activateReviewedPlan(input)

    expect(audit.status).toBe('rejected')
    expect(audit.blockers.map((b) => b.code)).toContain('review_attestation_attestation_invalid')
    expect(input.deps.crawlSpy).not.toHaveBeenCalled()
    expect(input.deps.store.writes).toHaveLength(0)
  })

  it('伪造认账（把一个 0 条主机的不完整发现「认掉」）→ 同样被 L2 拒', async () => {
    const core = makeCore(['https://example.com/a'], { hosts: ['example.com', 'shop.example.com'] })
    const envelope = makeEnvelope(core)
    const review = signReview(
      envelope,
      makeSubmission(envelope, acceptAllPending(core), {
        acknowledgements: { 'shop.example.com': { acknowledgedBy: 'po', reason: '旧站已下线' } },
      }),
      { verifyGenerationSignature: verifyGeneration, signer: revSigner },
    )
    const submission = { ...review.submission, acknowledgements: { 'shop.example.com': { acknowledgedBy: '我', reason: '我说的' } } }
    const input = makeActivationInput({
      envelope,
      review: { ...review, submission, reviewDigest: computeReviewDigest(submission) },
      expected: { clientId: CLIENT, requestedDomain: DOMAIN, approvedHosts: ['example.com', 'shop.example.com'] },
    })
    const audit = await activateReviewedPlan(input)

    expect(audit.status).toBe('rejected')
    expect(audit.blockers.map((b) => b.code)).toContain('review_attestation_attestation_invalid')
    expect(input.deps.crawlSpy).not.toHaveBeenCalled()
  })
})

describe('🔴 重放：同一枚信封 + 同一份凭证跑第二遍', () => {
  it('第一次 activated；第二次被自己写进去的行挡住 → rejected，第二次零写入', async () => {
    // 🔴 这是「防重放靠首次激活的空库闸」这句话的**唯一**端到端依据。
    //    预置 existingCount 的假店只能证明「空库闸会响」，证明不了这条因果链。
    const store = new FakeInventoryStore({ countFromWrites: true })
    const { envelope, review } = legitimate()
    const expected = { clientId: CLIENT, requestedDomain: DOMAIN, approvedHosts: HOSTS }

    const first = await activateReviewedPlan({
      envelope,
      review,
      expected,
      mode: 'first_activation',
      deps: makeActivationDeps({ store }),
    })
    expect(first.status).toBe('activated')
    expect(store.writes).toHaveLength(1)

    const replayDeps = makeActivationDeps({ store })
    const second = await activateReviewedPlan({
      envelope,
      review,
      expected,
      mode: 'first_activation',
      deps: replayDeps,
    })
    expect(second.status).toBe('rejected')
    expect(second.blockers.map((b) => b.code)).toContain('inventory_not_empty')
    expect(replayDeps.crawlSpy, '重放时连抓取都不该发生').not.toHaveBeenCalled()
    expect(store.writes, '第二次一行都不许写').toHaveLength(1)
  })

  it('⚠️ 记账：台账被清空后同一枚信封仍可在七天内再跑 —— 单次消费没有独立记录', async () => {
    // 这不是「通过」，是把一个**已知限制**钉成可执行的事实：
    // 防重放 100% 委托给 store 的空库判断，没有任何「已消费」标记。
    // 放开增量激活之前必须先落地一次性消费的持久化记录（#960 冻结决议硬条款 1）。
    const { envelope, review } = legitimate()
    const expected = { clientId: CLIENT, requestedDomain: DOMAIN, approvedHosts: HOSTS }
    const run = () =>
      activateReviewedPlan({ envelope, review, expected, mode: 'first_activation', deps: makeActivationDeps() })
    expect((await run()).status).toBe('activated')
    expect((await run()).status).toBe('activated')
  })

  it('⚠️ 记账：同一枚 L1 可以盖出多份各自合法、决策不同的 L2', async () => {
    // `signReview` 不是一次性的。文档措辞必须写明这一点（见 attestation.ts 文件头）。
    const envelope = makeEnvelope(makeCore(['https://example.com/a', 'https://example.com/b']))
    const deps = { verifyGenerationSignature: verifyGeneration, signer: revSigner }
    const both = signReview(envelope, makeSubmission(envelope, acceptAllPending(envelope.core)), deps)
    const onlyOne = signReview(
      envelope,
      makeSubmission(envelope, {
        'https://example.com/a': { decision: 'accepted' },
        'https://example.com/b': { decision: 'rejected' },
      }),
      deps,
    )
    expect(both.reviewAttestation).not.toBe(onlyOne.reviewAttestation)
    const a = await activateReviewedPlan({
      envelope,
      review: both,
      expected: { clientId: CLIENT, requestedDomain: DOMAIN, approvedHosts: HOSTS },
      mode: 'first_activation',
      deps: makeActivationDeps(),
    })
    const b = await activateReviewedPlan({
      envelope,
      review: onlyOne,
      expected: { clientId: CLIENT, requestedDomain: DOMAIN, approvedHosts: HOSTS },
      mode: 'first_activation',
      deps: makeActivationDeps(),
    })
    expect(a.writtenUrls).toHaveLength(2)
    expect(b.writtenUrls).toHaveLength(1)
  })
})

describe('🔴 凭证张冠李戴', () => {
  it('拿另一份计划的合法 L2 配这一份合法 L1 → 拒，且一次抓取都没发生', async () => {
    const a = legitimate()
    const otherEnvelope = makeEnvelope(makeCore(['https://example.com/x', 'https://example.com/y']), {
      planId: 'plan-0002',
    })
    const otherReview = signReview(
      otherEnvelope,
      makeSubmission(otherEnvelope, acceptAllPending(otherEnvelope.core)),
      { verifyGenerationSignature: verifyGeneration, signer: revSigner },
    )

    const input = makeActivationInput({ envelope: a.envelope, review: otherReview })
    const audit = await activateReviewedPlan(input)

    expect(audit.status).toBe('rejected')
    expect(audit.blockers.map((b) => b.code)).toContain('review_plan_binding_mismatch')
    expect(input.deps.crawlSpy).not.toHaveBeenCalled()
    expect(input.deps.store.writes).toHaveLength(0)
  })
})
