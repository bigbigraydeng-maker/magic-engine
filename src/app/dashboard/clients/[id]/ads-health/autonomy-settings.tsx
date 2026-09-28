'use client'

/**
 * Autonomy settings — P21.K.5
 *
 * The control panel for the Ad Strategy Engine: daily budget cap, autonomy
 * mode, and the creative pool. Deliberately self-contained (React + fetch
 * only) so it can be dropped into the ads-health page without pulling server
 * imports into a client component.
 *
 * Red-line: if the config read fails we render ONLY the error notice. Empty
 * inputs that look editable would let a save overwrite real values with blanks.
 */

import React, { useEffect, useState } from 'react'
import Link from 'next/link'

type AutonomyMode = 'observe' | 'bounded_auto'

interface CreativePoolEntry {
  kind: string
  ref: string
  status: string
  approved_by?: string | null
}

interface AdStrategyConfig {
  daily_budget_cap_cents: number | null
  autonomy_mode: AutonomyMode
  creative_pool: CreativePoolEntry[]
}

interface ConfigResponse {
  success?: boolean
  config?: AdStrategyConfig
  circuit_breaker_tripped?: boolean
  error?: string
}

// ─── 熔断横幅（WP3 熔断器运行时调用方）───────────────────────────────────────

function CircuitBreakerBanner({
  clientId,
  onReleased,
}: {
  clientId: string
  onReleased: () => void
}) {
  const [releasing, setReleasing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const release = async () => {
    setReleasing(true)
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/ad-strategy-config/release-circuit-breaker`, {
        method: 'POST',
      })
      const json = (await res.json()) as { success?: boolean; error?: string }
      if (!res.ok || !json.success) throw new Error(json.error ?? `HTTP ${res.status}`)
      onReleased()
    } catch (err) {
      setError(err instanceof Error ? err.message : '解除失败')
    } finally {
      setReleasing(false)
    }
  }

  return (
    <div className="mb-4 rounded-xl border border-red-200 bg-red-50 p-4">
      <p className="text-sm font-medium text-red-800">🔴 熔断已触发</p>
      <p className="mt-1 text-xs text-red-700">
        当日实际花费合计超过 7 天中位数的 3 倍，系统已自动把全部广告动作切到「禁止」档位，不再动钱。
        先到 Meta Ads Manager 核实花费是否正常，确认没问题后再点下面按钮解除。
      </p>
      <button
        type="button"
        disabled={releasing}
        onClick={release}
        className="mt-2 rounded-lg border border-red-300 bg-white px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
      >
        {releasing ? '解除中…' : '解除熔断'}
      </button>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}

// ─── Sub-components (each kept small and single-purpose) ──────────────────────

function CapField({
  draftCap,
  currentCap,
  onChange,
}: {
  draftCap: string
  currentCap: number | null
  onChange: (v: string) => void
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700">日预算上限</label>
      <div className="mt-1.5 flex items-center gap-2">
        <input
          type="number"
          min={1}
          value={draftCap}
          onChange={e => onChange(e.target.value)}
          placeholder="未设"
          className="w-40 rounded-lg border border-gray-300 px-3 py-1.5 text-sm tabular-nums text-gray-800 focus:border-gray-400 focus:outline-none"
        />
        <span className="text-xs text-gray-400">分（账户币种）</span>
      </div>
      <p className="mt-1 text-xs text-gray-400">留空 = 未设 → 系统只巡察不动钱</p>
      <p className="mt-0.5 text-xs text-gray-400">
        当前：<span className="tabular-nums text-gray-600">{currentCap ?? '未设'}</span>
      </p>
    </div>
  )
}

function ModeField({
  draftMode,
  capUnset,
  onChange,
}: {
  draftMode: AutonomyMode
  capUnset: boolean
  onChange: (m: AutonomyMode) => void
}) {
  return (
    <div>
      <span className="block text-sm font-medium text-gray-700">自治模式</span>
      <div className="mt-1.5 space-y-1.5">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input
            type="radio"
            name="autonomy_mode"
            checked={draftMode === 'observe'}
            onChange={() => onChange('observe')}
            className="accent-me-ochre"
          />
          只巡察不动钱
        </label>
        <label className={`flex items-center gap-2 text-sm ${capUnset ? 'text-gray-400' : 'text-gray-700'}`}>
          <input
            type="radio"
            name="autonomy_mode"
            disabled={capUnset}
            checked={draftMode === 'bounded_auto'}
            onChange={() => onChange('bounded_auto')}
            className="accent-me-ochre"
          />
          信封内自动执行 — 需要日预算上限已设
        </label>
      </div>
    </div>
  )
}

function CreativePoolList({
  clientId,
  entries,
  onApproved,
}: {
  clientId: string
  entries: CreativePoolEntry[]
  onApproved: (config: AdStrategyConfig) => void
}) {
  const [busyRef, setBusyRef] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const approve = async (ref: string) => {
    setBusyRef(ref)
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/ad-strategy-config/creative-pool/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref }),
      })
      const json = (await res.json()) as ConfigResponse
      if (!res.ok || !json.config) throw new Error(json.error ?? `HTTP ${res.status}`)
      onApproved(json.config)
    } catch (err) {
      setError(err instanceof Error ? err.message : '批准失败')
    } finally {
      setBusyRef(null)
    }
  }

  if (entries.length === 0) {
    return <p className="text-xs text-gray-400">素材池还是空的。</p>
  }

  return (
    <div className="space-y-1.5">
      {entries.map(e => (
        <div key={`${e.kind}:${e.ref}`} className="flex items-center justify-between gap-3 text-sm">
          <span className="min-w-0 truncate text-gray-600">
            {e.kind} · <span className="tabular-nums">{e.ref}</span> ·{' '}
            <span className={e.status === 'approved' ? 'text-emerald-600' : 'text-gray-400'}>
              {e.status === 'approved' ? `已批准 by ${e.approved_by ?? '—'}` : '候选'}
            </span>
          </span>
          {e.status !== 'approved' && (
            <button
              type="button"
              disabled={busyRef !== null}
              onClick={() => approve(e.ref)}
              className="shrink-0 rounded-lg border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            >
              {busyRef === e.ref ? '批准中…' : '批准'}
            </button>
          )}
        </div>
      ))}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function AutonomySettings({ clientId }: { clientId: string }) {
  const [config, setConfig] = useState<AdStrategyConfig | null>(null)
  const [circuitTripped, setCircuitTripped] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [draftCap, setDraftCap] = useState('')
  const [draftMode, setDraftMode] = useState<AutonomyMode>('observe')
  const [draftRefs, setDraftRefs] = useState('')

  const applyConfig = (c: AdStrategyConfig) => {
    setConfig(c)
    setDraftCap(c.daily_budget_cap_cents == null ? '' : String(c.daily_budget_cap_cents))
    setDraftMode(c.autonomy_mode)
  }

  const load = async () => {
    try {
      const res = await fetch(`/api/clients/${clientId}/ad-strategy-config`)
      const json = (await res.json()) as ConfigResponse
      if (!res.ok || !json.config) throw new Error(json.error ?? `HTTP ${res.status}`)
      applyConfig(json.config)
      setCircuitTripped(json.circuit_breaker_tripped === true)
    } catch {
      setLoadError('读不到广告自治配置，稍后再试')
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])

  if (loadError) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        {loadError}
      </div>
    )
  }

  if (!config) {
    return <div className="text-sm text-gray-400 py-4">加载中…</div>
  }

  const capUnset = draftCap.trim() === '' && config.daily_budget_cap_cents == null
  const newRefs = draftRefs.split('\n').map(r => r.trim()).filter(Boolean)

  const save = async () => {
    setSaving(true)
    setMessage(null)
    try {
      const body: Record<string, unknown> = {}

      const parsedCap = draftCap.trim() === '' ? null : parseInt(draftCap, 10)
      if (parsedCap !== config.daily_budget_cap_cents) body.daily_budget_cap_cents = parsedCap
      if (draftMode !== config.autonomy_mode) body.autonomy_mode = draftMode

      // Only touch the pool when new candidates are being submitted. The PATCH
      // route REPLACES the pool, so sending it back would demote approvals —
      // the warning under the textarea tells the user this is the v1 behaviour.
      if (newRefs.length > 0) {
        body.creative_pool = [
          ...config.creative_pool.map(e => ({ kind: e.kind, ref: e.ref, status: 'candidate' })),
          ...newRefs.map(ref => ({ kind: 'meta_video', ref, status: 'candidate' })),
        ]
      }

      if (Object.keys(body).length === 0) {
        setMessage('没有改动')
        return
      }

      const res = await fetch(`/api/clients/${clientId}/ad-strategy-config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = (await res.json()) as ConfigResponse
      if (!res.ok || !json.config) throw new Error(json.error ?? `HTTP ${res.status}`)

      applyConfig(json.config)
      setDraftRefs('')
      setMessage('已保存')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5">
      {circuitTripped && (
        <CircuitBreakerBanner clientId={clientId} onReleased={() => { setCircuitTripped(false); void load() }} />
      )}
      <h2 className="text-sm font-semibold text-gray-800">目标 · 日预算上限 · 素材池</h2>

      <div className="mt-4 space-y-5">
        <div>
          <span className="block text-sm font-medium text-gray-700">目标</span>
          <p className="mt-1 text-xs text-gray-500">目标在「目标」页设置，日报第一行会显示进度</p>
          <Link
            href={`/dashboard/clients/${clientId}/goals/history`}
            className="mt-1 inline-block text-xs text-gray-500 hover:text-gray-700"
          >
            去看目标 →
          </Link>
        </div>

        <CapField draftCap={draftCap} currentCap={config.daily_budget_cap_cents} onChange={setDraftCap} />

        <ModeField draftMode={draftMode} capUnset={capUnset} onChange={setDraftMode} />

        <div>
          <span className="block text-sm font-medium text-gray-700">素材池</span>
          <div className="mt-1.5">
            <CreativePoolList clientId={clientId} entries={config.creative_pool} onApproved={applyConfig} />
          </div>
          <textarea
            value={draftRefs}
            onChange={e => setDraftRefs(e.target.value)}
            rows={3}
            placeholder="提报候选（每行一个 Meta 视频 ID 或 work order ID）"
            className="mt-2 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-800 focus:border-gray-400 focus:outline-none"
          />
          <p className="mt-1 text-xs text-amber-700">
            提报新候选会把整个素材池重设为候选状态，已批准的需要重新批准
          </p>
        </div>
      </div>

      <div className="mt-5 flex items-center gap-3">
        <button
          type="button"
          disabled={saving}
          onClick={save}
          className="rounded-lg bg-gray-800 px-3 py-1.5 text-sm text-white hover:bg-gray-700 disabled:opacity-50"
        >
          {saving ? '保存中…' : '保存'}
        </button>
        {message && <span className="text-xs text-gray-500">{message}</span>}
      </div>
    </div>
  )
}
