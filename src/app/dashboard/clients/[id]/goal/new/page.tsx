'use client'

/**
 * Phase 31 M2 + Phase 32 — Goal 设定 4 步向导
 * URL: /dashboard/clients/[id]/goal/new
 *
 * Step 1: Intent (acquisition / sales / awareness) + Sub-type (P32) + Title
 * Step 2: Primary metric (按 intent + sub_type 推荐) + baseline/target
 * Step 3: Period + Budget + FDE reasoning
 * Step 4: Confirm + Save as draft
 *
 * Phase 32 新增：
 *   - sub_type 按 intent 分流（清仓 / 团报名 / 月营收持续 等）
 *   - target_direction（清仓型自动 decrease）
 *   - 主指标按 sub_type 推荐
 *
 * Saved as draft only — FDE 后续在 Goal 看板点 "Activate" 才正式启动。
 */

import { useState, useMemo } from 'react'
import { useRouter, useParams } from 'next/navigation'
import {
  GOAL_SUBTYPES_BY_INTENT,
  getRecommendedMetrics,
  type GoalIntent,
  type GoalSubType,
  type TargetDirection,
  type MetricCandidate,
  type CreateGoalInput,
} from '@/types/strategy'

// ─── Intent options ──────────────────────────────────────────────────────────

const INTENT_OPTIONS: Array<{
  value: GoalIntent
  emoji: string
  title: string
  description: string
}> = [
  { value: 'acquisition', emoji: '🎯', title: '获客 Acquisition',
    description: '老板想要更多线索 / 询盘 / 试用注册' },
  { value: 'sales',       emoji: '💰', title: '销售 Sales',
    description: '老板想要更多营收 / 订单 / 清仓 / 团报名' },
  { value: 'awareness',   emoji: '📢', title: '品牌曝光 Awareness',
    description: '老板想要更多市场认知（新进入 / 活动推广）' },
]

// ─── Page ────────────────────────────────────────────────────────────────────

