// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHmac } from 'node:crypto'
import { handleResendWebhook, sanitizeValue, errorCodeOf } from '../resend-ingest'
import type { ProviderEventInput, ProviderEventStore } from '../types'

// 测试用密钥（合法格式：whsec_ + base64，解码后 >= 16 字节）
const SECRET = 'whsec_' + 'ABEiM0RVZneImaq7zN3u/wARIjNEVWZ3'

// 环境变量读取函数：只认 system 账号的密钥
const ENV = (name: string): string | undefined =>
  name === 'RESEND_WEBHOOK_SECRET_SYSTEM' ? SECRET : undefined

// 独立签名实现（不依赖仓库里的签名工具）
function sign(secret: string, id: string, ts: string, body: string): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  const digest = createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64')
  return 'v1,' + digest
}

// 当前秒级时间戳
function nowSec(): number {
  return Math.floor(Date.now() / 1000)
}

// 构造标准事件体
function eventBody(
  type: string = 'email.delivered',
  dataOverride: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    type,
    created_at: '2026-11-01T01:02:03.000Z',
    data: {
      email_id: 'em_123',
      from: 'CTS Website <noreply@example.com>',
      to: ['staff@example.com'],
      subject: 'New enquiry from your website — Zhang San',
      ...dataOverride,
    },
  })
}

// 模拟存储：唯一约束按 provider|account|providerEventId 去重
function makeStore(): {
  store: ProviderEventStore
  rows: ProviderEventInput[]
  insert: ReturnType<typeof vi.fn>
} {
  const rows: ProviderEventInput[] = []
  const seen = new Set<string>()
  const insert = vi.fn(async (row: ProviderEventInput): Promise<'inserted' | 'duplicate'> => {
    const key = `${row.provider}|${row.account}|${row.providerEventId}`
    if (seen.has(key)) return 'duplicate'
    seen.add(key)
    rows.push(row)
    return 'inserted'
  })
  const store: ProviderEventStore = { insert }
  return { store, rows, insert }
}

interface CallOpts {
  id?: string
  ts?: string
  secret?: string
  account?: string
  env?: (name: string) => string | undefined
  omit?: 'id' | 'ts' | 'sig'
  nowSec?: number
}

// 调用被测入口，自动按需签名
async function call(
  store: ProviderEventStore,
  body: string,
  opts: CallOpts = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const id = opts.id ?? 'msg_test_1'
  const ts = opts.ts ?? String(nowSec())
  const secret = opts.secret ?? SECRET
  const account = opts.account ?? 'system'
  const env = opts.env ?? ENV

  const sig = sign(secret, id, ts, body)

  const svixId = opts.omit === 'id' ? null : id
  const svixTimestamp = opts.omit === 'ts' ? null : ts
  const svixSignature = opts.omit === 'sig' ? null : sig

  return handleResendWebhook(store, {
    account,
    bodyText: body,
    svixId,
    svixTimestamp,
    svixSignature,
    env,
    nowSec: opts.nowSec,
  })
}

// 把任意参数安全地 JSON 化（循环引用等异常时退化为 String）
function safeJson(v: unknown): string {
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

// 所有级别日志拼成一个字符串
function logged(): string {
  const parts: string[] = []
  for (const level of ['info', 'warn', 'error'] as const) {
    for (const args of calls(level)) {
      parts.push(args.map((a) => safeJson(a)).join(' '))
    }
  }
  return parts.join('\n')
}

// 某级别的调用参数数组
function calls(level: 'info' | 'warn' | 'error'): unknown[][] {
  const spy =
    level === 'info' ? console.info : level === 'warn' ? console.warn : console.error
  return (spy as unknown as { mock: { calls: unknown[][] } }).mock.calls
}

// 递归收集所有字符串值以及所有对象的键名
function collectTexts(v: unknown): string[] {
  const out: string[] = []
  const walk = (x: unknown): void => {
    if (typeof x === 'string') {
      out.push(x)
      return
    }
    if (Array.isArray(x)) {
      for (const item of x) walk(item)
      return
    }
    if (x !== null && typeof x === 'object') {
      for (const [k, val] of Object.entries(x)) {
        out.push(k)
        walk(val)
      }
    }
  }
  walk(v)
  return out
}

// 按 UTF-16 码元检查是否存在孤立代理
function hasLoneSurrogate(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = i + 1 < s.length ? s.charCodeAt(i + 1) : -1
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true
      i++
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      const prev = i > 0 ? s.charCodeAt(i - 1) : -1
      if (!(prev >= 0xd800 && prev <= 0xdbff)) return true
    }
  }
  return false
}

