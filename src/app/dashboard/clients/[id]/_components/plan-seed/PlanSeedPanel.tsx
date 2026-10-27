'use client'

import { useEffect, useState } from 'react'
import { PLAY_CATALOG } from '@/lib/ads-strategy/play-vocabulary'
import { formatMinor } from '@/lib/ads-strategy/plan-seed/format'
import type { AudienceState, CreativeState, PlanSeed, PlanSeedStep } from '@/lib/ads-strategy/plan-seed/types'

type Field<T> =
  | { ok: true; value: T; basis: { label: string; value: string; source: string; as_of: string | null }[]; notes: string[] }
  | { ok: false; why_empty: string; notes: string[] }

type PanelState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'empty'; reason: string }
  | { kind: 'ready'; seed: PlanSeed }

type Props = { clientId: string; prescriptionId: string | null }

const FALLBACK_REASON = '这份处方没有填广告打法'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isPlanSeed(v: unknown): v is PlanSeed {
  if (!isRecord(v)) return false
  if (v.schema_version !== 1) return false
  if (v.produced_by !== 'ads-agent') return false
  if (typeof v.facts_as_of !== 'string') return false
  if (!Array.isArray(v.ad_steps)) return false
  if (!Array.isArray(v.skipped)) return false
  if (!Array.isArray(v.notes)) return false
  if (!isRecord(v.captured_at)) return false
  return true
}

