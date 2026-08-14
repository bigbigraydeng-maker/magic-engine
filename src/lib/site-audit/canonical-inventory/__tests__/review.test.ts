/**
 * 复核盖章 + L2 完整性凭证（Issue #960）。
 *
 * 🔴 这一组盯的是 #930 那句「拿到什么就给什么盖章」—— 持密钥的一方对递进来的
 *    任何东西背书。现在第一件事就是验 L1：**信封验不过，一个字都不盖。**
 */

import { describe, expect, it } from 'vitest'
import { signReview } from '../review'
import { computeReviewDigest, verifyReviewAttestation } from '../attestation'
import { computeGenerationDigest } from '../envelope'
import { createHmacVerifier, createUnavailableVerifier } from '../signing'
import {
  acceptAllPending,
  makeCore,
  makeEnvelope,
  makeSubmission,
  revSigner,
  verifyGeneration,
  verifyReview,
} from './fixtures'
import type { InventoryPlanEnvelope, ReviewSubmission } from '../types'
import { InventoryPlanError } from '../plan'

/**
 * 断言抛出的是**指定 code** 的错误，而不是「消息里恰好含某几个字」。
 *
 * 🔴 用 code 不用消息：消息是给人读的，随时会被改写；code 是契约的一部分，
 *    审计与变异探针都按它分组。拿消息做判据，改一句文案就能让判据静默失效。
 */
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

const URLS = ['https://example.com/a', 'https://example.com/b', 'http://example.com/insecure']

function envelopeAndDecisions(): { envelope: InventoryPlanEnvelope; decisions: Record<string, { decision: 'accepted' }> } {
  const envelope = makeEnvelope(makeCore(URLS))
  return { envelope, decisions: acceptAllPending(envelope.core) as Record<string, { decision: 'accepted' }> }
}

const deps = { verifyGenerationSignature: verifyGeneration, signer: revSigner }

describe('顺利盖章的基线', () => {
  it('L1 验得过 + 决策齐全 → 盖出一份验得过的 L2', () => {
    const { envelope, decisions } = envelopeAndDecisions()
    const review = signReview(envelope, makeSubmission(envelope, decisions), deps)

    expect(verifyReviewAttestation(review, verifyReview)).toBe('valid')
    expect(review.reviewDigest).toBe(computeReviewDigest(review.submission))
    expect(review.submission.reviewerIdentitySource).toBe('self_reported')
    // 🔴 L2 用的是复核密钥，不是生成密钥 —— 拿生成密钥环去验必须验不过。
    expect(verifyReviewAttestation(review, verifyGeneration)).toBe('unknown_key')
  })
})

describe('🔴 盖章前必须先验 L1（信封验不过，一个字都不盖）', () => {
  it('信封内容被改过（digest 没跟着改）→ 抛', () => {
    const { envelope, decisions } = envelopeAndDecisions()
    const tampered = { ...envelope, core: { ...envelope.core, clientId: 'other-tenant' } }
    expectCode(() => signReview(tampered, makeSubmission(tampered, decisions), deps), 'generation_digest_mismatch')
  })

  it('🔴 信封内容被改过**并用公开函数重算了 digest** → 仍然抛（重签需要密钥）', () => {
    const { envelope, decisions } = envelopeAndDecisions()
    const swapped = {
      ...envelope,
      core: {
        ...envelope.core,
        candidates: envelope.core.candidates.map((c, i) =>
          i === 0 ? { ...c, originalUrl: 'https://example.com/x', canonicalUrl: 'https://example.com/x' } : c,
        ),
      },
    }
    const rehashed = { ...swapped, generationDigest: computeGenerationDigest(swapped) }
    expectCode(() => signReview(rehashed, makeSubmission(rehashed, decisions), deps), 'generation_signature_invalid')
  })

  it('密钥已作废（keyId 不在环里）→ 抛，且说清是密钥问题', () => {
    const { envelope, decisions } = envelopeAndDecisions()
    const stranger = { ...envelope, keyId: 'gen-retired' }
    const rehashed = { ...stranger, generationDigest: computeGenerationDigest(stranger) }
    expectCode(() => signReview(rehashed, makeSubmission(rehashed, decisions), deps), 'generation_unknown_key')
  })

  it('一把生成密钥都没配 → 抛 key_unavailable（验不了 ≠ 验过了）', () => {
    const { envelope, decisions } = envelopeAndDecisions()
    expectCode(() => signReview(envelope, makeSubmission(envelope, decisions), {
        ...deps,
        verifyGenerationSignature: createHmacVerifier({ keys: {} }),
      }), 'generation_key_unavailable')
  })

  it('验签器自己抛 → 也拒（验不了 ≠ 验过了）', () => {
    const { envelope, decisions } = envelopeAndDecisions()
    expectCode(() => signReview(envelope, makeSubmission(envelope, decisions), {
        ...deps,
        verifyGenerationSignature: () => {
          throw new Error('HSM offline')
        },
      }), 'generation_signature_unverifiable')
  })

  it('恒判 key_unavailable 的显式验签器同样拒（组合根没配密钥时该注入它）', () => {
    const { envelope, decisions } = envelopeAndDecisions()
    expectCode(() => signReview(envelope, makeSubmission(envelope, decisions), {
        ...deps,
        verifyGenerationSignature: createUnavailableVerifier(),
      }), 'generation_key_unavailable')
  })
})

