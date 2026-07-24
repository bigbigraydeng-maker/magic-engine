/**
 * 客户素材上传链接的令牌(加密 + 认证,零 DB)。
 *
 * 为什么不做登录:老板在工地、店员在仓库,拍完随手就传。要登录 = 没人用
 * (PM 硬要求「一定要简单」)。所以用带签名的长期链接:发一次,长期用。
 *
 * 🔴 令牌里**不放明文 client UUID**(用 AES-256-GCM 把它加密进去)。
 * 原因:client UUID 是平台大量 /api/clients/[id]/* 接口的事实凭据(其中不少历史接口
 * 尚未补登录校验)。如果链接里明文带 UUID,等于把这个凭据交到了系统外的人手里,而链接
 * 是会被转发的。加密后,拿到链接的人无法从中反推出 UUID —— 上传口本身只让他往这一个
 * 客户的素材库写文件,再无其他。
 *
 * GCM 自带完整性校验:篡改密文/nonce/tag 任意一段,解密即失败 —— 一次同时挡住伪造和篡改。
 *
 * 安全边界(诚实说明):
 * - 链接不过期(PM 要求「发一次长期用」)。作废靠换 UPLOAD_LINK_SECRET(所有链接一起失效),
 *   目前无单条吊销 —— 刻意取舍,不是遗漏。
 * - 密钥缺失时一律 fail-closed(既不签发也不放行),绝不用空密钥。
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NONCE_BYTES = 12 // GCM 标准 96-bit nonce
const TAG_BYTES = 16

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function fromB64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

/** secret 派生成 32 字节 AES key(secret 长度不定,SHA-256 归一) */
function keyFrom(secret: string): Buffer {
  return createHash('sha256').update(secret).digest()
}

/**
 * 生成令牌:nonce.ciphertext.tag(全 base64url)。
 * secret 缺失或 clientId 非法 → null(fail-closed)。
 */
export function createUploadToken(clientId: string, secret: string | undefined): string | null {
  if (!secret || !UUID_RE.test(clientId)) return null
  const nonce = randomBytes(NONCE_BYTES)
  const cipher = createCipheriv('aes-256-gcm', keyFrom(secret), nonce)
  const ct = Buffer.concat([cipher.update(clientId, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${b64url(nonce)}.${b64url(ct)}.${b64url(tag)}`
}

/** 校验并解出 client_id;任何不对(篡改/伪造/密钥错/格式错)一律 null,绝不抛。 */
export function verifyUploadToken(token: string | undefined, secret: string | undefined): string | null {
  if (!token || !secret) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    const nonce = fromB64url(parts[0])
    const ct = fromB64url(parts[1])
    const tag = fromB64url(parts[2])
    if (nonce.length !== NONCE_BYTES || tag.length !== TAG_BYTES || ct.length === 0) return null

    const decipher = createDecipheriv('aes-256-gcm', keyFrom(secret), nonce)
    decipher.setAuthTag(tag)
    const clientId = Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
    // 解出来的必须是合法 UUID —— 双保险,防解密侥幸产出垃圾
    return UUID_RE.test(clientId) ? clientId : null
  } catch {
    // GCM 校验失败(篡改/错密钥)会在 final() 抛,吞掉返回 null
    return null
  }
}

/**
 * 一次性生成 + 自校验,确认往返成立(测试与运行时的一致性保障)。
 * timingSafeEqual 仅用于这层自检的等值判断,不涉及秘密比较。
 */
export function roundTripOk(clientId: string, secret: string): boolean {
  const t = createUploadToken(clientId, secret)
  if (!t) return false
  const back = verifyUploadToken(t, secret)
  if (!back) return false
  const a = Buffer.from(back)
  const b = Buffer.from(clientId)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** 签名密钥。专用 env 优先;没配就退回 CRON_SECRET(Render 上已存在,省一步人工配置)。 */
export function uploadSecret(): string | undefined {
  return process.env.UPLOAD_LINK_SECRET || process.env.CRON_SECRET
}
