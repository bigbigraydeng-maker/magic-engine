/**
 * Magic Engine 2.0 · L1 生成信封（Issue #960）
 *
 * 冻结公式：
 *
 *   UnsignedEnvelope    = { envelopeVersion, keyId, planId, issuedAt, core }
 *   generationDigest    = SHA256(canonicalJson(UnsignedEnvelope))
 *   generationSignature = HMAC(K_gen, canonicalJson({ envelopeVersion, keyId, generationDigest }))
 *
 * 🔴 `planId` / `issuedAt` 在 `UnsignedEnvelope` **里面**，不是外面。放外面的话，
 *    改 `issuedAt` 就能绕过有效期闸、改 `planId` 就能破坏 L1↔L2 绑定，而签名照样有效。
 *
 * 🔴 `keyId` 同时进 digest **和**签名原文。只放信封字段里不进原文，等于允许
 *    「用 A 的密钥签、对外声称是 B 签的」这种 key confusion。
 *
 * 🔴 验证时**必须重算 digest**再跟签名比。签名只覆盖 digest；若只验「签名对得上声称的 digest」，
 *    编辑者留着旧签名换掉 core 就过了 —— digest 那一栏是他自己填的。
 */

import { createHash } from 'crypto'
import { canonicalJson } from './canonical-json'
import { INVENTORY_ENVELOPE_VERSION } from './types'
import type { GeneratedPlanCore, InventoryPlanEnvelope, UnsignedEnvelope } from './types'
import type { PlanSigner, SignatureVerifier } from './signing'

/**
 * 计划有效期，**固定 7 天**。
 *
 * 🔴 不是函数入参、不是调用方选项、不可调大、不可关闭、没有 `skipExpiry`。
 *    测试只能通过注入 `now()` 控制时钟。
 *    做成可配的那一刻，「过期」就变成一个谁都能关掉的装饰。
 */
export const PLAN_MAX_AGE_DAYS = 7

const MAX_AGE_MS = PLAN_MAX_AGE_DAYS * 24 * 60 * 60 * 1000

/** 信封验证的结论。每一种都对应激活侧一个**不同**的 blocker code。 */
export type EnvelopeVerdict =
  | 'valid'
  /** 重算的 digest 跟信封自称的对不上 —— core / planId / issuedAt 里有东西被改过 */
  | 'digest_mismatch'
  /** digest 对得上，但签名不是这把密钥签的 —— 内容被改后连 digest 一起重算了 */
  | 'signature_invalid'
  /** 信封声称的 keyId 不在密钥环里（密钥已作废 / 信封来自别的系统） */
  | 'unknown_key'
  /** 一把密钥都没配 —— 运维问题，不是篡改 */
  | 'key_unavailable'
  /** 缺 keyId / 缺签名 / 类型不对 */
  | 'malformed'

export type FreshnessVerdict = 'fresh' | 'expired' | 'invalid_timestamp'

/** 把信封剥回签名覆盖面。**只留这五项** —— 多留一项就等于那一项没被签。 */
export function toUnsignedEnvelope(envelope: UnsignedEnvelope): UnsignedEnvelope {
  return {
    envelopeVersion: envelope.envelopeVersion,
    keyId: envelope.keyId,
    planId: envelope.planId,
    issuedAt: envelope.issuedAt,
    core: envelope.core,
  }
}

export function computeGenerationDigest(unsigned: UnsignedEnvelope): string {
  return createHash('sha256').update(canonicalJson(toUnsignedEnvelope(unsigned)), 'utf8').digest('hex')
}

/** 签名原文。三项都进去：换版本、换密钥、换内容，任意一项都签不回去。 */
export function generationSignaturePayload(input: {
  envelopeVersion: string
  keyId: string
  generationDigest: string
}): string {
  return canonicalJson({
    envelopeVersion: input.envelopeVersion,
    keyId: input.keyId,
    generationDigest: input.generationDigest,
  })
}

/**
 * 用签名器把一份 core 封成信封。
 *
 * 🔴 这是**内部**原语，`index.ts` 不导出它 —— 唯一对外的生成入口是
 *    `generateSignedInventoryPlan()`，那个入口自己跑发现、不收调用方的候选内容。
 *    把封签器摆到公开门面上，等于对外提供一台「替任意内容签名」的机器。
 */
export function sealEnvelope(
  parts: { readonly planId: string; readonly issuedAt: string; readonly core: GeneratedPlanCore },
  signer: PlanSigner,
): InventoryPlanEnvelope {
  const unsigned: UnsignedEnvelope = {
    envelopeVersion: INVENTORY_ENVELOPE_VERSION,
    keyId: signer.keyId,
    planId: parts.planId,
    issuedAt: parts.issuedAt,
    core: parts.core,
  }
  const generationDigest = computeGenerationDigest(unsigned)
  const generationSignature = signer.sign(
    generationSignaturePayload({
      envelopeVersion: unsigned.envelopeVersion,
      keyId: unsigned.keyId,
      generationDigest,
    }),
  )
  return { ...unsigned, generationDigest, generationSignature }
}

/**
 * 验一枚信封。顺序是**先重算 digest 再验签** —— 反过来会让「换掉 core、
 * 保留旧签名与旧 digest」这条路只在签名那一步被拦，而拦不住的原因说不清楚。
 */
export function verifyEnvelope(envelope: InventoryPlanEnvelope, verify: SignatureVerifier): EnvelopeVerdict {
  if (typeof envelope.keyId !== 'string' || envelope.keyId.trim().length === 0) return 'malformed'
  if (typeof envelope.generationSignature !== 'string' || envelope.generationSignature.trim().length === 0) {
    return 'malformed'
  }
  if (typeof envelope.generationDigest !== 'string' || envelope.generationDigest.trim().length === 0) {
    return 'malformed'
  }
  if (computeGenerationDigest(envelope) !== envelope.generationDigest) return 'digest_mismatch'

  const payload = generationSignaturePayload({
    envelopeVersion: envelope.envelopeVersion,
    keyId: envelope.keyId,
    generationDigest: envelope.generationDigest,
  })
  const check = verify({ keyId: envelope.keyId, payload, signature: envelope.generationSignature })
  if (check === 'valid') return 'valid'
  if (check === 'unknown_key') return 'unknown_key'
  if (check === 'key_unavailable') return 'key_unavailable'
  return 'signature_invalid'
}

/**
 * 信封新鲜度。**固定 7 天**，见 {@link PLAN_MAX_AGE_DAYS}。
 *
 * 时间戳解析不出来一律判 `invalid_timestamp` 而不是「当作没过期」——
 * 一个排不了序的时间戳证明不了任何事，放行等于把有效期闸交给字符串的运气。
 */
export function checkEnvelopeFreshness(issuedAt: string, nowIso: string): FreshnessVerdict {
  const issued = Date.parse(typeof issuedAt === 'string' ? issuedAt : '')
  const now = Date.parse(typeof nowIso === 'string' ? nowIso : '')
  if (!Number.isFinite(issued) || !Number.isFinite(now)) return 'invalid_timestamp'
  const age = now - issued
  // 🔴 未来时间也算不合法：签发时间比当前还晚，说明时钟或内容有一个不对，
  //    放行等于给一枚「永远不会过期」的信封开绿灯。
  if (age < 0) return 'invalid_timestamp'
  return age > MAX_AGE_MS ? 'expired' : 'fresh'
}