describe('🔴 L2 必须绑定到确切那一份 L1', () => {
  it('planId 对不上 → 抛', () => {
    const { envelope, decisions } = envelopeAndDecisions()
    const submission = { ...makeSubmission(envelope, decisions), planId: 'plan-other' }
    expectCode(() => signReview(envelope, submission, deps), 'review_plan_id_mismatch')
  })

  it('generationDigest 对不上 → 抛（一份合法凭证不许配另一份信封）', () => {
    const { envelope, decisions } = envelopeAndDecisions()
    const submission = { ...makeSubmission(envelope, decisions), generationDigest: 'deadbeef' }
    expectCode(() => signReview(envelope, submission, deps), 'review_digest_binding_mismatch')
  })
})

describe('🔴 reviewerIdentitySource 只接受逐字的 self_reported', () => {
  it.each([
    ['authenticated_session', 'authenticated_session'],
    ['拼错', 'self-reported'],
    ['空', ''],
    ['缺失', undefined],
  ])('%s → 抛', (_label, value) => {
    const { envelope, decisions } = envelopeAndDecisions()
    const submission = {
      ...makeSubmission(envelope, decisions),
      reviewerIdentitySource: value,
    } as unknown as ReviewSubmission
    expectCode(() => signReview(envelope, submission, deps), 'invalid_reviewer_identity_source')
  })

  it('🔴 它进 reviewDigest —— 盖完章再改它，凭证立刻验不过', () => {
    const { envelope, decisions } = envelopeAndDecisions()
    const review = signReview(envelope, makeSubmission(envelope, decisions), deps)
    const tampered = {
      ...review,
      submission: { ...review.submission, reviewerIdentitySource: 'authenticated_session' },
    } as unknown as typeof review
    expect(verifyReviewAttestation(tampered, verifyReview)).toBe('digest_mismatch')
    expect(
      verifyReviewAttestation({ ...tampered, reviewDigest: computeReviewDigest(tampered.submission) }, verifyReview),
    ).toBe('attestation_invalid')
  })
})

describe('复核署名与时间', () => {
  it('没署名 → 抛', () => {
    const { envelope, decisions } = envelopeAndDecisions()
    expectCode(() => signReview(envelope, makeSubmission(envelope, decisions, { reviewedBy: '  ' }), deps), 'missing_reviewer')
  })

  it.each(['not-a-date', '2026-13-45', '昨天'])('复核时间「%s」不是 ISO 8601 → 抛', (bad) => {
    const { envelope, decisions } = envelopeAndDecisions()
    expectCode(() => signReview(envelope, makeSubmission(envelope, decisions, { reviewedAt: bad }), deps), 'invalid_timestamp')
  })
})

