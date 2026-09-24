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

import { getValidAccessToken, SHEETS_READONLY_SCOPE, SHEETS_RW_SCOPE } from '@/lib/google-oauth/client'
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
  scope: string = SHEETS_READONLY_SCOPE,
): Promise<string | null> {
  const oauthToken = await getValidAccessToken(clientId)
  if (oauthToken) return oauthToken

  const creds = loadServiceAccount()
  if (!creds) return null
  return mintServiceAccountToken(creds, scope, deps).catch(() => null)
}

/**
 * 读一个 A1 范围（如 `'CRM管理!A2:S'`），返回原始的行×列字符串矩阵。
 * 空单元格是 `''`，短行不会补齐到统一长度（跟 Sheets API 原样行为一致，
 * 调用方自己按下标取值时要防越界）。
 *
 * `render` 决定 Sheets 怎么把单元格交给我们，**选错会静默出错**：
 *   · `'unformatted'`（默认，保持老行为）—— 日期/数字给**原始值**：
 *     单元格里显示 `2026-09-24 09:52`，拿回来是 `46289.41111111111`。
 *     适合要拿数字算数的场景。
 *   · `'formatted'` —— 给**人看到的那串文本**，跟表格里一模一样。
 *     🔴 **凡是要拿读回来的内容跟人手填的行比对（判重），必须用这个。**
 *        实测 2026-09-24：用 unformatted 读 CTS 新表，日期列变成 46289.411…，
 *        跟我们算出来的 `2026-09-24 09:52` 永远对不上 —— 判重全部失效，
 *        PM 已经手工填好的两行会被再写一遍。
 */
export async function readSheetValues(
  clientId: string,
  spreadsheetId: string,
  range: string,
  deps: { fetcher?: typeof fetch; render?: 'unformatted' | 'formatted' } = {},
): Promise<string[][]> {
  const fetcher = deps.fetcher ?? fetch
  const token = await resolveAccessToken(clientId, { fetcher })
  if (!token) throw new GoogleSheetsNotConfiguredError(clientId)

  const renderOption = deps.render === 'formatted' ? 'FORMATTED_VALUE' : 'UNFORMATTED_VALUE'
  const url = `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?valueRenderOption=${renderOption}`
  const res = await fetcher(url, { headers: { Authorization: `Bearer ${token}` } })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new GoogleSheetsError(res.status, `Sheets API 读取失败 (${res.status}): ${body.slice(0, 300)}`)
  }

  const json = (await res.json()) as { values?: unknown[][] }
  const values = json.values ?? []
  return values.map((row) => row.map((cell) => (cell == null ? '' : String(cell))))
}

/**
 * 往一个范围的末尾**追加**若干行。返回 Sheets 报回来的「真写进去的行数」。
 *
 * 🔴 **只 append，绝不覆盖**。用的是 `values:append` + `insertDataOption=INSERT_ROWS`：
 *    Sheets 会在已有数据的下面插入新行，不会碰任何一个已有单元格。
 *    CTS 那张旧表从第 18 列起全是员工手打的跟进记录（"call back when she is free"
 *    这类），还有一片人工维护的名单区 —— 任何一次覆盖都是不可逆的损失。
 *
 * 🔴 **`valueInputOption=RAW`，不是 USER_ENTERED**。两个实测过的坑都靠它挡住：
 *    · 电话 `0210140952` 被当成数字吃掉前导 0 → 变成 210140952；
 *    · 电话 `+64211...` 开头的 `+` 被 Sheets 当成公式。
 *    RAW 表示「原样存成文本，别替我解析」。
 *
 * 需要写权限（`SHEETS_RW_SCOPE`）。客户只授过只读的话 Google 会回 403，
 * 这里原样抛出去让调用方下发人工待办，不吞。
 */
export async function appendSheetValues(
  clientId: string,
  spreadsheetId: string,
  range: string,
  rows: readonly (readonly string[])[],
  deps: { fetcher?: typeof fetch } = {},
): Promise<number> {
  if (rows.length === 0) return 0

  const fetcher = deps.fetcher ?? fetch
  const token = await resolveAccessToken(clientId, { fetcher }, SHEETS_RW_SCOPE)
  if (!token) throw new GoogleSheetsNotConfiguredError(clientId)

  const url =
    `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:append` +
    `?valueInputOption=RAW&insertDataOption=INSERT_ROWS&responseValueRenderOption=UNFORMATTED_VALUE`

  const res = await fetcher(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ values: rows.map((r) => [...r]) }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new GoogleSheetsError(
      res.status,
      `Sheets API 追加失败 (${res.status}): ${body.slice(0, 300)}`,
    )
  }

  const json = (await res.json()) as { updates?: { updatedRows?: number } }
  // 🔴 回执报的行数跟我们打算写的对不上 = 只写进去一半，必须让调用方看见真实数字，
  //    不能拿 rows.length 当成「写成了这么多」。
  return json.updates?.updatedRows ?? 0
}
