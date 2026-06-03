'use client'

/**
 * Phase 31 M3 — Initiative 配置弹窗
 *
 * 用于新建和编辑 initiative。
 *   • 新建：editing=null
 *   • 编辑：editing=existing row
 *
 * 包含诸葛亮 (Sonnet) 润色 hypothesis 的按钮 — 必须先保存 initiative 才能润色
 * （因为润色需要 initiative_id 来读上下文）。新建时按钮 disabled，
 * 提示用户"先保存草稿，再润色"。
 */

import { useState } from 'react'
import type {
  InitiativeRow,
  InitiativeType,
  InitiativePosture,
  GoalRow,
} from '@/types/strategy'
import { INITIATIVE_TYPE_LABEL, INITIATIVE_TYPE_TIER } from '@/types/strategy'

const POSTURE_OPTIONS: Array<{ value: InitiativePosture; label: string; emoji: string; description: string }> = [
  { value: 'offensive', emoji: '⚔️',  label: 'Offensive 攻击', description: '抢竞品份额 / 抢新市场' },
  { value: 'defensive', emoji: '🛡️', label: 'Defensive 防守', description: '守住现有地位 / 应对竞品反扑' },
  { value: 'fast',      emoji: '⚡',  label: 'Fast 速胜',      description: '30-60 天见效，热点驱动' },
  { value: 'slow',      emoji: '🌱', label: 'Slow 长跑',      description: '内容沉淀 / SEO / 品牌长期' },
]

interface Props {
  goal: GoalRow
  initiative: InitiativeRow | null   // null = create new
  terminals: InitiativeRow[]          // for supporting → supports_initiative_id picker
  remainingBudgetPct: number
  availableTypes: InitiativeType[]
  onClose: () => void
  onSaved: () => void
}