// 日志卫生检查：每次调用恰好一个字符串参数，且为合法 JSON 结构、不含敏感信息
function assertLogsClean(): void {
  const allowedKeys = new Set(['evt', 'code', 'account', 'type', 'dbCode'])
  const secretBody = SECRET.replace(/^whsec_/, '')
  for (const level of ['info', 'warn', 'error'] as const) {
    for (const args of calls(level)) {
      expect(args).toHaveLength(1)
      const line = args[0]
      expect(typeof line).toBe('string')
      if (typeof line !== 'string') continue
      const parsed: unknown = JSON.parse(line)
      expect(parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)).toBe(true)
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) continue
      const obj = parsed as Record<string, unknown>
      expect(obj.evt).toBe('provider_webhook')
      for (const [k, val] of Object.entries(obj)) {
        expect(allowedKeys.has(k)).toBe(true)
        expect(typeof val).toBe('string')
      }
      expect(line).not.toContain('@')
      expect(line).not.toContain('whsec_')
      expect(line).not.toContain(secretBody)
    }
  }
}

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  assertLogsClean()
  vi.restoreAllMocks()
})

describe('handleResendWebhook - 账号白名单', () => {
  it('rejects unknown accounts with 404 and no logging', async () => {
    for (const account of ['client', '', 'SYSTEM', '../x']) {
      const { store, insert } = makeStore()
      const res = await call(store, eventBody(), { account })
      expect(res.status).toBe(404)
      expect(res.body).toEqual({ ok: false, error: 'not_found' })
      expect(insert).not.toHaveBeenCalled()
    }
    expect(calls('info')).toHaveLength(0)
    expect(calls('warn')).toHaveLength(0)
    expect(calls('error')).toHaveLength(0)
  })
})

describe('handleResendWebhook - 密钥读取', () => {
  it('returns 503 when secret is missing or malformed', async () => {
    const badSecrets: Array<string | undefined> = [
      undefined,
      '',
      '   ',
      'whsec_',
      'whsec_abc',
      'whsec_' + '-'.repeat(30),
    ]
    for (const value of badSecrets) {
      const { store, insert } = makeStore()
      const env = (name: string): string | undefined =>
        name === 'RESEND_WEBHOOK_SECRET_SYSTEM' ? value : undefined
      const res = await call(store, eventBody(), { env })
      expect(res.status).toBe(503)
      expect(res.body).toEqual({ ok: false, error: 'unavailable' })
      expect(insert).not.toHaveBeenCalled()
    }
    // 每个坏密钥各产生恰好一次 error（共 badSecrets.length 次），代号都是 secret_unavailable，且不再有 warn
    expect(calls('error')).toHaveLength(badSecrets.length)
    for (const args of calls('error')) {
      expect(String(args[0])).toContain('"code":"secret_unavailable"')
    }
    expect(calls('warn')).toHaveLength(0)
  })
})

describe('handleResendWebhook - 缺失签名头', () => {
  it('returns 401 with missing_headers when any svix header is absent', async () => {
    for (const omit of ['id', 'ts', 'sig'] as const) {
      const { store, insert } = makeStore()
      const res = await call(store, eventBody(), { omit })
      expect(res.status).toBe(401)
      expect(res.body).toEqual({ ok: false, error: 'invalid_signature' })
      expect(insert).not.toHaveBeenCalled()
    }
    expect(calls('warn')).toHaveLength(3)
    for (const args of calls('warn')) {
      expect(String(args[0])).toContain('"code":"missing_headers"')
    }
  })
})

describe('handleResendWebhook - 签名不符', () => {
  it('returns 401 and logs signature_mismatch at error level', async () => {
    const { store, insert } = makeStore()
    const res = await call(store, eventBody(), {
      secret: 'whsec_' + 'MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw',
    })
    expect(res.status).toBe(401)
    expect(res.body).toEqual({ ok: false, error: 'invalid_signature' })
    expect(insert).not.toHaveBeenCalled()
    expect(calls('error')).toHaveLength(1)
    expect(String(calls('error')[0][0])).toContain('"code":"signature_mismatch"')
  })
})

