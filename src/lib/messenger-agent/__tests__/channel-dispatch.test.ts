/**
 * `src/lib/messenger-agent/channel-dispatch.ts` 的单测 + 变异测试（issue #1578）。
 *
 * 三块：
 *   1. `isChannelEnabled` —— fail-closed 的三条路径（未识别渠道 / 查询报错 /
 *      查不到客户）+ 两个渠道各自 true/false 的正常路径 + kill switch 从 true
 *      改到 false 后立刻读到新值（不经过缓存，验证要求里的 TTL 实测）。
 *   2. `getSentMessageId` —— 两个渠道各自的字段名映射 + 失败结果一律 null。
 *   3. `isWindowClosed` —— 两个渠道各自的"关闭"取值映射。
 */

import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isChannelEnabled, getSentMessageId, isWindowClosed } from '../channel-dispatch'
import type { SendReplyResult } from '../../messenger/send'
import type { SendWhatsAppResult } from '../../whatsapp/send'
import type { SendMailReplyResult } from '../../microsoft/mail-send'

// ---------------------------------------------------------------------------
// 假 supabase 数据源 —— 跟 `optout.test.ts` 同一个写法：按表名建模，`.eq()`
// 逐个收窄，最后 `.maybeSingle()` 取一行。这里只建模 `clients` 表，因为
// `isChannelEnabled` 只查这一张表。
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>

function makeFakeSupabase(rows: Row[], opts?: { forceError?: string }): SupabaseClient {
  const from = (table: string) => {
    if (table !== 'clients') throw new Error(`fake supabase: 表 '${table}' 没建模`)
    let filteredId: unknown
    const builder: Record<string, unknown> = {}
    builder.select = () => builder
    builder.eq = (col: string, val: unknown) => {
      if (col === 'id') filteredId = val
      return builder
    }
    builder.maybeSingle = async () => {
      if (opts?.forceError) return { data: null, error: { message: opts.forceError } }
      return { data: rows.find((r) => r.id === filteredId) ?? null, error: null }
    }
    return builder
  }
  return { from } as unknown as SupabaseClient
}

const CLIENT_A = 'client-a'

// ---------------------------------------------------------------------------
// 1) isChannelEnabled
// ---------------------------------------------------------------------------

