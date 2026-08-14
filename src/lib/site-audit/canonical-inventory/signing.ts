/**
 * Magic Engine 2.0 · 台账层的签名 / 验签原语（Issue #960）
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 这一层解决什么
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 计划的自带哈希是**公开函数**算出来的：谁改了内容都能自己重算一遍。
 * 唯一挡得住「改内容 + 改哈希 + 自己重签」的是一枚**改文件的人算不出来**的东西 ——
 * 带密钥的 HMAC。这个文件只负责「拿密钥算 / 拿密钥验」，不知道被签的是什么。
 *
 * 🔴 **不读 `process.env`。** 密钥由组合根解析后**注入**。
 *    本层一旦自己读环境变量，密钥就可能随着某次序列化混进工件，
 *    而整套证明的第一个前提就是「密钥永不进入工件」。架构测试锁死这一条。
 *
 * 🔴 **缺密钥一律 fail closed**：
 *    - 签名侧 `createHmacSigner` **直接抛** —— 签不出来就别生成计划；
 *    - 验签侧 `createHmacVerifier` 在没有任何密钥时返回一个恒判 `key_unavailable`
 *      的验签器 —— 激活方据此出 blocker 并**一次抓取都不发**。
 *    绝不接受任何 fallback 密钥（`UPLOAD_LINK_SECRET` 未配时回落 `CRON_SECRET`
 *    那个先例在这里明令不许照抄：借来的密钥等于两套系统共用一个信任根）。
 */

import { createHmac, timingSafeEqual } from 'crypto'

/**
 * 密钥最短长度。
 *
 * HMAC-SHA256 的安全性上限就是 256 bit，短于 32 字节的密钥是在自降强度；
 * 而且短密钥通常意味着有人随手填了个占位串。宁可签不出来。
 */
export const MIN_SIGNING_SECRET_BYTES = 32

/** keyId 的形状。留白 / 带分隔符的 id 会让签名原文的拼接产生歧义。 */
const KEY_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/

export class InventorySigningError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'InventorySigningError'
    this.code = code
  }
}

/**
 * 验签结论。
 *
 * 🔴 四种结局必须分开，不能都塌成 `false`：
 *    「密钥没配」是运维问题，「不认识这个 keyId」是密钥已作废，「对不上」才是被改过。
 *    塌成一个值，读审计的人就分不清该去配密钥还是该去查谁改了文件。
 */
export type SignatureCheck = 'valid' | 'invalid' | 'unknown_key' | 'key_unavailable'

export type SignatureVerifier = (input: {
  readonly keyId: string
  readonly payload: string
  readonly signature: string
}) => SignatureCheck

export interface PlanSigner {
  /** 当前用来签名的密钥 id —— 它会明文进信封**并进签名原文**（防 key confusion）。 */
  readonly keyId: string
  sign(payload: string): string
}

/** 注入的密钥环：`keyId → secret`。由组合根从环境变量解析后交进来。 */
export interface SigningKeyMaterial {
  readonly keys: Readonly<Record<string, string>>
  /** 当前签名用哪一把。验签不需要它（按信封里的 keyId 查）。 */
  readonly activeKeyId?: string
}

/**
 * 造一个签名器。密钥环有任何问题都**直接抛** —— 签不出来比签错好。
 */
export function createHmacSigner(material: SigningKeyMaterial): PlanSigner {
  const keys = validateKeyRing(material.keys)
  const activeKeyId = (material.activeKeyId ?? '').trim()
  if (activeKeyId.length === 0) {
    throw new InventorySigningError('missing_active_key_id', '没有指定当前签名密钥 id —— 签不出来就别生成计划')
  }
  const secret = keys.get(activeKeyId)
  if (secret === undefined) {
    throw new InventorySigningError(
      'active_key_not_in_ring',
      `当前签名密钥 id「${activeKeyId}」不在密钥环里（环里有：${[...keys.keys()].join(', ')}）`,
    )
  }
  return {
    keyId: activeKeyId,
    sign: (payload: string) => hmac(secret, payload),
  }
}

/**
 * 造一个验签器。
 *
 * 密钥环**为空**时返回恒判 `key_unavailable` 的验签器：这是「没配密钥」这个事实的
 * 诚实表达，调用方会把它变成 blocker。密钥环里有**格式非法**的密钥则直接抛 ——
 * 那是配错了，不是没配，不该被当成「暂时验不了」放过去。
 */
export function createHmacVerifier(material: Pick<SigningKeyMaterial, 'keys'>): SignatureVerifier {
  const keys = validateKeyRing(material.keys, { allowEmpty: true })
  if (keys.size === 0) return () => 'key_unavailable'
  return ({ keyId, payload, signature }) => {
    const secret = keys.get(keyId)
    if (secret === undefined) return 'unknown_key'
    return constantTimeEquals(hmac(secret, payload), signature) ? 'valid' : 'invalid'
  }
}

/**
 * 一个永远判 `key_unavailable` 的验签器。
 *
 * 给组合根在「这次不打算接签名密钥」时显式注入 —— 比注入 `() => 'valid'` 安全，
 * 也比注入 `undefined` 诚实（后者会变成一个谁都没注意到的 optional 分支）。
 */
export function createUnavailableVerifier(): SignatureVerifier {
  return () => 'key_unavailable'
}

// ---------------------------------------------------------------------------
// 私有
// ---------------------------------------------------------------------------

function validateKeyRing(
  keys: Readonly<Record<string, string>>,
  opts: { allowEmpty?: boolean } = {},
): Map<string, Buffer> {
  const entries = Object.entries(keys ?? {})
  if (entries.length === 0) {
    if (opts.allowEmpty === true) return new Map()
    throw new InventorySigningError('empty_key_ring', '密钥环是空的 —— 没有密钥就不许签名')
  }
  const out = new Map<string, Buffer>()
  for (const [keyId, secret] of entries) {
    if (!KEY_ID_PATTERN.test(keyId)) {
      throw new InventorySigningError('malformed_key_id', `密钥 id「${keyId}」不合规（只允许 a-z0-9 . _ -，≤64 字符）`)
    }
    const bytes = Buffer.from(secret ?? '', 'utf8')
    if (bytes.length < MIN_SIGNING_SECRET_BYTES) {
      throw new InventorySigningError(
        'weak_secret',
        `密钥「${keyId}」只有 ${bytes.length} 字节，至少要 ${MIN_SIGNING_SECRET_BYTES} —— 短密钥多半是随手填的占位串`,
      )
    }
    out.set(keyId, bytes)
  }
  return out
}

function hmac(secret: Buffer, payload: string): string {
  return createHmac('sha256', secret).update(payload, 'utf8').digest('hex')
}

/** 长度不同直接判否 —— `timingSafeEqual` 要求等长缓冲区。 */
function constantTimeEquals(expected: string, provided: string): boolean {
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(provided ?? '', 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}
