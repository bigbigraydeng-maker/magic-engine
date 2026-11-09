// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// 用 vi.hoisted 提前声明 mock，保证 vi.mock 工厂能引用到它们。
const { insertFn, fromFn } = vi.hoisted(() => {
  const insertFn = vi.fn()
  const fromFn = vi.fn((table: string) => ({
    insert: (row: unknown) => insertFn(table, row),
  }))
  return { insertFn, fromFn }
})

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: fromFn } }))

import { supabaseProviderEventStore } from '../store'
import type { ProviderEventInput } from '../types'

// 样本行：覆盖所有字段，便于断言列名映射。
const ROW: ProviderEventInput = {
  provider: 'resend',
  account: 'system',
  providerEventId: 'msg_s1',
  eventType: 'email.bounced',
  providerMessageId: 'em_1',
  occurredAt: '2026-11-01T01:02:03.000Z',
  payload: { type: 'email.bounced', data: { email_id: 'em_1' } },
}

beforeEach(() => {
  insertFn.mockReset()
})

describe('supabaseProviderEventStore.insert', () => {
  it('returns "inserted" and maps domain fields to db columns on success', async () => {
    // 成功路径：无错误。
    insertFn.mockResolvedValue({ error: null })

    const outcome = await supabaseProviderEventStore.insert(ROW)

    expect(outcome).toBe('inserted')
    // 恰好调用一次，且表名与列映射正确。
    expect(insertFn).toHaveBeenCalledTimes(1)
    expect(insertFn).toHaveBeenNthCalledWith(1, 'provider_webhook_events', {
      provider: 'resend',
      account: 'system',
      provider_event_id: 'msg_s1',
      event_type: 'email.bounced',
      provider_message_id: 'em_1',
      occurred_at: '2026-11-01T01:02:03.000Z',
      payload: ROW.payload,
    })
  })

  it('returns "duplicate" on unique violation (23505) without throwing', async () => {
    // 唯一约束冲突视为重复事件，幂等处理。
    insertFn.mockResolvedValue({
      error: { code: '23505', message: 'duplicate key', details: 'x' },
    })

    // 用 resolves 断言：若实现改成抛错，这里是断言失败而不是崩溃
    await expect(supabaseProviderEventStore.insert(ROW)).resolves.toBe('duplicate')
  })

  it('throws a sanitized error on CHECK violation (23514) without leaking details', async () => {
    // CHECK 违例：details 含邮箱，绝不能带出去。
    insertFn.mockResolvedValue({
      error: {
        code: '23514',
        message: 'new row violates check constraint',
        details: 'Failing row contains (guest@example.com)',
      },
    })

    const promise = supabaseProviderEventStore.insert(ROW)

    await expect(promise).rejects.toThrow(
      'provider_webhook_events insert failed: 23514',
    )
    // 额外断言：错误信息不含任何敏感片段。
    await expect(promise).rejects.toSatisfy((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err)
      expect(message).not.toContain('@')
      expect(message).not.toContain('guest')
      expect(message).not.toContain('Failing')
      return true
    })
  })

  it('throws with "unknown" code when error has no code', async () => {
    // 缺少 code 时降级为 unknown。
    insertFn.mockResolvedValue({
      error: {
        message: 'boom',
        details: 'Failing row contains (guest@example.com)',
      },
    })

    await expect(supabaseProviderEventStore.insert(ROW)).rejects.toThrow(
      'provider_webhook_events insert failed: unknown',
    )
  })

  it('throws with "unknown" code when error code fails the whitelist regex', async () => {
    // 非法 code（含空格与感叹号）不通过白名单正则，降级为 unknown。
    insertFn.mockResolvedValue({
      error: { code: 'bad code with spaces!!', message: 'x' },
    })

    await expect(supabaseProviderEventStore.insert(ROW)).rejects.toThrow(
      'provider_webhook_events insert failed: unknown',
    )
  })

  it('preserves a valid alphanumeric error code (PGRST102)', async () => {
    // 合法 code 原样带出。
    insertFn.mockResolvedValue({
      error: { code: 'PGRST102', message: 'invalid json' },
    })

    await expect(supabaseProviderEventStore.insert(ROW)).rejects.toThrow(
      'provider_webhook_events insert failed: PGRST102',
    )
  })

  it('propagates a rejected insertFn (network error) unchanged', async () => {
    // 网络层直接抛错：store 不应吞掉，应以同一个错误 reject。
    const networkError = new Error('network down')
    insertFn.mockRejectedValue(networkError)

    await expect(supabaseProviderEventStore.insert(ROW)).rejects.toBe(
      networkError,
    )
  })
})
