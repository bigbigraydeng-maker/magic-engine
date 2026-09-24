import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadLedger } from '../load'

const ID_RE = /^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/

function entryFile(id: string): string {
  return [
    '---',
    `id: ${id}`,
    'title: 测试条目',
    'status: decided',
    'owner: pm',
    'decided_on: 2026-01-01',
    'source: session:abcd1234',
    'verify_how: 人工确认',
    '---',
    '',
    '正文',
    '',
  ].join('\n')
}

describe('loadLedger', () => {
  it('仓库里的真实台账条目全部合法', () => {
    const { entries, errors } = loadLedger()
    expect(errors, JSON.stringify(errors)).toEqual([])
    expect(entries.length).toBeGreaterThanOrEqual(1)
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(entries.length)
    for (const entry of entries) {
      expect(entry.id).toMatch(ID_RE)
    }
  })

  it('坏条目单独报错、好条目照常读入，README.md 被忽略', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledger-'))
    try {
      writeFileSync(join(dir, 'README.md'), '这是说明文档，不是条目')
      writeFileSync(join(dir, '2026-01-01-x.md'), entryFile('2026-01-01-x'))
      // id 跟文件名对不上 —— 这是最常见的抄错，必须以错误形式冒出来而不是静默丢掉
      writeFileSync(join(dir, '2026-01-01-y.md'), entryFile('2026-01-01-x'))

      const { entries, errors } = loadLedger(dir)
      expect(entries).toHaveLength(1)
      expect(entries[0].id).toBe('2026-01-01-x')
      expect(errors).toHaveLength(1)
      expect(errors[0].file).toBe('2026-01-01-y.md')
      expect(errors[0].reason).toContain('对不上')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
