/**
 * Magic Engine 2.0 · 复核盖章（Issue #960）
 *
 * 一句话：**先验 L1，再验内容，最后才盖 L2。**
 *
 * 🔴 #930 时代的 `applyReviewDecisions()` 是「拿到什么就给什么盖章」——
 *    持密钥的一方对递进来的任何东西背书，服务端对 discovery 当时产出过什么毫无记忆。
 *    这里第一件事就是验生成信封：**信封验不过，一个字都不盖**。
 *
 * 🔴 复核人提交的是 `ReviewSubmission`，里面**没有候选数组**。
 *    他能改的只有「每条候选算什么」和「哪个主机的不完整发现我认了」。
 */

import { verifyEnvelope } from './envelope'
import { sealReview } from './attestation'
import { resolveAcknowledgements, resolveDecisions } from './decisions'
import { assertCoreIntact, assertValidIsoTimestamp, InventoryPlanError } from './plan'
import type { InventoryPlanEnvelope, ReviewSubmission, SignedReview } from './types'
import type { PlanSigner, SignatureVerifier } from './signing'

/**
 * `reviewerIdentitySource` 当前唯一合法值。
 *
 * 🔴 逐字校验，**不接受** `'authenticated_session'`：现在没有任何东西能产生那个值，
 *    允许调用方填就等于允许 agent 谎称「我是从认证会话来的」。
 *    真正接入 Auth / UI 时必须升契约版本，并由可信组合根注入这个字段。
 */
export const ALLOWED_REVIEWER_IDENTITY_SOURCE = 'self_reported'

export interface SignReviewDeps {
  /** 验 L1。**必须**是带密钥的实现 —— 恒判 valid 等于把整道闸拆了。 */
  readonly verifyGenerationSignature: SignatureVerifier
  /** 盖 L2 用的签名器，与 L1 **不同**的密钥。 */
  readonly signer: PlanSigner
}

/**
 * 校验并盖上复核完整性凭证。
 *
 * 任何一步说不通都**抛**，不返回半成品 —— 半成品会被当成「盖过章的」往下传。
 */
export function signReview(
  envelope: InventoryPlanEnvelope,
  submission: ReviewSubmission,
  deps: SignReviewDeps,
): SignedReview {
  assertEnvelopeTrusted(envelope, deps.verifyGenerationSignature)
  // 纵深：L1 已经把内容钉死，但没有任何东西能证明一份**手写**的 core 来自 buildInventoryPlan()。
  assertCoreIntact(envelope.core)
  assertSubmissionBindsEnvelope(envelope, submission)
  assertReviewerFields(submission)

  const problems = [
    ...resolveDecisions(envelope.core, submission.decisions).problems,
    ...resolveAcknowledgements(envelope.core, submission.acknowledgements),
  ]
  if (problems.length > 0) {
    throw new InventoryPlanError(
      problems[0].code,
      `复核提交有 ${problems.length} 处说不通，一处都不能带着凭证往下走：\n` +
        problems.map((p) => `- [${p.code}] ${p.message}`).join('\n'),
    )
  }
  return sealReview(submission, deps.signer)
}

/**
 * L1 必须验得过。
 *
 * 每一种结论单独抛一个 code —— 「没配密钥」是运维问题，「密钥不认识」是密钥已作废，
 * 「对不上」才是内容被改过。塌成一句「验签失败」，人就不知道该去配密钥还是查谁改了文件。
 */
function assertEnvelopeTrusted(envelope: InventoryPlanEnvelope, verify: SignatureVerifier): void {
  let verdict: ReturnType<typeof verifyEnvelope>
  try {
    verdict = verifyEnvelope(envelope, verify)
  } catch (err) {
    throw new InventoryPlanError(
      'generation_signature_unverifiable',
      `验生成签名时出错，不能当成验过：${err instanceof Error ? err.message : String(err)}`,
    )
  }
  if (verdict === 'valid') return
  const reason: Record<typeof verdict, string> = {
    valid: '',
    digest_mismatch: '信封内容与它自带的 digest 对不上 —— 生成之后被改过',
    signature_invalid: '生成签名对不上 —— 内容被改过之后连 digest 一起重算了（那需要密钥，改文件的人没有）',
    unknown_key: '信封声称的签名密钥 id 不在密钥环里 —— 该密钥已作废，请重新生成计划',
    key_unavailable: '一把签名密钥都没配，验不了 —— 这是运维问题，不是篡改',
    malformed: '信封缺 keyId / digest / 签名，或者它们不是字符串',
  }
  throw new InventoryPlanError(`generation_${verdict}`, `不许盖章：${reason[verdict]}`)
}

/** L2 必须指回**确切那一份** L1。两项都比，缺一项就能配错信封。 */
function assertSubmissionBindsEnvelope(envelope: InventoryPlanEnvelope, submission: ReviewSubmission): void {
  if (submission.planId !== envelope.planId) {
    throw new InventoryPlanError(
      'review_plan_id_mismatch',
      `复核提交指向计划 ${String(submission.planId)}，信封是 ${envelope.planId} —— 对不上就不是同一份计划`,
    )
  }
  if (submission.generationDigest !== envelope.generationDigest) {
    throw new InventoryPlanError(
      'review_digest_binding_mismatch',
      '复核提交里记的 generationDigest 跟信封的对不上 —— 一份合法凭证不许配另一份信封',
    )
  }
}

function assertReviewerFields(submission: ReviewSubmission): void {
  if (typeof submission.reviewedBy !== 'string' || submission.reviewedBy.trim().length === 0) {
    throw new InventoryPlanError('missing_reviewer', '复核必须署名 —— 「谁判的」是这份清单唯一写得出来的出处')
  }
  assertValidIsoTimestamp(submission.reviewedAt, '复核时间')
  if (submission.reviewerIdentitySource !== ALLOWED_REVIEWER_IDENTITY_SOURCE) {
    throw new InventoryPlanError(
      'invalid_reviewer_identity_source',
      `reviewerIdentitySource 只接受逐字的「${ALLOWED_REVIEWER_IDENTITY_SOURCE}」，` +
        `收到的是「${String(submission.reviewerIdentitySource)}」—— ` +
        '现在没有任何东西能产生「已认证」这个事实，允许调用方自己填就等于允许谎称已认证',
    )
  }
}
