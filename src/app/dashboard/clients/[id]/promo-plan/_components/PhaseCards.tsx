'use client'

import type { BusinessCase, ExperimentCard, SalesHandover } from '@/lib/marketing-plan/promo/spec'
import { businessCaseMath } from '@/lib/marketing-plan/promo/economics'
import { centsToYuan, percentToRate, rateToPercent, splitList, yuanToCents } from '@/lib/marketing-plan/promo/form'
import { Field, LocalInput, inputCls } from './Field'

export function BusinessCaseFields({ card, onChange }: { card: BusinessCase; onChange: (c: BusinessCase) => void }) {
  const set = (patch: Partial<BusinessCase>) => onChange({ ...card, ...patch })
  const num = (v: string) => Math.max(0, Math.floor(Number(v) || 0))
  const show = (n: number) => (n > 0 ? String(n) : '')
  const showSample = (n: number | null) => (n === null || n <= 0 ? '' : String(n))
  const parseSample = (v: string) => {
    const n = Math.floor(Number(v) || 0)
    return n > 0 ? n : null
  }
  const showPax = (n: number) => (n > 0 ? String(n) : '')
  const parsePax = (v: string) => (Number(v) > 0 ? Number(v) : 0)
  const basisOptions: { key: BusinessCase['retention_basis'][number]; label: string }[] = [
    { key: 'commission', label: '佣金' },
    { key: 'ad_cost', label: '广告费' },
    { key: 'fixed_cost', label: '固定成本' },
    { key: 'none', label: '都没扣' },
  ]
  const toggleBasis = (key: BusinessCase['retention_basis'][number], checked: boolean) => {
    const next = checked
      ? [...card.retention_basis.filter(k => k !== key), key]
      : card.retention_basis.filter(k => k !== key)
    set({ retention_basis: next })
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <Field label="这笔钱对准哪个团期" hint="填团名 + 出发日，或 ME 里的班期编号">
        <input className={inputCls} value={card.departure_ref} onChange={e => set({ departure_ref: e.target.value })} />
      </Field>
      <Field label="还剩多少座">
        <LocalInput value={card.seats_remaining} format={show} parse={num} onValue={n => set({ seats_remaining: n })} />
      </Field>
      <Field label="这个座位数客户确认过了吗" hint="没确认的座位数不能用来批准开投">
        <select className={inputCls} value={card.seats_confirmed ? 'yes' : 'no'} onChange={e => set({ seats_confirmed: e.target.value === 'yes' })}>
          <option value="yes">已确认</option>
          <option value="no">还没确认</option>
        </select>
      </Field>
      <Field label="座位数是哪天的">
        <input type="date" className={inputCls} value={card.seats_as_of} onChange={e => set({ seats_as_of: e.target.value })} />
      </Field>
      <Field label="每座公司留存（元）">
        <LocalInput value={card.retained_per_seat_cents} format={centsToYuan} parse={yuanToCents} onValue={n => set({ retained_per_seat_cents: n })} />
      </Field>
      <Field label="这个留存扣掉了什么" hint="至少选一项；都没扣就选「都没扣」">
        <div className="flex flex-wrap gap-3 text-sm text-gray-800 pt-1">
          {basisOptions.map(o => (
            <label key={o.key} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={card.retention_basis.includes(o.key)}
                onChange={e => toggleBasis(o.key, e.target.checked)}
              />
              {o.label}
            </label>
          ))}
        </div>
      </Field>
      <Field label="每单几座" hint="例如一单平均 1.74 个人">
        <LocalInput value={card.pax_per_booking} format={showPax} parse={parsePax} onValue={n => set({ pax_per_booking: n })} />
      </Field>
      <Field label="线索成交率（%）" hint="填百分数，例如 2.6">
        <LocalInput value={card.lead_to_booking_rate} format={rateToPercent} parse={percentToRate} onValue={n => set({ lead_to_booking_rate: n })} />
      </Field>
      <Field label="这个成交率是实测还是假设">
        <select className={inputCls} value={card.rate_source} onChange={e => set({ rate_source: e.target.value === 'measured' ? 'measured' : 'assumed' })}>
          <option value="measured">实测</option>
          <option value="assumed">假设</option>
        </select>
      </Field>
      <Field label="实测样本量" hint="选「实测」时才要填">
        <LocalInput value={card.rate_sample_n} format={showSample} parse={parseSample} onValue={n => set({ rate_sample_n: n })} />
      </Field>
      <Field label="素材缺口补充说明">
        <input className={inputCls} value={card.creative_gap_note} onChange={e => set({ creative_gap_note: e.target.value })} />
      </Field>
      <Field label="负责人">
        <input className={inputCls} value={card.owner} onChange={e => set({ owner: e.target.value })} />
      </Field>
      <BusinessCaseMathNote card={card} actualLeadCostCents={null} />
    </div>
  )
}

