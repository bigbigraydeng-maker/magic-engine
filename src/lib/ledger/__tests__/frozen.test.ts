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
  const brokenValue = "查 captureClientSnapshots(..., reason: 'kernel_post') 的调用方"
  const brokenBase = () => fm(BASE_FIELDS.replace('跑一遍抓取脚本看还报不报错', brokenValue))
  const wrappedHead = (value = brokenValue) => fm(BASE_FIELDS.replace(
    'verify_how: 跑一遍抓取脚本看还报不报错', `verify_how: |-\n  ${value}`,
  ))

  it('only repairs invalid YAML by wrapping the exact single-line verification text', () => {
    const result = checkFrozenFields('2026-09-24-foo.md', wrappedHead(), brokenBase())
    expect(result.baseParseError).not.toBeNull()
    expect(result.parseError).toBeNull()
    expect(result.violations).toEqual([])
  })

  it.each([
    ['changed character', () => brokenBase(), () => wrappedHead(brokenValue + '改')],
    ['valid base YAML', () => fm(BASE_FIELDS), () => wrappedHead('跑一遍抓取脚本看还报不报错')],
    ['business validation failure only', () => fm(BASE_FIELDS.replace('status: decided', 'status: bogus')), () => wrappedHead('跑一遍抓取脚本看还报不报错')],
    ['duplicate verification key', () => brokenBase().replace('\n---\n正文', '\nverify_how: other\n---\n正文'), () => wrappedHead()],
    ['another duplicate key', () => brokenBase().replace('\n---\n正文', '\nsource: session:abc12345\n---\n正文'), () => wrappedHead()],
    ['base continuation', () => brokenBase().replace(brokenValue, brokenValue + '\n  continuation'), () => wrappedHead()],
    ['invalid head', () => brokenBase(), () => wrappedHead().replace('status: decided', 'status: bogus')],
    ['noncanonical wrapping', () => brokenBase(), () => wrappedHead().replace('verify_how: |-', 'verify_how: >-')],
    ['hash truncation', () => brokenBase().replace(brokenValue, brokenValue + ' #2010'), () => wrappedHead(brokenValue + ' #2010')],
    ['other syntax error', () => brokenBase().replace('title: 换掉旧的抓取库', 'title: [unclosed'), () => wrappedHead()],
  ] as const)('rejects %s', (_name, base, head) => {
    expect(checkFrozenFields('2026-09-24-foo.md', head(), base()).violations.map(v => v.field)).toContain('verify_how')
  })

  it('still freezes other fields during an otherwise valid wrapping repair', () => {
    const result = checkFrozenFields('2026-09-24-foo.md', wrappedHead().replace('title: 换掉旧的抓取库', 'title: 新标题'), brokenBase())
    expect(result.violations.map(v => v.field)).toEqual(['title'])
  })

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

  it('YAML 空格# 截断 → 原始文本比对仍能检测到差异', () => {
    const baseFields = BASE_FIELDS.replace(
      'verify_how: 跑一遍抓取脚本看还报不报错',
      'verify_how: 查 PR #2010 结果',
    )
    const baseText = fm(baseFields)
    const headFields = BASE_FIELDS.replace(
      'verify_how: 跑一遍抓取脚本看还报不报错',
      'verify_how: 查 PR #9999 不用查了',
    )
    const headText = fm(headFields)
    const { violations } = checkFrozenFields('2026-09-24-foo.md', headText, baseText)
    expect(violations).toHaveLength(1)
    expect(violations[0].field).toBe('verify_how')
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
