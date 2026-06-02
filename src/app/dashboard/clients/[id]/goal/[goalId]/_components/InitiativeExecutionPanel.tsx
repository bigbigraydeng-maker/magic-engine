'use client'

/**
 * Phase 33 P33.5 + P33.6 — Initiative 关联执行区域
 *
 * 嵌入 InitiativeList 的每张卡片展开后显示：
 *   - 已关联 Campaign 列表（带跳转链接）
 *   - + 关联 Campaign 下拉
 *   - + 生成 Marketing Plan 按钮（打开 PlanGenerator 弹窗，预填 initiative_id + title）
 */

import { useState, useEffect, useCallback } from 'react'
import type { InitiativeRow } from '@/types/strategy'
import { PlanGenerator } from '@/app/dashboard/clients/[id]/marketing-plan/_components/PlanGenerator'
import type { MarketingPlan } from '@/lib/marketing-plan/types'

interface CampaignLite {
  id: string
  title: string
  status: string
}

interface Props {
  initiative: InitiativeRow
  clientId: string
  /** Called after campaign_ids or marketing plan changes so parent can refresh */
  onUpdated?: () => void
}

export function InitiativeExecutionPanel({ initiative, clientId, onUpdated }: Props) {
  const [campaigns, setCampaigns] = useState<CampaignLite[]>([])
  const [campaignsLoading, setCampaignsLoading] = useState(true)
  const [addingCampaign, setAddingCampaign] = useState(false)
  const [selectCampaignId, setSelectCampaignId] = useState('')
  const [saving, setSaving] = useState(false)
  const [showPlanGenerator, setShowPlanGenerator] = useState(false)
  const [error, setError] = useState('')

  // Load all campaigns for this client (for the add-campaign dropdown)
  const loadCampaigns = useCallback(async () => {
    setCampaignsLoading(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/campaign?status=active`)
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

  // Campaigns linked to this initiative (derived from initiative.campaign_ids + loaded list)
  const linkedCampaignIds = initiative.campaign_ids ?? []
  const linkedCampaigns = campaigns.filter(c => linkedCampaignIds.includes(c.id))
  const unlinkableCampaigns = campaigns.filter(c => !linkedCampaignIds.includes(c.id))

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
      <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-me-charcoal/45">
        关联执行
      </p>

      {/* Linked campaigns */}
      <div className="mb-2 space-y-1">
        {linkedCampaigns.length === 0 && (
          <p className="text-xs font-semibold text-me-charcoal/45">暂无关联 Campaign</p>
        )}
        {linkedCampaigns.map(c => (
          <div key={c.id} className="flex items-center justify-between gap-2">
            <a
              href={`/dashboard/clients/${clientId}/brief?campaign=${c.id}`}
              className="text-xs font-semibold text-me-ochre hover:underline"
            >
              {c.title}
            </a>
            <button
              type="button"
              disabled={saving}
              onClick={() => handleUnlinkCampaign(c.id)}
              className="text-[10px] font-bold text-me-charcoal/35 hover:text-status-rej disabled:opacity-40"
            >
              ×
            </button>
          </div>
        ))}
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
