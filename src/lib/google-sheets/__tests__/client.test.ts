import { describe, it, expect, vi, afterEach } from 'vitest'
import { generateKeyPairSync } from 'crypto'
import { readSheetValues, GoogleSheetsError, GoogleSheetsNotConfiguredError } from '../client'

const getValidAccessTokenMock = vi.fn<(clientId: string) => Promise<string | null>>()

vi.mock('@/lib/google-oauth/client', () => ({
  getValidAccessToken: (clientId: string) => getValidAccessTokenMock(clientId),
  SHEETS_READONLY_SCOPE: 'https://www.googleapis.com/auth/spreadsheets.readonly',
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
