import { describe, expect, it } from 'vitest'
import { buildLedgerItems, pushLedgerItems, nzToday, LEDGER_ENTRY_URL } from '../ledger-items'
import { assertAbsoluteHref } from '../manual-items'
import type { ManualItem } from '../manual-item-types'
import type { LedgerEntry } from '@/lib/ledger/types'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

function mk(over: Partial<LedgerEntry>): LedgerEntry {
  return {
    id: '2026-09-01-x',
    title: '测试条目',
    status: 'decided',
    owner: 'pm',
    decidedOn: '2026-09-01',
    source: 'session:test',
    verifyBy: null,
    verifyHow: '看一眼',
    onHold: false,
    doneOn: null,
    doneRef: null,
    verifiedRef: null,
    lastChecked: null,
    checkNote: null,
    body: '',
    ...over,
  }
}

describe('nzToday', () => {
  it('按新西兰日期算「今天」', () => {
    expect(nzToday(new Date('2026-09-24T12:00:00Z'))).toBe('2026-09-25')
  })
})

describe('buildLedgerItems', () => {
  it('把三类发现和读不出来的文件都翻成待办', () => {
    const items = buildLedgerItems(
      [
        { kind: 'decided_stale', entry: mk({ id: 'a', title: '测试条目' }), daysIdle: 9 },
        { kind: 'done_unverified', entry: mk({ id: 'b', title: '测试条目' }), daysIdle: 3 },
        { kind: 'verification_failed', entry: mk({ id: 'c', title: '测试条目' }) },
      ],
      [{ file: 'bad.md', reason: '缺少字段 title' }],
    )

    expect(items).toHaveLength(4)
    expect(items.map((i) => i.kind)).toEqual([
      'ledger_decided_stale',
      'ledger_done_unverified',
      'ledger_verification_failed',
      'ledger_unreadable',
    ])

    for (const item of items.slice(0, 3)) {
      expect(item.href.startsWith(LEDGER_ENTRY_URL)).toBe(true)
      expect(item.href.endsWith('.md')).toBe(true)
      expect(() => assertAbsoluteHref(item)).not.toThrow()
    }

    expect(items[3].href).toBe('')
    expect(items[0].what).toContain('测试条目')
    expect(items[0].what).toContain('9 天')
  })

  it('夜巡没来单独报一条，并说清几天没来', () => {
    const items = buildLedgerItems(
      [{ kind: 'patrol_missing', entry: mk({ id: 'p', title: '测试条目' }), daysSilent: 3 }],
      [],
    )

    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('ledger_patrol_missing')
    expect(items[0].what).toContain('3 天没来')
    expect(items[0].href.startsWith(LEDGER_ENTRY_URL)).toBe(true)
  })

  it('done_unverified 带上最近一次自动核查的日期和备注', () => {
    const items = buildLedgerItems(
      [
        {
          kind: 'done_unverified',
          entry: mk({ id: 'd', lastChecked: '2026-09-27', checkNote: 'PR 还没合并' }),
          daysIdle: 3,
        },
      ],
      [],
    )

    expect(items[0].what).toContain('上次自动核查 2026-09-27')
    expect(items[0].what).toContain('PR 还没合并')
  })

  it('没被夜巡盖过章的 done_unverified 不提自动核查', () => {
    const items = buildLedgerItems(
      [{ kind: 'done_unverified', entry: mk({ id: 'd', lastChecked: null }), daysIdle: 3 }],
      [],
    )

    expect(items[0].what).not.toContain('上次自动核查')
  })

  it('decided_stale 的 how 指向 Claude Code 窗口', () => {
    const items = buildLedgerItems(
      [{ kind: 'decided_stale', entry: mk({ id: 'a' }), daysIdle: 9 }],
      [],
    )

    expect(items[0].how).toContain('Claude Code 窗口')
  })
})

describe('pushLedgerItems', () => {
  it('目录读不出来时单独报一条 ledger_unreadable', () => {
    const items: ManualItem[] = []
    pushLedgerItems(items, new Date(), '/nonexistent/ledger-dir-for-test')

    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('ledger_unreadable')
    expect(items[0].what).toContain('读不出来')
  })

  it('从真实目录读出过期条目', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledger-items-'))
    try {
      writeFileSync(
        join(dir, '2026-08-01-old.md'),
        [
          '---',
          'id: 2026-08-01-old',
          'title: 老条目',
          'status: decided',
          'owner: agent',
          'decided_on: 2026-08-01',
          'source: session:abcd1234',
          'verify_how: 看一眼',
          '---',
          '',
          '正文',
        ].join('\n'),
      )

      const items: ManualItem[] = []
      pushLedgerItems(items, new Date('2026-09-24T12:00:00Z'), dir)

      expect(items).toHaveLength(1)
      expect(items[0].kind).toBe('ledger_decided_stale')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
