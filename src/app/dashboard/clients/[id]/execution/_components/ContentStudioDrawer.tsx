'use client'

/**
 * ContentStudioDrawer is the diagnosis-driven content workbench.
 *
 * The diagnosis explains why the task exists; this drawer gives the FDE a
 * focused place to generate the content that resolves it.
 */

import { useState, useEffect, useCallback } from 'react'
import type { ExecutionItem } from '@/types/diagnostic'
import { ReelsStudio } from '../../_components/ReelsStudio'
import { StudioArticleTab } from './StudioArticleTab'
import { SocialPlanSection } from './SocialPlanSection'

type StudioTab = 'article' | 'social' | 'video'

interface ActiveCampaign {
  id: string
  name: string
}

interface BackgroundGenerateParams {
  campaignId: string
  platform: string
  posts_count: number
  stories_count: number
  reels_count: number
  angle_focus?: string
}

interface Props {
  clientId: string
  item: ExecutionItem
  onClose: () => void
  /** Called after content is generated; parent silently refreshes the kanban. */
  onContentGenerated: () => void
  /** When set, "生成这条X" closes the drawer immediately and runs generation in the background. */
  onBackgroundGenerate?: (itemId: string, params: BackgroundGenerateParams) => void
}

function defaultTabFor(dimension: string): StudioTab {
  return dimension === 'social' ? 'social' : 'article'
}

