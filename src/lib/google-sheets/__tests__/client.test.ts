import { describe, it, expect, vi, afterEach } from 'vitest'
import { generateKeyPairSync } from 'crypto'
import { readSheetValues, appendSheetValues, GoogleSheetsError, GoogleSheetsNotConfiguredError } from '../client'

const getValidAccessTokenMock = vi.fn<(clientId: string) => Promise<string | null>>()

vi.mock('@/lib/google-oauth/client', () => ({
  getValidAccessToken: (clientId: string) => getValidAccessTokenMock(clientId),
  SHEETS_READONLY_SCOPE: 'https://www.googleapis.com/auth/spreadsheets.readonly',
  SHEETS_RW_SCOPE: 'https://www.googleapis.com/auth/spreadsheets',
}))

const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})

function setServiceAccountCreds() {
  process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS = JSON.stringify({
    private_key: privateKey,
    client_email: 'svc@example.iam.gserviceaccount.com',
  })
}

/**
 * `readSheetValues`（../client.ts）的 `deps.fetcher` 形参类型实测就是 `typeof fetch`
 * （直接读源码核实过），mock 函数签名比 fetch 的重载窄，这里的转换是对齐参数类型，
 * 不是绕过接口不匹配。
 */
function asFetch(fn: (...args: unknown[]) => Promise<Response>): typeof fetch {
  return fn as unknown as typeof fetch // 已核实：deps.fetcher 形参类型即 typeof fetch
}

afterEach(() => {
  vi.restoreAllMocks()
  getValidAccessTokenMock.mockReset()
  delete process.env.GOOGLE_SERVICE_ACCOUNT_CREDENTIALS
})

describe('readSheetValues', () => {
  it('throws GoogleSheetsNotConfiguredError when the client has no OAuth connection and no service account is configured', async () => {
    getValidAccessTokenMock.mockResolvedValue(null)
    await expect(readSheetValues('client-1', 'sheet-id', 'Tab!A1:B2')).rejects.toBeInstanceOf(
      GoogleSheetsNotConfiguredError,
    )
  })

  it("prefers the client's existing Google OAuth token — no service account call at all", async () => {
    getValidAccessTokenMock.mockResolvedValue('oauth-tok-xyz')
    const calls: string[] = []
    const fetcher = asFetch(async (...args) => {
      const [url, init] = args as [string, RequestInit | undefined]
      calls.push(url)
      expect((init?.headers as Record<string, string>)?.Authorization).toBe('Bearer oauth-tok-xyz')
      return { ok: true, json: async () => ({ values: [['a', 1, ''], ['b']] }) } as Response
    })

    const rows = await readSheetValues('client-1', 'sheet-id', 'CRM管理!A2:S', { fetcher })

    expect(rows).toEqual([['a', '1', ''], ['b']])
    expect(getValidAccessTokenMock).toHaveBeenCalledWith('client-1')
    expect(calls.every((u) => u.includes('sheets.googleapis.com'))).toBe(true) // 没有走 oauth2.googleapis.com 铸造服务账号 token
    expect(calls.some((u) => u.includes(encodeURIComponent('CRM管理!A2:S')))).toBe(true)
  })

  it('falls back to the service account only when the client has no OAuth token', async () => {
    getValidAccessTokenMock.mockResolvedValue(null)
    setServiceAccountCreds()
    const fetcher = asFetch(async (...args) => {
      const [url, init] = args as [string, RequestInit | undefined]
      if (url.includes('oauth2.googleapis.com')) {
        return { ok: true, json: async () => ({ access_token: 'svc-tok' }) } as Response
      }
      expect((init?.headers as Record<string, string>)?.Authorization).toBe('Bearer svc-tok')
      return { ok: true, json: async () => ({ values: [['x']] }) } as Response
    })

    const rows = await readSheetValues('client-1', 'sheet-id', 'Tab!A:Z', { fetcher })
    expect(rows).toEqual([['x']])
  })

  it('surfaces a GoogleSheetsError with the HTTP status on failure', async () => {
    getValidAccessTokenMock.mockResolvedValue('oauth-tok-xyz')
    const fetcher = asFetch(async () => ({ ok: false, status: 403, text: async () => 'PERMISSION_DENIED' }) as Response)

    const err = await readSheetValues('client-1', 'sheet-id', 'CRM管理!A2:S', { fetcher }).catch((e) => e)
    expect(err).toBeInstanceOf(GoogleSheetsError)
    expect((err as GoogleSheetsError).httpStatus).toBe(403)
  })

  it('does not pad short rows to a uniform width', async () => {
    getValidAccessTokenMock.mockResolvedValue('oauth-tok-xyz')
    const fetcher = asFetch(async () => ({ ok: true, json: async () => ({ values: [[], ['only-one']] }) }) as Response)

    const rows = await readSheetValues('client-1', 'sheet-id', 'Tab!A:Z', { fetcher })
    expect(rows).toEqual([[], ['only-one']])
  })
})

