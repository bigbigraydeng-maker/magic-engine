import { describe, it, expect } from 'vitest'
import { parseDescription, isClosedTitle } from '../parse-event'

describe('parseDescription - ledger-id', () => {
  it('accepts a valid ledger-id only', () => {
    const result = parseDescription('ledger-id: 2026-10-08-audit-card')
    expect(result.ledgerId).toBe('2026-10-08-audit-card')
    expect(result.probe).toBeNull()
    expect(result.ambiguous).toBe(false)
    expect(result.reason).toBeNull()
  })

  it('reports missing ledger-id', () => {
    const result = parseDescription('just some notes')
    expect(result.ledgerId).toBeNull()
    expect(result.reason).toBe('描述里没有 ledger-id')
  })

  it('reports malformed ledger-id', () => {
    const result = parseDescription('ledger-id: NotValid_ID')
    expect(result.ledgerId).toBeNull()
    expect(result.reason).toBe('ledger-id 格式不合格')
  })

  it('flags two ledger-ids as ambiguous', () => {
    const result = parseDescription('ledger-id: 2026-10-08-a\nledger-id: 2026-10-08-b')
    expect(result.ledgerId).toBeNull()
    expect(result.probe).toBeNull()
    expect(result.ambiguous).toBe(true)
    expect(result.reason).toBe('描述里出现多个 ledger-id')
  })

  it('ignores mid-line ledger-id text', () => {
    const result = parseDescription('see ledger-id: 2026-10-08-a for details')
    expect(result.ledgerId).toBeNull()
    expect(result.reason).toBe('描述里没有 ledger-id')
  })

  it.each([
    '../../.env',
    '../evidence/x',
    '%2e%2e/x',
    '/etc/passwd',
    'a/b',
  ])('rejects path-traversal token %s', (token) => {
    const result = parseDescription(`ledger-id: ${token}`)
    expect(result.ledgerId).toBeNull()
    expect(result.reason).toBe('ledger-id 格式不合格')
  })
})

