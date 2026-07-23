/**
 * 客户素材上传链接的令牌(纯函数 + HMAC,零 DB)。
 *
 * 为什么不做登录:老板在工地、店员在仓库,拍完随手就传。多一个密码就没人用了 ——
 * PM 硬要求「一定要简单:点链接 → 选文件 → 传完」。所以用带签名的长期链接:
 * 发一次,长期用。
 *
 * 为什么不建表:签名自校验就够了,不需要在库里存令牌。少一张表 = 少一次 migration
 * (migration 必须 PM 拍板),也少一个要维护的状态。
 *
 * 安全边界(诚实说明这条链接能干什么):
 * - 拿到链接的人**只能往这一个客户的素材库上传文件**,读不到任何东西、改不了任何东西。
 * - 上传接口自己还有类型和大小限制。
 * - 链接不过期(PM 要求「发一次长期用」)。要作废就换 UPLOAD_LINK_SECRET,
 *   所有旧链接一起失效 —— 目前没有单条吊销,这是刻意的取舍,不是遗漏。
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** base64url:URL 里不用转义,链接短且不会被聊天软件截断 */
function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function sign(clientId: string, secret: string): string {
  return b64url(createHmac('sha256', secret).update(`upload:${clientId}`).digest()).slice(0, 32)
}

/**
 * 生成令牌。secret 缺失时返回 null —— fail-closed:
 * 宁可「功能不可用」也不要用空密钥签出人人可伪造的链接。
 */
export function createUploadToken(clientId: string, secret: string | undefined): string | null {
  if (!secret || !UUID_RE.test(clientId)) return null
  return `${clientId}.${sign(clientId, secret)}`
}

/** 校验令牌,返回 client_id;任何不对一律 null。 */
export function verifyUploadToken(token: string | undefined, secret: string | undefined): string | null {
  if (!token || !secret) return null
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return null
  const clientId = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  if (!UUID_RE.test(clientId)) return null

  const expected = sign(clientId, secret)
  // 定长比较防时序侧信道;长度不等直接拒(timingSafeEqual 长度不等会抛)
  if (sig.length !== expected.length) return null
  try {
    return timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) ? clientId : null
  } catch {
    return null
  }
}

/** 签名密钥。专用 env 优先;没配就退回 CRON_SECRET(Render 上已存在,省掉一步人工配置)。 */
export function uploadSecret(): string | undefined {
  return process.env.UPLOAD_LINK_SECRET || process.env.CRON_SECRET
}
