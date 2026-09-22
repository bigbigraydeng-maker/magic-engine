/**
 * Google Sheets 只读连接器（L3）——「给一个客户 + 表格 ID + 范围，读回一格一格的字符串」。
 *
 * 不认识任何客户语义：不知道哪一列是电话、哪一列是阶段。那些判断属于调用方
 * （例如 `src/lib/conversions/cts-crm-sheet-sync.ts`），不该下沉到这里。
 *
 * 鉴权跟 GSC 同一套优先级（`gsc/client.ts::resolveAccessToken`）：
 *   1. 客户已有的 Google OAuth 连接（`google_oauth_tokens`，`COMBINED_GOOGLE_SCOPES`
 *      现在带了 `spreadsheets.readonly`）——**这一环境唯一实际配置了的路径**：
 *      2026-09-13 PM 实测确认生产环境根本没有 `GOOGLE_SERVICE_ACCOUNT_CREDENTIALS`。
 *      客户表格通常是客户自己账号建的，用客户已经连过的 Google 身份去读，
 *      不需要另外"分享给谁"。
 *   2. 服务账号 JWT 兜底——万一以后哪个客户改配了这条路，不用再改这个文件。
 *
 * 已连过 GSC/GA4 的客户第一次读表格会遇到权限不够（旧 token 的 scope 里没有
 * Sheets）——这不是 bug，是 Google 的正常行为：客户要重新走一次
 * `/api/auth/google/connect` 在同意页面上多点一个新权限。
 */

import { getValidAccessToken, SHEETS_READONLY_SCOPE } from '@/lib/google-oauth/client'
import { loadServiceAccount, mintServiceAccountToken } from '@/lib/google-oauth/service-account'

const SHEETS_API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets'

export class GoogleSheetsError extends Error {
  constructor(
    public readonly httpStatus: number,
    message: string,
  ) {
    super(message)
    this.name = 'GoogleSheetsError'
  }
}

export class GoogleSheetsNotConfiguredError extends Error {
  constructor(clientId: string) {
    super(
      `客户 ${clientId} 既没有可用的 Google 连接，也没有配置服务账号 —— ` +
        `需要先在后台走一次"连接 Google"（/api/auth/google/connect?client_id=${clientId}&flow=admin）`,
    )
    this.name = 'GoogleSheetsNotConfiguredError'
  }
}

async function resolveAccessToken(
  clientId: string,
  deps: { fetcher?: typeof fetch } = {},
): Promise<string | null> {
  const oauthToken = await getValidAccessToken(clientId)
  if (oauthToken) return oauthToken

  const creds = loadServiceAccount()
  if (!creds) return null
  return mintServiceAccountToken(creds, SHEETS_READONLY_SCOPE, deps).catch(() => null)
}

/**
 * 读一个 A1 范围（如 `'CRM管理!A2:S'`），返回原始的行×列字符串矩阵。
 * 空单元格是 `''`，短行不会补齐到统一长度（跟 Sheets API 原样行为一致，
 * 调用方自己按下标取值时要防越界）。
 */
export async function readSheetValues(
  clientId: string,
  spreadsheetId: string,
  range: string,
  deps: { fetcher?: typeof fetch } = {},
): Promise<string[][]> {
  const fetcher = deps.fetcher ?? fetch
  const token = await resolveAccessToken(clientId, { fetcher })
  if (!token) throw new GoogleSheetsNotConfiguredError(clientId)

  const url = `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueRenderOption=UNFORMATTED_VALUE`
  const res = await fetcher(url, { headers: { Authorization: `Bearer ${token}` } })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new GoogleSheetsError(res.status, `Sheets API 读取失败 (${res.status}): ${body.slice(0, 300)}`)
  }

  const json = (await res.json()) as { values?: unknown[][] }
  const values = json.values ?? []
  return values.map((row) => row.map((cell) => (cell == null ? '' : String(cell))))
}
