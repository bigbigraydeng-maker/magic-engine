'use client'

/**
 * Per-client ad-send settings. Plain labels, no raw JSON.
 * Saved through the existing leads-config endpoint. An empty choice
 * clears the key and keeps today's behaviour.
 */

import { useCallback, useEffect, useState } from 'react'

type Milestone = '' | 'deposit' | 'balance'

interface StageOption {
  stageKey: string
  label: string
}

interface CapiConfig {
  capiAllowedEvents: string[] | null
  capiAllowedEventsMalformed: boolean
  capiDealMilestone: 'deposit' | 'balance' | null
  capiDealMilestoneMalformed: boolean
  capiQualifiedLeadStageKey: string | null
  capiQualifiedLeadStageMalformed: boolean
  capiDealStageKey: string | null
  capiDealStageKeyMalformed: boolean
}

interface Draft {
  milestone: Milestone
  qualifiedStage: string
  dealStage: string
}

const selectClass =
  'mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-800 focus:border-cyan-500 focus:outline-none'

export function CapiSendSettings({ clientId }: { clientId: string }) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [stages, setStages] = useState<StageOption[]>([])
  const [stagesLoaded, setStagesLoaded] = useState(false)
  const [warnings, setWarnings] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  const load = useCallback(async () => {
    setErr(null)
    const [configRes, stageRes] = await Promise.all([
      fetch(`/api/clients/${clientId}/leads-config`),
      fetch(`/api/clients/${clientId}/pipeline-stages`),
    ])
    const configJson = (await configRes.json()) as { config?: CapiConfig; error?: string }
    if (!configRes.ok) throw new Error(configJson.error ?? '加载失败')
    const stageJson = (await stageRes.json()) as { stages?: StageOption[]; error?: string }
    setStages(stageRes.ok ? (stageJson.stages ?? []) : [])
    setStagesLoaded(stageRes.ok)
    const cfg = configJson.config
    setWarnings(warningsFor(cfg))
    setDraft(draftFrom(cfg))
  }, [clientId])

  useEffect(() => {
    void load().catch((e: unknown) => setErr(e instanceof Error ? e.message : '加载失败'))
  }, [load])

  const save = async () => {
    if (!draft) return
    setSaving(true)
    setErr(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/leads-config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloadFrom(draft)),
      })
      const json = (await res.json()) as { config?: CapiConfig; error?: string }
      if (!res.ok) throw new Error(json.error ?? '保存失败')
      setWarnings(warningsFor(json.config))
      setDraft(draftFrom(json.config))
      setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }))
    } catch (e) {
      setErr(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  if (!draft && !err) return <p className="text-sm text-slate-400">加载中...</p>
  if (!draft) return <p className="text-sm text-red-600">⚠ {err}</p>

  return (
    <CapiForm
      clientId={clientId}
      draft={draft}
      stages={stages}
      stagesLoaded={stagesLoaded}
      warnings={warnings}
      saving={saving}
      err={err}
      savedAt={savedAt}
      onChange={setDraft}
      onSave={() => void save()}
    />
  )
}

function CapiForm(props: {
  clientId: string
  draft: Draft
  stages: StageOption[]
  stagesLoaded: boolean
  warnings: string[]
  saving: boolean
  err: string | null
  savedAt: string | null
  onChange: (d: Draft) => void
  onSave: () => void
}) {
  const { draft } = props
  return (
    <div className="space-y-4">
      <MilestoneField draft={draft} saving={props.saving} onChange={props.onChange} />
      <StageField
        id={`capi-qualified-${props.clientId}`}
        label="哪一步算合格咨询"
        hint="只是先记下来。现在还不会因为走到这一步就发给广告平台。"
        value={draft.qualifiedStage}
        stages={props.stages}
        stagesLoaded={props.stagesLoaded}
        disabled={props.saving}
        onChange={(qualifiedStage) => props.onChange({ ...draft, qualifiedStage })}
      />
      <StageField
        id={`capi-deal-stage-${props.clientId}`}
        label="哪一步可以手录成交金额"
        hint="没有行程价目表的客户，在客人详情里把人标到这一步时，可以手填金额。不选就不会弹出。"
        value={draft.dealStage}
        stages={props.stages}
        stagesLoaded={props.stagesLoaded}
        disabled={props.saving}
        onChange={(dealStage) => props.onChange({ ...draft, dealStage })}
      />
      {props.warnings.map((line) => (
        <p key={line} className="text-xs text-amber-700">{line}</p>
      ))}
      {props.err && <p className="text-xs text-red-600">⚠ {props.err}</p>}
      {!props.err && props.savedAt && <p className="text-xs text-emerald-600">✓ 已保存（{props.savedAt}）</p>}
      <button
        type="button"
        disabled={props.saving}
        onClick={props.onSave}
        className="rounded-lg bg-cyan-600 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
      >
        保存
      </button>
    </div>
  )
}

function MilestoneField({ draft, saving, onChange }: { draft: Draft; saving: boolean; onChange: (d: Draft) => void }) {
  return (
    <label className="block text-sm font-bold text-slate-800">
      哪一笔记成成交
      <p className="mt-1 text-xs font-normal leading-relaxed text-slate-500">
        员工在订单里把这一笔记成已付之后，记一笔等审核的成交。不选就不会自动记。
      </p>
      <select
        className={selectClass}
        disabled={saving}
        value={draft.milestone}
        onChange={(e) => onChange({ ...draft, milestone: e.target.value as Milestone })}
      >
        <option value="">不自动记</option>
        <option value="deposit">定金</option>
        <option value="balance">尾款</option>
      </select>
    </label>
  )
}

function StageField(props: {
  id: string
  label: string
  hint: string
  value: string
  stages: StageOption[]
  stagesLoaded: boolean
  disabled: boolean
  onChange: (value: string) => void
}) {
  const known = props.stages.some((s) => s.stageKey === props.value)
  const missing = props.stagesLoaded && props.value !== '' && !known
  return (
    <label className="block text-sm font-bold text-slate-800" htmlFor={props.id}>
      {props.label}
      <p className="mt-1 text-xs font-normal leading-relaxed text-slate-500">{props.hint}</p>
      <select
        id={props.id}
        className={selectClass}
        disabled={props.disabled}
        value={missing ? '' : props.value}
        onChange={(e) => props.onChange(e.target.value)}
      >
        <option value="">不指定</option>
        {props.stages.map((s) => (
          <option key={s.stageKey} value={s.stageKey}>{s.label}</option>
        ))}
      </select>
      {missing && (
        <p className="mt-1 text-xs text-amber-700">已保存的那一步现在不在跟进步骤里。选「不指定」再保存才会清掉它。</p>
      )}
    </label>
  )
}

function draftFrom(cfg: CapiConfig | undefined): Draft {
  return {
    milestone: cfg?.capiDealMilestone ?? '',
    qualifiedStage: cfg?.capiQualifiedLeadStageKey ?? '',
    dealStage: cfg?.capiDealStageKey ?? '',
  }
}

function payloadFrom(draft: Draft): Record<string, unknown> {
  return {
    capiDealMilestone: draft.milestone || null,
    capiQualifiedLeadStageKey: draft.qualifiedStage || null,
    capiDealStageKey: draft.dealStage || null,
  }
}

function warningsFor(cfg: CapiConfig | undefined): string[] {
  if (!cfg) return []
  const lines: string[] = []
  if (cfg.capiDealMilestoneMalformed) lines.push('「哪一笔记成成交」之前存坏了。不重选就保存会清掉它，之后不会自动记成交。')
  if (cfg.capiQualifiedLeadStageMalformed) lines.push('「哪一步算合格咨询」之前存坏了，请从跟进步骤里重选。')
  if (cfg.capiDealStageKeyMalformed) lines.push('「哪一步可以手录成交金额」之前存坏了，请从跟进步骤里重选。')
  return lines
}