function formatNz(iso: string): string {
  const date = new Date(iso)
  const parts = new Intl.DateTimeFormat('en-NZ', {
    timeZone: 'Pacific/Auckland',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? ''
  const month = String(Number(get('month')))
  const day = String(Number(get('day')))
  const hour = get('hour').padStart(2, '0')
  const minute = get('minute').padStart(2, '0')
  return `${month}月${day}日 ${hour}:${minute}`
}

export function describeCapture(capturedAt: string | null, _factsAsOf: string): string {
  const capturedMs = capturedAt === null ? NaN : Date.parse(capturedAt)
  if (Number.isNaN(capturedMs)) {
    return '读不到这个账户最近一次数据抓取的时间，预算建议不可靠，请看依据里的说明'
  }
  return `这个余量是按 ${formatNz(capturedAt as string)} 的数据算的，之后新开的广告没算进去`
}

function FieldRow<T>({
  title,
  field,
  format,
}: {
  title: string
  field: Field<T>
  format: (value: T) => string
}) {
  return (
    <div className="mt-2">
      <div className="text-gray-500">{title}</div>
      {field.ok ? (
        <div>
          <div className="font-semibold">{format(field.value)}</div>
          <div className="mt-1 text-xs text-gray-500">凭什么：</div>
          <ul className="ml-4 list-disc text-xs text-gray-600">
            {field.basis.map((b, i) => (
              <li key={i}>{`${b.label}：${b.value}（来源：${b.source}）`}</li>
            ))}
          </ul>
          {field.notes.map((n, i) => (
            <div key={i} className="text-xs text-gray-500">
              {n}
            </div>
          ))}
        </div>
      ) : (
        <div>
          <div className="text-amber-700">{`没填上：${field.why_empty}`}</div>
          {field.notes.map((n, i) => (
            <div key={i} className="text-xs text-gray-500">
              {n}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const AUDIENCE_STATE_LABEL: Record<AudienceState, string> = { read: '读到', unusable: '读到但不可用', unreadable: '读不到' }
const CREATIVE_STATE_LABEL: Record<CreativeState, string> = {
  ready: '可用', pending_approval: '素材待批', window_mismatch: '推广期对不上', none: '没有素材', unreadable: '读不到',
}

function StepCard({ step, currency }: { step: PlanSeedStep; currency: string | null }) {
  const playLabel = PLAY_CATALOG[step.play].label
  const budgetFormat = (minor: number): string => formatMinor(minor, currency)
  return (
    <div className="mt-4 rounded border border-gray-200 p-3 text-sm">
      <div className="font-semibold">
        {playLabel}
      </div>
      <FieldRow title="主页" field={step.page_id} format={(v) => v} />
      <FieldRow title="广告账户" field={step.ad_account_id} format={(v) => v} />
      <FieldRow title="日预算" field={step.daily_budget_cents} format={budgetFormat} />
      {step.audience_ids && (
        <FieldRow title={`受众（${AUDIENCE_STATE_LABEL[step.audience_state ?? 'unreadable']}）`} field={step.audience_ids} format={(v) => v.join('、')} />
      )}
      {step.excluded_audience_ids && (
        <FieldRow title="排除名单（只引用已有的）" field={step.excluded_audience_ids} format={(v) => v.join('、')} />
      )}
      {step.creative_refs && (
        <FieldRow title={`素材（${CREATIVE_STATE_LABEL[step.creative_state ?? 'unreadable']}）`} field={step.creative_refs} format={(v) => v.join('、')} />
      )}
    </div>
  )
}

function CaptureLines({ seed }: { seed: PlanSeed }) {
  const ids: string[] = []
  for (const step of seed.ad_steps) {
    if (step.ad_account_id.ok && !ids.includes(step.ad_account_id.value)) {
      ids.push(step.ad_account_id.value)
    }
  }
  if (ids.length === 0) return null
  return (
    <div className="mt-4 space-y-1 text-xs text-gray-600">
      {ids.map((id) => (
        <div key={id}>
          {`账户 ${id}：${describeCapture(seed.captured_at[id] ?? null, seed.facts_as_of)}`}
        </div>
      ))}
    </div>
  )
}

/** 预算依据里有「实时读成功」的那条（文案含「这次用」）才算已实时核对；面板不做阈值算术，只看文案标志。 */
function hasLiveBasis(step: PlanSeedStep): boolean {
  const budget = step.daily_budget_cents
  if (!budget.ok) return false
  return budget.basis.some((b) => b.label === '在投合计（实时）' && b.value.includes('这次用'))
}

function ReadyView({ seed }: { seed: PlanSeed }) {
  const showSnapshotLimit = seed.ad_steps.length > 0 && !seed.ad_steps.every(hasLiveBasis)
  return (
    <div>
      {seed.schedule && (
        <FieldRow title="起止日" field={seed.schedule} format={(v) => `${v.start_date} 至 ${v.end_date}`} />
      )}
      <h3 className="mt-4 font-semibold">广告步骤的建议</h3>
      {seed.ad_steps.map((step) => (
        <StepCard key={step.step_key} step={step} currency={seed.currency} />
      ))}
      <CaptureLines seed={seed} />
      {showSnapshotLimit && (
        <p className="mt-4 text-xs text-gray-600">
          读到的在投合计来自最近一次数据抓取，抓取之后新开的广告不在内。
        </p>
      )}
      {seed.skipped.length > 0 && (
        <div className="mt-4">
          <div className="font-semibold">这次没产出的步骤</div>
          <ul className="ml-4 list-disc text-xs text-gray-600">
            {seed.skipped.map((s, i) => (
              <li key={i}>{`${s.step_key}：${s.why_empty}`}</li>
            ))}
          </ul>
        </div>
      )}
      {seed.notes.length > 0 && (
        <div className="mt-4 space-y-1 text-xs text-gray-500">
          {seed.notes.map((n, i) => (
            <div key={i}>{n}</div>
          ))}
        </div>
      )}
    </div>
  )
}

function Header() {
  return (
    <div>
      <p className="text-sm">
        <strong>这些数字只是 Agent 的建议，批准这份处方不等于批准花这些钱</strong>
        ；花钱要在计划页批准计划、在审批页点开广告。
      </p>
      <p className="mt-1 text-xs text-gray-500">
        百分比（占 Goal 总预算）只是记在目标上的分配说明，不会花钱；日预算才是以后真能花出去的数；两者本版不互相校验。
      </p>
    </div>
  )
}

export function PlanSeedPanel({ clientId, prescriptionId }: Props) {
  const [state, setState] = useState<PanelState>({ kind: 'loading' })

  useEffect(() => {
    if (prescriptionId === null) return
    let cancelled = false
    setState({ kind: 'loading' })
    const run = async (): Promise<void> => {
      try {
        const res = await fetch(
          `/api/clients/${clientId}/prescription/${prescriptionId}/plan-seed`,
          { cache: 'no-store' },
        )
        if (!res.ok) {
          if (!cancelled) setState({ kind: 'error' })
          return
        }
        const json: unknown = await res.json()
        if (cancelled) return
        if (!isRecord(json) || json.success !== true) {
          setState({ kind: 'error' })
          return
        }
        const seed = json.seed
        if (seed === null || seed === undefined) {
          const reason = typeof json.reason === 'string' ? json.reason : FALLBACK_REASON
          setState({ kind: 'empty', reason })
          return
        }
        if (!isPlanSeed(seed)) {
          setState({ kind: 'error' })
          return
        }
        setState({ kind: 'ready', seed })
      } catch {
        if (!cancelled) setState({ kind: 'error' })
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [clientId, prescriptionId])

  if (prescriptionId === null) return null

  return (
    <div data-plan-seed-panel="" className="mt-4 rounded border border-gray-200 p-3 text-sm">
      <Header />
      {state.kind === 'loading' && <p className="mt-4 text-gray-500">正在算 Agent 的建议…</p>}
      {state.kind === 'error' && (
        <p className="mt-4 text-amber-700">读不到 Agent 的建议（接口出错），稍后刷新再试</p>
      )}
      {state.kind === 'empty' && <p className="mt-4 text-gray-600">{state.reason}</p>}
      {state.kind === 'ready' && <ReadyView seed={state.seed} />}
    </div>
  )
}
