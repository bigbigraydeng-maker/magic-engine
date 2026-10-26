/**
 * X-Pbx-Token 校验。
 *
 * 库里只存令牌的 SHA-256，不存令牌本身，也不存可解密的密文：我们永远只需要
 * 「比对对方发来的是不是它」，不需要把它原样拿出来再用，所以不可逆比可解密更稳
 * （库被读走也拿不到能冒充 PBX 的令牌）。令牌是随机长串，不需要慢哈希。
 * 比对用常量时间，不让人逐字节试探。
 */

import { createHash, randomBytes, timingSafeEqual } from 'crypto'

export function hashWebhookToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/** 生成一个新令牌（只在开通时显示一次，填进 VoIPLine 门户；库里只留哈希）。 */
export function generateWebhookToken(): string {
  return randomBytes(32).toString('base64url')
}

/** 没有令牌、没配置哈希、长度不对，一律 false（fail-closed）。 */
export function verifyWebhookToken(header: string | null | undefined, storedHash: string | null | undefined): boolean {
  if (!header || !storedHash) return false
  const given = Buffer.from(hashWebhookToken(header), 'hex')
  const want = Buffer.from(storedHash, 'hex')
  if (given.length !== want.length || want.length === 0) return false
  return timingSafeEqual(given, want)
}
