'use client'
import { useMemo, useState } from 'react'
import { AI_STEWARD_RULES_V1 as RULES } from '@/lib/distributor/config'
import { formatDollars, simulateMonth, SIMULATION_LIMITS, type SimulationInput } from '@/lib/distributor/simulate'
import type { DistributorLevel } from '@/lib/distributor/types'

const LEVELS: Array<{ value: DistributorLevel; label: string }> = [
  { value: 'standard', label: '普通' },
  { value: 'tier1', label: '一级' },
  { value: 'premier', label: '特级' },
]

function Stepper({
  label,
  unit,
  value,
  max,
  onChange,
}: {
  label: string
  unit: string
  value: number
  max: number
  onChange: (n: number) => void
}) {
  const clamp = (n: number) => Math.min(max, Math.max(0, n))
  return (
    <div>
      <label className="mb-2 block text-[13px] font-semibold text-me-charcoal/75">{label}</label>
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          aria-label={`${label}减 1`}
          onClick={() => onChange(clamp(value - 1))}
          className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-[#F2EEE7] text-xl font-semibold text-me-charcoal"
        >
          −
        </button>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={max}
          aria-label={label}
          value={value}
          onChange={(e) => {
            const n = parseInt(e.target.value, 10)
            onChange(clamp(Number.isNaN(n) ? 0 : n))
          }}
          className="min-w-0 flex-1 rounded-[10px] border border-black/10 bg-white py-[7px] text-center text-xl font-bold tabular-nums text-me-charcoal"
        />
        <button
          type="button"
          aria-label={`${label}加 1`}
          onClick={() => onChange(clamp(value + 1))}
          className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-[#F2EEE7] text-xl font-semibold text-me-charcoal"
        >
          +
        </button>
        <span className="w-16 text-[13px] text-me-charcoal/55">{unit}</span>
      </div>
    </div>
  )
}

function LevelSegmented({
  label,
  value,
  onChange,
}: {
  label: string
  value: DistributorLevel
  onChange: (level: DistributorLevel) => void
}) {
  return (
    <div>
      <label className="mb-2 block text-[13px] font-semibold text-me-charcoal/75">{label}</label>
      <div role="radiogroup" aria-label={label} className="flex rounded-xl bg-[#F2EEE7] p-1">
        {LEVELS.map((level) => {
          const on = level.value === value
          return (
            <button
              key={level.value}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(level.value)}
              className={
                on
                  ? 'flex-1 rounded-[9px] bg-white py-2 text-center text-sm font-bold text-me-charcoal shadow-[0_1px_2px_rgba(0,0,0,0.08)]'
                  : 'flex-1 rounded-[9px] py-2 text-center text-sm text-me-charcoal/60'
              }
            >
              {level.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function Simulator() {
  const [input, setInput] = useState<SimulationInput>({
    myLevel: 'standard',
    planCode: 'videos-16',
    mySales: 10,
    directCount: 10,
    directLevel: 'standard',
    salesEach: 8,
  })
  const result = useMemo(() => simulateMonth(input), [input])

  return (
    <section className="mt-12">
      <h2 className="text-[22px] font-bold text-me-charcoal">收益模拟器</h2>
      <p className="mt-1.5 text-sm leading-relaxed text-me-charcoal/60">
        改下面的数字，马上算出一个月大概能拿多少。算法和每月真实结算用的是同一套。新加入都从普通开始。
      </p>
      <div className="mt-5 grid overflow-hidden rounded-2xl bg-white shadow-card md:grid-cols-2">
        <div className="flex flex-col gap-5 p-5 md:p-7">
          <LevelSegmented
            label="我的等级"
            value={input.myLevel}
            onChange={(myLevel) => setInput((prev) => ({ ...prev, myLevel }))}
          />
          <div>
            <label className="mb-2 block text-[13px] font-semibold text-me-charcoal/75">客户买的套餐</label>
            <select
              aria-label="客户买的套餐"
              value={input.planCode}
              onChange={(e) => setInput((prev) => ({ ...prev, planCode: e.target.value }))}
              className="w-full rounded-[10px] border border-black/10 bg-white px-3 py-2.5 text-sm text-me-charcoal"
            >
              {RULES.catalog.plans.map((plan) => (
                <option key={plan.code} value={plan.code}>
                  每月 {plan.videosPerMonth} 条视频 · {formatDollars(plan.monthlyCents, true)}/月
                </option>
              ))}
            </select>
          </div>
          <Stepper
            label="我自己每月卖出"
            unit="单"
            value={input.mySales}
            max={SIMULATION_LIMITS.maxSales}
            onChange={(mySales) => setInput((prev) => ({ ...prev, mySales }))}
          />
          <Stepper
            label="我直接带的经销商"
            unit="位"
            value={input.directCount}
            max={SIMULATION_LIMITS.maxDirect}
            onChange={(directCount) => setInput((prev) => ({ ...prev, directCount }))}
          />
          <Stepper
            label="他们每人每月卖出"
            unit="单"
            value={input.salesEach}
            max={SIMULATION_LIMITS.maxSales}
            onChange={(salesEach) => setInput((prev) => ({ ...prev, salesEach }))}
          />
          <LevelSegmented
            label="他们的等级"
            value={input.directLevel}
            onChange={(directLevel) => setInput((prev) => ({ ...prev, directLevel }))}
          />
        </div>

        <div className="bg-me-charcoal p-5 text-me-ivory md:p-7">
          <div className="text-[13px] text-me-ivory/60">每月预计到手</div>
          <div aria-live="polite" className="mt-1.5 text-[38px] font-bold tabular-nums text-me-gold md:text-[48px]">
            {formatDollars(result.totalCents)}
            <small className="ml-1 text-base font-medium text-me-ivory/60"> /月</small>
          </div>
          <div className="mt-5 border-t border-me-ivory/[0.12]">
            <div className="flex justify-between border-b border-me-ivory/[0.12] py-3 text-[15px]">
              <span className="text-me-ivory">
                零售分润
                <small className="mt-0.5 block text-xs text-me-ivory/50">
                  {input.mySales} 单 × {formatDollars(result.planMonthlyCents, true)} ×{' '}
                  {RULES.retailRateBp[input.myLevel] / 100}%
                </small>
              </span>
              <span className="font-bold tabular-nums text-me-ivory">{formatDollars(result.retailCents)}</span>
            </div>
            <div className="flex justify-between border-b border-me-ivory/[0.12] py-3 text-[15px]">
              <span className="text-me-ivory">
                平级奖励
                <small className="mt-0.5 block text-xs text-me-ivory/50">
                  下面的人和你同级时，每单拿 {RULES.peerRateBp / 100}%
                </small>
              </span>
              <span className="font-bold tabular-nums text-me-ivory">{formatDollars(result.peerCents)}</span>
            </div>
            <div className="flex justify-between border-b border-me-ivory/[0.12] py-3 text-[15px]">
              <span className="text-me-ivory">
                团队奖励
                <small className="mt-0.5 block text-xs text-me-ivory/50">
                  团队合计 {formatDollars(result.teamSalesCents, true)} × {result.teamRateBp / 100}%，已减下级应得
                </small>
              </span>
              <span className="font-bold tabular-nums text-me-ivory">{formatDollars(result.teamCents)}</span>
            </div>
          </div>
          <div className="mt-4 text-[13px] leading-relaxed text-me-ivory/65">
            团队这个月合计卖出 {formatDollars(result.teamSalesCents, true)}，对应团队比例 {result.teamRateBp / 100}%。
            {input.directCount > 0 ? (
              <>
                <br />
                你下面每位经销商这个月大约拿 {formatDollars(result.eachDirectCents)}。
              </>
            ) : null}
          </div>
          {result.teamWithheldCents > 0 ? (
            <div className="mt-4 rounded-[10px] bg-me-gold/[0.12] px-3 py-2.5 text-xs leading-relaxed text-me-gold">
              你自己这个月一单没卖：团队奖励 {formatDollars(result.teamWithheldCents)} 按规则不发放，之后也不补发。
            </div>
          ) : null}
          {result.teamRateBp === 0 && result.teamSalesCents > 0 ? (
            <div className="mt-2 text-xs leading-relaxed text-me-ivory/60">
              团队合计还没到 {formatDollars(RULES.teamRateSteps[0].minTeamSalesCents, true)}，暂时没有团队奖励。
            </div>
          ) : null}
          <div className="mt-4 rounded-[10px] bg-me-gold/[0.12] px-3 py-2.5 text-xs leading-relaxed text-me-gold">
            这只是举例，不是承诺。实际收入只看客户真实付款；客户退款会扣回分润。
          </div>
        </div>
      </div>
    </section>
  )
}
