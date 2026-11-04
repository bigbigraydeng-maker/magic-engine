import { describe, expect, it } from 'vitest'
import { ACCOUNT_AUDIT_TODO_KIND, buildAccountAuditItem } from '../account-audit-items'

const receipt = (over: Record<string, unknown> = {}) => ({
  client_id: 'c1', as_of: '2026-11-09', reel_count: 41, error: null,
  metrics: [
    { key: 'D1', label: '模板集中度', status: 'over', value: 'x' },
    { key: 'D2', label: 'BGM 重复', status: 'over', value: 'y' },
    { key: 'D3', label: '改版扎堆', status: 'ok', value: 'z' },
    { key: 'D5', label: '内容柱配比', status: 'not_measured', value: 'w' },
  ],
  findings: [
    { key: 'D1', tier: 'A', what: '模板集中度超线', how: '排期' },
    { key: 'D4', tier: 'C', what: '账号缺「people」这一类内容', how: '开发卡' },
  ],
  ...over,
})

describe('buildAccountAuditItem', () => {
  it('one item per client: what (counts and names), how, href', () => {
    const item = buildAccountAuditItem(receipt(), () => 'CTS')
    expect(item).toMatchObject({ kind: ACCOUNT_AUDIT_TODO_KIND, client_id: 'c1', client_name: 'CTS' })
    expect(item?.what).toContain('2 项超线（模板集中度、BGM 重复）')
    expect(item?.what).toContain('1 项量不出来（内容柱配比）')
    expect(item?.what).toContain('账号缺「people」这一类内容')
    expect(item?.what).not.toContain('模板集中度超线') // tier A is done by the schedule itself, not asked of a person
    expect(item?.how.length).toBeGreaterThan(20)
    expect(item?.href).toContain('/dashboard/clients/c1/daily-plan')
  })

  it('nothing over and everything measured → no to-do', () => {
    expect(buildAccountAuditItem(receipt({ metrics: [{ key: 'D1', label: 'a', status: 'ok', value: '' }], findings: [] }), () => 'CTS')).toBeNull()
  })

  it('a client whose audit failed or a malformed receipt → no to-do (the run log already carries the failure)', () => {
    expect(buildAccountAuditItem(receipt({ error: 'db down' }), () => 'CTS')).toBeNull()
    expect(buildAccountAuditItem(null, () => 'CTS')).toBeNull()
    expect(buildAccountAuditItem({ metrics: [] }, () => 'CTS')).toBeNull()
  })

  it('only not-measured fields still raise one (a blind spot is not a pass)', () => {
    const item = buildAccountAuditItem(receipt({ metrics: [{ key: 'D5', label: '内容柱配比', status: 'not_measured', value: '' }], findings: [] }), () => 'CTS')
    expect(item?.what).toContain('1 项量不出来')
    expect(item?.what).not.toContain('项超线')
  })
})