describe('handleResendWebhook - 时间窗', () => {
  it('rejects timestamps outside the replay window', async () => {
    for (const offset of [-310, 310]) {
      const { store, insert } = makeStore()
      const ts = String(nowSec() + offset)
      const res = await call(store, eventBody(), { ts })
      expect(res.status).toBe(401)
      expect(res.body).toEqual({ ok: false, error: 'invalid_signature' })
      expect(insert).not.toHaveBeenCalled()
    }
    expect(calls('warn')).toHaveLength(2)
    for (const args of calls('warn')) {
      expect(String(args[0])).toContain('"code":"outside_window"')
    }
  })

  it('accepts timestamps inside the replay window', async () => {
    for (const offset of [-290, 290]) {
      const { store, rows } = makeStore()
      const ts = String(nowSec() + offset)
      const res = await call(store, eventBody(), { ts })
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ ok: true })
      expect(rows).toHaveLength(1)
    }
  })

  it('handles exact window boundaries deterministically', async () => {
    const base = 1730000000
    // 边界内：±300 秒应被接受
    for (const ts of [base - 300, base + 300]) {
      const { store, rows } = makeStore()
      const res = await call(store, eventBody(), { ts: String(ts), nowSec: base })
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ ok: true })
      expect(rows).toHaveLength(1)
    }
    // 边界外：±301 秒应被拒绝
    for (const ts of [base - 301, base + 301]) {
      const { store, insert } = makeStore()
      const res = await call(store, eventBody(), { ts: String(ts), nowSec: base })
      expect(res.status).toBe(401)
      expect(res.body).toEqual({ ok: false, error: 'invalid_signature' })
      expect(insert).not.toHaveBeenCalled()
    }
    expect(calls('warn')).toHaveLength(2)
    for (const args of calls('warn')) {
      expect(String(args[0])).toContain('"code":"outside_window"')
    }
  })

  it('rejects non-numeric timestamps with bad_timestamp', async () => {
    const { store, insert } = makeStore()
    const res = await call(store, eventBody(), { ts: 'abc' })
    expect(res.status).toBe(401)
    expect(res.body).toEqual({ ok: false, error: 'invalid_signature' })
    expect(insert).not.toHaveBeenCalled()
    expect(calls('warn')).toHaveLength(1)
    expect(String(calls('warn')[0][0])).toContain('"code":"bad_timestamp"')
  })
})

describe('handleResendWebhook - nowSec 参数', () => {
  it('uses provided nowSec for window check', async () => {
    const { store, rows } = makeStore()
    const res = await call(store, eventBody(), { ts: '1730000000', nowSec: 1730000000 })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
    expect(rows).toHaveLength(1)
  })
})

describe('handleResendWebhook - 坏载荷', () => {
  it('returns 400 for malformed bodies', async () => {
    const bodies = [
      'not json',
      '[]',
      'null',
      '"str"',
      JSON.stringify({ data: {} }),
      JSON.stringify({ type: 5 }),
    ]
    for (const body of bodies) {
      const { store, insert } = makeStore()
      const res = await call(store, body)
      expect(res.status).toBe(400)
      expect(res.body).toEqual({ ok: false, error: 'bad_payload' })
      expect(insert).not.toHaveBeenCalled()
    }
    expect(calls('warn')).toHaveLength(bodies.length)
    for (const args of calls('warn')) {
      expect(String(args[0])).toContain('"code":"bad_payload"')
    }
  })

  it('returns 400 for invalid svix-id shape', async () => {
    const { store, insert } = makeStore()
    const res = await call(store, eventBody(), { id: 'msg id!' })
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ ok: false, error: 'bad_payload' })
    expect(insert).not.toHaveBeenCalled()
  })
})

describe('handleResendWebhook - svix-id 长度', () => {
  it('accepts svix-id of 200 chars', async () => {
    const { store, rows } = makeStore()
    const res = await call(store, eventBody(), { id: 'm'.repeat(200) })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
    expect(rows).toHaveLength(1)
  })

  it('rejects svix-id of 201 chars', async () => {
    const { store, insert } = makeStore()
    const res = await call(store, eventBody(), { id: 'm'.repeat(201) })
    expect(res.status).toBe(400)
    expect(res.body).toEqual({ ok: false, error: 'bad_payload' })
    expect(insert).not.toHaveBeenCalled()
  })
})

describe('handleResendWebhook - 事件类型白名单外', () => {
  it('ignores non-whitelisted event types', async () => {
    const types = [
      'email.opened',
      'email.clicked',
      'email.received',
      'email.scheduled',
      'contact.created',
      'email.sent ',
    ]
    for (const type of types) {
      const { store, insert } = makeStore()
      const res = await call(store, eventBody(type))
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ ok: true, ignored: true })
      expect(insert).not.toHaveBeenCalled()
    }
    expect(calls('info')).toHaveLength(types.length)
    for (const args of calls('info')) {
      expect(String(args[0])).toContain('"code":"ignored_type"')
    }
  })
})