describe('🔴 人工决策的运行时校验', () => {
  it('决策指向不存在的候选 → 抛', () => {
    const { envelope, decisions } = envelopeAndDecisions()
    const submission = makeSubmission(envelope, { ...decisions, 'https://example.com/typo': { decision: 'accepted' } })
    expectCode(() => signReview(envelope, submission, deps), 'unknown_candidate')
  })

  it('决策值拼错（accept 少个 ed）→ 抛，不许带着凭证往下走', () => {
    const { envelope, decisions } = envelopeAndDecisions()
    const broken = { ...decisions, 'https://example.com/a': { decision: 'accept' } } as unknown as typeof decisions
    expectCode(() => signReview(envelope, makeSubmission(envelope, broken), deps), 'invalid_decision')
  })

  it('人工原因码拼错 → 抛', () => {
    const { envelope, decisions } = envelopeAndDecisions()
    const broken = {
      ...decisions,
      'https://example.com/a': { decision: 'rejected', reasonCodes: ['reviewr_rejected'] },
    } as unknown as typeof decisions
    expectCode(() => signReview(envelope, makeSubmission(envelope, broken), deps), 'invalid_reason_code')
  })

  it('🔴 规则自动拒掉的候选不许被人碰（哪怕只是重复标一次 rejected）', () => {
    const { envelope, decisions } = envelopeAndDecisions()
    const broken = { ...decisions, 'http://example.com/insecure': { decision: 'accepted' } } as typeof decisions
    expectCode(() => signReview(envelope, makeSubmission(envelope, broken), deps), 'auto_rejected_not_overridable')
  })

  it('🔴 还有 pending 没判 → 抛（漏判不许当成「不要」）', () => {
    const { envelope, decisions } = envelopeAndDecisions()
    const partial = { 'https://example.com/a': decisions['https://example.com/a'] }
    expectCode(() => signReview(envelope, makeSubmission(envelope, partial), deps), 'unreviewed_candidate')
  })

  it('拒 / 暂缓不给原因码时自动补机器可读原因码', () => {
    const { envelope } = envelopeAndDecisions()
    const review = signReview(
      envelope,
      makeSubmission(envelope, {
        'https://example.com/a': { decision: 'rejected' },
        'https://example.com/b': { decision: 'defer' },
      }),
      deps,
    )
    expect(review.submission.decisions['https://example.com/a'].reasonCodes).toBeUndefined()
    // 原因码的补齐发生在解析阶段（activation 会用），提交件本身保持原样不被改写 ——
    // 改写提交件等于替人签了他没写过的东西。
    expect(verifyReviewAttestation(review, verifyReview)).toBe('valid')
  })
})

describe('🔴 不完整发现必须有人署名认账', () => {
  const HOSTS2 = ['example.com', 'shop.example.com']
  const twoHostEnvelope = (): InventoryPlanEnvelope =>
    makeEnvelope(makeCore(['https://example.com/a'], { hosts: HOSTS2 }))

  it('某个主机 0 条、没人认 → 抛', () => {
    const envelope = twoHostEnvelope()
    const submission = makeSubmission(envelope, acceptAllPending(envelope.core))
    expectCode(() => signReview(envelope, submission, deps), 'incomplete_discovery_not_acknowledged')
  })

  it('认账没署名 → 抛（没署名的「我知道了」等于没人认过）', () => {
    const envelope = twoHostEnvelope()
    const submission = makeSubmission(envelope, acceptAllPending(envelope.core), {
      acknowledgements: { 'shop.example.com': { acknowledgedBy: ' ', reason: '旧站已下线' } },
    })
    expectCode(() => signReview(envelope, submission, deps), 'acknowledgement_unsigned')
  })

  it('认账没写理由 → 抛（审计要能看出人当时凭什么认为 0 条是正常的）', () => {
    const envelope = twoHostEnvelope()
    const submission = makeSubmission(envelope, acceptAllPending(envelope.core), {
      acknowledgements: { 'shop.example.com': { acknowledgedBy: 'po', reason: '' } },
    })
    expectCode(() => signReview(envelope, submission, deps), 'acknowledgement_without_reason')
  })

  it('认账指向计划里没有的主机 → 抛', () => {
    const envelope = twoHostEnvelope()
    const submission = makeSubmission(envelope, acceptAllPending(envelope.core), {
      acknowledgements: {
        'shop.example.com': { acknowledgedBy: 'po', reason: '旧站已下线' },
        'ghost.example.com': { acknowledgedBy: 'po', reason: '?' },
      },
    })
    expectCode(() => signReview(envelope, submission, deps), 'unknown_acknowledged_host')
  })

  it('署名 + 写了理由 → 盖得出来，而且认账进了 digest', () => {
    const envelope = twoHostEnvelope()
    const ack = { 'shop.example.com': { acknowledgedBy: 'product-owner', reason: '旧品牌站已下线，确认无页面' } }
    const review = signReview(
      envelope,
      makeSubmission(envelope, acceptAllPending(envelope.core), { acknowledgements: ack }),
      deps,
    )
    expect(verifyReviewAttestation(review, verifyReview)).toBe('valid')
    const tampered = { ...review, submission: { ...review.submission, acknowledgements: {} } }
    expect(verifyReviewAttestation(tampered, verifyReview)).toBe('digest_mismatch')
  })
})