/**
 * 必须显式声明形参签名。`vi.fn(async () => ...)` 推断出来的 `mock.calls` 是
 * 空元组 `[]`，按下标取 `calls[0][0]` 会被 TS 判成越界（TS2493）——
 * 测试照样跑得过，但 type-check 是红的。
 */
type FetchMock = (url: string, init?: RequestInit) => Promise<Response>

/**
 * 同 `asFetch`，但收的是带签名的 mock。跟 `asFetch` 并存而不是改它 ——
 * 改它会牵动这个文件里原有的一批测试，没必要。
 */
function asTypedFetch(fn: FetchMock): typeof fetch {
  return fn as unknown as typeof fetch // 已核实：deps.fetcher 形参类型即 typeof fetch
}

describe('appendSheetValues', () => {
  /**
   * 现在每次追加要打两个请求：先 GET 表信息拿 sheetId，再 POST batchUpdate。
   * 这个 mock 按顺序应答，并记录每次调用的 URL / init 供断言。
   */
  function mockAppendFlow(opts: {
    sheetId?: number
    title?: string
    postStatus?: number
    postBody?: string
  } = {}) {
    const { sheetId = 123, title = 'Sheet1', postStatus = 200, postBody = '{}' } = opts
    const calls: { url: string; init?: RequestInit }[] = []
    const fetcher = vi.fn<FetchMock>(async (url, init) => {
      calls.push({ url, init })
      if (url.includes('fields=sheets.properties')) {
        return new Response(JSON.stringify({ sheets: [{ properties: { sheetId, title } }] }), {
          status: 200,
        })
      }
      return new Response(postBody, { status: postStatus })
    })
    return { fetcher, calls }
  }

  it('走 batchUpdate + appendCells，用 sheetId 定位，从 A 列开始追加', async () => {
    getValidAccessTokenMock.mockResolvedValue('tok')
    const { fetcher, calls } = mockAppendFlow({ sheetId: 123 })
    await appendSheetValues('c1', 'sheet-1', 'Sheet1!A:ZZ', [['a', 'b']], {
      fetcher: asTypedFetch(fetcher),
    })

    const post = calls[1]
    expect(post.url.endsWith(':batchUpdate')).toBe(true)
    expect(post.init).toMatchObject({ method: 'POST' })
    const body = JSON.parse(String(post.init?.body))
    expect(body.requests[0].appendCells.sheetId).toBe(123)
  })

  it('绝不再用 values:append 端点（表格识别会把行推到右边）', async () => {
    getValidAccessTokenMock.mockResolvedValue('tok')
    const { fetcher, calls } = mockAppendFlow()
    await appendSheetValues('c1', 's', 'Sheet1!A:ZZ', [['a']], { fetcher: asTypedFetch(fetcher) })
    expect(calls.some((c) => c.url.includes(':append'))).toBe(false)
  })

  it('文本一律走 stringValue —— 电话的前导 0 和开头的 + 都不能被 Sheets 解析掉', async () => {
    // 实测过的两个坑：USER_ENTERED 会把 0210140952 变成 210140952，
    // 也会把 +64211... 当成公式。stringValue 等价于以前的 RAW。
    getValidAccessTokenMock.mockResolvedValue('tok')
    const { fetcher, calls } = mockAppendFlow()
    await appendSheetValues('c1', 's', 'Sheet1!A:ZZ', [['0210140952', '+64211914575']], {
      fetcher: asTypedFetch(fetcher),
    })

    const body = JSON.parse(String(calls[1].init?.body))
    expect(body.requests[0].appendCells.rows[0].values).toEqual([
      { userEnteredValue: { stringValue: '0210140952' } },
      { userEnteredValue: { stringValue: '+64211914575' } },
    ])
  })

  it('带空格和引号的表名也能按标题找到工作表', async () => {
    getValidAccessTokenMock.mockResolvedValue('tok')

    const spaced = mockAppendFlow({ sheetId: 7, title: 'FB 表单 2026' })
    await appendSheetValues('c1', 's', "'FB 表单 2026'!A:ZZ", [['a']], {
      fetcher: asTypedFetch(spaced.fetcher),
    })
    expect(JSON.parse(String(spaced.calls[1].init?.body)).requests[0].appendCells.sheetId).toBe(7)

    const quoted = mockAppendFlow({ sheetId: 9, title: "It's" })
    await appendSheetValues('c1', 's', "'It''s'!A:ZZ", [['a']], {
      fetcher: asTypedFetch(quoted.fetcher),
    })
    expect(JSON.parse(String(quoted.calls[1].init?.body)).requests[0].appendCells.sheetId).toBe(9)
  })

  it('找不到工作表 -> GoogleSheetsError 404', async () => {
    getValidAccessTokenMock.mockResolvedValue('tok')
    const { fetcher } = mockAppendFlow({ title: '别的表' })
    const err = await appendSheetValues('c1', 's', 'Sheet1!A:ZZ', [['a']], {
      fetcher: asTypedFetch(fetcher),
    }).catch((e) => e)
    expect(err).toBeInstanceOf(GoogleSheetsError)
    expect((err as GoogleSheetsError).httpStatus).toBe(404)
  })

  it('没有行就不发请求', async () => {
    getValidAccessTokenMock.mockResolvedValue('tok')
    const { fetcher } = mockAppendFlow()
    expect(await appendSheetValues('c1', 's', 'Sheet1!A:ZZ', [], { fetcher: asTypedFetch(fetcher) })).toBe(0)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('成功时返回 rows.length（batchUpdate 是原子的，回执没有行数）', async () => {
    getValidAccessTokenMock.mockResolvedValue('tok')
    const { fetcher } = mockAppendFlow()
    const n = await appendSheetValues('c1', 's', 'Sheet1!A:ZZ', [['a'], ['b']], {
      fetcher: asTypedFetch(fetcher),
    })
    expect(n).toBe(2)
  })

  it('403（只授过只读）原样抛出去，不吞 —— 调用方要拿它下发人工待办', async () => {
    getValidAccessTokenMock.mockResolvedValue('tok')
    const { fetcher } = mockAppendFlow({ postStatus: 403, postBody: 'insufficient authentication scopes' })
    const err = await appendSheetValues('c1', 's', 'Sheet1!A:ZZ', [['a']], {
      fetcher: asTypedFetch(fetcher),
    }).catch((e) => e)
    expect(err).toBeInstanceOf(GoogleSheetsError)
    expect((err as GoogleSheetsError).httpStatus).toBe(403)
  })

  it('完全没有可用身份时抛 NotConfigured', async () => {
    getValidAccessTokenMock.mockResolvedValue(null)
    await expect(appendSheetValues('c1', 's', 'Sheet1!A:ZZ', [['a']])).rejects.toBeInstanceOf(
      GoogleSheetsNotConfiguredError,
    )
  })
})

describe('readSheetValues render 选项', () => {
  it('默认还是 UNFORMATTED（老调用方行为不变）', async () => {
    getValidAccessTokenMock.mockResolvedValue('tok')
    const fetcher = vi.fn<FetchMock>(async () => new Response(JSON.stringify({ values: [] }), { status: 200 }))
    await readSheetValues('c1', 's', 'T!A:B', { fetcher: asTypedFetch(fetcher) })
    expect(String(fetcher.mock.calls[0][0])).toContain('valueRenderOption=UNFORMATTED_VALUE')
  })

  it('要判重就得按人看到的文本读 —— formatted', async () => {
    getValidAccessTokenMock.mockResolvedValue('tok')
    const fetcher = vi.fn<FetchMock>(async () => new Response(JSON.stringify({ values: [] }), { status: 200 }))
    await readSheetValues('c1', 's', 'T!A:B', { fetcher: asTypedFetch(fetcher), render: 'formatted' })
    expect(String(fetcher.mock.calls[0][0])).toContain('valueRenderOption=FORMATTED_VALUE')
  })
})