describe('handleResendWebhook - 事件类型白名单内', () => {
  it('stores each whitelisted event type with correct row fields', async () => {
    const types = [
      'email.sent',
      'email.delivered',
      'email.delivery_delayed',
      'email.bounced',
      'email.complained',
      'email.failed',
      'email.suppressed',
    ]
    for (const type of types) {
      const { store, rows, insert } = makeStore()
      const id = `msg_${type.replace(/\./g, '_')}`
      const res = await call(store, eventBody(type), { id })
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ ok: true })
      expect(insert).toHaveBeenCalledTimes(1)
      expect(rows).toHaveLength(1)
      const row = rows[0]
      expect(row.provider).toBe('resend')
      expect(row.account).toBe('system')
      expect(row.providerEventId).toBe(id)
      expect(row.eventType).toBe(type)
      expect(row.providerMessageId).toBe('em_123')
      expect(row.occurredAt).toBe('2026-11-01T01:02:03.000Z')
    }
    // 成功路径无日志
    expect(calls('info')).toHaveLength(0)
    expect(calls('warn')).toHaveLength(0)
    expect(calls('error')).toHaveLength(0)
  })
})

describe('handleResendWebhook - 载荷清洗', () => {
  it('removes subject but keeps to/from and top-level fields', async () => {
    const { store, rows } = makeStore()
    const res = await call(store, eventBody())
    expect(res.status).toBe(200)
    expect(rows).toHaveLength(1)
    const payload = rows[0].payload
    const data = payload.data as Record<string, unknown>
    expect(Object.prototype.hasOwnProperty.call(data, 'subject')).toBe(false)
    expect(data.to).toEqual(['staff@example.com'])
    expect(data.from).toBe('CTS Website <noreply@example.com>')
    expect(payload.type).toBe('email.delivered')
    expect(payload.created_at).toBe('2026-11-01T01:02:03.000Z')
  })

  it('handles non-object data without error', async () => {
    const bodies = [
      JSON.stringify({
        type: 'email.delivered',
        created_at: '2026-11-01T01:02:03.000Z',
        data: 'not-an-object',
      }),
      JSON.stringify({
        type: 'email.delivered',
        created_at: '2026-11-01T01:02:03.000Z',
      }),
    ]
    for (const body of bodies) {
      const { store, rows } = makeStore()
      const res = await call(store, body)
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ ok: true })
      expect(rows).toHaveLength(1)
      expect(rows[0].providerMessageId).toBeNull()
    }
  })
})

describe('handleResendWebhook - 去重', () => {
  it('returns duplicate on second call with same id', async () => {
    const { store, rows } = makeStore()
    const body = eventBody()
    const first = await call(store, body, { id: 'msg_dup' })
    expect(first.status).toBe(200)
    expect(first.body).toEqual({ ok: true })
    const second = await call(store, body, { id: 'msg_dup' })
    expect(second.status).toBe(200)
    expect(second.body).toEqual({ ok: true, duplicate: true })
    expect(rows).toHaveLength(1)
  })

  it('stores two rows for same email_id with different svix-id', async () => {
    const { store, rows } = makeStore()
    const body = eventBody()
    await call(store, body, { id: 'msg_a' })
    await call(store, body, { id: 'msg_b' })
    expect(rows).toHaveLength(2)
  })
})

describe('handleResendWebhook - 库错误', () => {
  it('returns 500 with dbCode and does not leak sensitive data', async () => {
    const { store } = makeStore()
    const err = Object.assign(
      new Error('Failing row contains (guest@example.com)'),
      { code: '23514' },
    )
    store.insert = vi.fn(async () => {
      throw err
    })
    const res = await call(store, eventBody())
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ ok: false, error: 'store_failed' })
    expect(calls('error')).toHaveLength(1)
    expect(String(calls('error')[0][0])).toContain('"dbCode":"23514"')

    const all = logged()
    expect(all).not.toContain('@')
    expect(all).not.toContain('guest')
    expect(all).not.toContain('whsec_')
    expect(all).not.toContain('Zhang San')
    expect(all).not.toContain('staff')
  })

  it('returns 500 with dbCode unknown for generic errors', async () => {
    const { store } = makeStore()
    store.insert = vi.fn(async () => {
      throw new Error('boom')
    })
    const res = await call(store, eventBody())
    expect(res.status).toBe(500)
    expect(res.body).toEqual({ ok: false, error: 'store_failed' })
    expect(calls('error')).toHaveLength(1)
    expect(String(calls('error')[0][0])).toContain('"dbCode":"unknown"')
  })
})

