'use client'

/**
 * Phase 31 M2 — Goal 设定 4 步向导
 * URL: /dashboard/clients/[id]/goal/new
 *
 * Step 1: Intent (acquisition / sales / awareness)
 * Step 2: Primary metric (按 intent 推荐)
 * Step 3: Period + Budget + FDE reasoning
 * Step 4: Confirm + Save as draft
 *
 * Saved as draft only — FDE 后续在 Goal 看板点 "Activate" 才正式启动。
 */

import { useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import {
  PRIMARY_METRIC_CATALOG,
  type GoalIntent,
  type AwarenessSubtype,
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
    description: '老板想要更多营收 / 订单 / 客单价' },
  { value: 'awareness',   emoji: '📢', title: '品牌曝光 Awareness',
    description: '老板想要更多市场认知（新进入 / 活动推广）' },
]

const AWARENESS_SUBTYPES: Array<{ value: AwarenessSubtype; label: string }> = [
  { value: 'new_market',           label: '新品牌进入（如中国车企进 NZ）' },
  { value: 'event_campaign',       label: '活动推广（如商品博览会）' },
  { value: 'geographic_expansion', label: '地理扩张（如 Christchurch 拓 Auckland）' },
  { value: 'reputation_recovery',  label: '口碑修复（占位）' },
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
  const [awarenessSubtype, setAwarenessSubtype] = useState<AwarenessSubtype | null>(null)
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

  // ── Filter metrics by chosen intent ────────────────────────────────────────
  const recommendedMetrics = intent
    ? PRIMARY_METRIC_CATALOG.filter(m => m.recommended_for.includes(intent))
    : []

  // ── Validation per step ────────────────────────────────────────────────────
  const canProceed1 = !!intent && !!title.trim() && (intent !== 'awareness' || !!awarenessSubtype)
  const canProceed2 = !!selectedMetric && baselineValue !== '' && targetValue !== '' && baselineValue !== targetValue
  const canProceed3 = !!periodStart && !!periodEnd && new Date(periodEnd) > new Date(periodStart)

  // ── Submit handler ─────────────────────────────────────────────────────────
  async function handleSubmit() {
    if (!intent || !selectedMetric) return
    setSaving(true)
    setError('')

    const payload: CreateGoalInput = {
      intent,
      awareness_subtype: intent === 'awareness' ? awarenessSubtype ?? undefined : undefined,
      title: title.trim(),
      primary_metric_key: selectedMetric.key,
      primary_metric_label: selectedMetric.label_zh,
      primary_metric_unit: selectedMetric.unit,
      baseline_value: parseFloat(baselineValue),
      target_value: parseFloat(targetValue),
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
              Phase 31 · 4-step wizard to set a 90-day client goal.
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
                {['Intent', 'Metric', 'Period & Budget', 'Confirm'][i]}
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

        {/* Step 1: Intent */}
        {step === 1 && (
          <div className="space-y-6 rounded-xl border border-black/10 bg-white p-6 shadow-sm">
            <div>
              <h2 className="font-display text-base font-bold text-me-charcoal">Step 1 · 选择客户意图</h2>
              <p className="mt-1 text-xs font-semibold text-me-charcoal/55">老板找我们的根本目的是什么？</p>
            </div>

            <div className="grid grid-cols-1 gap-3">
              {INTENT_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setIntent(opt.value)}
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

            {intent === 'awareness' && (
              <div className="space-y-2 border-t border-black/10 pt-4">
                <label className="text-xs font-black uppercase tracking-wide text-me-charcoal/55">Awareness 子类型</label>
                <select
                  value={awarenessSubtype ?? ''}
                  onChange={e => setAwarenessSubtype(e.target.value as AwarenessSubtype)}
                  className="w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm font-semibold text-me-charcoal focus:border-me-ochre focus:outline-none"
                >
                  <option value="">— 选择子类型 —</option>
                  {AWARENESS_SUBTYPES.map(s => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-xs font-black uppercase tracking-wide text-me-charcoal/55">Goal 标题 (FDE 起名)</label>
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="e.g. CTS 2026 Q3 Sales +50%"
                className="w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm font-semibold text-me-charcoal placeholder:text-me-taupe focus:border-me-ochre focus:outline-none"
              />
            </div>
          </div>
        )}

        {/* Step 2: Primary metric */}
        {step === 2 && (
          <div className="space-y-6 rounded-xl border border-black/10 bg-white p-6 shadow-sm">
            <div>
              <h2 className="font-display text-base font-bold text-me-charcoal">Step 2 · 选择主指标</h2>
              <p className="mt-1 text-xs font-semibold text-me-charcoal/55">这个数字决定 90 天后 Goal 是否达成。</p>
            </div>

            <div className="space-y-2">
              {recommendedMetrics.map(m => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setSelectedMetric(m)}
                  className={`w-full rounded-lg border px-4 py-3 text-left transition-all ${
                    selectedMetric?.key === m.key
                      ? 'border-me-ochre bg-me-ochre/10'
                      : 'border-black/10 hover:border-me-ochre/40 hover:bg-me-ivory'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-black text-me-charcoal">{m.label_zh}</div>
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
              <div className="grid grid-cols-2 gap-4 border-t border-black/10 pt-4">
                <div className="space-y-2">
                  <label className="text-xs font-black uppercase tracking-wide text-me-charcoal/55">Baseline (当前)</label>
                  <input
                    type="number"
                    value={baselineValue}
                    onChange={e => setBaselineValue(e.target.value)}
                    placeholder="e.g. 80000"
                    className="w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm font-semibold text-me-charcoal placeholder:text-me-taupe focus:border-me-ochre focus:outline-none"
                  />
                  <p className="text-[11px] font-semibold text-me-charcoal/45">单位: {selectedMetric.unit}</p>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-black uppercase tracking-wide text-me-charcoal/55">Target (90 天后)</label>
                  <input
                    type="number"
                    value={targetValue}
                    onChange={e => setTargetValue(e.target.value)}
                    placeholder="e.g. 120000"
                    className="w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm font-semibold text-me-charcoal placeholder:text-me-taupe focus:border-me-ochre focus:outline-none"
                  />
                  {baselineValue && targetValue && (
                    <p className="text-[11px] font-bold text-status-track">
                      {((parseFloat(targetValue) / parseFloat(baselineValue) - 1) * 100).toFixed(0)}% growth
                    </p>
                  )}
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
              <p className="mt-1 text-xs font-semibold text-me-charcoal/55">90 天为推荐周期，awareness 可以倒计时到目标日。</p>
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
                placeholder="e.g. CTS 老板今年想拿下中国春节档，主要靠老客户复购+Wendy Wu 同源词抢量..."
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
              {awarenessSubtype && (
                <Row label="Subtype" value={AWARENESS_SUBTYPES.find(s => s.value === awarenessSubtype)?.label ?? ''} />
              )}
              <Row label="Title" value={title} />
              <Row label="Primary Metric" value={`${selectedMetric?.label_zh} (${selectedMetric?.unit})`} />
              <Row label="Baseline → Target" value={`${baselineValue} → ${targetValue}`} highlight />
              <Row label="Period" value={`${periodStart} → ${periodEnd}`} />
              {budgetAmount && <Row label="Budget" value={`${budgetCurrency} ${parseFloat(budgetAmount).toLocaleString()}`} />}
              {fdeReasoning && <Row label="FDE Reasoning" value={fdeReasoning} multiline />}
            </dl>

            <p className="border-t border-black/10 pt-4 text-xs font-semibold text-me-charcoal/55">
              Goal 会先以 <strong className="text-me-charcoal">draft</strong> 状态保存。下一步在 Goal 看板配 Initiative，准备好后再 <strong className="text-me-charcoal">Activate</strong>。
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
