/**
 * 🔴 键名撞车回归（独立审查 2026-10-20 发现，PR 2937）：
 * `metadata.travel_window` 是**老字段**（客人原话，冷热分级读它判「现在打是打扰」），
 * 官网表单的出发时间稳定代码必须用 `form_travel_window` / `form_budget_band`，
 * 否则新线索一写入 mar_may_2027 就从「热名单」掉进「冷名单」。
 * 这里钉住：带了新键的客人，段位、冷热、理由与没带时**完全一样**。
 */
import { describe, expect, it } from 'vitest'
import { buildContactModel } from '../contact-model'
import { segmentContact } from '../segments'

const row = {
  id: 'c1',
  display_name: 'Jane',
  primary_phone: '+64211234567',
  primary_email: 'jane@example.com',
  do_not_contact: false,
  snooze_until: null,
  stage: null,
}

function seg(meta: Record<string, unknown>, nowIso: string) {
  const tp = {
    contact_id: 'c1',
    channel: 'web_form',
    direction: 'inbound' as const,
    occurred_at: '2026-10-21T00:00:00Z',
    source: 'web_form',
    raw: '兴趣: X',
    metadata: meta,
  }
  const model = buildContactModel(row, [tp], new Map())
  const r = segmentContact(model, new Date(nowIso))
  return { segment: r.segment, temperature: r.temperature, reason: r.reason }
}

describe('官网表单的出发时间/预算代码不改变冷热分级', () => {
  const base = { lead_id: 'm1', source_url: '/tours/x' }
  for (const nowIso of ['2026-10-22T00:00:00Z', '2026-11-05T00:00:00Z', '2027-04-01T00:00:00Z']) {
    it(`now=${nowIso}：四个出发时间 × 预算，段位与没带时一致`, () => {
      const baseline = seg(base, nowIso)
      for (const code of ['mar_may_2027', 'jun_sep_2027', 'oct_dec_2027', 'not_sure']) {
        expect(seg({ ...base, form_travel_window: code, form_budget_band: '3000_5000' }, nowIso)).toEqual(baseline)
      }
    })
  }
})