describe('handleResendWebhook - 毒事件清洗', () => {
  it('sanitizes NUL and lone surrogates in stored payload', async () => {
    const NUL = String.fromCharCode(0)
    const LONE = String.fromCharCode(0xd800)
    const body = JSON.stringify({
      type: 'email.delivered',
      created_at: '2026-11-01T01:02:03.000Z',
      data: {
        email_id: 'em_poison',
        bounce: { message: 'a' + NUL + 'b' },
        tags: ['x' + LONE + 'y'],
        ['k' + NUL + 'ey']: 'value',
      },
    })
    const { store, rows } = makeStore()
    const res = await call(store, body)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
    expect(rows).toHaveLength(1)

    const texts = collectTexts(rows[0].payload)
    for (const t of texts) {
      expect(t).not.toContain(NUL)
      expect(hasLoneSurrogate(t)).toBe(false)
    }

    const data = rows[0].payload.data as Record<string, unknown>
    const bounce = data.bounce as Record<string, unknown>
    expect(bounce.message).toBe('ab')
    expect(Object.prototype.hasOwnProperty.call(data, 'key')).toBe(true)
    const tags = data.tags as string[]
    expect(tags[0]).toBe('x\uFFFDy')
  })

  it('replaces lone low surrogate with U+FFFD', async () => {
    const body = JSON.stringify({
      type: 'email.delivered',
      created_at: '2026-11-01T01:02:03.000Z',
      data: { email_id: 'em_1', note: 'a' + String.fromCharCode(0xdc00) + 'b' },
    })
    const { store, rows } = makeStore()
    const res = await call(store, body)
    expect(res.status).toBe(200)
    const data = rows[0].payload.data as Record<string, unknown>
    expect(data.note).toBe('a' + String.fromCharCode(0xfffd) + 'b')
  })

  it('replaces trailing lone high surrogate with U+FFFD', async () => {
    const body = JSON.stringify({
      type: 'email.delivered',
      created_at: '2026-11-01T01:02:03.000Z',
      data: { email_id: 'em_1', note: 'x' + String.fromCharCode(0xd800) },
    })
    const { store, rows } = makeStore()
    const res = await call(store, body)
    expect(res.status).toBe(200)
    const data = rows[0].payload.data as Record<string, unknown>
    expect(data.note).toBe('x' + String.fromCharCode(0xfffd))
  })

  it('keeps valid surrogate pairs intact', async () => {
    const emoji = 'ok ' + String.fromCodePoint(0x1f600) + ' done'
    const body = JSON.stringify({
      type: 'email.delivered',
      created_at: '2026-11-01T01:02:03.000Z',
      data: { email_id: 'em_1', note: emoji },
    })
    const { store, rows } = makeStore()
    const res = await call(store, body)
    expect(res.status).toBe(200)
    const data = rows[0].payload.data as Record<string, unknown>
    expect(data.note).toBe(emoji)
  })

  it('strips NUL from email_id in row and payload', async () => {
    const body = JSON.stringify({
      type: 'email.delivered',
      created_at: '2026-11-01T01:02:03.000Z',
      data: { email_id: 'em' + String.fromCharCode(0) + 'x' },
    })
    const { store, rows } = makeStore()
    const res = await call(store, body)
    expect(res.status).toBe(200)
    expect(rows[0].providerMessageId).toBe('emx')
    const data = rows[0].payload.data as Record<string, unknown>
    expect(data.email_id).toBe('emx')
  })

  it('checks email_id length after sanitization', async () => {
    const body = JSON.stringify({
      type: 'email.delivered',
      created_at: '2026-11-01T01:02:03.000Z',
      data: { email_id: 'x'.repeat(200) + String.fromCharCode(0) },
    })
    const { store, rows } = makeStore()
    const res = await call(store, body)
    expect(res.status).toBe(200)
    expect(rows[0].providerMessageId).toBe('x'.repeat(200))
  })

  it('drops subject even when key contains NUL', async () => {
    const body = JSON.stringify({
      type: 'email.delivered',
      created_at: '2026-11-01T01:02:03.000Z',
      data: {
        email_id: 'em_1',
        ['sub' + String.fromCharCode(0) + 'ject']: 'secret subject',
        subject: 'real subject',
      },
    })
    const { store, rows } = makeStore()
    const res = await call(store, body)
    expect(res.status).toBe(200)
    const data = rows[0].payload.data as Record<string, unknown>
    const keys = Object.keys(data)
    expect(keys).not.toContain('subject')
    for (const k of keys) {
      expect(k).not.toContain(String.fromCharCode(0))
    }
  })
})

