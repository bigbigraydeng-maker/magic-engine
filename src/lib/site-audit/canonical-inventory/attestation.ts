/**
 * Magic Engine 2.0 · L2 复核完整性凭证（Issue #960）
 *
 *   reviewDigest      = SHA256(canonicalJson(ReviewSubmission))
 *   reviewAttestation = HMAC(K_rev, canonicalJson({ envelopeVersion, keyId, reviewDigest }))
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 🔴 它证明什么，不证明什么（措辞纪律，不是客套）
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * **证明**：这份复核内容被持 `K_rev` 的服务签过，之后没有被修改，
 *          并且绑定到确切的那一份 L1 信封（`planId` + `generationDigest` 都在 digest 里）。
 *
 * **不证明**：`reviewedBy` 写的那个人真的亲自批准了。那仍然是调用方提交的字符串。
 *
 * 因此这一层叫 *review integrity attestation*，**不得**被表述为身份认证、不可抵赖、
 * 或法律意义上的签署。真正的人工授权来自工件之外 —— Product Owner 对确切客户、
 * 确切主机清单、确切写入动作的单独授权。
 *
 * 🔴 `K_rev` 与 `K_gen` 是两把不同的密钥，但**当前都存放在同一个进程的环境变量里**。
 *    这不构成物理隔离，也不构成密钥分权；当前的价值只有职责边界可分辨、
 *    以及将来把复核拆成独立服务时契约不用改。
 */

import { createHash } from 'crypto'
import { canonicalJson } from './canonical-json'
import { INVENTORY_ENVELOPE_VERSION } from './types'
import type { ReviewSubmission, SignedReview } from './types'
import type { PlanSigner, SignatureVerifier } from './signing'

/** 与 {@link import('./envelope').EnvelopeVerdict} 同构 —— 每一种对应一个不同的 blocker。 */
export type AttestationVerdict =
  | 'valid'
  | 'digest_mismatch'
  | 'attestation_invalid'
  | 'unknown_key'
  | 'key_unavailable'
  | 'malformed'
  | 'version_mismatch'

export function computeReviewDigest(submission: ReviewSubmission): string {
  return createHash('sha256').update(canonicalJson(submission), 'utf8').digest('hex')
}

export function reviewAttestationPayload(input: {
  envelopeVersion: string
  keyId: string
  reviewDigest: string
}): string {
  return canonicalJson({
    envelopeVersion: input.envelopeVersion,
    keyId: input.keyId,
    reviewDigest: input.reviewDigest,
  })
}

/**
 * 给一份**已经校验过**的复核提交盖凭证。
 *
 * 🔴 校验在 `review.ts` 里做完才会走到这儿。这个函数自己不判内容对不对 ——
 *    它是原语，不是闸；`index.ts` 也不导出它。
 */
export function sealReview(submission: ReviewSubmission, signer: PlanSigner): SignedReview {
  const reviewDigest = computeReviewDigest(submission)
  const reviewAttestation = signer.sign(
    reviewAttestationPayload({
      envelopeVersion: INVENTORY_ENVELOPE_VERSION,
      keyId: signer.keyId,
      reviewDigest,
    }),
  )
  return {
    envelopeVersion: INVENTORY_ENVELOPE_VERSION,
    keyId: signer.keyId,
    submission,
    reviewDigest,
    reviewAttestation,
  }
}

/** 验一份复核凭证。同样是**先重算 digest 再验签**。 */
export function verifyReviewAttestation(review: SignedReview, verify: SignatureVerifier): AttestationVerdict {
  // 见 `envelope.ts` 同一处：只算不比 = 「升版本旧凭证立刻失效」是空承诺。
  if (review.envelopeVersion !== INVENTORY_ENVELOPE_VERSION) return 'version_mismatch'
  if (typeof review.keyId !== 'string' || review.keyId.trim().length === 0) return 'malformed'
  if (typeof review.reviewAttestation !== 'string' || review.reviewAttestation.trim().length === 0) {
    return 'malformed'
  }
  if (typeof review.reviewDigest !== 'string' || review.reviewDigest.trim().length === 0) return 'malformed'
  if (computeReviewDigest(review.submission) !== review.reviewDigest) return 'digest_mismatch'

  const payload = reviewAttestationPayload({
    envelopeVersion: review.envelopeVersion,
    keyId: review.keyId,
    reviewDigest: review.reviewDigest,
  })
  const check = verify({ keyId: review.keyId, payload, signature: review.reviewAttestation })
  if (check === 'valid') return 'valid'
  if (check === 'unknown_key') return 'unknown_key'
  if (check === 'key_unavailable') return 'key_unavailable'
  return 'attestation_invalid'
}
