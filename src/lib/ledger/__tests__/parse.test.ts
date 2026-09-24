import { describe, expect, it } from 'vitest'
import { parseLedgerFile } from '../parse'

/** 拼一个带文件头的台账文本 */
function fm(fields: string, body = '正文'): string {
  return `---\n${fields}\n---\n${body}\n`
}

const VALID = [
  'id: 2026-09-24-foo',
  'title: 换掉旧的抓取库',
  'status: decided',
  'owner: pm',
  'decided_on: 2026-09-24',
  'source: session:abc123',
  'verify_by: 2026-10-01',
  'verify_how: 跑一遍抓取脚本看还报不报错',
].join('\n')

describe('parseLedgerFile', () => {
  it('合法的 decided 条目 → ok，字段映射成 camelCase，可选字段缺省为 null', () => {
    const result = parseLedgerFile('2026-09-24-foo.md', fm(VALID, '  正文  '))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.entry.id).toBe('2026-09-24-foo')
    expect(result.entry.verifyBy).toBe('2026-10-01')
    expect(result.entry.doneOn).toBeNull()
    expect(result.entry.body).toBe('正文')
  })

  it('id 跟文件名对不上 → 报错', () => {
    const result = parseLedgerFile('2026-09-24-bar.md', fm(VALID))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.reason).toContain('id')
  })

  it('status 不在白名单 → 报错', () => {
    const result = parseLedgerFile('2026-09-24-foo.md', fm(VALID.replace('status: decided', 'status: open')))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.reason).toContain('status')
  })

  it('status 为 done 但没填 done_ref → 报错', () => {
    const fields = VALID.replace('status: decided', 'status: done') + '\ndone_on: 2026-09-25'
    const result = parseLedgerFile('2026-09-24-foo.md', fm(fields))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.reason).toContain('done_ref')
  })

  it('status 为 verified 但没填 verified_ref → 报错', () => {
    const fields =
      VALID.replace('status: decided', 'status: verified') +
      '\ndone_on: 2026-09-25\ndone_ref: pr:42'
    const result = parseLedgerFile('2026-09-24-foo.md', fm(fields))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.reason).toContain('verified_ref')
  })

  it('正文里出现像账户号的连续数字 → 报错', () => {
    const result = parseLedgerFile('2026-09-24-foo.md', fm(VALID, '账户 act_953025114498626'))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.reason).toContain('10 位')
  })

  it('没有文件头 → 报错', () => {
    const result = parseLedgerFile('2026-09-24-foo.md', '就是一段普通正文')
    expect(result.ok).toBe(false)
  })

  it('decided_on 不是 YYYY-MM-DD → 报错', () => {
    // 只改 decided_on 那一行，别把 id 里的日期也换掉（那会先撞上「id 跟文件名对不上」）
    const result = parseLedgerFile('2026-09-24-foo.md', fm(VALID.replace('decided_on: 2026-09-24', 'decided_on: 2026/09/24')))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.reason).toContain('YYYY-MM-DD')
  })
})