describe('handleResendWebhook - email_id 变体', () => {
  it('normalizes providerMessageId based on email_id shape', async () => {
    const cases: Array<{ data: Record<string, unknown> | undefined; expected: string | null }> = [
      { data: { email_id: '' }, expected: null },
      { data: { email_id: 'x'.repeat(201) }, expected: null },
      { data: { email_id: 123 }, expected: null },
      { data: undefined, expected: null },
      { data: { email_id: 'x'.repeat(200) }, expected: 'x'.repeat(200) },
    ]
    for (const c of cases) {
      const body = JSON.stringify({
        type: 'email.delivered',
        created_at: '2026-11-01T01:02:03.000Z',
        ...(c.data === undefined ? {} : { data: c.data }),
      })
      const { store, rows } = makeStore()
      const res = await call(store, body)
      expect(res.status).toBe(200)
      expect(rows).toHaveLength(1)
      expect(rows[0].providerMessageId).toBe(c.expected)
    }
  })
})

describe('handleResendWebhook - created_at 变体', () => {
  it('normalizes occurredAt based on created_at value', async () => {
    const cases: Array<{ created_at: unknown; expected: string | null }> = [
      { created_at: 'not-a-date', expected: null },
      { created_at: '', expected: null },
      { created_at: 5, expected: null },
      { created_at: '-000001-01-01T00:00:00.000Z', expected: null },
      { created_at: '1999-12-31T23:59:59.000Z', expected: null },
      { created_at: '2101-01-01T00:00:00.000Z', expected: null },
      { created_at: '2026-11-01T01:02:03.456+13:00', expected: '2026-10-31T12:02:03.456Z' },
    ]
    for (const c of cases) {
      const body = JSON.stringify({
        type: 'email.delivered',
        created_at: c.created_at,
        data: { email_id: 'em_123' },
      })
      const { store, rows } = makeStore()
      const res = await call(store, body)
      expect(res.status).toBe(200)
      expect(rows).toHaveLength(1)
      expect(rows[0].occurredAt).toBe(c.expected)
    }
  })
})

describe('handleResendWebhook - 原型安全', () => {
  it('keeps __proto__ as own key without polluting Object.prototype', async () => {
    const body =
      '{"type":"email.delivered","created_at":"2026-11-01T01:02:03.000Z","data":{"email_id":"em_1","__proto__":{"polluted":1}}}'
    const { store, rows } = makeStore()
    const res = await call(store, body)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
    expect(rows).toHaveLength(1)
    const data = rows[0].payload.data as Record<string, unknown>
    expect(Object.keys(data)).toContain('__proto__')
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
  })
})

describe('errorCodeOf', () => {
  it('extracts safe error codes', () => {
    expect(errorCodeOf({ code: '23514' })).toBe('23514')
    expect(errorCodeOf({ code: 'bad code!' })).toBe('unknown')
    expect(errorCodeOf(new Error('provider_webhook_events insert failed: 42501'))).toBe('42501')
    expect(errorCodeOf('x')).toBe('unknown')
    expect(errorCodeOf(null)).toBe('unknown')
    expect(errorCodeOf(undefined)).toBe('unknown')
  })
})

describe('sanitizeValue', () => {
  it('sanitizes nested strings and keys, preserves primitives and valid pairs', () => {
    const NUL = String.fromCharCode(0)
    const LONE = String.fromCharCode(0xd800)
    const emoji = '\u{1F600}'

    const input = {
      ['k' + NUL + 'ey']: 'a' + NUL + 'b',
      nested: {
        arr: ['x' + LONE + 'y', 42, true, null],
        emoji,
      },
    }

    const out = sanitizeValue(input) as Record<string, unknown>
    expect(Object.prototype.hasOwnProperty.call(out, 'key')).toBe(true)
    expect(out.key).toBe('ab')

    const nested = out.nested as Record<string, unknown>
    const arr = nested.arr as unknown[]
    expect(arr[0]).toBe('x\uFFFDy')
    expect(arr[1]).toBe(42)
    expect(arr[2]).toBe(true)
    expect(arr[3]).toBeNull()
    expect(nested.emoji).toBe(emoji)
  })
})
