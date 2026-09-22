/**
 * Google 服务账号 JWT 铸造 —— 从 `src/lib/gsc/client.ts` 提取（原来是它的私有函数，
 * 只认 GSC 一个 scope）。GA4/GSC/Sheets 现在共用同一个 `GOOGLE_SERVICE_ACCOUNT_CREDENTIALS`
 * 服务账号，只是各自申请的 scope 不同，所以铸造逻辑本身只应该有一份。
 *
 * 行为跟提取前逐字一致：同一个 env var、同一个 token 端点、同样的 RS256 签名方式。
 * GSC 的调用方式改成传自己的 scope 常量，其余分支不变。
 */

import { createSign } from 'crypto'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'

export interface ServiceAccount {
  private_key: string
  client_email: string
}

/** 读 `GOOGLE_SERVICE_ACCOUNT_CREDENTIALS`，格式不对或缺字段就返回 null，不抛错。 */
export function loadServiceAccount(): ServiceAccount | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<ServiceAccount>
    if (!parsed.private_key || !parsed.client_email) return null
    return parsed as ServiceAccount
  } catch {
    return null
  }
}

function b64url(str: string): string {
  return Buffer.from(str, 'utf8').toString('base64url')
}

/** 用服务账号私钥签一个短命 JWT，换成 access token。1 小时有效期，不缓存 —— 调用方按需要的频率来调。 */
export async function mintServiceAccountToken(
  creds: ServiceAccount,
  scope: string,
  deps: { fetcher?: typeof fetch } = {},
): Promise<string> {
  const fetcher = deps.fetcher ?? fetch
  const now = Math.floor(Date.now() / 1000)
  const exp = now + 3600

  const headerB64 = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payloadB64 = b64url(
    JSON.stringify({
      iss: creds.client_email,
      sub: creds.client_email,
      scope,
      aud: TOKEN_URL,
      iat: now,
      exp,
    }),
  )

  const toSign = `${headerB64}.${payloadB64}`
  const signer = createSign('RSA-SHA256')
  signer.update(toSign)
  const sig = signer.sign(creds.private_key, 'base64url')
  const jwt = `${toSign}.${sig}`

  const res = await fetcher(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })

  if (!res.ok) throw new Error(`Service account token exchange failed: ${res.status}`)
  const json = (await res.json()) as { access_token?: string }
  if (!json.access_token) throw new Error('No access_token in service account response')
  return json.access_token
}
