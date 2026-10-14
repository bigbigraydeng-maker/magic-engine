import { describe, expect, it } from 'vitest'
import { approveButtonState, continueButtonVisible, formatRowValue, LIGHT_META, ROW_STATUS_META } from '../labels'
import { buildPromoTemplate } from '../template'
import { parsePromoSpec } from '../spec'
import { evaluateApproval } from '../gates'
import { baseSpec, goodFacts as rawFacts, verifiedChecks } from './fixtures'

const verified = () => baseSpec()
const goodFacts = (o: Parameters<typeof rawFacts>[0] = {}) => rawFacts({ manual_checks: verifiedChecks(), ...o })

describe('approveButtonState', () => {
  it('不是草稿 → 不显示（已批准的计划没有"批准"）', () => {
    const s = approveButtonState({ plan_status: 'approved', approval: null, spec_valid: true })
    expect(s.visible).toBe(false)
  })
  it('结构有问题 → 灰着，不能批', () => {
    const s = approveButtonState({ plan_status: 'draft', approval: null, spec_valid: false })
    expect(s).toMatchObject({ visible: true, disabled: true, label: '暂时不能批' })
  })
  it('硬门没过 → 灰着，并逐项说缺什么、怎么办', () => {
    const approval = evaluateApproval(baseSpec(), goodFacts({ manual_checks: [] }))
    const s = approveButtonState({ plan_status: 'draft', approval, spec_valid: true })
    expect(s.disabled).toBe(true)
    expect(s.blockers.length).toBeGreaterThan(0)
    expect(s.blockers[0].how.length).toBeGreaterThan(0)
  })
  it('只有软门/黄灯未核实 → 可以批，按钮带数量，提示"默认先别批"', () => {
    const approval = evaluateApproval(verified(), goodFacts())
    const s = approveButtonState({ plan_status: 'draft', approval, spec_valid: true })
    expect(s.disabled).toBe(false)
    expect(s.label).toMatch(/批准计划（\d+ 项未核实）/)
    expect(s.hint).toContain('默认先别批')
    expect(s.hint).toContain('广告不会自动投放')
  })
  it('全部通过 → 可以批，且明说广告不会自动投放', () => {
    const approval = { can_approve: true, blockers: [], unverified: [], results: [], note: null }
    const s = approveButtonState({ plan_status: 'draft', approval, spec_valid: true })
    expect(s).toMatchObject({ visible: true, disabled: false, label: '批准计划' })
    expect(s.hint).toContain('广告不会自动投放')
  })
})

describe('continueButtonVisible', () => {
  const rec = { window: { start: 'a', end: 'b' }, week_index: 1, rows: [], headline: '', blind: false }
  it('已批准 + 有对账 + 这个窗口还没点过 → 显示', () => {
    expect(continueButtonVisible({ plan_status: 'approved', reconcile: rec, reviewed_this_window: false })).toBe(true)
  })
  it('点过了 / 草稿 / 没有对账 → 不显示', () => {
    expect(continueButtonVisible({ plan_status: 'approved', reconcile: rec, reviewed_this_window: true })).toBe(false)
    expect(continueButtonVisible({ plan_status: 'draft', reconcile: rec, reviewed_this_window: false })).toBe(false)
    expect(continueButtonVisible({ plan_status: 'approved', reconcile: null, reviewed_this_window: false })).toBe(false)
  })
})

describe('文案', () => {
  it('四种灯都有文字说明（灰不能只靠颜色）', () => {
    for (const l of ['green', 'yellow', 'red', 'gray'] as const) expect(LIGHT_META[l].label.length).toBeGreaterThan(0)
    expect(LIGHT_META.gray.label).toBe('还没核实')
  })
  it('页面文案不含内部词', () => {
    // 只检查人看得到的文字（label），不检查代码里的键名
    const all = JSON.stringify([...Object.values(LIGHT_META), ...Object.values(ROW_STATUS_META)].map(m => m.label))
    for (const w of ['unknown', 'gate', 'hard', 'soft', 'promo', 'schema', 'Kernel', 'migration']) {
      expect(all.toLowerCase()).not.toContain(w.toLowerCase())
    }
  })
  it('formatRowValue：分 → 元；空 → —', () => {
    expect(formatRowValue({ unit: '分' }, 12345)).toBe('123.45')
    expect(formatRowValue({ unit: '' }, null)).toBe('—')
    expect(formatRowValue({ unit: '条' }, 5)).toBe('5')
    expect(formatRowValue({ unit: '' }, 40.04)).toBe('40.0')
  })
})

describe('空白模板', () => {
  it('结构合法但目标编号为空，所以不填就保存不了；不含示例金额 / 账户', () => {
    const t = buildPromoTemplate({ start_date: '2026-11-01', end_date: '2026-11-30' })
    expect(t.goal_id).toBe('')
    expect(parsePromoSpec(t).ok).toBe(false)
    const json = JSON.stringify(t)
    expect(json).not.toMatch(/act_|budget|cents/)
    t.goal_id = 'g1'
    expect(parsePromoSpec(t).ok).toBe(true)
  })
})
