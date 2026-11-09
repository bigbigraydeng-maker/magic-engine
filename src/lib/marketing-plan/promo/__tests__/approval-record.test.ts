import { describe, expect, it } from 'vitest'
import { describeApprovalRecord } from '../approval-record'
import { baseSpec } from './fixtures'
import { promoContentHash } from '../content-hash'

const PROMO = { schema: 'promo_v1' }
const receipt = (over: Record<string, unknown> = {}) => ({
  request_id: 'r1', approved_by: 'pm@example.com', approved_at: '2026-10-20T03:04:05Z',
  tasks_created: 0, tasks_skipped: 0, packages_created: 0, ...over,
})
const plan = (status: string, r?: unknown, extra: Record<string, unknown> = {}) => ({
  status, approved_at: '2026-10-20T03:04:05Z', plan_data: {},
  generation_meta: r === undefined ? null : { approval_receipt: r }, ...extra,
}) as never

describe('describeApprovalRecord', () => {
  it('草稿和已归档没有批准记录可看', () => {
    expect(describeApprovalRecord(plan('draft'))).toBeNull()
    expect(describeApprovalRecord(plan('archived'))).toBeNull()
  })
  it('有回执：写清谁、什么时候（悉尼时间）', () => {
    const v = describeApprovalRecord(plan('approved', receipt({ tasks_created: 5, packages_created: 1 })))!
    expect(v.tone).toBe('normal')
    expect(v.lines[0]).toBe('批准人：pm@example.com')
    expect(v.lines[1]).toBe('批准时间：2026-10-20 14:04（悉尼时间）')
    expect(v.lines.join('')).toContain('派出内部待办 5 张')
  })
  it('没记录批准人时写「没有记录」，不编', () => {
    expect(describeApprovalRecord(plan('completed', receipt({ approved_by: null })))!.lines[0]).toBe('批准人：没有记录')
  })
  it('带检查清单快照：按灯统计，并说明批准后没有自动派活', () => {
    const v = describeApprovalRecord(plan('approved', receipt({
      gate_snapshot: { taken_at: '2026-10-20T03:04:00Z', results: [
        { key: 'a', light: 'green', hard: true }, { key: 'b', light: 'green', hard: false }, { key: 'c', light: 'gray', hard: false }] },
    })))!
    const text = v.lines.join('\n')
    expect(text).toContain('2 项通过')
    expect(text).toContain('1 项还没核实')
    expect(text).toContain('还没有自动生成待办')
  })
  it('灯的值不认识时单独计数，不悄悄丢掉', () => {
    const v = describeApprovalRecord(plan('approved', receipt({
      gate_snapshot: { taken_at: '2026-10-20T03:04:00Z', results: [{ key: 'a', light: 'purple', hard: true }, null, { key: 'b', light: 'green', hard: false }] },
    })))!
    expect(v.lines.join('\n')).toContain('1 项通过，2 项格式无法识别')
  })
  it('🔴 预算那一道批准时用的是哪份证据，写进批准记录：现读 / 存档 / 想现读没读成而用存档（事后能说清）', () => {
    const snap = (source: unknown, asOf: unknown = '2026-10-20T03:03:00Z') => receipt({
      gate_snapshot: { taken_at: '2026-10-20T03:04:00Z', results: [
        { key: 'ads.budget_within_caps', light: 'green', hard: true },
        { key: 'env.account_billing', light: 'yellow', hard: true, source, as_of: asOf }] },
    })
    const lines = (source: unknown, asOf?: unknown) => describeApprovalRecord(plan('approved', snap(source, asOf)))!.lines.join('\n')
    expect(lines('live')).toContain('广告账户与付款（含在投预算）：批准时现读的（2026-10-20 14:03（悉尼时间））')
    expect(lines('receipt')).toContain('用的是每天早上自动检查的存档（2026-10-20 14:03（悉尼时间）），不是批准时现读的')
    expect(lines('receipt_after_live_failed')).toContain('批准时想现读但没读成，用的是存档')
    // 读取时间缺失 / 乱写：写「没有记录」，不编
    expect(lines('live', null)).toContain('批准时现读的（没有记录）')
    expect(lines('live', 'garbage')).toContain('批准时现读的（没有记录）')
  })
  it('较早的批准没有来源字段 / 来源写了不认识的值 / 别的门带了来源 → 不出这一行，也不崩', () => {
    const noSource = receipt({ gate_snapshot: { taken_at: '2026-10-20T03:04:00Z', results: [{ key: 'env.account_billing', light: 'green', hard: true }] } })
    expect(describeApprovalRecord(plan('approved', noSource))!.lines.join('\n')).not.toContain('广告账户与付款')
    const unknown = receipt({ gate_snapshot: { taken_at: '2026-10-20T03:04:00Z', results: [{ key: 'env.account_billing', light: 'green', hard: true, source: 'magic' }] } })
    expect(describeApprovalRecord(plan('approved', unknown))!.lines.join('\n')).not.toContain('广告账户与付款')
    const otherGate = receipt({ gate_snapshot: { taken_at: '2026-10-20T03:04:00Z', results: [{ key: 'tracking.pixel_alive', light: 'green', hard: true, source: 'live' }] } })
    expect(describeApprovalRecord(plan('approved', otherGate))!.lines.join('\n')).not.toContain('广告账户与付款')
  })
  it('跳过的待办数会写出来', () => {
    expect(describeApprovalRecord(plan('approved', receipt({ tasks_created: 3, tasks_skipped: 2 })))!.lines.join('')).toContain('跳过 2 张')
  })
})

