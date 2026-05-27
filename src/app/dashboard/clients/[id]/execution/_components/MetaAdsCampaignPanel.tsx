'use client'

import { useEffect, useState } from 'react'
import type { CampaignInsightsRow } from '@/lib/meta/campaign-list'

// ── Grade config ───────────────────────────────────────────────────────────────

const GRADE_STYLE = {
  critical: { bg: 'bg-red-50 border-red-200',    badge: 'bg-red-100 text-red-700',    dot: 'bg-red-500',    label: '亏损' },
  warning:  { bg: 'bg-amber-50 border-amber-200', badge: 'bg-amber-100 text-amber-700', dot: 'bg-amber-400',  label: '注意' },
  healthy:  { bg: 'bg-green-50 border-green-200', badge: 'bg-green-100 text-green-700', dot: 'bg-green-500',  label: '健康' },
} as const

// ── Types ──────────────────────────────────────────────────────────────────────

interface FixResult {
  flywheel_action_id: string
  capped?: boolean
}

type FixPhase = 'idle' | 'confirming' | 'running' | 'done' | 'error'

interface CampaignRowProps {
  row: CampaignInsightsRow
  clientId: string
  onFixed: (campaignId: string, actionId: string) => void
}

// ── CampaignRow ────────────────────────────────────────────────────────────────