export function BusinessCaseMathNote({ card, actualLeadCostCents }: { card: BusinessCase; actualLeadCostCents: number | null }) {
  const math = businessCaseMath(card, actualLeadCostCents)
  const retained = card.retained_per_seat_cents > 0 ? `${centsToYuan(card.retained_per_seat_cents)} 元` : '未知'
  const pax = card.pax_per_booking > 0 ? String(card.pax_per_booking) : '未知'
  const rate = card.lead_to_booking_rate > 0 ? `${rateToPercent(card.lead_to_booking_rate)}%` : '未知'
  return (
    <div className="sm:col-span-2 rounded-lg bg-gray-50 border border-gray-200 p-3 text-xs text-gray-700 space-y-1">
      <div>可承受的每条线索成本 = 每座留存 × 每单几座 × 成交率</div>
      <div>代入：每座留存 {retained}，每单几座 {pax}，成交率 {rate}</div>
      <div>
        可承受的每条线索成本：
        {math.acceptable_lead_cost_cents === null
          ? '未知（上面有项没填）'
          : `${centsToYuan(math.acceptable_lead_cost_cents)} 元`}
      </div>
      <div>
        按实际线索成本算，保本至少要
        {math.breakeven_rate === null ? '未知（还没有实际线索成本）' : `${rateToPercent(math.breakeven_rate)}%`}
      </div>
    </div>
  )
}

export function ExperimentFields({ card, onChange }: { card: ExperimentCard; onChange: (c: ExperimentCard) => void }) {
  const set = (patch: Partial<ExperimentCard>) => onChange({ ...card, ...patch })
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <Field label="这一轮要验证什么">
        <input className={inputCls} value={card.hypothesis} onChange={e => set({ hypothesis: e.target.value })} />
      </Field>
      <Field label="哪些东西固定不变" hint="多个用逗号隔开">
        <LocalInput value={card.held_constant} format={l => l.join(', ')} parse={splitList} onValue={l => set({ held_constant: l })} />
      </Field>
      <Field label="主指标" hint="「合格咨询」系统里还没有口径，选了只能当文字记录，算不出数">
        <select className={inputCls} value={card.primary_metric} onChange={e => set({ primary_metric: e.target.value === 'qualified_enquiry' ? 'qualified_enquiry' : e.target.value === 'booking' ? 'booking' : 'enquiry' })}>
          <option value="enquiry">咨询</option>
          <option value="qualified_enquiry">合格咨询</option>
          <option value="booking">预订</option>
        </select>
      </Field>
      <Field label="最大可承受损失（元）">
        <LocalInput value={card.max_loss_cents} format={centsToYuan} parse={yuanToCents} onValue={n => set({ max_loss_cents: n })} />
      </Field>
      <Field label="什么情况下停">
        <input className={inputCls} value={card.stop_rule} onChange={e => set({ stop_rule: e.target.value })} />
      </Field>
      <Field label="什么情况下继续">
        <input className={inputCls} value={card.continue_rule} onChange={e => set({ continue_rule: e.target.value })} />
      </Field>
      <Field label="负责人">
        <input className={inputCls} value={card.owner} onChange={e => set({ owner: e.target.value })} />
      </Field>
    </div>
  )
}

export function SalesHandoverFields({ card, onChange }: { card: SalesHandover; onChange: (c: SalesHandover) => void }) {
  const set = (patch: Partial<SalesHandover>) => onChange({ ...card, ...patch })
  const num = (v: string) => Math.max(0, Math.floor(Number(v) || 0))
  const show = (n: number) => (n > 0 ? String(n) : '')
  const channelOptions: { key: SalesHandover['channels'][number]; label: string }[] = [
    { key: 'phone', label: '电话' },
    { key: 'email', label: '邮件' },
    { key: 'dm', label: '私信' },
  ]
  const toggleChannel = (key: SalesHandover['channels'][number], checked: boolean) => {
    const next = checked
      ? [...card.channels.filter(k => k !== key), key]
      : card.channels.filter(k => k !== key)
    set({ channels: next })
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <Field label="谁接手这些客人">
        <input className={inputCls} value={card.owner} onChange={e => set({ owner: e.target.value })} />
      </Field>
      <Field label="多久之内要联系上（小时）">
        <LocalInput value={card.response_sla_hours} format={show} parse={num} onValue={n => set({ response_sla_hours: n })} />
      </Field>
      <Field label="用什么联系">
        <div className="flex flex-wrap gap-3 text-sm text-gray-800 pt-1">
          {channelOptions.map(o => (
            <label key={o.key} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={card.channels.includes(o.key)}
                onChange={e => toggleChannel(o.key, e.target.checked)}
              />
              {o.label}
            </label>
          ))}
        </div>
      </Field>
      <Field label="没人接手时怎么办">
        <input className={inputCls} value={card.fallback} onChange={e => set({ fallback: e.target.value })} />
      </Field>
    </div>
  )
}