describe('parseDescription - probes', () => {
  it('accepts cron_run_ok with a valid ledger-id', () => {
    const result = parseDescription(
      'ledger-id: 2026-10-08-a\nprobe: cron_run_ok job=calendar-closure-audit within_hours=24',
    )
    expect(result.ledgerId).toBe('2026-10-08-a')
    expect(result.probe).toEqual({
      name: 'cron_run_ok',
      params: { job: 'calendar-closure-audit', within_hours: '24' },
    })
    expect(result.reason).toBeNull()
  })

  it('accepts todo_item_present with a valid ledger-id', () => {
    const result = parseDescription(
      'ledger-id: 2026-10-08-a\nprobe: todo_item_present kind=audit client=acme',
    )
    expect(result.probe).toEqual({
      name: 'todo_item_present',
      params: { kind: 'audit', client: 'acme' },
    })
    expect(result.reason).toBeNull()
  })

  it('accepts ledger_card_status with a valid ledger-id', () => {
    const result = parseDescription(
      'ledger-id: 2026-10-08-a\nprobe: ledger_card_status id=2026-10-08-a status=verified',
    )
    expect(result.probe).toEqual({
      name: 'ledger_card_status',
      params: { id: '2026-10-08-a', status: 'verified' },
    })
    expect(result.reason).toBeNull()
  })

  it('handles CRLF line endings', () => {
    const result = parseDescription(
      'ledger-id: 2026-10-08-a\r\nprobe: cron_run_ok job=calendar-closure-audit within_hours=24\r\n',
    )
    expect(result.ledgerId).toBe('2026-10-08-a')
    expect(result.probe?.name).toBe('cron_run_ok')
    expect(result.reason).toBeNull()
  })

  it('flags two probe lines as ambiguous', () => {
    const result = parseDescription(
      'ledger-id: 2026-10-08-a\nprobe: cron_run_ok job=calendar-closure-audit within_hours=24\nprobe: todo_item_present kind=audit client=acme',
    )
    expect(result.probe).toBeNull()
    expect(result.ambiguous).toBe(true)
    expect(result.reason).toBe('描述里出现多个 probe 行')
  })

  it('rejects an unknown probe name', () => {
    const result = parseDescription('ledger-id: 2026-10-08-a\nprobe: mystery_probe foo=bar')
    expect(result.probe).toBeNull()
    expect(result.reason).toBe('probe 行不合格：未知 probe mystery_probe')
  })

  it('rejects a probe with an extra key', () => {
    const result = parseDescription(
      'ledger-id: 2026-10-08-a\nprobe: cron_run_ok job=calendar-closure-audit within_hours=24 extra=1',
    )
    expect(result.probe).toBeNull()
    expect(result.reason).toBe('probe 行不合格：参数数量不符')
  })

  it.each([
    'job=calendar closure-audit within_hours=24',
    'job=calendar-closure-audit;rm within_hours=24',
    'job="calendar-closure-audit" within_hours=24',
  ])('rejects a probe with a bad value: %s', (tail) => {
    const result = parseDescription(`ledger-id: 2026-10-08-a\nprobe: cron_run_ok ${tail}`)
    expect(result.probe).toBeNull()
    expect(result.reason).toMatch(/^probe 行不合格/)
  })

  it('rejects a probe without a valid ledger-id', () => {
    const result = parseDescription('probe: cron_run_ok job=calendar-closure-audit within_hours=24')
    expect(result.ledgerId).toBeNull()
    expect(result.probe).toBeNull()
    expect(result.reason).toBe('描述里没有 ledger-id')
  })

  it('rejects a probe when ledger-id is malformed', () => {
    const result = parseDescription(
      'ledger-id: Bad_ID\nprobe: cron_run_ok job=calendar-closure-audit within_hours=24',
    )
    expect(result.ledgerId).toBeNull()
    expect(result.probe).toBeNull()
    expect(result.reason).toBe('ledger-id 格式不合格')
  })

  it('rejects ledger_card_status with a bad status value', () => {
    const result = parseDescription(
      'ledger-id: 2026-10-08-a\nprobe: ledger_card_status id=2026-10-08-a status=maybe',
    )
    expect(result.probe).toBeNull()
    expect(result.reason).toBe('probe 行不合格：status 值不合格')
  })

  it('rejects cron_run_ok with out-of-range within_hours', () => {
    const result = parseDescription(
      'ledger-id: 2026-10-08-a\nprobe: cron_run_ok job=calendar-closure-audit within_hours=9999',
    )
    expect(result.probe).toBeNull()
    expect(result.reason).toBe('probe 行不合格：within_hours 超出范围')
  })
})

describe('isClosedTitle', () => {
  it.each(['✅ done', '❌ failed', '作废 这条', '（已验证）', '【已验证】'])(
    'returns true for %s',
    (title) => {
      expect(isClosedTitle(title)).toBe(true)
    },
  )

  it.each(['audit due', '  pending', ''])('returns false for %s', (title) => {
    expect(isClosedTitle(title)).toBe(false)
  })

  it('trims before checking', () => {
    expect(isClosedTitle('  ✅ done')).toBe(true)
  })
})

describe('parseDescription - 外部输入压力', () => {
  it('畸形超长 probe 行（曾能造成指数回溯）在 50ms 内返回，且判不合格', () => {
    const evil = `probe: cron_run_ok${' a=b=c'.repeat(40)} =`
    const start = Date.now()
    const r = parseDescription(`ledger-id: 2026-10-08-a\n${evil}`)
    expect(Date.now() - start).toBeLessThan(50)
    expect(r.probe).toBeNull()
    expect(r.reason).toMatch(/probe 行不合格/)
  })

  it('超过 8000 字的描述被截断处理，不拖垮', () => {
    const start = Date.now()
    const r = parseDescription(`ledger-id: 2026-10-08-a\n${'x'.repeat(200_000)}`)
    expect(Date.now() - start).toBeLessThan(50)
    expect(r.ledgerId).toBe('2026-10-08-a')
  })

  it('参数名 __proto__ 被拒', () => {
    const r = parseDescription('ledger-id: 2026-10-08-a\nprobe: cron_run_ok __proto__=x within_hours=1')
    expect(r.probe).toBeNull()
  })
})