describe('isChannelEnabled', () => {
  it('不存在的 channel 字符串 → false，不抛异常（fail-closed，变异测试）', async () => {
    const supabase = makeFakeSupabase([
      {
        id: CLIENT_A,
        messenger_agent_enabled_messenger: true,
        messenger_agent_enabled_whatsapp: true,
      },
    ])
    await expect(isChannelEnabled(CLIENT_A, 'sms', supabase)).resolves.toBe(false)
    await expect(isChannelEnabled(CLIENT_A, '', supabase)).resolves.toBe(false)
    await expect(isChannelEnabled(CLIENT_A, 'Messenger', supabase)).resolves.toBe(false) // 大小写敏感，不做归一化猜测
  })

  it('DB 查询报错 → false，不能因为查不到就当"开"处理', async () => {
    const supabase = makeFakeSupabase([], { forceError: 'connection reset' })
    await expect(isChannelEnabled(CLIENT_A, 'messenger', supabase)).resolves.toBe(false)
    await expect(isChannelEnabled(CLIENT_A, 'whatsapp', supabase)).resolves.toBe(false)
  })

  it('客户行不存在 → false', async () => {
    const supabase = makeFakeSupabase([])
    await expect(isChannelEnabled('no-such-client', 'messenger', supabase)).resolves.toBe(false)
  })

  it('messenger 列 true / whatsapp 列 false → 各自读各自的列，互不影响', async () => {
    const supabase = makeFakeSupabase([
      {
        id: CLIENT_A,
        messenger_agent_enabled_messenger: true,
        messenger_agent_enabled_whatsapp: false,
      },
    ])
    await expect(isChannelEnabled(CLIENT_A, 'messenger', supabase)).resolves.toBe(true)
    await expect(isChannelEnabled(CLIENT_A, 'whatsapp', supabase)).resolves.toBe(false)
  })

  it('三列都是 false（迁移默认值）→ 三个渠道都是 false', async () => {
    const supabase = makeFakeSupabase([
      {
        id: CLIENT_A,
        messenger_agent_enabled_messenger: false,
        messenger_agent_enabled_whatsapp: false,
        messenger_agent_enabled_email: false,
      },
    ])
    await expect(isChannelEnabled(CLIENT_A, 'messenger', supabase)).resolves.toBe(false)
    await expect(isChannelEnabled(CLIENT_A, 'whatsapp', supabase)).resolves.toBe(false)
    await expect(isChannelEnabled(CLIENT_A, 'email', supabase)).resolves.toBe(false)
  })

  it('email 列 true，messenger/whatsapp 仍是 false → 三列互不影响（issue #1745）', async () => {
    const supabase = makeFakeSupabase([
      {
        id: CLIENT_A,
        messenger_agent_enabled_messenger: false,
        messenger_agent_enabled_whatsapp: false,
        messenger_agent_enabled_email: true,
      },
    ])
    await expect(isChannelEnabled(CLIENT_A, 'email', supabase)).resolves.toBe(true)
    await expect(isChannelEnabled(CLIENT_A, 'messenger', supabase)).resolves.toBe(false)
    await expect(isChannelEnabled(CLIENT_A, 'whatsapp', supabase)).resolves.toBe(false)
  })

  it('kill switch 从 true 改到 false 后，下一次查询立刻读到新值（不经过缓存）', async () => {
    const rows: Row[] = [
      {
        id: CLIENT_A,
        messenger_agent_enabled_messenger: true,
        messenger_agent_enabled_whatsapp: true,
      },
    ]
    const supabase = makeFakeSupabase(rows)

    await expect(isChannelEnabled(CLIENT_A, 'messenger', supabase)).resolves.toBe(true)

    // PM 在 Settings UI 里把开关拍到 false —— 模拟为同一行的原地更新。
    rows[0].messenger_agent_enabled_messenger = false

    await expect(isChannelEnabled(CLIENT_A, 'messenger', supabase)).resolves.toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 2) getSentMessageId
// ---------------------------------------------------------------------------

describe('getSentMessageId', () => {
  it('messenger 成功结果 → 取 metaMessageId', () => {
    const result: SendReplyResult = { ok: true, metaMessageId: 'mid.123', window: 'standard' }
    expect(getSentMessageId('messenger', result)).toBe('mid.123')
  })

  it('messenger 成功但 metaMessageId 为 null → null（不是取不到就报错）', () => {
    const result: SendReplyResult = { ok: true, metaMessageId: null, window: 'human_agent' }
    expect(getSentMessageId('messenger', result)).toBeNull()
  })

  it('whatsapp 成功结果 → 取 whatsappMessageId', () => {
    const result: SendWhatsAppResult = { ok: true, whatsappMessageId: 'wamid.456', window: 'open' }
    expect(getSentMessageId('whatsapp', result)).toBe('wamid.456')
  })

  it('messenger 发送失败结果 → null', () => {
    const result: SendReplyResult = {
      ok: false,
      status: 409,
      error: 'Messenger 回复窗口已关闭',
      reason: 'window_closed',
    }
    expect(getSentMessageId('messenger', result)).toBeNull()
  })

  it('whatsapp 发送失败结果 → null', () => {
    const result: SendWhatsAppResult = {
      ok: false,
      status: 424,
      error: 'WhatsApp 授权未配置，无法发送',
      reason: 'no_token',
    }
    expect(getSentMessageId('whatsapp', result)).toBeNull()
  })

  it('email 成功结果 → 取 messageId（issue #1745，字段名跟另外两个渠道都不同）', () => {
    const result: SendMailReplyResult = { ok: true, messageId: 'graph-msg-1' }
    expect(getSentMessageId('email', result)).toBe('graph-msg-1')
  })

  it('email 发送失败结果 → null', () => {
    const result: SendMailReplyResult = {
      ok: false,
      status: 424,
      error: '邮箱授权掉线了，请找 Magic Lab 团队重连',
      reason: 'no_token',
    }
    expect(getSentMessageId('email', result)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 3) isWindowClosed
// ---------------------------------------------------------------------------

describe('isWindowClosed', () => {
  it("messenger：'closed' → true", () => {
    expect(isWindowClosed('messenger', 'closed')).toBe(true)
  })

  it.each(['standard', 'human_agent'])("messenger：'%s' → false", (kind) => {
    expect(isWindowClosed('messenger', kind)).toBe(false)
  })

  it("whatsapp：'template_only' → true", () => {
    expect(isWindowClosed('whatsapp', 'template_only')).toBe(true)
  })

  it("whatsapp：'open' → false", () => {
    expect(isWindowClosed('whatsapp', 'open')).toBe(false)
  })

  it("跨渠道取值不能互相误判：messenger 传 'template_only' → false（那是 whatsapp 的关闭态，不是 messenger 的）", () => {
    expect(isWindowClosed('messenger', 'template_only')).toBe(false)
  })

  it("跨渠道取值不能互相误判：whatsapp 传 'closed' → false（那是 messenger 的关闭态，不是 whatsapp 的）", () => {
    expect(isWindowClosed('whatsapp', 'closed')).toBe(false)
  })

  it("email：'closed' → true（客人没来过信）", () => {
    expect(isWindowClosed('email', 'closed')).toBe(true)
  })

  it("email：'open' → false", () => {
    expect(isWindowClosed('email', 'open')).toBe(false)
  })
})
