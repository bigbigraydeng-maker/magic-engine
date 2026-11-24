import { describe, expect, it } from 'vitest'
import { parseLedgerFile } from '../parse'
import type { LedgerEntry } from '../types'
import { walkLedger } from '../walk'

const BASE = [
  'id: 2026-09-24-foo',
  'title: 换掉旧的抓取库',
  'owner: pm',
  'decided_on: 2026-09-24',
  'source: session:abc12345',
  'verify_by: 2026-10-01',
  'verify_how: 跑一遍抓取脚本看还报不报错',
]

function card(extra: string[]): string {
  return `---\n${[...BASE, ...extra].join('\n')}\n---\n正文\n`
}

function parse(extra: string[]) {
  return parseLedgerFile('2026-09-24-foo.md', card(extra))
}

const NOTE = ['last_checked: 2026-11-25', 'check_note: 过期没验：到期两周以上没人核，不再追']

describe('expired 状态（过期没验）', () => {
  it('决定了没做 → expired：不带 done 字段也合法', () => {
    expect(parse(['status: expired', ...NOTE]).ok).toBe(true)
  })

  it('做了没验 → expired：带 done_on + done_ref 合法', () => {
    expect(parse(['status: expired', 'done_on: 2026-09-25', 'done_ref: pr:1', ...NOTE]).ok).toBe(true)
  })

  it('缺 check_note 或 last_checked → 不合规', () => {
    const noNote = parse(['status: expired', 'last_checked: 2026-11-25'])
    const noDate = parse(['status: expired', 'check_note: 不追了'])
    expect(noNote.ok).toBe(false)
    expect(noDate.ok).toBe(false)
    if (!noNote.ok) expect(noNote.error.reason).toContain('check_note')
  })

  it('带 verified_ref → 不合规（没验就不能有证据）', () => {
    const r = parse(['status: expired', 'done_on: 2026-09-25', 'done_ref: pr:1', 'verified_ref: pr:2', ...NOTE])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.reason).toContain('verified_ref')
  })

  it('done_on 和 done_ref 只填一个 → 不合规', () => {
    expect(parse(['status: expired', 'done_on: 2026-09-25', ...NOTE]).ok).toBe(false)
  })

  it('last_checked 早于 done_on → 不合规', () => {
    const r = parse(['status: expired', 'done_on: 2026-09-25', 'done_ref: pr:1', 'last_checked: 2026-09-24', 'check_note: x'])
    expect(r.ok).toBe(false)
  })

  it('到期没满 14 天 → 不许标过期', () => {
    const r = parse(['status: expired', 'last_checked: 2026-10-14', 'check_note: 不追了'])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error.reason).toContain('14')
    expect(parse(['status: expired', 'last_checked: 2026-10-15', 'check_note: 不追了']).ok).toBe(true)
  })

  it('没写 verify_by 时按做完日 +7 天算到期', () => {
    const card = (lc: string) => parseLedgerFile('2026-09-24-foo.md', `---\n${BASE.filter((l) => !l.startsWith('verify_by')).join('\n')}\nstatus: expired\ndone_on: 2026-09-25\ndone_ref: pr:1\nlast_checked: ${lc}\ncheck_note: x\n---\n正文\n`)
    expect(card('2026-10-15').ok).toBe(false)
    expect(card('2026-10-16').ok).toBe(true)
  })

  it('expired 卡不再出现在待办里', () => {
    const entry: LedgerEntry = {
      id: 'x', title: 'x', status: 'expired', owner: 'pm', decidedOn: '2026-09-01',
      source: 'session:1', verifyBy: '2026-09-05', verifyHow: '', doneOn: null, doneRef: null,
      verifiedRef: null, lastChecked: '2026-11-25', checkNote: '不追了', body: '',
    }
    expect(walkLedger([entry], '2026-11-25')).toEqual([])
  })
})
