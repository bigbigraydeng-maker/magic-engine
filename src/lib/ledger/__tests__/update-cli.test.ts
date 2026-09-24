import { describe, expect, it } from 'vitest'
import { ALLOWED_KEYS, FROZEN_KEYS, applyUpdates } from '../../../../scripts/ledger-update.mjs'

const CARD = [
  '---',
  'id: 2026-09-24-harness-ledger-v0',
  'title: Harness Ledger v0',
  'status: decided',
  'owner: alice',
  'decided_on: 2026-09-24',
  'source: meeting',
  'verify_how: manual',
  '---',
  '正文',
  '',
].join('\n')

describe('applyUpdates', () => {
  it('replaces status and appends new keys before the closing fence', () => {
    const out = applyUpdates(CARD, [
      ['status', 'done'],
      ['done_on', '2026-09-25'],
      ['done_ref', 'pr:1984'],
    ])
    expect(out).toContain('status: done')
    expect(out).not.toContain('status: decided')
    expect(out).toContain('done_on: 2026-09-25')
    expect(out).toContain('done_ref: pr:1984')
    expect(out).toContain('正文')
    expect(out).not.toContain('\r')
    const lines = out.split('\n')
    const closeIdx = lines.indexOf('---', 1)
    expect(lines[closeIdx - 1]).toBe('done_ref: pr:1984')
  })

  it('keeps a single check_note line when applied twice', () => {
    const once = applyUpdates(CARD, [['check_note', '第一次']])
    const twice = applyUpdates(once, [['check_note', '第二次']])
    const matches = twice.split('\n').filter((line) => line.startsWith('check_note:'))
    expect(matches).toHaveLength(1)
    expect(matches[0]).toBe('check_note: 第二次')
  })

  it('removes the line when the value is empty', () => {
    const withNote = applyUpdates(CARD, [['check_note', '待办']])
    const cleared = applyUpdates(withNote, [['check_note', '']])
    expect(cleared).not.toContain('check_note:')
  })

  it('rejects frozen keys by default', () => {
    expect(() => applyUpdates(CARD, [['title', '改名']])).toThrow(/冻结/)
  })

  it('allows frozen keys when allowFrozen is set', () => {
    const out = applyUpdates(CARD, [['title', '改名']], { allowFrozen: true })
    expect(out).toContain('title: 改名')
    expect(out).not.toContain('title: Harness Ledger v0')
  })

  it('rejects unknown keys', () => {
    expect(() => applyUpdates(CARD, [['colour', 'red']])).toThrow(/不认识/)
  })

  it('rejects text without frontmatter', () => {
    expect(() => applyUpdates('正文\n', [['status', 'done']])).toThrow(/文件头/)
  })

  it('exposes the frozen and allowed key lists', () => {
    expect(FROZEN_KEYS).toContain('verify_how')
    expect(ALLOWED_KEYS).toContain('last_checked')
  })
})
