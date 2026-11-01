// Resend 回调验签：读取密钥、调用已有 verifyWebhookSignature、映射失败原因。
import { verifyWebhookSignature } from '@/lib/voice/providers/webhook-sign'
import type { ResendAccount } from './types'

/** 重放窗口（秒）。 */
export const REPLAY_WINDOW_SEC = 300

/** 每个账号对应的密钥环境变量名。 */
export function resendSecretEnvName(account: ResendAccount): string {
  return `RESEND_WEBHOOK_SECRET_${account.toUpperCase()}`
}

/**
 * 读取并校验 Resend webhook 密钥。
 * 必须完整匹配 /^whsec_([A-Za-z0-9+/]+={0,2})$/，且 base64 解码后字节数 >= 16。
 * 通过则返回 trim 后的整串（含 whsec_ 前缀），否则 null。
 */
export function loadResendWebhookSecret(
  account: ResendAccount,
  env: (name: string) => string | undefined,
): string | null {
  const raw = env(resendSecretEnvName(account))
  if (raw === undefined) return null
  const trimmed = raw.trim()
  const match = /^whsec_([A-Za-z0-9+/]+={0,2})$/.exec(trimmed)
  if (!match) return null
  const bytes = Buffer.from(match[1], 'base64')
  if (bytes.length < 16) return null
  return trimmed
}

export type SignatureFailure =
  | 'missing_headers'
  | 'bad_timestamp'
  | 'outside_window'
  | 'signature_mismatch'

export interface VerifyResendSignatureArgs {
  bodyText: string
  svixId: string | null
  svixTimestamp: string | null
  svixSignature: string | null
  secret: string
  nowSec?: number
}

/** 校验 Resend 回调签名，并把底层 reason 映射为稳定的失败枚举。 */
export function verifyResendSignature(
  args: VerifyResendSignatureArgs,
): { valid: true } | { valid: false; reason: SignatureFailure } {
  const headers: Record<string, string | undefined> = {
    'webhook-id': args.svixId ?? undefined,
    'webhook-timestamp': args.svixTimestamp ?? undefined,
    'webhook-signature': args.svixSignature ?? undefined,
  }

  const result =
    args.nowSec === undefined
      ? verifyWebhookSignature(args.bodyText, headers, args.secret, REPLAY_WINDOW_SEC)
      : verifyWebhookSignature(args.bodyText, headers, args.secret, REPLAY_WINDOW_SEC, args.nowSec)

  if (result.valid) return { valid: true }

  const reason = result.reason ?? ''
  if (reason.includes('missing')) return { valid: false, reason: 'missing_headers' }
  if (reason.includes('window')) return { valid: false, reason: 'outside_window' }
  if (reason.includes('timestamp')) return { valid: false, reason: 'bad_timestamp' }
  return { valid: false, reason: 'signature_mismatch' }
}
