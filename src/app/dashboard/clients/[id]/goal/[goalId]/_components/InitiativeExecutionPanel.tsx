'use client'

/**
 * Phase 33 P33.5 + P33.6 — Initiative 关联执行区域
 * Phase 33 M4 / P33.11 — 加 action 完成率 + Campaign 状态分布
 *
 * 嵌入 InitiativeList 的每张卡片展开后显示：
 *   - 已关联 Campaign 列表（带跳转链接）+ Campaign 状态点（active/paused/...）
 *   - action 完成率（completed / (total - skipped)）
 *   - + 关联 Campaign 下拉
 *   - + 生成 Marketing Plan 按钮（打开 PlanGenerator 弹窗，预填 initiative_id + title）
 *
 * Bug fix per 子牙: 之前拉 campaign 用 ?status=active，paused 的 campaign
 * 已关联但不出现在 linkedCampaigns 列表里。改成全状态拉取 + 在 dropdown 处
 * 只用 active 候选作为可关联池。
 */

import { useState, useEffect, useCallback } from 'react'
import type { InitiativeRow } from '@/types/strategy'
import { PlanGenerator } from '@/app/dashboard/clients/[id]/marketing-plan/_components/PlanGenerator'
import type { MarketingPlan } from '@/lib/marketing-plan/types'
import type { InitiativeExecutionSummary } from '@/lib/strategy/initiatives'

interface CampaignLite {
  id: string
  title: string
  status: string
}

interface Props {
  initiative: InitiativeRow
  clientId: string
  /** Phase 33 M4: per-Initiative summary computed at parent level (one fetch). */
  summary?: InitiativeExecutionSummary
  /** Called after campaign_ids or marketing plan changes so parent can refresh */
  onUpdated?: () => void
}

// Campaign status visual map for the inline status dots beside linked campaigns
const CAMPAIGN_STATUS_DOT: Record<string, { label: string; cls: string }> = {
  active:    { label: 'Active',    cls: 'bg-status-track'  },
  paused:    { label: 'Paused',    cls: 'bg-status-sched'  },
  draft:     { label: 'Draft',     cls: 'bg-me-charcoal/30' },
  completed: { label: 'Completed', cls: 'bg-me-ochre'      },
  archived:  { label: 'Archived',  cls: 'bg-me-stone'      },
}