describe('没有批准回执', () => {
  it('较早的普通计划（有批准时间、没推广结构）：灰色中性提示，不吓人', () => {
    const v = describeApprovalRecord(plan('approved'))!
    expect(v.tone).toBe('neutral')
    expect(v.lines.join('')).toContain('较早的计划')
    expect(v.lines[0]).toContain('2026-10-20 14:04')
  })
  it('带推广结构却没回执：标红，说明怎么办', () => {
    const v = describeApprovalRecord(plan('approved', undefined, { plan_data: { promo: PROMO } }))!
    expect(v.tone).toBe('alert')
    expect(v.lines.join('')).toContain('退回草稿')
  })
  it('连批准时间也没有（直接改了状态）：标红', () => {
    expect(describeApprovalRecord(plan('completed', undefined, { approved_at: null }))!.tone).toBe('alert')
  })
})

describe('记录残缺或被手改时不崩', () => {
  it.each([
    ['回执是字符串', 'oops'],
    ['回执是数组', [1, 2]],
    ['回执是空对象', {}],
    ['时间不是字符串', receipt({ approved_at: 12345 })],
    ['时间是乱码', receipt({ approved_at: 'not-a-date' })],
  ])('%s', (_name, r) => {
    expect(() => describeApprovalRecord(plan('approved', r))).not.toThrow()
  })
  it('批准人是对象 → 当没记录；快照 results 不是数组 → 不显示快照行；数字乱填被归零', () => {
    const v = describeApprovalRecord(plan('approved', receipt({
      approved_by: { x: 1 }, tasks_created: 'many', gate_snapshot: { taken_at: 5, results: {} },
    })))!
    expect(v.lines[0]).toBe('批准人：没有记录')
    expect(v.lines.join('\n')).not.toContain('检查清单')
    expect(v.lines.join('')).toContain('还没有自动生成待办')
  })
  it('时间不是合法日期 → 写「没有记录」', () => {
    expect(describeApprovalRecord(plan('approved', receipt({ approved_at: 'not-a-date' })))!.tone).toBe('normal')
  })
})

describe('内容版本', () => {
  const withPromo = (r?: unknown) => plan('approved', r, { plan_data: { promo: baseSpec() } })
  it('回执内容版本和现在一致 → 正常，说明批准的就是这一版', () => {
    const v = describeApprovalRecord(withPromo(receipt({ content_hash: promoContentHash(baseSpec()) })))!
    expect(v.tone).toBe('normal')
    expect(v.lines.join('\n')).toContain('批准的就是现在这一版内容')
  })
  it('回执内容版本对不上 → 标红，说明批准后内容被改过', () => {
    const v = describeApprovalRecord(withPromo(receipt({ content_hash: 'other-hash' })))!
    expect(v.tone).toBe('alert')
    expect(v.lines.join('\n')).toContain('批准的不是现在这一版内容')
  })
  it('旧回执没有内容版本 → 正常，说明没有记录内容版本', () => {
    const v = describeApprovalRecord(withPromo(receipt()))!
    expect(v.tone).toBe('normal')
    expect(v.lines.join('\n')).toContain('没有记录内容版本')
  })
  it('没有推广结构 → 不出现内容版本行', () => {
    const v = describeApprovalRecord(plan('approved', receipt({ content_hash: 'other-hash' })))!
    const text = v.lines.join('\n')
    expect(text).not.toContain('批准的就是现在这一版内容')
    expect(text).not.toContain('批准的不是现在这一版内容')
    expect(text).not.toContain('没有记录内容版本')
  })
})
