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

  const boldValue = '**【第一条】会不会返回？** 其余**保留**'
  const strippedBold = '【第一条】会不会返回？ 其余**保留**'
  const boldBase = () => fm(BASE_FIELDS.replace('跑一遍抓取脚本看还报不报错', boldValue))
  const boldHead = (value = strippedBold) => fm(BASE_FIELDS.replace(
    'verify_how: 跑一遍抓取脚本看还报不报错',
    `verify_how: ${value}`,
  ))

  it('repairs a leading ** pair that YAML reads as an alias', () => {
    const result = checkFrozenFields('2026-09-24-foo.md', boldHead(), boldBase())
    expect(result.baseParseError).not.toBeNull()
    expect(result.parseError).toBeNull()
    expect(result.violations).toEqual([])
  })

  it('rejects any other change while stripping that leading ** pair', () => {
    const changed = checkFrozenFields('2026-09-24-foo.md', boldHead(strippedBold + '改'), boldBase())
    expect(changed.violations.map((v) => v.field)).toContain('verify_how')
    const laterPair = checkFrozenFields(
      '2026-09-24-foo.md',
      boldHead('**【第一条】会不会返回？** 其余保留'),
      boldBase(),
    )
    expect(laterPair.violations.map((v) => v.field)).toContain('verify_how')
    const alreadyValid = fm(BASE_FIELDS.replace(
      'verify_how: 跑一遍抓取脚本看还报不报错',
      'verify_how: "**保持**"',
    ))
    const rewritten = fm(BASE_FIELDS.replace('verify_how: 跑一遍抓取脚本看还报不报错', 'verify_how: 保持'))
    expect(checkFrozenFields('2026-09-24-foo.md', rewritten, alreadyValid).violations.map((v) => v.field)).toContain('verify_how')
  })

  it('still freezes other fields during a leading-bold repair', () => {
    const result = checkFrozenFields(
      '2026-09-24-foo.md',
      boldHead().replace('title: 换掉旧的抓取库', 'title: 新标题'),
      boldBase(),
    )
    expect(result.violations.map((v) => v.field)).toEqual(['title'])
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

  it('坏卡可以把编号改成文件名，并把 PR #数字改成同一个 pr 编号', () => {
    const file = '2026-10-25-meta-client-token-db-verify.md'
    const base = fm([
      'id: task_meta_client_token_db_verify',
      'title: 验证口令',
      'status: decided',
      'owner: agent',
      'decided_on: 2026-10-25',
      'source: PR #3145',
      'verify_by: 2026-11-01',
      'verify_how: 看三件事',
    ].join('\n'), '正文不动')
    const head = base
      .replace('id: task_meta_client_token_db_verify', 'id: 2026-10-25-meta-client-token-db-verify')
      .replace('source: PR #3145', 'source: pr:3145')
    const result = checkFrozenFields(file, head, base)
    expect(result.violations).toEqual([])
    expect(result.parseError).toBeNull()
    expect(result.baseParseError?.reason).toContain('对不上')
  })

  it.each([
    ['换成别的 PR 号', 'id: 2026-10-25-meta-client-token-db-verify', 'source: pr:9999', 'source'],
    ['编号仍和文件名不同', 'id: 2026-10-25-other', 'source: pr:3145', 'id'],
    ['改了标题', 'id: 2026-10-25-meta-client-token-db-verify', 'source: pr:3145', 'title'],
    ['改了验收说法', 'id: 2026-10-25-meta-client-token-db-verify', 'source: pr:3145', 'verify_how'],
  ])('坏卡拼写修复时不许%s', (_name, idLine, sourceLine, field) => {
    const file = '2026-10-25-meta-client-token-db-verify.md'
    const base = fm([
      'id: task_meta_client_token_db_verify',
      'title: 验证口令',
      'status: decided',
      'owner: agent',
      'decided_on: 2026-10-25',
      'source: PR #3145',
      'verify_by: 2026-11-01',
      'verify_how: 看三件事',
    ].join('\n'), '正文不动')
    let head = base.replace('id: task_meta_client_token_db_verify', idLine).replace('source: PR #3145', sourceLine)
    if (field === 'title') head = head.replace('title: 验证口令', 'title: 新标题')
    if (field === 'verify_how') head = head.replace('verify_how: 看三件事', 'verify_how: 换成别的验法')
    expect(checkFrozenFields(file, head, base).violations.map((v) => v.field)).toContain(field)
  })

  it('已经合法的卡不能借这条修法改编号', () => {
    const file = '2026-10-25-meta-client-token-db-verify.md'
    const base = fm([
      'id: 2026-10-25-meta-client-token-db-verify',
      'title: 验证口令',
      'status: decided',
      'owner: agent',
      'decided_on: 2026-10-25',
      'source: pr:3145',
      'verify_by: 2026-11-01',
      'verify_how: 看三件事',
    ].join('\n'))
    const head = base.replace('id: 2026-10-25-meta-client-token-db-verify', 'id: 2026-10-25-renamed')
    expect(checkFrozenFields(file, head, base).violations.map((v) => v.field)).toContain('id')
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