export function InitiativeFormDrawer({
  goal, initiative, terminals, remainingBudgetPct, availableTypes, onClose, onSaved,
}: Props) {
  const editing = !!initiative

  const [type, setType] = useState<InitiativeType>(initiative?.initiative_type ?? 'demand_generation')
  const [title, setTitle] = useState(initiative?.title ?? '')
  const [posture, setPosture] = useState<InitiativePosture | ''>(initiative?.posture ?? '')
  const [budgetPct, setBudgetPct] = useState<string>(initiative?.budget_percent?.toString() ?? '')
  const [hypothesis, setHypothesis] = useState(initiative?.hypothesis ?? '')
  const [supportsId, setSupportsId] = useState(initiative?.supports_initiative_id ?? '')

  const [saving, setSaving] = useState(false)
  const [polishing, setPolishing] = useState(false)
  const [error, setError] = useState('')

  const tier = INITIATIVE_TYPE_TIER[type]
  const isSupporting = tier === 'supporting'

  async function handleSave() {
    setSaving(true)
    setError('')

    const body: Record<string, unknown> = {
      title: title.trim(),
      posture: posture || null,
      budget_percent: budgetPct ? parseFloat(budgetPct) : null,
      hypothesis: hypothesis.trim() || null,
      supports_initiative_id: supportsId || null,
    }

    try {
      let res: Response
      if (editing) {
        res = await fetch(`/api/initiatives/${initiative!.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      } else {
        res = await fetch(`/api/goals/${goal.id}/initiatives`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...body, initiative_type: type }),
        })
      }
      if (!res.ok) {
        const j = await res.json()
        setError(j.error ?? 'Save failed')
        return
      }
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  async function handlePolish() {
    if (!editing || !initiative) return
    if (!hypothesis.trim()) {
      setError('Write a rough hypothesis first, then let 诸葛亮 polish it.')
      return
    }
    setPolishing(true)
    setError('')
    try {
      const res = await fetch(`/api/initiatives/${initiative.id}/polish-hypothesis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawHypothesis: hypothesis }),
      })
      if (!res.ok) {
        const j = await res.json()
        setError(`诸葛亮润色失败：${j.error}`)
        return
      }
      const j = await res.json()
      setHypothesis(j.polished)

      // Auto-mark hypothesis_polished_by_ai after adopting
      await fetch(`/api/initiatives/${initiative.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hypothesis: j.polished, hypothesis_polished_by_ai: true }),
      })
    } finally {
      setPolishing(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div
        className="h-full w-full max-w-2xl overflow-y-auto border-l border-black/10 bg-white shadow-card"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-black/10 bg-white px-6 py-4">
          <div>
            <h2 className="font-display text-base font-bold text-me-charcoal">
              {editing ? 'Edit Initiative' : 'Add Initiative'}
            </h2>
            <p className="mt-0.5 text-xs font-semibold text-me-charcoal/55">
              Under Goal: <span className="font-bold text-me-charcoal/75">{goal.title}</span>
            </p>
          </div>
          <button onClick={onClose} className="text-xl text-me-charcoal/55 hover:text-me-charcoal">×</button>
        </div>

        <div className="space-y-6 p-6">
          {/* Initiative Type */}
          <div className="space-y-2">
            <label className="text-xs font-black uppercase tracking-wide text-me-charcoal/55">Type</label>
            {editing ? (
              <p className="text-sm font-semibold text-me-charcoal/80">
                {INITIATIVE_TYPE_LABEL[type]?.zh} · {INITIATIVE_TYPE_LABEL[type]?.en}
                <span className="ml-2 text-xs font-semibold text-me-charcoal/45">(cannot change after creation — archive and recreate instead)</span>
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-2">
                {availableTypes.map(t => {
                  const label = INITIATIVE_TYPE_LABEL[t]
                  const tierBadge = INITIATIVE_TYPE_TIER[t]
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setType(t)}
                      className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                        type === t
                          ? 'border-me-ochre bg-me-ochre/10'
                          : 'border-black/10 hover:border-me-ochre/40 hover:bg-me-ivory'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-black text-me-charcoal">{label?.zh}</span>
                        <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                          tierBadge === 'terminal' ? 'bg-me-ochre/15 text-me-ochre' : 'bg-status-sched/15 text-status-sched'
                        }`}>
                          {tierBadge}
                        </span>
                      </div>
                      <div className="mt-0.5 text-xs font-semibold text-me-charcoal/55">{label?.description}</div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Supports (only for supporting initiatives) */}
          {isSupporting && (
            <div className="space-y-2">
              <label className="text-xs font-black uppercase tracking-wide text-me-charcoal/55">
                Supports Terminal Initiative <span className="text-status-rej">*</span>
              </label>
              <select
                value={supportsId}
                onChange={e => setSupportsId(e.target.value)}
                className="w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm font-semibold text-me-charcoal focus:border-me-ochre focus:outline-none"
              >
                <option value="">— Select which terminal this supports —</option>
                {terminals.filter(t => !initiative || t.id !== initiative.id).map(t => (
                  <option key={t.id} value={t.id}>{t.title}</option>
                ))}
              </select>
              <p className="text-[11px] font-semibold text-me-charcoal/55">
                Supporting initiative 是弹药库 — 它的成果会喂给一个 terminal，不直接驱动 Goal verdict。
              </p>
            </div>
          )}

          {/* Title */}
          <div className="space-y-2">
            <label className="text-xs font-black uppercase tracking-wide text-me-charcoal/55">Title</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Meta Ads 抢 Wendy Wu 同源词"
              className="w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm font-semibold text-me-charcoal placeholder:text-me-taupe focus:border-me-ochre focus:outline-none"
            />
          </div>

          {/* Posture */}
          <div className="space-y-2">
            <label className="text-xs font-black uppercase tracking-wide text-me-charcoal/55">Posture 战术姿态</label>
            <div className="grid grid-cols-2 gap-2">
              {POSTURE_OPTIONS.map(p => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setPosture(p.value === posture ? '' : p.value)}
                  className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                    posture === p.value
                      ? 'border-me-ochre bg-me-ochre/10'
                      : 'border-black/10 hover:border-me-ochre/40 hover:bg-me-ivory'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span>{p.emoji}</span>
                    <span className="text-sm font-black text-me-charcoal">{p.label}</span>
                  </div>
                  <div className="mt-0.5 text-[11px] font-semibold text-me-charcoal/55">{p.description}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Budget */}
          <div className="space-y-2">
            <label className="text-xs font-black uppercase tracking-wide text-me-charcoal/55">
              Budget % of Goal · 剩余 {remainingBudgetPct.toFixed(0)}%
            </label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min="0"
                max={remainingBudgetPct}
                value={budgetPct}
                onChange={e => setBudgetPct(e.target.value)}
                placeholder="e.g. 30"
                className="w-32 rounded-lg border border-black/15 bg-white px-3 py-2 text-sm font-semibold text-me-charcoal placeholder:text-me-taupe focus:border-me-ochre focus:outline-none"
              />
              <span className="text-sm font-semibold text-me-charcoal/55">%</span>
              {budgetPct && goal.budget_amount != null && (
                <span className="text-xs font-semibold text-me-charcoal/55">
                  ≈ {goal.budget_currency} {Math.round(goal.budget_amount * parseFloat(budgetPct) / 100).toLocaleString()}
                </span>
              )}
            </div>
          </div>

          {/* Hypothesis + AI polish */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-black uppercase tracking-wide text-me-charcoal/55">
                Hypothesis · 为什么押这一条
              </label>
              {/* B6 fix: polish button with hover tooltip explaining disable reason */}
              <PolishButton
                editing={editing}
                polishing={polishing}
                hypothesisEmpty={!hypothesis.trim()}
                onClick={handlePolish}
              />
            </div>
            <textarea
              value={hypothesis}
              onChange={e => setHypothesis(e.target.value)}
              rows={8}
              placeholder="e.g. 因为 CTS 已经在 china tour nz 拿到第 4 名，Wendy Wu 第 1，预期投 Meta 广告抢 retargeting + 中文落地页 60 天内把转化率 +30%..."
              className="w-full resize-none rounded-lg border border-black/15 bg-white px-3 py-2 font-mono text-sm leading-relaxed text-me-charcoal placeholder:text-me-taupe focus:border-me-ochre focus:outline-none"
            />
            <p className="text-[11px] font-semibold text-me-charcoal/55">
              90 天后归因看 hypothesis 是否被验证 — 写得越具体越能学到东西。
              {!editing && <span className="mt-1 block font-bold text-me-ochre">先保存草稿，再用诸葛亮润色（润色需要 initiative 上下文）。</span>}
            </p>
          </div>

          {error && (
            <div className="rounded-xl border border-status-rej/30 bg-status-rej/10 px-4 py-2 text-sm font-semibold text-status-rej">
              {error}
            </div>
          )}

          {/* Footer actions */}
          <div className="flex justify-end gap-2 border-t border-black/10 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-black text-me-charcoal/55 hover:text-me-charcoal"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !title.trim() || (isSupporting && !supportsId)}
              className="rounded-lg bg-me-ochre px-6 py-2 text-sm font-black text-white transition-colors hover:bg-me-ochre/90 disabled:cursor-not-allowed disabled:opacity-30"
            >
              {saving ? 'Saving…' : editing ? 'Save' : 'Create Initiative'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── B6 fix: polish button with hover tooltip ────────────────────────────────
// When disabled, hover shows a clear reason instead of relying on the
// browser's native title attribute (which has a 1-2s delay + bland styling).

function PolishButton({
  editing, polishing, hypothesisEmpty, onClick,
}: {
  editing: boolean
  polishing: boolean
  hypothesisEmpty: boolean
  onClick: () => void
}) {
  const disabled = !editing || polishing || hypothesisEmpty

  // Disable reason — first match wins
  const disableReason =
    polishing ? null  // no tooltip during polishing
    : !editing ? '先点 Create Initiative 保存草稿，诸葛亮才能读 initiative 上下文做润色'
    : hypothesisEmpty ? '先在下方写一段粗糙的 hypothesis，再让诸葛亮润色'
    : null

  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="rounded-md bg-me-ochre/90 px-3 py-1 text-xs font-black text-white transition-colors hover:bg-me-ochre disabled:cursor-not-allowed disabled:opacity-30"
      >
        {polishing ? '诸葛亮润色中…' : '🪄 让诸葛亮润色'}
      </button>

      {/* Hover tooltip — shows instantly on hover/focus when button is disabled */}
      {disableReason && (
        <div className="pointer-events-none absolute right-0 top-full z-20 mt-1.5 w-64 rounded-lg border border-black/15 bg-me-charcoal px-3 py-2 text-[11px] font-semibold leading-relaxed text-white opacity-0 shadow-card transition-opacity duration-150 group-hover:opacity-100">
          <div className="font-black uppercase tracking-wide text-me-ochre/90 text-[9px] mb-1">为什么按钮灰着？</div>
          {disableReason}
          {/* Arrow */}
          <div className="absolute -top-1 right-4 h-2 w-2 rotate-45 border-l border-t border-black/15 bg-me-charcoal"></div>
        </div>
      )}
    </div>
  )
}
