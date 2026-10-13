/**
 * Twilio 请求签名校验（X-Twilio-Signature）。
 * 算法（官方）：URL + 把 POST 参数按键名排序后「键+值」依次拼接，用账号令牌做 HMAC-SHA1，再 base64。
 * 用常量时间比较；没有令牌 / 没有签名头一律 false（fail-closed）。
 */

import { createHmac, timingSafeEqual } from 'crypto'

export function computeTwilioSignature(authToken: string, url: string, params: Record<string, string>): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + params[k], url)
  return createHmac('sha1', authToken).update(data, 'utf8').digest('base64')
}

export function verifyTwilioSignature(
  authToken: string | null | undefined,
  url: string,
  params: Record<string, string>,
  header: string | null | undefined,
): boolean {
  if (!authToken || !header) return false
  const want = Buffer.from(computeTwilioSignature(authToken, url, params))
  const got = Buffer.from(header)
  return want.length === got.length && timingSafeEqual(want, got)
}
