import { describe, expect, it } from 'vitest'
import { LEDGER_REF_HELP, parseRef } from '../refs'

describe('parseRef', () => {
  it('接受 pr 与 issue 编号', () => {
    expect(parseRef('pr:1984')).toEqual({ kind: 'pr', value: '1984' })
    expect(parseRef('issue:964')).toEqual({ kind: 'issue', value: '964' })
  })

  it('校验 commit 短哈希', () => {
    expect(parseRef('commit:2596090a')).toEqual({ kind: 'commit', value: '2596090a' })
    expect(parseRef('commit:xyz')).toBeNull()
    expect(parseRef('commit:abc')).toBeNull()
  })

  it('校验 doc 路径', () => {
    expect(parseRef('doc:docs/ledger/README.md')).toEqual({
      kind: 'doc',
      value: 'docs/ledger/README.md',
    })
    expect(parseRef('doc:/etc/passwd')).toBeNull()
    expect(parseRef('doc:../x.md')).toBeNull()
  })

  it('校验 session id', () => {
    expect(parseRef('session:beef24ba')).toEqual({ kind: 'session', value: 'beef24ba' })
    expect(parseRef('session:abc')).toBeNull()
  })

  it('校验 url', () => {
    expect(parseRef('url:https://github.com/x/y/pull/1')).toEqual({
      kind: 'url',
      value: 'https://github.com/x/y/pull/1',
    })
    expect(parseRef('url:ftp://x')).toBeNull()
  })

  it('拒绝非法输入', () => {
    expect(parseRef('pr:0')).toBeNull()
    expect(parseRef('pr:')).toBeNull()
    expect(parseRef('pr')).toBeNull()
    expect(parseRef('')).toBeNull()
    expect(parseRef('PR:1')).toBeNull()
  })

  it('容忍首尾空白', () => {
    expect(parseRef('  pr:12  ')).toEqual({ kind: 'pr', value: '12' })
  })
})

describe('LEDGER_REF_HELP', () => {
  it('包含 pr 示例', () => {
    expect(LEDGER_REF_HELP).toContain('pr:123')
  })
})
