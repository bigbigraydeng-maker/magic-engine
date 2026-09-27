import { describe, expect, it } from 'vitest'
import { checkFrozenFields } from '../frozen'

function fm(fields: string, body = '正文'): string {
  return `---\n${fields}\n---\n${body}\n`
}

const BASE_FIELDS = [
  'id: 2026-09-24-foo',
  'title: 换掉旧的抓取库',
  'status: decided',
  'owner: agent',
  'decided_on: 2026-09-24',
  'source: session:abc12345',
  'verify_by: 2026-10-01',
  'verify_how: 跑一遍抓取脚本看还报不报错',
].join('\n')

describe('checkFrozenFields', () => {
  it('新卡（base 不存在）→ 不检查冻结字段', () => {
    const headText = fm(BASE_FIELDS)
    const { violations } = checkFrozenFields('2026-09-24-foo.md', headText, null)
    expect(violations).toEqual([])
  })

  it('正常状态变更（decided → done）→ 通过', () => {
    const baseText = fm(BASE_FIELDS)
    const headFields = BASE_FIELDS.replace('status: decided', 'status: done') +
      '\ndone_on: 2026-09-25\ndone_ref: pr:42'
    const headText = fm(headFields)
    const { violations } = checkFrozenFields('2026-09-24-foo.md', headText, baseText)
    expect(violations).toEqual([])
  })

  it('改写 verify_how → 报违规', () => {
    const baseText = fm(BASE_FIELDS)
    const headFields = BASE_FIELDS.replace(
      'verify_how: 跑一遍抓取脚本看还报不报错',
      'verify_how: 改成别的验法'
    )
    const headText = fm(headFields)
    const { violations } = checkFrozenFields('2026-09-24-foo.md', headText, baseText)
    expect(violations).toHaveLength(1)
    expect(violations[0].field).toBe('verify_how')
    expect(violations[0].baseValue).toBe('跑一遍抓取脚本看还报不报错')
    expect(violations[0].headValue).toBe('改成别的验法')
  })

  it('改写 decided_on → 报违规', () => {
    const baseText = fm(BASE_FIELDS)
    const headFields = BASE_FIELDS.replace('decided_on: 2026-09-24', 'decided_on: 2026-09-20')
    const headText = fm(headFields)
    const { violations } = checkFrozenFields('2026-09-24-foo.md', headText, baseText)
    expect(violations).toHaveLength(1)
    expect(violations[0].field).toBe('decided_on')
  })

  it('改写 title → 报违规', () => {
    const baseText = fm(BASE_FIELDS)
    const headFields = BASE_FIELDS.replace('title: 换掉旧的抓取库', 'title: 全新的标题')
    const headText = fm(headFields)
    const { violations } = checkFrozenFields('2026-09-24-foo.md', headText, baseText)
    expect(violations).toHaveLength(1)
    expect(violations[0].field).toBe('title')
  })

  it('改写 source → 报违规', () => {
    const baseText = fm(BASE_FIELDS)
    const headFields = BASE_FIELDS.replace('source: session:abc12345', 'source: pr:999')
    const headText = fm(headFields)
    const { violations } = checkFrozenFields('2026-09-24-foo.md', headText, baseText)
    expect(violations).toHaveLength(1)
    expect(violations[0].field).toBe('source')
  })

  it('同时改写多个冻结字段 → 全部报出', () => {
    const baseText = fm(BASE_FIELDS)
    const headFields = BASE_FIELDS
      .replace('verify_how: 跑一遍抓取脚本看还报不报错', 'verify_how: 新验法')
      .replace('title: 换掉旧的抓取库', 'title: 新标题')
    const headText = fm(headFields)
    const { violations } = checkFrozenFields('2026-09-24-foo.md', headText, baseText)
    expect(violations).toHaveLength(2)
    const fields = violations.map((v) => v.field).sort()
    expect(fields).toEqual(['title', 'verify_how'])
  })

  it('只改 done_on/done_ref/check_note 等非冻结字段 → 通过', () => {
    const baseText = fm(BASE_FIELDS.replace('status: decided', 'status: done') +
      '\ndone_on: 2026-09-25\ndone_ref: pr:42')
    const headFields = BASE_FIELDS.replace('status: decided', 'status: verified') +
      '\ndone_on: 2026-09-25\ndone_ref: pr:42\nverified_ref: doc:docs/ledger/evidence/foo.md\nlast_checked: 2026-09-26\ncheck_note: 验过了'
    const headText = fm(headFields)
    const { violations } = checkFrozenFields('2026-09-24-foo.md', headText, baseText)
    expect(violations).toEqual([])
  })

  it('head 解析失败 → 返回 parseError，不返回 violations', () => {
    const baseText = fm(BASE_FIELDS)
    const headText = '没有文件头'
    const { violations, parseError } = checkFrozenFields('2026-09-24-foo.md', headText, baseText)
    expect(violations).toEqual([])
    expect(parseError).not.toBeNull()
  })

  it('base 解析失败 → 跳过检查但返回 baseParseError', () => {
    const baseText = '这不是合法的台账文件'
    const headText = fm(BASE_FIELDS)
    const { violations, parseError, baseParseError } = checkFrozenFields('2026-09-24-foo.md', headText, baseText)
    expect(violations).toEqual([])
    expect(parseError).toBeNull()
    expect(baseParseError).not.toBeNull()
  })
})
