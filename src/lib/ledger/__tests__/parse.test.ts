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
  'source: session:abc12345',
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

  it('source 写法不合法 → 报错', () => {
    const result = parseLedgerFile('2026-09-24-foo.md', fm(VALID.replace('source: session:abc12345', 'source: 随便写的')))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.reason).toContain('source')
  })

  it('done 但 done_ref 写法不合法 → 报错', () => {
    const fields = VALID.replace('status: decided', 'status: done') + '\ndone_on: 2026-09-25\ndone_ref: 做完了'
    const result = parseLedgerFile('2026-09-24-foo.md', fm(fields))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.reason).toContain('done_ref')
  })

  it('done_ref 用 url → 报错', () => {
    const fields = VALID.replace('status: decided', 'status: done') + '\ndone_on: 2026-09-25\ndone_ref: url:https://x.y/z'
    const result = parseLedgerFile('2026-09-24-foo.md', fm(fields))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.reason).toContain('done_ref')
  })

  it('done 且 done_ref 合法 → ok', () => {
    const fields = VALID.replace('status: decided', 'status: done') + '\ndone_on: 2026-09-25\ndone_ref: pr:1984'
    const result = parseLedgerFile('2026-09-24-foo.md', fm(fields))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.entry.doneRef).toBe('pr:1984')
  })

  it('decided 却填了 done_on → 报错', () => {
    const result = parseLedgerFile('2026-09-24-foo.md', fm(VALID + '\ndone_on: 2026-09-25'))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.reason).toContain('decided')
  })

  it('done_on 早于 decided_on → 报错', () => {
    const fields = VALID.replace('status: decided', 'status: done') + '\ndone_on: 2026-09-01\ndone_ref: pr:1'
    const result = parseLedgerFile('2026-09-24-foo.md', fm(fields))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.reason).toContain('done_on 不能早于')
  })

  it('verified_ref 跟 done_ref 相同 → 报错', () => {
    const fields =
      VALID.replace('status: decided', 'status: verified') +
      '\ndone_on: 2026-09-25\ndone_ref: pr:1984\nverified_ref: pr:1984\nlast_checked: 2026-09-26'
    const result = parseLedgerFile('2026-09-24-foo.md', fm(fields))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.reason).toContain('verified_ref 不能跟 done_ref')
  })

  it('verified 但没填 last_checked → 报错', () => {
    const fields =
      VALID.replace('status: decided', 'status: verified') +
      '\ndone_on: 2026-09-25\ndone_ref: pr:1984\nverified_ref: url:https://github.com/x/y/pull/1990'
    const result = parseLedgerFile('2026-09-24-foo.md', fm(fields))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.reason).toContain('last_checked')
  })

  it('last_checked 早于 done_on → 报错', () => {
    const fields =
      VALID.replace('status: decided', 'status: verified') +
      '\ndone_on: 2026-09-25\ndone_ref: pr:1984\nverified_ref: url:https://github.com/x/y/pull/1990\nlast_checked: 2026-09-20'
    const result = parseLedgerFile('2026-09-24-foo.md', fm(fields))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.reason).toContain('last_checked 不能早于')
  })

  it('verified 且字段齐全 → ok，lastChecked/checkNote 映射正确', () => {
    const fields =
      VALID.replace('status: decided', 'status: verified') +
      '\ndone_on: 2026-09-25\ndone_ref: pr:1984\nverified_ref: url:https://github.com/x/y/pull/1990\nlast_checked: 2026-09-26\ncheck_note: 邮件里看到了'
    const result = parseLedgerFile('2026-09-24-foo.md', fm(fields))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.entry.lastChecked).toBe('2026-09-26')
    expect(result.entry.checkNote).toBe('邮件里看到了')
  })

  it('title 里出现像账户号的连续数字 → 报错', () => {
    const result = parseLedgerFile('2026-09-24-foo.md', fm(VALID.replace('title: 换掉旧的抓取库', 'title: 账户 act_1234567890 出问题')))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.reason).toContain('10 位')
  })

  it('CRLF 换行也能解析 → ok', () => {
    const result = parseLedgerFile('2026-09-24-foo.md', fm(VALID).replace(/\n/g, '\r\n'))
    expect(result.ok).toBe(true)
  })

  it('没填 last_checked/check_note → 都是 null', () => {
    const result = parseLedgerFile('2026-09-24-foo.md', fm(VALID))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.entry.lastChecked).toBeNull()
    expect(result.entry.checkNote).toBeNull()
  })

  it('没填 on_hold → 默认 false', () => {
    const result = parseLedgerFile('2026-09-24-foo.md', fm(VALID))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.entry.onHold).toBe(false)
  })

  it('decided 且 on_hold: true → ok', () => {
    const result = parseLedgerFile('2026-09-24-foo.md', fm(`${VALID}\non_hold: true`))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.entry.onHold).toBe(true)
  })

  it('on_hold 不是布尔值 → 报错', () => {
    const result = parseLedgerFile('2026-09-24-foo.md', fm(`${VALID}\non_hold: 是的`))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.reason).toContain('on_hold')
  })

  it('status 不是 decided 却填 on_hold: true → 报错', () => {
    const fields =
      VALID.replace('status: decided', 'status: done') +
      '\ndone_on: 2026-09-25\ndone_ref: pr:1984\non_hold: true'
    const result = parseLedgerFile('2026-09-24-foo.md', fm(fields))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.reason).toContain('on_hold')
  })
})