export default function NewGoalPage() {
  const router = useRouter()
  const params = useParams<{ id: string }>()
  const clientId = params.id

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // ── State for all steps ────────────────────────────────────────────────────
  const [intent, setIntent] = useState<GoalIntent | null>(null)
  const [subType, setSubType] = useState<GoalSubType | null>(null)
  const [targetDirection, setTargetDirection] = useState<TargetDirection>('increase')
  const [title, setTitle] = useState('')

  const [selectedMetric, setSelectedMetric] = useState<MetricCandidate | null>(null)
  const [baselineValue, setBaselineValue] = useState('')
  const [targetValue, setTargetValue] = useState('')

  const [periodStart, setPeriodStart] = useState(new Date().toISOString().slice(0, 10))
  const [periodEnd, setPeriodEnd] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + 90)
    return d.toISOString().slice(0, 10)
  })
  const [budgetAmount, setBudgetAmount] = useState('')
  const [budgetCurrency, setBudgetCurrency] = useState<'AUD' | 'NZD'>('NZD')
  const [fdeReasoning, setFdeReasoning] = useState('')

  // ── Available sub-types for the chosen intent ─────────────────────────────
  const availableSubTypes = intent ? GOAL_SUBTYPES_BY_INTENT[intent] : []
  const selectedSubTypeDef = subType
    ? availableSubTypes.find(s => s.value === subType) ?? null
    : null

  // ── Filter metrics by intent + sub_type ────────────────────────────────────
  const recommendedMetrics = useMemo(
    () => intent ? getRecommendedMetrics(intent, subType) : [],
    [intent, subType],
  )

  // ── When sub_type changes, set sensible defaults ───────────────────────────
  function handleSubTypeChange(newSubType: GoalSubType) {
    setSubType(newSubType)
    const def = availableSubTypes.find(s => s.value === newSubType)
    if (def) {
      setTargetDirection(def.default_direction)
    }
    // Clear metric — will be re-chosen from filtered list
    setSelectedMetric(null)
    setBaselineValue('')
    setTargetValue('')
  }

  function handleIntentChange(newIntent: GoalIntent) {
    setIntent(newIntent)
    setSubType(null)
    setTargetDirection('increase')
    setSelectedMetric(null)
  }

  // ── Validation per step ────────────────────────────────────────────────────
  const canProceed1 = !!intent && !!subType && !!title.trim()
  const canProceed2 = !!selectedMetric && baselineValue !== '' && targetValue !== '' && baselineValue !== targetValue
  const canProceed3 = !!periodStart && !!periodEnd && new Date(periodEnd) > new Date(periodStart)

  // ── Submit handler ─────────────────────────────────────────────────────────
  async function handleSubmit() {
    if (!intent || !subType || !selectedMetric) return
    setSaving(true)
    setError('')

    const payload: CreateGoalInput = {
      intent,
      sub_type: subType,
      title: title.trim(),
      primary_metric_key: selectedMetric.key,
      primary_metric_label: selectedMetric.label_zh,
      primary_metric_unit: selectedMetric.unit,
      baseline_value: parseFloat(baselineValue),
      target_value: parseFloat(targetValue),
      target_direction: targetDirection,
      period_start: periodStart,
      period_end: periodEnd,
      budget_amount: budgetAmount ? parseFloat(budgetAmount) : undefined,
      budget_currency: budgetCurrency,
      fde_reasoning: fdeReasoning.trim() || undefined,
    }

    try {
      const res = await fetch(`/api/clients/${clientId}/goals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const j = await res.json()
        setError(j.error ?? 'Failed to create goal')
        return
      }
      const { goal } = await res.json()
      router.push(`/dashboard/clients/${clientId}/goal/${goal.id}`)
    } finally {
      setSaving(false)
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#f6f7f2] px-4 py-8 md:px-6">
      <div className="mx-auto max-w-3xl">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="flex items-center gap-2 font-display text-3xl font-bold tracking-tight text-me-charcoal">
              New Goal
              <span className="inline-block rounded-full bg-me-ochre/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-me-ochre">
                Beta
              </span>
            </h1>
            <p className="mt-1 text-sm font-semibold text-me-charcoal/55">
              Phase 31 + 32 · 4-step wizard. 多 Goal 并行 · 支持清仓/团报名/月营收持续等场景。
            </p>
          </div>
        </div>

        {/* Stepper */}
        <div className="mb-6 flex items-center gap-2 text-xs">
          {[1, 2, 3, 4].map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <span className={`flex h-7 w-7 items-center justify-center rounded-full font-black ${
                step === s ? 'bg-me-ochre text-white'
                : step > s ? 'bg-status-track/20 text-status-track'
                : 'bg-me-ivory text-me-charcoal/45'
              }`}>
                {step > s ? '✓' : s}
              </span>
              <span className={step === s ? 'font-black text-me-charcoal' : 'font-semibold text-me-charcoal/45'}>
                {['Intent + Type', 'Metric', 'Period & Budget', 'Confirm'][i]}
              </span>
              {i < 3 && <span className="text-me-charcoal/25">›</span>}
            </div>
          ))}
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-status-rej/30 bg-status-rej/10 px-4 py-2 text-sm font-semibold text-status-rej">
            {error}
          </div>
        )}

        {/* Step 1: Intent + Sub-type + Title */}
        {step === 1 && (
          <div className="space-y-6 rounded-xl border border-black/10 bg-white p-6 shadow-sm">
            <div>
              <h2 className="font-display text-base font-bold text-me-charcoal">Step 1 · 客户意图 + Goal 类型</h2>
              <p className="mt-1 text-xs font-semibold text-me-charcoal/55">先选大方向（intent），再选具体类型（sub-type）。</p>
            </div>

            {/* Intent selection */}
            <div className="space-y-2">
              <label className="text-xs font-black uppercase tracking-wide text-me-charcoal/55">1.1 选择 Intent</label>
              <div className="grid grid-cols-1 gap-3">
                {INTENT_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => handleIntentChange(opt.value)}
                    className={`rounded-lg border px-4 py-3 text-left transition-all ${
                      intent === opt.value
                        ? 'border-me-ochre bg-me-ochre/10'
                        : 'border-black/10 hover:border-me-ochre/40 hover:bg-me-ivory'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <span className="text-2xl">{opt.emoji}</span>
                      <div>
                        <div className="font-black text-me-charcoal">{opt.title}</div>
                        <div className="mt-0.5 text-xs font-semibold text-me-charcoal/55">{opt.description}</div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Sub-type selection (only after intent chosen) */}
            {intent && (
              <div className="space-y-2 border-t border-black/10 pt-4">
                <label className="text-xs font-black uppercase tracking-wide text-me-charcoal/55">
                  1.2 选择 Sub-type {availableSubTypes.length > 0 && `(${availableSubTypes.length} 个候选)`}
                </label>
                <div className="grid grid-cols-1 gap-2">
                  {availableSubTypes.map(s => (
                    <button
                      key={s.value}
                      type="button"
                      onClick={() => handleSubTypeChange(s.value)}
                      className={`rounded-lg border px-3 py-2.5 text-left transition-all ${
                        subType === s.value
                          ? 'border-me-ochre bg-me-ochre/10'
                          : 'border-black/10 hover:border-me-ochre/40 hover:bg-me-ivory'
                      }`}
                    >
                      <div className="flex items-start gap-2.5">
                        <span className="text-lg">{s.emoji}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-black text-me-charcoal">{s.label_zh}</span>
                            <span className="text-[10px] font-semibold text-me-charcoal/45">{s.label_en}</span>
                            {s.default_direction === 'decrease' && (
                              <span className="rounded-full bg-status-sched/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-status-sched">
                                ↓ Decrease
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 text-xs font-semibold text-me-charcoal/55">{s.description}</div>
                          <div className="mt-1 text-[11px] font-semibold italic text-me-charcoal/45">e.g. {s.example}</div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Title (only after sub_type chosen) */}
            {subType && (
              <div className="space-y-2 border-t border-black/10 pt-4">
                <label className="text-xs font-black uppercase tracking-wide text-me-charcoal/55">1.3 Goal 标题（FDE 起名）</label>
                <input
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder={selectedSubTypeDef?.example ?? 'e.g. CTS 2026 春节中国团'}
                  className="w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm font-semibold text-me-charcoal placeholder:text-me-taupe focus:border-me-ochre focus:outline-none"
                />
              </div>
            )}
          </div>
        )}

        {/* Step 2: Primary metric */}
        {step === 2 && (
          <div className="space-y-6 rounded-xl border border-black/10 bg-white p-6 shadow-sm">
            <div>
              <h2 className="font-display text-base font-bold text-me-charcoal">Step 2 · 选择主指标</h2>
              <p className="mt-1 text-xs font-semibold text-me-charcoal/55">
                这个数字决定 Goal 是否达成。
                {selectedSubTypeDef && (
                  <> 已按 <strong className="text-me-ochre">{selectedSubTypeDef.label_zh}</strong> 推荐 {recommendedMetrics.length} 个指标。</>
                )}
              </p>
            </div>

            <div className="space-y-2">
              {recommendedMetrics.map(m => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => {
                    setSelectedMetric(m)
                    // Auto-apply metric's default direction if exists
                    if (m.default_direction) setTargetDirection(m.default_direction)
                  }}
                  className={`w-full rounded-lg border px-4 py-3 text-left transition-all ${
                    selectedMetric?.key === m.key
                      ? 'border-me-ochre bg-me-ochre/10'
                      : 'border-black/10 hover:border-me-ochre/40 hover:bg-me-ivory'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-black text-me-charcoal">{m.label_zh}</span>
                        {m.default_direction === 'decrease' && (
                          <span className="rounded-full bg-status-sched/15 px-1.5 py-0.5 text-[9px] font-bold uppercase text-status-sched">↓ Decrease</span>
                        )}
                      </div>
                      <div className="mt-0.5 text-xs font-semibold text-me-charcoal/55">{m.label_en} · {m.unit}</div>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                      m.measurement === 'auto'        ? 'bg-status-track/15 text-status-track'
                      : m.measurement === 'self_report' ? 'bg-me-ochre/15 text-me-ochre'
                      :                                   'bg-status-sched/15 text-status-sched'
                    }`}>
                      {m.measurement === 'auto' ? '系统自动测' : m.measurement === 'self_report' ? '客户自报' : 'auto+自报'}
                    </span>
                  </div>
                  {m.note && <div className="mt-1 text-[11px] font-semibold text-me-charcoal/45">注：{m.note}</div>}
                </button>
              ))}
            </div>

            {selectedMetric && (
              <div className="space-y-4 border-t border-black/10 pt-4">
                {/* Direction toggle (auto-set by sub_type / metric, but user can override) */}
                <div className="rounded-lg border border-black/10 bg-me-ivory p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-black text-me-charcoal">
                        指标方向：{targetDirection === 'increase' ? '↑ Increase（向上增长）' : '↓ Decrease（向下减少 — 清仓型）'}
                      </div>
                      <div className="mt-0.5 text-[11px] font-semibold text-me-charcoal/55">
                        {targetDirection === 'increase'
                          ? 'baseline 是起点，target 是目标（target > baseline）'
                          : 'baseline 是起始库存/比例，target 是清空目标（target < baseline）'}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setTargetDirection(targetDirection === 'increase' ? 'decrease' : 'increase')}
                      className="rounded-lg border border-black/15 bg-white px-3 py-1.5 text-xs font-black text-me-charcoal transition-colors hover:border-me-ochre/40 hover:bg-me-ivory"
                    >
                      切换方向
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-black uppercase tracking-wide text-me-charcoal/55">
                      Baseline ({targetDirection === 'decrease' ? '起始库存/起点' : '当前'})
                    </label>
                    <input
                      type="number"
                      value={baselineValue}
                      onChange={e => setBaselineValue(e.target.value)}
                      placeholder={targetDirection === 'decrease' ? 'e.g. 500' : 'e.g. 80000'}
                      className="w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm font-semibold text-me-charcoal placeholder:text-me-taupe focus:border-me-ochre focus:outline-none"
                    />
                    <p className="text-[11px] font-semibold text-me-charcoal/45">单位: {selectedMetric.unit}</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-black uppercase tracking-wide text-me-charcoal/55">
                      Target ({targetDirection === 'decrease' ? '清空/降至目标' : '90 天后'})
                    </label>
                    <input
                      type="number"
                      value={targetValue}
                      onChange={e => setTargetValue(e.target.value)}
                      placeholder={targetDirection === 'decrease' ? 'e.g. 0' : 'e.g. 120000'}
                      className="w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm font-semibold text-me-charcoal placeholder:text-me-taupe focus:border-me-ochre focus:outline-none"
                    />
                    {baselineValue && targetValue && parseFloat(baselineValue) !== 0 && (
                      <p className="text-[11px] font-bold text-status-track">
                        {targetDirection === 'decrease'
                          ? `${((1 - parseFloat(targetValue) / parseFloat(baselineValue)) * 100).toFixed(0)}% reduction`
                          : `${((parseFloat(targetValue) / parseFloat(baselineValue) - 1) * 100).toFixed(0)}% growth`}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Step 3: Period & Budget & FDE reasoning */}
        {step === 3 && (
          <div className="space-y-6 rounded-xl border border-black/10 bg-white p-6 shadow-sm">
            <div>
              <h2 className="font-display text-base font-bold text-me-charcoal">Step 3 · 周期、预算、战略思考</h2>
              <p className="mt-1 text-xs font-semibold text-me-charcoal/55">90 天为推荐周期。清仓 / 团报名型可倒计时到关键日。</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-black uppercase tracking-wide text-me-charcoal/55">起始日期</label>
                <input
                  type="date"
                  value={periodStart}
                  onChange={e => setPeriodStart(e.target.value)}
                  className="w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm font-semibold text-me-charcoal focus:border-me-ochre focus:outline-none"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-black uppercase tracking-wide text-me-charcoal/55">结束日期</label>
                <input
                  type="date"
                  value={periodEnd}
                  onChange={e => setPeriodEnd(e.target.value)}
                  className="w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm font-semibold text-me-charcoal focus:border-me-ochre focus:outline-none"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2 space-y-2">
                <label className="text-xs font-black uppercase tracking-wide text-me-charcoal/55">预算 (可选)</label>
                <input
                  type="number"
                  value={budgetAmount}
                  onChange={e => setBudgetAmount(e.target.value)}
                  placeholder="e.g. 25000"
                  className="w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm font-semibold text-me-charcoal placeholder:text-me-taupe focus:border-me-ochre focus:outline-none"
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-black uppercase tracking-wide text-me-charcoal/55">货币</label>
                <select
                  value={budgetCurrency}
                  onChange={e => setBudgetCurrency(e.target.value as 'AUD' | 'NZD')}
                  className="w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm font-semibold text-me-charcoal focus:border-me-ochre focus:outline-none"
                >
                  <option value="NZD">NZD</option>
                  <option value="AUD">AUD</option>
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-black uppercase tracking-wide text-me-charcoal/55">
                FDE Reasoning (强烈建议填) — 客户为什么要做这个 Goal？我们 90 天后看回这段话
              </label>
              <textarea
                value={fdeReasoning}
                onChange={e => setFdeReasoning(e.target.value)}
                rows={4}
                placeholder="e.g. CTS 老板今年想拿下中国春节档，主要靠老客户复购 + Wendy Wu 同源词抢量..."
                className="w-full resize-none rounded-lg border border-black/15 bg-white px-3 py-2 text-sm font-semibold text-me-charcoal placeholder:text-me-taupe focus:border-me-ochre focus:outline-none"
              />
            </div>
          </div>
        )}

        {/* Step 4: Confirm */}
        {step === 4 && (
          <div className="space-y-4 rounded-xl border border-black/10 bg-white p-6 shadow-sm">
            <h2 className="font-display text-base font-bold text-me-charcoal">Step 4 · 确认 Goal</h2>

            <dl className="space-y-3 text-sm">
              <Row label="Intent" value={`${INTENT_OPTIONS.find(o => o.value === intent)?.emoji} ${INTENT_OPTIONS.find(o => o.value === intent)?.title}`} />
              {selectedSubTypeDef && (
                <Row label="Sub-type" value={`${selectedSubTypeDef.emoji} ${selectedSubTypeDef.label_zh} (${selectedSubTypeDef.label_en})`} />
              )}
              <Row label="Title" value={title} />
              <Row label="Primary Metric" value={`${selectedMetric?.label_zh} (${selectedMetric?.unit})`} />
              <Row label="Direction" value={targetDirection === 'increase' ? '↑ Increase' : '↓ Decrease (清仓型)'} />
              <Row label="Baseline → Target" value={`${baselineValue} → ${targetValue}`} highlight />
              <Row label="Period" value={`${periodStart} → ${periodEnd}`} />
              {budgetAmount && <Row label="Budget" value={`${budgetCurrency} ${parseFloat(budgetAmount).toLocaleString()}`} />}
              {fdeReasoning && <Row label="FDE Reasoning" value={fdeReasoning} multiline />}
            </dl>

            <p className="border-t border-black/10 pt-4 text-xs font-semibold text-me-charcoal/55">
              Goal 会先以 <strong className="text-me-charcoal">draft</strong> 状态保存。下一步在 Goal 详情页配 Initiative，准备好后再 <strong className="text-me-charcoal">Activate</strong>。
              <br />
              <span className="text-me-ochre">Phase 32: 同客户可有多个 active Goal（CTS 4 团 / Oztop 清仓 + 月营收 并行）。</span>
            </p>
          </div>
        )}

        {/* Nav buttons */}
        <div className="mt-6 flex items-center justify-between">
          <button
            type="button"
            onClick={() => step > 1 && setStep((step - 1) as 1 | 2 | 3 | 4)}
            disabled={step === 1}
            className="rounded-lg px-4 py-2 text-sm font-black text-me-charcoal/55 transition-colors hover:text-me-charcoal disabled:cursor-not-allowed disabled:opacity-30"
          >
            ← Back
          </button>

          {step < 4 ? (
            <button
              type="button"
              onClick={() => {
                if (step === 1 && !canProceed1) return
                if (step === 2 && !canProceed2) return
                if (step === 3 && !canProceed3) return
                setStep((step + 1) as 1 | 2 | 3 | 4)
              }}
              disabled={
                (step === 1 && !canProceed1) ||
                (step === 2 && !canProceed2) ||
                (step === 3 && !canProceed3)
              }
              className="rounded-lg bg-me-ochre px-6 py-2 text-sm font-black text-white transition-colors hover:bg-me-ochre/90 disabled:cursor-not-allowed disabled:opacity-30"
            >
              Next →
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={saving}
              className="rounded-lg bg-status-track px-6 py-2 text-sm font-black text-white transition-colors hover:bg-status-track/90 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save Draft'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ label, value, highlight, multiline }: { label: string; value: string; highlight?: boolean; multiline?: boolean }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3">
      <dt className="pt-0.5 text-xs font-black uppercase tracking-wide text-me-charcoal/45">{label}</dt>
      <dd className={`text-sm font-semibold ${highlight ? 'font-black text-status-track' : 'text-me-charcoal'} ${multiline ? 'whitespace-pre-wrap' : ''}`}>
        {value}
      </dd>
    </div>
  )
}