export function InitiativeExecutionPanel({ initiative, clientId, summary, onUpdated }: Props) {
  const [campaigns, setCampaigns] = useState<CampaignLite[]>([])
  const [campaignsLoading, setCampaignsLoading] = useState(true)
  const [addingCampaign, setAddingCampaign] = useState(false)
  const [selectCampaignId, setSelectCampaignId] = useState('')
  const [saving, setSaving] = useState(false)
  const [showPlanGenerator, setShowPlanGenerator] = useState(false)
  const [error, setError] = useState('')

  // Load all campaigns for this client (status-agnostic so paused/completed
  // ones already linked to this Initiative still show up). The dropdown then
  // filters to active+unlinkable for the "add" operation.
  const loadCampaigns = useCallback(async () => {
    setCampaignsLoading(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/campaign`)
      if (!res.ok) return
      const json = await res.json() as { campaigns?: CampaignLite[] }
      setCampaigns(json.campaigns ?? [])
    } catch {
      // non-fatal
    } finally {
      setCampaignsLoading(false)
    }
  }, [clientId])

  useEffect(() => { void loadCampaigns() }, [loadCampaigns])

  // Campaigns linked to this initiative (derived from initiative.campaign_ids + loaded list).
  // unlinkableCampaigns dropdown only offers active candidates that aren't already linked —
  // adding a paused/draft campaign mid-flight isn't a workflow we support today.
  const linkedCampaignIds = initiative.campaign_ids ?? []
  const linkedCampaigns = campaigns.filter(c => linkedCampaignIds.includes(c.id))
  const unlinkableCampaigns = campaigns.filter(c =>
    !linkedCampaignIds.includes(c.id) && c.status === 'active'
  )

  async function handleAddCampaign() {
    if (!selectCampaignId) return
    setSaving(true)
    setError('')
    try {
      const combined = linkedCampaignIds.concat([selectCampaignId])
      const newIds = combined.filter((v, i, a) => a.indexOf(v) === i)
      const res = await fetch(`/api/initiatives/${initiative.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign_ids: newIds }),
      })
      if (!res.ok) {
        const j = await res.json() as { error?: string }
        throw new Error(j.error ?? 'Failed to link campaign')
      }
      setAddingCampaign(false)
      setSelectCampaignId('')
      onUpdated?.()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function handleUnlinkCampaign(campaignId: string) {
    setSaving(true)
    setError('')
    try {
      const newIds = linkedCampaignIds.filter(id => id !== campaignId)
      const res = await fetch(`/api/initiatives/${initiative.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign_ids: newIds }),
      })
      if (!res.ok) {
        const j = await res.json() as { error?: string }
        throw new Error(j.error ?? 'Failed to unlink campaign')
      }
      onUpdated?.()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  function handlePlanGenerated(_plan: MarketingPlan) {
    setShowPlanGenerator(false)
    onUpdated?.()
  }

  return (
    <div className="mt-3 rounded-lg border border-black/8 bg-me-ivory px-4 py-3">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <p className="text-[10px] font-bold uppercase tracking-wide text-me-charcoal/45">
          关联执行
        </p>
        {/* P33.11: per-Initiative summary chip (only renders when parent passed a summary) */}
        {summary && summary.totalActions > 0 && (
          <div className="flex items-center gap-2 text-[11px] font-semibold text-me-charcoal/55">
            <span>
              {summary.completedActions} / {summary.totalActions - summary.skippedActions} actions done
            </span>
            {summary.completionPct !== null && (
              <span className="rounded bg-me-ochre/15 px-1.5 py-0.5 font-bold text-me-ochre">
                {summary.completionPct}%
              </span>
            )}
          </div>
        )}
      </div>

      {/* Linked campaigns + status dot (P33.11) */}
      <div className="mb-2 space-y-1">
        {linkedCampaigns.length === 0 && (
          <p className="text-xs font-semibold text-me-charcoal/45">暂无关联 Campaign</p>
        )}
        {linkedCampaigns.map(c => {
          const dot = CAMPAIGN_STATUS_DOT[c.status] ?? {
            label: c.status, cls: 'bg-me-stone',
          }
          return (
            <div key={c.id} className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1.5">
                <span
                  className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${dot.cls}`}
                  title={dot.label}
                />
                <a
                  href={`/dashboard/clients/${clientId}/brief?campaign=${c.id}`}
                  className="truncate text-xs font-semibold text-me-ochre hover:underline"
                >
                  {c.title}
                </a>
                <span className="text-[10px] font-semibold text-me-charcoal/45">
                  {dot.label}
                </span>
              </div>
              <button
                type="button"
                disabled={saving}
                onClick={() => handleUnlinkCampaign(c.id)}
                title="解除关联（不会删除 Campaign）"
                className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md border border-black/10 bg-white text-sm font-bold text-me-charcoal/55 transition-colors hover:border-status-rej/40 hover:bg-status-rej/10 hover:text-status-rej disabled:opacity-40"
              >
                ×
              </button>
            </div>
          )
        })}
      </div>

      {error && (
        <p className="mb-2 text-[10px] font-bold text-status-rej">{error}</p>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap gap-2">
        {!addingCampaign && (
          <button
            type="button"
            disabled={campaignsLoading || unlinkableCampaigns.length === 0}
            onClick={() => setAddingCampaign(true)}
            className="rounded-md border border-black/15 bg-white px-2.5 py-1 text-[11px] font-bold text-me-charcoal hover:border-me-ochre/50 hover:text-me-ochre disabled:opacity-40"
          >
            + 关联 Campaign
          </button>
        )}

        {addingCampaign && (
          <div className="flex items-center gap-1.5">
            <select
              value={selectCampaignId}
              onChange={e => setSelectCampaignId(e.target.value)}
              className="rounded-md border border-black/15 bg-white px-2 py-1 text-[11px] font-semibold text-me-charcoal focus:outline-none focus:ring-1 focus:ring-me-ochre"
            >
              <option value="">选择 Campaign…</option>
              {unlinkableCampaigns.map(c => (
                <option key={c.id} value={c.id}>{c.title}</option>
              ))}
            </select>
            <button
              type="button"
              disabled={!selectCampaignId || saving}
              onClick={handleAddCampaign}
              className="rounded-md bg-me-ochre px-2.5 py-1 text-[11px] font-bold text-white hover:bg-me-ochre/90 disabled:opacity-40"
            >
              确认
            </button>
            <button
              type="button"
              onClick={() => { setAddingCampaign(false); setSelectCampaignId('') }}
              className="text-[11px] font-bold text-me-charcoal/45 hover:text-me-charcoal"
            >
              取消
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={() => setShowPlanGenerator(true)}
          className="rounded-md border border-black/15 bg-white px-2.5 py-1 text-[11px] font-bold text-me-charcoal hover:border-me-ochre/50 hover:text-me-ochre"
        >
          + 生成 Marketing Plan
        </button>
      </div>

      {/* Marketing Plan Generator Modal — pre-filled with initiative context */}
      {showPlanGenerator && (
        <PlanGenerator
          clientId={clientId}
          initiativeId={initiative.id}
          defaultTitle={`${initiative.title} · 营销计划`}
          onGenerated={handlePlanGenerated}
          onCancel={() => setShowPlanGenerator(false)}
        />
      )}
    </div>
  )
}
