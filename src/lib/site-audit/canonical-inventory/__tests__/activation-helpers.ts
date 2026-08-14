/**
 * 激活测试的公用夹具（Issue #930 · #960）。
 *
 * 🔴 从 `activation.test.ts` 抽出来的原因只有一个：那个文件到 862 行了，
 *    而冻结契约要求**生产文件与测试文件一律 < 800**。
 *    抽成共用件而不是复制两份 —— 复制会让两边的 `standard()` 悄悄漂开，
 *    那时「除了被测那一项以外全部合法」这个前提就不再成立，而没有任何东西会红。
 *
 * 🔴 每一道闸都**单独**直测：拿一份除了那一项以外完全合法的输入去撞它。
 *    不这么写的话，前一道闸会把后面的闸遮住 —— 一堆全绿的断言其实一道都没盯住
 *    （这个仓库真出过：拆掉某一句原子兑换，18 条测试照样全绿）。
 *
 * 🔴 测试**持有签名密钥**，所以能封出「签名合法但内容有问题」的信封与凭证。
 *    这正是闸 6–10 存在的意义：它们是纵深防御 —— L1/L2 只证明「没被外人改过」，
 *    证明不了「产出它的那段代码没写错」。用真签名 + 坏内容去撞，才测得到它们。
 */

import { vi } from 'vitest'
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
  genSigner,
  GEN_SECRET,
  REV_SECRET,
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

export const ACCEPTED = ['https://example.com/a', 'https://example.com/b']
export const REJECTED = 'http://example.com/insecure'
export const DEFERRED = 'https://example.com/maybe'
export const ALL = [...ACCEPTED, REJECTED, DEFERRED]

/** 用真密钥把任意一份提交件封成凭证 —— 用来构造「凭证合法但内容有问题」的输入。 */
export function seal(submission: ReviewSubmission): SignedReview {
  return sealReview(submission, revSigner)
}

export function standardDecisions(): Record<string, ReviewDecisionEntry> {
  return {
    [ACCEPTED[0]]: { decision: 'accepted' },
    [ACCEPTED[1]]: { decision: 'accepted' },
    [DEFERRED]: { decision: 'defer' },
  }
}

/** 一份「除了被测那一项以外全部合法」的信封 + 凭证。 */
export function standard(over: { core?: GeneratedPlanCore; decisions?: Record<string, ReviewDecisionEntry> } = {}): {
  envelope: InventoryPlanEnvelope
  review: SignedReview
} {
  const envelope = makeEnvelope(over.core ?? makeCore(ALL))
  return { envelope, review: seal(makeSubmission(envelope, over.decisions ?? standardDecisions())) }
}

export function inputWith(over: Partial<ActivateInput> = {}): ReturnType<typeof makeActivationInput> {
  const base = standard()
  return makeActivationInput({
    envelope: (over.envelope as InventoryPlanEnvelope) ?? base.envelope,
    review: (over.review as SignedReview) ?? base.review,
    expected: over.expected,
    deps: over.deps as ReturnType<typeof makeActivationDeps>,
  })
}

export {
  CLIENT,
  DOMAIN,
  HOSTS,
  ISSUED_AT,
  NOW,
  GEN_SECRET,
  REV_SECRET,
  genSigner,
  revSigner,
  verifyGeneration,
  verifyReview,
  makeActivationDeps,
  makeCore,
  makeCrawlResult,
  makeEnriched,
  makeEnvelope,
  makeSubmission,
  acceptAllPending,
} from './fixtures'
export { FakeInventoryStore } from './fake-store'
export { sealReview } from '../attestation'
export { createHmacVerifier, createUnavailableVerifier } from '../signing'
export { computeGenerationDigest } from '../envelope'
export { computeReviewDigest } from '../attestation'
export { activateReviewedPlan } from '../activation'
export type { ActivateInput } from '../activation'
export type { GeneratedPlanCore, InventoryPlanEnvelope, ReviewDecisionEntry, ReviewSubmission, SignedReview } from '../types'