function CampaignRow({ row, clientId, onFixed }: CampaignRowProps) {
  const style      = GRADE_STYLE[row.grade]
  const [phase, setPhase]    = useState<FixPhase>('idle')
  const [errorMsg, setError] = useState('')
  const [fixId, setFixId]    = useState('')
  const [capped, setCapped]  = useState(false)

  async function handlePause() {
    setPhase('running')
    setError('')
    try {
      const res = await fetch(`/api/clients/${clientId}/meta-ads/fix`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action:    'pause_campaign',
          entity_id: row.campaign_id,
          expected_metric: 'ads.account.spend',
        }),
      })
      if (!res.ok) {
        const json = await res.json() as { error?: string }
        throw new Error(json.error ?? `HTTP ${res.status}`)
      }
      const json = await res.json() as FixResult
      setFixId(json.flywheel_action_id)
      setCapped(!!json.capped)
      setPhase('done')
      onFixed(row.campaign_id, json.flywheel_action_id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPhase('error')
    }
  }

  async function handleRollback() {
    if (!fixId) return
    setPhase('running')
    try {
      const res = await fetch(`/api/clients/${clientId}/meta-ads/rollback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flywheel_action_id: fixId }),
      })
      if (!res.ok) {
        const json = await res.json() as { error?: string }
        throw new Error(json.error ?? `HTTP ${res.status}`)
      }
      setPhase('idle')
      setFixId('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPhase('error')
    }
  }

  return (
    <div className={`rounded-lg border p-3 ${style.bg}`}>
      <div className="flex items-start gap-3">
        {/* Grade dot */}
        <div className={`mt-1 h-2.5 w-2.5 flex-shrink-0 rounded-full ${style.dot}`} />

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-gray-900 truncate">{row.campaign_name}</span>
            <span className={`text-[11px] px-1.5 py-0.5 rounded font-medium ${style.badge}`}>
              {style.label}
            </span>
            {capped && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700 font-medium">
                出价已上限保护
              </span>
            )}
          </div>
          <div className="mt-1 flex gap-4 text-xs text-gray-500">
            <span>花费 <strong className="text-gray-800">${row.spend.toFixed(0)}</strong></span>
            {row.roas !== null && (
              <span>ROAS <strong className={row.roas < 1 ? 'text-red-600' : row.roas < 2 ? 'text-amber-600' : 'text-green-600'}>{row.roas.toFixed(2)}x</strong></span>
            )}
            {row.conversions !== null && (
              <span>转化 <strong className="text-gray-800">{row.conversions}</strong></span>
            )}
            {row.ctr !== null && (
              <span>CTR <strong className="text-gray-800">{(row.ctr * 100).toFixed(1)}%</strong></span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex-shrink-0 flex items-center gap-2">
          {phase === 'idle' && row.grade !== 'healthy' && (
            <button
              onClick={() => setPhase('confirming')}
              className="text-xs px-2.5 py-1 rounded bg-white border border-red-300 text-red-700 hover:bg-red-50 font-medium transition-colors"
            >
              暂停
            </button>
          )}
          {phase === 'confirming' && (
            <>
              <span className="text-xs text-gray-600">确认暂停？</span>
              <button onClick={handlePause} className="text-xs px-2.5 py-1 rounded bg-red-600 text-white hover:bg-red-700 font-medium transition-colors">
                确认
              </button>
              <button onClick={() => setPhase('idle')} className="text-xs px-2 py-1 rounded text-gray-500 hover:bg-gray-100">
                取消
              </button>
            </>
          )}
          {phase === 'running' && (
            <span className="text-xs text-gray-400 animate-pulse">执行中…</span>
          )}
          {phase === 'done' && (
            <>
              <span className="text-xs text-green-600 font-medium">✓ 已暂停</span>
              <button onClick={handleRollback} className="text-xs px-2 py-1 rounded text-gray-500 border border-gray-200 hover:bg-gray-50">
                撤销
              </button>
            </>
          )}
          {phase === 'error' && (
            <span className="text-xs text-red-600 max-w-[160px] truncate" title={errorMsg}>✗ {errorMsg}</span>
          )}
        </div>
      </div>
    </div>
  )
}

// ── MetaAdsCampaignPanel ───────────────────────────────────────────────────────

interface Props {
  clientId: string
}

export function MetaAdsCampaignPanel({ clientId }: Props) {
  const [campaigns, setCampaigns] = useState<CampaignInsightsRow[]>([])
  const [status, setStatus]       = useState<'loading' | 'loaded' | 'error' | 'unconfigured'>('loading')
  const [errorMsg, setError]      = useState('')
  const [fixedIds, setFixedIds]   = useState<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/meta-ads/campaigns`)
        if (!res.ok) {
          const json = await res.json() as { error?: string }
          if (res.status === 422 || res.status === 424) {
            setStatus('unconfigured')
          } else {
            setError(json.error ?? `HTTP ${res.status}`)
            setStatus('error')
          }
          return
        }
        const json = await res.json() as { campaigns: CampaignInsightsRow[] }
        if (cancelled) return
        setCampaigns(json.campaigns)
        setStatus('loaded')
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e))
          setStatus('error')
        }
      }
    })()
    return () => { cancelled = true }
  }, [clientId])

  function handleFixed(campaignId: string, _actionId: string) {
    setFixedIds(prev => new Set([...prev, campaignId]))
  }

  if (status === 'loading') {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <p className="text-sm text-gray-400 animate-pulse">加载广告活动数据…</p>
      </div>
    )
  }

  if (status === 'unconfigured') {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-4">
        <p className="text-sm text-gray-500">未配置 Meta 广告账号 ID（<code>meta_ad_account_id</code>）或 Meta 系统 Token 未设置。</p>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4">
        <p className="text-sm text-red-600">加载失败：{errorMsg}</p>
      </div>
    )
  }

  const actionable = campaigns.filter(c => c.grade !== 'healthy' && !fixedIds.has(c.campaign_id))
  const rest       = campaigns.filter(c => c.grade === 'healthy' || fixedIds.has(c.campaign_id))

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 bg-gray-50">
        <h3 className="text-sm font-semibold text-gray-800">Meta 广告活动（近 7 天）</h3>
        <div className="flex gap-3 text-xs text-gray-500">
          <span>
            <span className="inline-block w-2 h-2 rounded-full bg-red-500 mr-1 align-middle" />
            亏损 {campaigns.filter(c => c.grade === 'critical').length}
          </span>
          <span>
            <span className="inline-block w-2 h-2 rounded-full bg-amber-400 mr-1 align-middle" />
            注意 {campaigns.filter(c => c.grade === 'warning').length}
          </span>
          <span>
            <span className="inline-block w-2 h-2 rounded-full bg-green-500 mr-1 align-middle" />
            健康 {campaigns.filter(c => c.grade === 'healthy').length}
          </span>
        </div>
      </div>

      <div className="p-3 space-y-2">
        {campaigns.length === 0 && (
          <p className="text-sm text-gray-400 py-4 text-center">近 7 天无广告活动数据。</p>
        )}

        {/* Actionable first */}
        {actionable.map(c => (
          <CampaignRow key={c.campaign_id} row={c} clientId={clientId} onFixed={handleFixed} />
        ))}

        {/* Already fixed */}
        {[...fixedIds].map(id => {
          const c = campaigns.find(x => x.campaign_id === id)
          if (!c) return null
          return (
            <div key={id} className="rounded-lg border border-gray-200 bg-gray-50 p-3 opacity-60">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-gray-500 truncate">{c.campaign_name}</span>
                <span className="text-xs text-green-600 font-medium">✓ 已暂停</span>
              </div>
            </div>
          )
        })}

        {/* Healthy */}
        {rest.filter(c => !fixedIds.has(c.campaign_id)).map(c => (
          <CampaignRow key={c.campaign_id} row={c} clientId={clientId} onFixed={handleFixed} />
        ))}
      </div>
    </div>
  )
}