export function ContentStudioDrawer({ clientId, item, onClose, onContentGenerated, onBackgroundGenerate }: Props) {
  const [tab, setTab]               = useState<StudioTab>(defaultTabFor(item.dimension))
  const [campaign, setCampaign]     = useState<ActiveCampaign | null>(null)
  const [campaignLoaded, setCampaignLoaded] = useState(false)

  useEffect(() => {
    const orig = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = orig }
  }, [])

  // Fetch the campaign for this execution item.
  // Priority: if the item was dispatched from a marketing plan, use that plan's
  // linked campaign (avoids showing the wrong campaign when multiple are active).
  // Fallback: first active campaign ordered by created_at DESC.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        // Path 1 — item has a marketing_plan_id; look up its campaign
        if (item.marketing_plan_id) {
          const mpRes = await fetch(
            `/api/clients/${clientId}/marketing-plan/${item.marketing_plan_id}`
          )
          if (mpRes.ok) {
            const mpData = await mpRes.json() as { plan?: { campaign_id: string | null } }
            const linkedCampaignId = mpData.plan?.campaign_id
            if (linkedCampaignId) {
              const camRes = await fetch(
                `/api/clients/${clientId}/campaign/${linkedCampaignId}`
              )
              if (camRes.ok) {
                const camData = await camRes.json() as { campaign?: { id: string; title?: string } }
                if (!cancelled && camData.campaign) {
                  setCampaign({ id: camData.campaign.id, name: camData.campaign.title ?? '' })
                  setCampaignLoaded(true)
                  return
                }
              }
            }
          }
        }

        // Path 2 — diagnostic item or plan has no campaign; fall back to first active
        const res = await fetch(`/api/clients/${clientId}/campaign?status=active`)
        if (res.ok) {
          const { campaigns } = await res.json() as { campaigns?: Array<{ id: string; title?: string }> }
          if (!cancelled && campaigns?.[0]) {
            setCampaign({ id: campaigns[0].id, name: campaigns[0].title ?? '' })
          }
        }
      } catch {
        /* non-fatal; generation still works on Master Brief alone */
      } finally {
        if (!cancelled) setCampaignLoaded(true)
      }
    })()
    return () => { cancelled = true }
  }, [clientId, item.marketing_plan_id])

  // Log generated content back to the execution item + bump status to in_progress.
  // Both calls are best-effort: a logging failure must never block content work.
  const linkContentToItem = useCallback((summary: string, blogPostId?: string) => {
    const content = blogPostId ? `${summary} [blog:${blogPostId}]` : summary
    fetch(`/api/clients/${clientId}/execution/${item.id}/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'ai_assist', author: 'luban', content }),
    }).catch(() => { /* non-blocking */ })

    if (item.status === 'pending') {
      fetch(`/api/clients/${clientId}/execution/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'in_progress' }),
      }).catch(() => { /* non-blocking */ })
    }

    onContentGenerated()
  }, [clientId, item.id, item.status, onContentGenerated])

  return (
    <>
      <div
        className="fixed inset-0 z-[60] bg-slate-950/45 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="fixed inset-y-0 right-0 z-[80] flex h-full w-full flex-col overflow-hidden overscroll-contain border-l border-slate-200 bg-[#f6f7f2] shadow-2xl transition-[width] duration-200 lg:w-[min(780px,calc(100vw-30rem))] xl:w-[min(880px,48vw)]">

        {/* Header: the WHY */}
        <div className="border-b border-slate-200 bg-[#f6f7f2] px-4 py-4 sm:px-6">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <span className="inline-flex rounded-md border border-cyan-200 bg-cyan-50 px-2 py-1 text-[11px] font-black uppercase tracking-[0.12em] text-cyan-800">
                Content workbench
              </span>
              <h2 className="mt-2 text-lg font-black leading-tight text-slate-950 sm:text-xl">{item.title}</h2>
              {item.description && item.description !== item.title && (
                <p className="mt-1 max-w-4xl text-sm leading-6 text-slate-600">{item.description}</p>
              )}
              <p className="mt-2 text-xs font-semibold text-slate-500">
                Master Brief is injected automatically
                {campaignLoaded && (
                  campaign
                    ? <> · Campaign: <strong className="text-slate-700">{campaign.name}</strong></>
                    : <> · <span className="text-amber-700">No active campaign; using brand DNA only</span></>
                )}
              </p>
            </div>
            <button
              onClick={onClose}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-lg font-black text-slate-400 transition hover:border-slate-300 hover:text-slate-700"
              aria-label="Close workbench"
            >
              x
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="border-b border-slate-200 bg-white px-4 sm:px-6">
          <div className="flex gap-2 overflow-x-auto">
            {([
              ['article', 'SEO 文章'],
              ['social',  '图文帖子'],
              ['video',   '短视频'],
            ] as const).map(([val, label]) => (
              <button
                key={val}
                onClick={() => setTab(val)}
                className={`shrink-0 border-b-2 px-3 py-3 text-sm font-black transition-colors ${
                  tab === val
                    ? 'border-slate-950 text-slate-950'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
          {!campaignLoaded ? (
            <div className="flex justify-center py-20">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-slate-950" />
            </div>
          ) : tab === 'article' ? (
            <StudioArticleTab
              clientId={clientId}
              item={item}
              hasActiveCampaign={!!campaign}
              onGenerated={linkContentToItem}
            />
          ) : tab === 'social' ? (
            // 图文帖子：Posts + Stories（含文字与图片生成）
            // TODO: 平台 tab（Facebook / Instagram / TikTok）→ 对应不同内容格式
            <SocialPlanSection
              mode="social"
              clientId={clientId}
              campaignId={campaign?.id}
              campaignName={campaign?.name}
              item={item}
              onBackgroundGenerate={onBackgroundGenerate ? (params) => {
                onBackgroundGenerate(item.id, params)
                onClose()
              } : undefined}
            />
          ) : (
            // 短视频：Reels 脚本 + Video Studio
            <div className="space-y-2">
              <SocialPlanSection
                mode="video"
                clientId={clientId}
                campaignId={campaign?.id}
                campaignName={campaign?.name}
                item={item}
              />
              <ReelsStudio
                clientId={clientId}
                defaultCampaignId={campaign?.id}
                onDraftGenerated={() =>
                  linkContentToItem('Generated a social video draft in Content Studio')
                }
              />
            </div>
          )}
        </div>
      </div>
    </>
  )
}
