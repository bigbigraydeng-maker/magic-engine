'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import type { CampaignBrief } from '@/types/magic-engine'
import { VisualDirectionSection } from '../_components/VisualDirectionSection'
import { CampaignDailyPlanPanel } from '../_components/CampaignDailyPlanPanel'
import { DailyPlanReelsPanel } from '../_components/DailyPlanReelsPanel'
import { WeekOverviewPanel } from '../_components/WeekOverviewPanel'
import { pickDefaultCampaignId } from './pick-default-campaign'

interface ClientLite {
  id: string
  name: string
}

export default function DailyPlanPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const clientId = params.id as string
  const requestedCampaignId = searchParams.get('campaign')
  // 图文 Post 与视频 Reels 分开看（PM：Post 和 Reels 要拆开）。?tab=reels 可直达视频页。
  const [tab, setTab] = useState<'post' | 'reels' | 'overview'>(
    searchParams.get('tab') === 'reels' ? 'reels' : searchParams.get('tab') === 'overview' ? 'overview' : 'post',
  )

  const [client, setClient] = useState<ClientLite | null>(null)
  const [campaigns, setCampaigns] = useState<CampaignBrief[]>([])
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [clientRes, campaignRes] = await Promise.all([
        fetch(`/api/clients/${clientId}`),
        fetch(`/api/clients/${clientId}/campaign?status=active`),
      ])
      if (clientRes.ok) {
        const { client: c } = await clientRes.json()
        setClient(c)
      }
      if (campaignRes.ok) {
        const { campaigns: list } = await campaignRes.json()
        const active = (list ?? []) as CampaignBrief[]
        setCampaigns(active)
        setSelectedCampaignId(current =>
          current && active.some(c => c.id === current)
            ? current
            : pickDefaultCampaignId(active, requestedCampaignId)
        )
      }
    } finally {
      setLoading(false)
    }
    // requestedCampaignId only matters on first load — once the FDE switches
    // campaigns manually, the URL param shouldn't fight that choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])

  useEffect(() => { load() }, [load])

  const handleCampaignUpdated = (updated: CampaignBrief) => {
    setCampaigns(prev => prev.map(c => c.id === updated.id ? updated : c))
  }

  const selectedCampaign = campaigns.find(c => c.id === selectedCampaignId) ?? null

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-me-stone rounded w-48" />
          <div className="h-4 bg-me-stone rounded w-64" />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen space-y-5 bg-[#f6f7f2] px-4 py-5 md:px-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/dashboard/clients/${clientId}`} className="text-sm font-semibold text-me-charcoal/45 hover:text-me-charcoal/75">
          ← {client?.name ?? 'Client'}
        </Link>
        <span className="text-me-charcoal/35">/</span>
        <h1 className="font-display text-2xl font-bold tracking-tight text-me-charcoal">社媒日常</h1>
      </div>

      <div className="flex gap-2" role="tablist" aria-label="社媒日常内容类型">
        {([['overview', '本周总览'], ['post', '图文帖子'], ['reels', '短视频']] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`text-sm px-4 py-1.5 rounded-lg border transition-colors ${
              tab === key
                ? 'bg-me-ochre text-me-charcoal border-me-ochre'
                : 'bg-white text-me-charcoal/70 border-black/10 hover:border-me-ochre/40'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' ? (
        <WeekOverviewPanel clientId={clientId} />
      ) : tab === 'reels' ? (
        <DailyPlanReelsPanel clientId={clientId} />
      ) : campaigns.length === 0 ? (
        <div className="bg-white rounded-xl border border-dashed border-black/10 py-14 text-center">
          <p className="text-2xl mb-2">🎯</p>
          <p className="text-sm font-medium text-me-charcoal/60">该客户暂无进行中的推广活动</p>
          <p className="text-xs text-me-charcoal/45 mt-1">
            先去
            <Link href={`/dashboard/clients/${clientId}/campaigns`} className="text-me-ochre hover:underline mx-1">推广活动</Link>
            新建一个活动，社媒日常才有内容可审核
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Campaign switcher — only shown when there's more than one active campaign */}
          {campaigns.length > 1 && (
            <div className="flex flex-wrap gap-2">
              {campaigns.map(c => (
                <button
                  key={c.id}
                  onClick={() => setSelectedCampaignId(c.id)}
                  className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${
                    c.id === selectedCampaignId
                      ? 'bg-me-ochre text-me-charcoal border-me-ochre'
                      : 'bg-white text-me-charcoal/70 border-black/10 hover:border-me-ochre/40'
                  }`}
                >
                  {c.title}
                </button>
              ))}
            </div>
          )}

          {selectedCampaign && (
            <>
              <div>
                <h2 className="text-base font-semibold text-me-charcoal/90">{selectedCampaign.title}</h2>
                {selectedCampaign.description && (
                  <p className="text-xs text-me-charcoal/55 mt-0.5">{selectedCampaign.description}</p>
                )}
              </div>

              {/* key forces a remount on campaign switch — VisualDirectionSection only seeds its form state from `campaign` on mount, so without it a switch would keep showing (and could save) the previous campaign's draft. */}
              <VisualDirectionSection
                key={selectedCampaign.id}
                campaign={selectedCampaign}
                clientId={clientId}
                onUpdated={handleCampaignUpdated}
              />

              <CampaignDailyPlanPanel clientId={clientId} campaignId={selectedCampaign.id} />
            </>
          )}
        </div>
      )}
    </div>
  )
}
