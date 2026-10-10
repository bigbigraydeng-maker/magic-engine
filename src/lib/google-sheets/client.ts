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
 * 从 A1 范围里取出工作表标题：最后一个 `!` 之前的部分。
 * 去掉包裹的单引号，并把转义的双写 `''` 还原成单个 `'`
 * （Sheets 的 A1 记法：`'It''s'!A:ZZ` 指的是标题为 `It's` 的工作表）。
 */
function tabTitleFromRange(range: string): string {
  const bang = range.lastIndexOf('!')
  const raw = bang === -1 ? range : range.slice(0, bang)
  if (raw.startsWith("'") && raw.endsWith("'") && raw.length >= 2) {
    return raw.slice(1, -1).replace(/''/g, "'")
  }
  return raw
}

/**
 * 往一个范围的末尾**追加**若干行。返回写进去的行数。
 *
 * 🔴 **只 append，绝不覆盖**。用的是 `spreadsheets.batchUpdate` 的 `appendCells`：
 *    Sheets 会在**该工作表最后一行有数据的行**下面插入新行，永远从 A 列开始，
 *    需要时自动插行，不会碰任何一个已有单元格。
 *    CTS 那张旧表从第 18 列起全是员工手打的跟进记录（"call back when she is free"
 *    这类），还有一片人工维护的名单区 —— 任何一次覆盖都是不可逆的损失。
 *
 * 🔴 **2026-10 事故：不能用 `values:append`。** 之前用的是
 *    `values:append` + `insertDataOption=INSERT_ROWS`，它依赖 Google 的「表格识别」。
 *    实测那张表中间有一个空行，Google 就把新行越放越靠右（第 77 列，之后每行 +32，
 *    最后到第 695 列），行永远对不上表头，判重（读第 1、15 列）也永远找不到它们 ——
 *    同一批 lead 每小时被重写一遍。`appendCells` 按工作表（不是表格）定位，
 *    从 A 列开始，彻底绕开表格识别。
 *
 * 🔴 **文本一律走 `stringValue`**，等价于以前的 `valueInputOption=RAW`：
 *    `stringValue` 表示「原样存成文本，别替我解析」。两个实测过的坑都靠它挡住：
 *    · 电话 `0210140952` 被当成数字吃掉前导 0 → 变成 210140952；
 *    · 电话 `+64211...` 开头的 `+` 被 Sheets 当成公式。
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

  const tabTitle = tabTitleFromRange(range)

  const metaUrl = `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties(sheetId,title)`
  const metaRes = await fetcher(metaUrl, { headers: { Authorization: `Bearer ${token}` } })
  if (!metaRes.ok) {
    const body = await metaRes.text().catch(() => '')
    throw new GoogleSheetsError(
      metaRes.status,
      `Sheets API 读取表信息失败 (${metaRes.status}): ${body.slice(0, 300)}`,
    )
  }

  const meta = (await metaRes.json()) as {
    sheets?: { properties?: { sheetId?: number; title?: string } }[]
  }
  const sheet = (meta.sheets ?? []).find((s) => s.properties?.title === tabTitle)
  if (!sheet?.properties || typeof sheet.properties.sheetId !== 'number') {
    throw new GoogleSheetsError(404, `Sheets API 找不到工作表「${tabTitle}」`)
  }
  const sheetId = sheet.properties.sheetId

  const url = `${SHEETS_API_BASE}/${encodeURIComponent(spreadsheetId)}:batchUpdate`
  const res = await fetcher(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      requests: [
        {
          appendCells: {
            sheetId,
            rows: rows.map((r) => ({
              values: r.map((cell) => ({ userEnteredValue: { stringValue: cell } })),
            })),
            fields: 'userEnteredValue',
          },
        },
      ],
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new GoogleSheetsError(
      res.status,
      `Sheets API 追加失败 (${res.status}): ${body.slice(0, 300)}`,
    )
  }

  // batchUpdate 是原子的，回执里没有行数 —— 2xx 就代表整批都写进去了。
  return rows.length
}
