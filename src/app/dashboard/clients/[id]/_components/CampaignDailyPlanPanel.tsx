'use client'

import { useEffect, useState, useCallback, useMemo, useRef } from 'react'

import { CampaignDailyPublishPanel, type PublishReceipt } from './CampaignDailyPublishPanel'
import { CampaignDailyAutoPublishPanel } from './CampaignDailyAutoPublishPanel'
import { POST_HUMAN_CHECK_KEYS, type CheckItemOutcome, type ContentCheckItemKey, type ContentCheckItemResult } from '@/lib/social/content-review'

interface Props {
  clientId: string
  campaignId: string
}

interface AssetRef {
  id: string
  storage_url: string
  original_filename: string | null
  source: string
  ownership: string
}

interface BundleReadiness {
  master_brief_grounding: boolean
  campaign_grounding: boolean
  evidence_grounding: 'UNKNOWN'
  client_asset_provenance: boolean
  format_completeness: { post: boolean; story: boolean; reel: boolean }
  human_approval: boolean
  provider_authorization: false
  publishing_authorization: false
  performance_outcome: 'UNKNOWN'
}

interface PostImage {
  id: string
  preview_url: string
  filename: string | null
  source: string
  ownership: string
}

interface PostReview {
  verdict: 'PASS' | 'NEEDS_REVISION'
  reason: string | null
  reviewed_at: string
  is_current: boolean
}

interface DailyBundle {
  date: string
  post: { hook: string; body: string; cta: string; image_asset_id?: string; cta_url?: string } | null
  story: { frames: Array<{ order: number; copy: string }> } | null
  reel: { brief: string; script: string; caption: string; source_asset_ids: string[]; media_status: 'NO_MEDIA' | 'DRAFT_MEDIA' | 'READY' } | null
  readiness: BundleReadiness
  provenance: AssetRef[]
  post_image: PostImage | null
  post_review: PostReview | null
}

interface DailyPlanResponse {
  success: boolean
  campaign: { id: string; title: string; offer: string | null; primary_cta: string | null } | null
  grounding: { status: 'OK' | 'NEEDS_BRIEF' | 'NEEDS_CAMPAIGN'; has_master_brief: boolean; has_campaign: boolean }
  days: Array<{ date: string; slots: { post: 'PLANNED' | 'NOT_PLANNED'; story: 'PLANNED' | 'NOT_PLANNED'; reel: 'PLANNED' | 'NOT_PLANNED' } }>
  bundles: DailyBundle[]
  publishing_plan: { conversion_goal: string | null; destination: 'UNKNOWN'; status: 'NOT_AUTHORIZED' }
  ad_candidate: { creative_ref: string | null; goal: string; audience: string; destination: string; budget: string; status: 'NOT_AUTHORIZED' } | null
  plan_id: string | null
  plan_revision: string | null
  review_revision: string | null
  review_summary: { passed: number; needs_revision: number; total: number }
  publish_queue_receipt: {
    event_name: 'daily_plan.publish_queue.ready'
    event_id: string
    status: 'READY_NO_PUBLISH'
    no_publish: true
    created_at: string
    posts: Array<{ date: string; image_asset_id: string; cta_url: string; review_verdict: 'PASS' }>
  } | null
  publish_receipt: PublishReceipt | null
  facebook_page_id: string | null
}

type PublishQueueStatus = 'READY' | 'NEEDS_REVISION' | 'PENDING_REVIEW'

const POST_CHECK_LABEL: Record<ContentCheckItemKey, string> = {
  audio_track_present_nonsilent: '音轨存在且非静音',
  resolution_aspect_ratio_correct: '分辨率与宽高比正确',
  subtitle_timing_aligned: '字幕时间轴对齐',
  cover_frame_not_blank_or_placeholder: '封面帧不是空白或占位图',
  factual_claims_have_source: '事实性主张有来源',
  factual_claims_source_verified: '来源支持对应主张',
  viral_recipe_hook_matched: '开头符合已选爆款配方',
  safe_zone_text_in_bounds: '文字位于安全区内',
  logo_watermark_present: '品牌 Logo / 水印正确',
  subtitle_short_and_large: '字幕短且清晰易读',
  asset_provenance_labeled: '素材来源已标注',
  asset_provenance_matches_claim_context: '素材与主张场景相符',
  bgm_segmented_with_fades: 'BGM 分段并带淡入淡出',
  bgm_listened_no_vocals: '已开声音听过，背景音乐无人声',
  format_is_reel: '发布格式为 Reel',
  cta_in_first_comment_not_body: 'CTA 位于首评而非正文',
  first_comment_link_has_tracking_params: '首评链接含追踪参数',
}

const FACTUAL_CHECK_KEYS: readonly ContentCheckItemKey[] = ['factual_claims_have_source', 'factual_claims_source_verified']

type PostChecklistDraft = Record<ContentCheckItemKey, { outcome: CheckItemOutcome; detail: string; source_ref: string }>
const emptyPostChecklist = (): PostChecklistDraft => Object.fromEntries(
  POST_HUMAN_CHECK_KEYS.map(key => [key, { outcome: 'NOT_MEASURED', detail: '', source_ref: '' }]),
) as PostChecklistDraft

const postChecklistPayload = (draft: PostChecklistDraft): ContentCheckItemResult[] =>
  POST_HUMAN_CHECK_KEYS.map(key => ({
    key,
    judge: 'HUMAN',
    outcome: draft[key].outcome,
    detail: draft[key].detail.trim() || null,
    source_ref: draft[key].source_ref.trim() || null,
  }))

const allPassChecklist = (sourceUrl: string): PostChecklistDraft => Object.fromEntries(
  POST_HUMAN_CHECK_KEYS.map(key => [key, { outcome: 'PASS' as const, detail: '', source_ref: FACTUAL_CHECK_KEYS.includes(key) ? sourceUrl : '' }]),
) as PostChecklistDraft

const GROUNDING_LABEL: Record<DailyPlanResponse['grounding']['status'], string> = {
  OK: '✅ 已连接 Master Brief',
  NEEDS_BRIEF: '⚠️ 缺少 Master Brief（NEEDS_BRIEF）',
  NEEDS_CAMPAIGN: '⚠️ 未选定推广活动（NEEDS_CAMPAIGN）',
}


function isDaySelectable(day: DailyPlanResponse['days'][number], bundleDates: Set<string>): boolean {
  return (
    day.slots.post === 'PLANNED' ||
    day.slots.story === 'PLANNED' ||
    day.slots.reel === 'PLANNED' ||
    bundleDates.has(day.date)
  )
}

export function CampaignDailyPlanPanel({ clientId, campaignId }: Props) {
  const [data, setData] = useState<DailyPlanResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [postExpanded, setPostExpanded] = useState(false)
  const [reviewReason, setReviewReason] = useState('')
  const [postChecklistDraft, setPostChecklistDraft] = useState<PostChecklistDraft>(emptyPostChecklist)
  const [reviewSaving, setReviewSaving] = useState(false)
  const [publishQueueSaving, setPublishQueueSaving] = useState(false)
  const [reviewError, setReviewError] = useState('')
  const [publishQueueError, setPublishQueueError] = useState('')
  const requestSequence = useRef(0)
  const loadAbort = useRef<AbortController | null>(null)
  const activeScope = useRef(`${clientId}:${campaignId}`)
  activeScope.current = `${clientId}:${campaignId}`

  const load = useCallback(async () => {
    const scope = `${clientId}:${campaignId}`
    const sequence = ++requestSequence.current
    loadAbort.current?.abort()
    const controller = new AbortController()
    loadAbort.current = controller
    setLoading(true)
    setError('')
    try {
      const res = await fetch(
        `/api/clients/${clientId}/campaign-daily-plan?campaign_id=${campaignId}`,
        { signal: controller.signal }
      )
      const json = await res.json()
      if (!json.success) throw new Error(json.error ?? '加载失败')
      if (sequence !== requestSequence.current || activeScope.current !== scope) return
      setData(json)
      // Default to the first selectable day so Ray always lands on real content when it exists.
      const bundleDates = new Set((json.bundles as DailyBundle[] | undefined)?.map(b => b.date) ?? [])
      const firstSelectable = (json.days as DailyPlanResponse['days'])?.find(day => isDaySelectable(day, bundleDates))
      setSelectedDate(current => {
        const currentStillExists = current && (json.days as DailyPlanResponse['days'])?.some(day => day.date === current)
        return currentStillExists ? current : firstSelectable?.date ?? json.days?.[0]?.date ?? null
      })
      setPostExpanded(false)
    } catch (err) {
      if (controller.signal.aborted || sequence !== requestSequence.current || activeScope.current !== scope) return
      setError((err as Error).message)
    } finally {
      if (sequence === requestSequence.current && activeScope.current === scope) setLoading(false)
    }
  }, [clientId, campaignId])

  useEffect(() => {
    setData(null)
    setReviewSaving(false)
    setPublishQueueSaving(false)
    setReviewError('')
    setPublishQueueError('')
    void load()
    return () => {
      requestSequence.current += 1
      loadAbort.current?.abort()
    }
  }, [load])

  const selectedBundle = useMemo(
    () => data?.bundles.find(b => b.date === selectedDate) ?? null,
    [data, selectedDate]
  )
  const bundleDates = useMemo(() => new Set(data?.bundles.map(b => b.date) ?? []), [data])

  useEffect(() => {
    setReviewReason(selectedBundle?.post_review?.reason ?? '')
    setPostChecklistDraft(emptyPostChecklist())
    setReviewError('')
  }, [selectedDate, selectedBundle?.post_review?.reason, selectedBundle?.post_review?.reviewed_at])

  const [postImageNaturalSize, setPostImageNaturalSize] = useState<{ width: number; height: number } | null>(null)
  useEffect(() => {
    setPostImageNaturalSize(null)
  }, [selectedBundle?.post_image?.id])
  const postImageAspectMismatch = useMemo(() => {
    if (!postImageNaturalSize) return false
    const actualRatio = postImageNaturalSize.width / postImageNaturalSize.height
    const targetRatio = 4 / 5
    return Math.abs(actualRatio - targetRatio) / targetRatio > 0.02
  }, [postImageNaturalSize])

  const submitPostReview = useCallback(async (verdict: PostReview['verdict'], dateOverride?: string, expectedReviewRevisionOverride?: string | null, checklistOverride?: PostChecklistDraft) => {
    const scope = `${clientId}:${campaignId}`
    const reviewDate = dateOverride ?? selectedDate
    if (!data?.plan_id || !data.plan_revision || !reviewDate) {
      setReviewError('当前计划没有可审核的已保存版本，请刷新后重试。')
      return
    }
    const reason = verdict === 'NEEDS_REVISION' ? reviewReason.trim() : null
    if (verdict === 'NEEDS_REVISION' && !reason) {
      setReviewError('请先写明需要修改的原因。')
      return
    }

    if (!dateOverride) setReviewSaving(true)
    setReviewError('')
    try {
      const res = await fetch(`/api/clients/${clientId}/campaign-daily-plan/post-review`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaign_id: campaignId,
          plan_id: data.plan_id,
          expected_plan_revision: data.plan_revision,
          expected_review_revision: expectedReviewRevisionOverride ?? data.review_revision ?? null,
          date: reviewDate,
          verdict,
          reason,
          checklist_human: postChecklistPayload(checklistOverride ?? postChecklistDraft),
        }),
      })
      const json = await res.json()
      if (activeScope.current !== scope) return
      if (!res.ok || !json.success) {
        if (res.status === 409) {
          await load()
          throw new Error('计划或审核状态已更新，页面已刷新，请确认后再操作。')
        }
        if (res.status === 422) {
          if (json.error === 'AUTO_CHECKS_FAILED') {
            throw new Error('帖子正文里含有 CTA 或链接，请把它们从正文去掉（链接会自动放进首评）后再通过。')
          }
          throw new Error('Post 当前不完整或图片不可用，不能标记为通过。')
        }
        throw new Error(json.error ?? '保存审核失败')
      }
      if (dateOverride) return json.review_revision as string | null
      await load()
    } catch (err) {
      if (activeScope.current === scope) setReviewError((err as Error).message)
      if (dateOverride) throw err
    } finally {
      if (activeScope.current === scope && !dateOverride) setReviewSaving(false)
    }
  }, [campaignId, clientId, data, load, postChecklistDraft, reviewReason, selectedDate])

  const preparePublishQueue = useCallback(async () => {
    const scope = `${clientId}:${campaignId}`
    if (!data?.plan_id || !data.plan_revision || !data.review_revision) {
      setPublishQueueError('当前计划还没有完整审核版本，请刷新后重试。')
      return
    }
    setPublishQueueSaving(true)
    setPublishQueueError('')
    try {
      const res = await fetch(`/api/clients/${clientId}/campaign-daily-plan/publish-queue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          campaign_id: campaignId,
          plan_id: data.plan_id,
          expected_plan_revision: data.plan_revision,
          expected_review_revision: data.review_revision,
          no_publish: true,
        }),
      })
      const json = await res.json()
      if (activeScope.current !== scope) return
      if (!res.ok || !json.success) throw new Error(json.error ?? '发布准备回执生成失败')
      await load()
    } catch (err) {
      if (activeScope.current === scope) setPublishQueueError((err as Error).message)
    } finally {
      if (activeScope.current === scope) setPublishQueueSaving(false)
    }
  }, [campaignId, clientId, data, load])

  if (loading) {
    return <p className="text-xs text-me-charcoal/45 animate-pulse py-3">加载图文帖子…</p>
  }
  if (error) {
    return <p className="text-xs text-[#C2453A] py-3">✗ {error}</p>
  }
  if (!data) return null

  const reviewSummary = data.review_summary ?? {
    passed: 0,
    needs_revision: 0,
    total: data.bundles.filter(bundle => !!bundle.post).length,
  }
  const selectedPostPassed = selectedBundle?.post_review?.verdict === 'PASS' && selectedBundle.post_review.is_current
  const selectedPostNeedsRevision = selectedBundle?.post_review?.verdict === 'NEEDS_REVISION'
  const postChecklistAllPass = POST_HUMAN_CHECK_KEYS.every(
    key => postChecklistDraft[key].outcome === 'PASS' && (!FACTUAL_CHECK_KEYS.includes(key) || postChecklistDraft[key].source_ref.trim().length > 0)
  )
  const publishQueueItems = data.bundles
    .filter(bundle => !!bundle.post)
    .map(bundle => {
      const passed = bundle.post_review?.verdict === 'PASS' && bundle.post_review.is_current
      const needsRevision = bundle.post_review?.verdict === 'NEEDS_REVISION'
      const status: PublishQueueStatus = passed ? 'READY' : needsRevision ? 'NEEDS_REVISION' : 'PENDING_REVIEW'
      return {
        date: bundle.date,
        cta: bundle.post?.cta ?? 'UNKNOWN',
        ctaUrl: bundle.post?.cta_url ?? null,
        hasImage: !!bundle.post_image,
        status,
      }
    })
  const publishQueueReadyCount = publishQueueItems.filter(item => item.status === 'READY').length
  const publishQueueReady = publishQueueItems.length > 0 && publishQueueReadyCount === publishQueueItems.length
  const publishQueueReceipt = data.publish_queue_receipt

  return (
    <div className="border border-black/[.06] rounded-xl overflow-hidden">
      <div className="bg-me-ivory px-4 py-3 flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs font-semibold text-me-charcoal/75 uppercase tracking-wide">图文帖子（社媒日常）</p>
        <div className="flex items-center gap-2">
          <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-me-charcoal/[.06] text-me-charcoal/65">
            Post 已通过 {reviewSummary.passed}/{reviewSummary.total}
          </span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
            data.grounding.status === 'OK' ? 'bg-[#5C8A4A]/12 text-[#5C8A4A]' : 'bg-me-gold/20 text-me-ochre'
          }`}>
            {GROUNDING_LABEL[data.grounding.status]}
          </span>
        </div>
      </div>

      <div className="px-4 py-4 space-y-5">
        {/* 7-day grid — every day with content is selectable */}
        <div>
          <p className="text-xs font-semibold text-me-charcoal/55 uppercase tracking-wide mb-2">七日排期</p>
          <div className="grid grid-cols-7 gap-1.5">
            {data.days.map(day => {
              const selectable = isDaySelectable(day, bundleDates)
              const isSelected = day.date === selectedDate
              const postReview = data.bundles.find(bundle => bundle.date === day.date)?.post_review
              return (
                <button
                  key={day.date}
                  type="button"
                  disabled={!selectable}
                  onClick={() => { setSelectedDate(day.date); setPostExpanded(false) }}
                  className={`rounded-lg px-1.5 py-2 text-center transition-colors border ${
                    isSelected
                      ? 'bg-me-ochre text-white border-me-ochre shadow-[0_0_0_2px_rgba(198,139,31,0.18)]'
                      : selectable
                        ? postReview?.verdict === 'PASS' && postReview.is_current
                          ? 'bg-[#5C8A4A]/8 border-[#5C8A4A]/20 hover:bg-[#5C8A4A]/12 cursor-pointer'
                          : 'bg-me-ivory border-transparent hover:bg-me-ochre/15 cursor-pointer'
                        : 'bg-me-ivory/60 border-transparent cursor-not-allowed'
                  }`}
                >
                  <p className={`text-[10px] mb-1 ${isSelected ? 'text-white/85' : 'text-me-charcoal/55'}`}>{day.date.slice(5)}</p>
                  <div className="flex justify-center gap-0.5">
                    <SlotDot label="帖" planned={day.slots.post === 'PLANNED'} selected={isSelected} />
                    <SlotDot label="故" planned={day.slots.story === 'PLANNED'} selected={isSelected} />
                    <SlotDot label="片" planned={day.slots.reel === 'PLANNED'} selected={isSelected} />
                  </div>
                  <p className={`text-[9px] mt-1 ${isSelected ? 'text-white/90' : postReview?.verdict === 'PASS' && postReview.is_current ? 'text-[#5C8A4A]' : postReview ? 'text-[#C2453A]' : 'text-me-charcoal/35'}`}>
                    {postReview?.verdict === 'PASS' && postReview.is_current ? '✓ Post' : postReview?.verdict === 'PASS' ? '! 重审' : postReview?.verdict === 'NEEDS_REVISION' ? '! 修改' : '· 待审'}
                  </p>
                </button>
              )
            })}
          </div>
        </div>

        {/* Selected day's bundle */}
        <div>
          <p className="text-xs font-semibold text-me-charcoal/55 uppercase tracking-wide mb-2">
            当前 Bundle{selectedDate ? ` · ${selectedDate}` : ''}
          </p>
          {!selectedBundle ? (
            <p className="text-xs text-me-charcoal/45 italic">该日暂无排定内容（NOT_PLANNED）</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <BundleCard title="📝 Post">
                {selectedBundle.post ? (
                  <>
                    {selectedPostPassed && (
                      <div className="mb-2 rounded-lg border border-[#5C8A4A]/20 bg-[#5C8A4A]/8 px-3 py-2">
                        <p className="text-xs font-semibold text-[#5C8A4A]">✓ 这一天的 Facebook Post 已通过</p>
                        <p className="mt-0.5 text-[10px] text-me-charcoal/45">仍未排期、未发布；这里只代表 Post 人工审核通过。</p>
                      </div>
                    )}
                    {selectedBundle.post_image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={selectedBundle.post_image.preview_url}
                        alt={selectedBundle.post_image.filename ?? 'Post image'}
                        className="w-full max-h-96 object-contain rounded mb-2 bg-me-ivory"
                        onLoad={e => {
                          const img = e.currentTarget
                          setPostImageNaturalSize({ width: img.naturalWidth, height: img.naturalHeight })
                        }}
                      />
                    ) : (
                      <div className="w-full aspect-[4/5] rounded mb-2 bg-me-ivory flex items-center justify-center">
                        <span className="text-[10px] text-me-charcoal/40 italic">未绑定 Post 图片</span>
                      </div>
                    )}
                    {selectedBundle.post_image && postImageAspectMismatch && postImageNaturalSize && (
                      <div className="mb-2 rounded-lg border border-[#C2453A]/25 bg-[#C2453A]/8 px-3 py-2">
                        <p className="text-[11px] font-semibold text-[#C2453A]">
                          ⚠ 图片实际比例 {postImageNaturalSize.width}:{postImageNaturalSize.height}，不是 Facebook 要求的 4:5
                        </p>
                        <p className="mt-0.5 text-[10px] text-me-charcoal/45">
                          发布时会按原图直接发送给 Facebook，构图与这里预览一致；如需 4:5 构图，请先替换或裁剪素材再通过审核。
                        </p>
                      </div>
                    )}
                    {selectedBundle.post_image && (
                      <p className="text-[10px] text-me-charcoal/50 mb-1 truncate">
                        {selectedBundle.post_image.filename ?? selectedBundle.post_image.id}
                        <span className="text-me-charcoal/35"> · {selectedBundle.post_image.source}</span>
                      </p>
                    )}
                    <p className="text-xs font-medium text-me-charcoal/80">{selectedBundle.post.hook}</p>
                    <p className={`text-xs text-me-charcoal/60 mt-1 ${postExpanded ? '' : 'line-clamp-3'}`}>
                      {selectedBundle.post.body}
                    </p>
                    <button
                      type="button"
                      onClick={() => setPostExpanded(v => !v)}
                      className="text-[11px] text-me-ochre hover:underline mt-1"
                    >
                      {postExpanded ? '收起' : '展开全文'}
                    </button>
                    {selectedBundle.post.cta_url ? (
                      <a
                        href={selectedBundle.post.cta_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block text-xs text-me-ochre mt-1 hover:underline break-all"
                      >
                        {selectedBundle.post.cta} →{' '}
                        <span className="text-me-charcoal/45">{selectedBundle.post.cta_url}</span>
                      </a>
                    ) : (
                      <p className="text-xs text-me-charcoal/45 mt-1 italic">CTA: {selectedBundle.post.cta}（未绑定链接）</p>
                    )}
                    <div className="mt-3 pt-3 border-t border-black/[.06] space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-semibold text-me-charcoal/70">Facebook Post 审核</p>
                        <PostReviewBadge review={selectedBundle.post_review} />
                      </div>
                      {selectedBundle.post_review?.verdict === 'NEEDS_REVISION' && selectedBundle.post_review.reason && (
                        <p className="text-[11px] text-[#C2453A]">上次反馈：{selectedBundle.post_review.reason}</p>
                      )}
                      {!selectedPostPassed && (
                        <input
                          type="text"
                          value={reviewReason}
                          maxLength={500}
                          onChange={event => setReviewReason(event.target.value)}
                          placeholder="如需修改，请写明原因"
                          className="w-full rounded-md border border-black/10 px-2.5 py-2 text-xs text-me-charcoal placeholder:text-me-charcoal/35 focus:outline-none focus:ring-1 focus:ring-me-ochre"
                        />
                      )}
                      <div className="rounded-md border border-black/[.08] p-2.5 space-y-2">
                        <p className="text-[11px] font-semibold text-me-charcoal/65">人工检查清单</p>
                        {POST_HUMAN_CHECK_KEYS.map(key => (
                          <div key={key} className="border-b border-black/[.05] pb-2 last:border-0 last:pb-0">
                            <p className="text-[11px] text-me-charcoal/70">{POST_CHECK_LABEL[key]}</p>
                            <div className="mt-1 flex gap-3 text-[10px] text-me-charcoal/60">
                              {(['PASS', 'FAIL', 'NOT_MEASURED'] as const).map(outcome => (
                                <label key={outcome} className="flex items-center gap-1">
                                  <input
                                    type="radio"
                                    name={`post-check-${selectedDate}-${key}`}
                                    checked={postChecklistDraft[key].outcome === outcome}
                                    onChange={() => setPostChecklistDraft(prev => ({ ...prev, [key]: { ...prev[key], outcome } }))}
                                  />
                                  {outcome === 'NOT_MEASURED' ? '未检查' : outcome}
                                </label>
                              ))}
                            </div>
                            {postChecklistDraft[key].outcome === 'FAIL' && (
                              <input
                                className="mt-1 w-full rounded border border-black/10 px-2 py-1 text-[11px]"
                                placeholder="说明未通过原因"
                                value={postChecklistDraft[key].detail}
                                onChange={event => setPostChecklistDraft(prev => ({ ...prev, [key]: { ...prev[key], detail: event.target.value } }))}
                              />
                            )}
                            {(key === 'factual_claims_have_source' || key === 'factual_claims_source_verified') && (
                              <input
                                className="mt-1 w-full rounded border border-black/10 px-2 py-1 text-[11px]"
                                placeholder="来源 HTTPS URL 或 client_asset:<ID>"
                                value={postChecklistDraft[key].source_ref}
                                onChange={event => setPostChecklistDraft(prev => ({ ...prev, [key]: { ...prev[key], source_ref: event.target.value } }))}
                              />
                            )}
                          </div>
                        ))}
                      </div>
                      <p className="rounded-md bg-black/[.03] px-2.5 py-2 text-[10px] leading-relaxed text-me-charcoal/60">
                        发布后系统会自动在这条帖子的第一条评论里贴「{selectedBundle.post.cta}」和带追踪参数的预约链接。正文里不能出现 CTA 或链接，审核通过时系统会自动检查这一点。
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {!selectedPostPassed && selectedBundle.post.cta_url && (
                          <button
                            type="button"
                            disabled={reviewSaving}
                            onClick={() => {
                              const checklist = allPassChecklist(selectedBundle.post?.cta_url ?? '')
                              setPostChecklistDraft(checklist)
                              void submitPostReview('PASS', undefined, undefined, checklist)
                            }}
                            className="rounded-md bg-me-ochre px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                          >
                            {reviewSaving ? '保存中…' : '按官网核对通过'}
                          </button>
                        )}
                        {!selectedPostPassed && (
                          <button
                            type="button"
                            disabled={reviewSaving || !postChecklistAllPass}
                            onClick={() => void submitPostReview('PASS')}
                            className="rounded-md bg-[#5C8A4A] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                          >
                            {reviewSaving ? '保存中…' : selectedPostNeedsRevision ? '改为 Post 通过' : 'Post 通过'}
                          </button>
                        )}
                        {selectedPostPassed && (
                          <span className="rounded-md bg-[#5C8A4A]/12 px-3 py-1.5 text-xs font-semibold text-[#5C8A4A]">✓ Post 已通过</span>
                        )}
                        <button
                          type="button"
                          disabled={reviewSaving || !POST_HUMAN_CHECK_KEYS.some(key => postChecklistDraft[key].outcome === 'FAIL' && postChecklistDraft[key].detail.trim())}
                          onClick={() => void submitPostReview('NEEDS_REVISION')}
                          className="rounded-md border border-[#C2453A]/30 px-3 py-1.5 text-xs font-medium text-[#C2453A] disabled:opacity-50"
                        >
                          Post 需修改
                        </button>
                      </div>
                      <p className="text-[10px] leading-relaxed text-me-charcoal/40">
                        点「按官网核对通过」＝ 你确认：这条文案已对照官网、图片来源已标注、与文案相符；五项人工检查记为通过，来源填该帖的官网链接。
                      </p>
                      {reviewError && <p className="text-[11px] text-[#C2453A]">{reviewError}</p>}
                      <p className="text-[10px] leading-relaxed text-me-charcoal/40">
                        这里只记录该 Facebook Post 的人工审阅；不代表事实核验、Story/Reel 通过、生成、排期、Provider 或发布授权。
                      </p>
                    </div>
                  </>
                ) : <EmptySlot />}
              </BundleCard>

              <BundleCard title="Story 和 Reel">
                <p className="text-xs text-me-charcoal/60">
                  Story 和 Reel 不在这里看：Story 在<a href="?tab=overview" className="mx-0.5 text-me-ochre hover:underline">本周总览</a>，Reel 在<a href="?tab=reels" className="mx-0.5 text-me-ochre hover:underline">短视频</a>。
                </p>
              </BundleCard>
            </div>
          )}
        </div>

        {/* Provenance — for the selected day only */}
        <div>
          <p className="text-xs font-semibold text-me-charcoal/55 uppercase tracking-wide mb-2">素材来源 / Provenance</p>
          {!selectedBundle || selectedBundle.provenance.length === 0 ? (
            <p className="text-xs text-me-charcoal/45 italic">未引用素材，或素材归属未通过校验</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {selectedBundle.provenance.map(a => (
                <div key={a.id} className="flex items-center gap-2 bg-me-ivory rounded-lg px-2 py-1.5 border border-black/[.06]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={a.storage_url} alt={a.original_filename ?? ''} className="w-8 h-8 rounded object-cover" />
                  <span className="text-[10px] text-me-charcoal/60">{a.source}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Readiness — for the selected day only */}
        <div>
          <p className="text-xs font-semibold text-me-charcoal/55 uppercase tracking-wide mb-2">就绪检查</p>
          {!selectedBundle ? (
            <p className="text-xs text-me-charcoal/45 italic">该日暂无排定内容，无就绪状态可显示</p>
          ) : (
            <ul className="grid grid-cols-2 gap-x-4 gap-y-1">
              <ReadinessRow label="Master Brief 已连接" ok={selectedBundle.readiness.master_brief_grounding} />
              <ReadinessRow label="Campaign 已连接" ok={selectedBundle.readiness.campaign_grounding} />
              <ReadinessRow label="证据 / Claim 支撑" ok={false} forceLabel="UNKNOWN" />
              <ReadinessRow label="素材归属校验" ok={selectedBundle.readiness.client_asset_provenance} />
              <ReadinessRow label="Post 草稿完整" ok={selectedBundle.readiness.format_completeness.post} />
              <ReadinessRow label="Story 草稿完整" ok={selectedBundle.readiness.format_completeness.story} />
              <ReadinessRow label="Reel 脚本草稿完整" ok={selectedBundle.readiness.format_completeness.reel} />
              <ReadinessRow label="人工审核" ok={selectedBundle.readiness.human_approval} />
              <ReadinessRow label="Provider 授权" ok={false} forceLabel="NOT_AUTHORIZED" />
              <ReadinessRow label="发布授权" ok={false} forceLabel="NOT_AUTHORIZED" />
              <ReadinessRow label="效果 / Outcome" ok={false} forceLabel="UNKNOWN" />
            </ul>
          )}
        </div>

        {/* Daily Plan publish queue — review handoff only; no legacy content board. */}
        <div className="border-t border-black/[.06] pt-3">
          <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
            <p className="text-xs font-semibold text-me-charcoal/55 uppercase tracking-wide">发布队列 / Publish Queue</p>
            <div className="flex flex-wrap gap-1.5">
              <span className="rounded-full bg-[#5C8A4A]/12 px-2 py-0.5 text-[10px] font-medium text-[#5C8A4A]">
                Ready {publishQueueReadyCount}/{publishQueueItems.length}
              </span>
              <span className="rounded-full bg-me-charcoal/[.06] px-2 py-0.5 text-[10px] font-medium text-me-charcoal/50">
                未排期
              </span>
              <span className="rounded-full bg-me-charcoal/[.06] px-2 py-0.5 text-[10px] font-medium text-me-charcoal/50">
                未发布
              </span>
              {publishQueueReceipt && (
                <span className="rounded-full bg-[#5C8A4A]/12 px-2 py-0.5 text-[10px] font-medium text-[#5C8A4A]">
                  Inngest 已记录
                </span>
              )}
            </div>
          </div>
          <p className="mb-2 text-[10px] leading-relaxed text-me-charcoal/40">
            这里只承接 Daily Plan 已通过的 Facebook Post，作为下一步发布确认入口；不写入旧运营台，也不代表已授权发布。
          </p>
          {publishQueueItems.length === 0 ? (
            <p className="text-xs text-me-charcoal/45 italic">暂无可进入发布队列的 Post。</p>
          ) : (
            <div className="space-y-1.5">
              {publishQueueItems.map(item => (
                <div
                  key={item.date}
                  className="grid grid-cols-[4.5rem_7rem_1fr] items-center gap-2 rounded-lg border border-black/[.06] bg-white px-2.5 py-2 text-xs"
                >
                  <span className="font-medium text-me-charcoal/70">队列 {item.date.slice(5)}</span>
                  <PublishQueueBadge status={item.status} />
                  <div className="min-w-0">
                    <p className="truncate font-medium text-me-charcoal/70">Facebook Post</p>
                    <p className="truncate text-[10px] text-me-charcoal/40">
                      {item.hasImage ? '图片已绑定' : '缺少图片'} · CTA: {item.cta}
                      {item.ctaUrl ? ` · ${item.ctaUrl}` : ' · 链接 UNKNOWN'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 rounded-lg bg-me-ivory/70 px-3 py-2">
            {publishQueueReceipt ? (
              <div className="space-y-1 text-xs text-me-charcoal/60">
                <p className="font-semibold text-[#5C8A4A]">✓ 发布准备回执已生成</p>
                <p className="text-[10px] text-me-charcoal/45">
                  {publishQueueReceipt.event_name} · {publishQueueReceipt.status} · {publishQueueReceipt.event_id}
                </p>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-[10px] leading-relaxed text-me-charcoal/45">
                        全部 Post 管理员审核通过后，才能生成 Inngest 发布准备回执。
                </p>
                <button
                  type="button"
                  disabled={!publishQueueReady || publishQueueSaving}
                  onClick={() => void preparePublishQueue()}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                    publishQueueReady
                      ? 'bg-me-ochre text-white hover:bg-me-gold'
                      : 'bg-me-charcoal/[.08] text-me-charcoal/45'
                  }`}
                >
                  {publishQueueSaving ? '生成回执中…' : '生成发布准备回执'}
                </button>
              </div>
            )}
            {publishQueueError && <p className="mt-2 text-[11px] text-[#C2453A]">{publishQueueError}</p>}
          </div>
        </div>

        <CampaignDailyPublishPanel
          clientId={clientId}
          campaignId={campaignId}
          planId={data.plan_id}
          planRevision={data.plan_revision}
          reviewRevision={data.review_revision}
          facebookPageId={data.facebook_page_id ?? null}
          queueReceiptReady={Boolean(publishQueueReceipt)}
          publishReceipt={data.publish_receipt ?? null}
          onPublished={load}
        />

        <CampaignDailyAutoPublishPanel
          clientId={clientId}
          campaignId={campaignId}
          planId={data.plan_id}
          planRevision={data.plan_revision}
          reviewRevision={data.review_revision}
          facebookPageId={data.facebook_page_id ?? null}
          reviewedDates={publishQueueReceipt?.posts.map(post => post.date) ?? []}
          queueReceiptReady={Boolean(publishQueueReceipt)}
        />

        {/* Publishing + Ad preview */}
        <div className="border-t border-black/[.06] pt-3">
          <p className="text-xs font-semibold text-me-charcoal/55 uppercase tracking-wide mb-2">发布计划 / 广告预览</p>
          <div className="space-y-1 text-xs text-me-charcoal/60">
            <p>
              <span className="text-me-charcoal/45">转化目标：</span>
              <span className="font-medium">{data.publishing_plan.conversion_goal ?? 'UNKNOWN'}</span>
              {data.publishing_plan.conversion_goal === 'lead_form_submit' && (
                <span className="text-me-charcoal/45"> · 用户在落地页提交表单即算转化</span>
              )}
            </p>
            <p>
              <span className="text-me-charcoal/45">发布目的地：</span>
              <span className="font-medium">{data.publishing_plan.destination}</span>
              <span className="text-me-charcoal/40"> · 等待发布桥确认，不经旧运营台</span>
            </p>
            <p className="flex items-center gap-2">
              <span className="text-me-charcoal/45">发布授权：</span>
              <span className="bg-me-charcoal/10 text-me-charcoal/60 px-2 py-0.5 rounded-full font-medium">
                {data.publishing_plan.status}
              </span>
            </p>
          </div>
          {data.ad_candidate && (
            <div className="mt-2 flex flex-wrap gap-3 text-xs text-me-charcoal/55">
              <span>目标：{data.ad_candidate.goal}</span>
              <span>受众：{data.ad_candidate.audience}</span>
              <span>预算：{data.ad_candidate.budget}</span>
              <span className="bg-me-charcoal/10 text-me-charcoal/60 px-2 py-0.5 rounded-full font-medium">
                {data.ad_candidate.status}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function SlotDot({ label, planned, selected }: { label: string; planned: boolean; selected: boolean }) {
  return (
    <span
      title={planned ? 'PLANNED' : 'NOT_PLANNED'}
      className={`w-4 h-4 rounded-full text-[9px] leading-4 font-medium ${
        planned
          ? selected ? 'bg-white text-me-ochre' : 'bg-me-ochre text-white'
          : selected ? 'bg-white/25 text-white/70' : 'bg-black/[.06] text-me-charcoal/35'
      }`}
    >
      {label}
    </span>
  )
}

function BundleCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-black/[.06] rounded-lg p-3">
      <p className="text-xs font-semibold text-me-charcoal/70 mb-1.5">{title}</p>
      {children}
    </div>
  )
}

function EmptySlot() {
  return <p className="text-xs text-me-charcoal/40 italic">NOT_PLANNED</p>
}

function PostReviewBadge({ review }: { review: PostReview | null | undefined }) {
  if (review?.verdict === 'PASS' && review.is_current) {
    return <span className="rounded-full bg-[#5C8A4A]/12 px-2 py-0.5 text-[10px] font-medium text-[#5C8A4A]">已通过</span>
  }
  if (review?.verdict === 'PASS') {
    return <span className="rounded-full bg-[#C2453A]/10 px-2 py-0.5 text-[10px] font-medium text-[#C2453A]">已失效，需重审</span>
  }
  if (review?.verdict === 'NEEDS_REVISION') {
    return <span className="rounded-full bg-[#C2453A]/10 px-2 py-0.5 text-[10px] font-medium text-[#C2453A]">需修改</span>
  }
  return <span className="rounded-full bg-me-charcoal/[.06] px-2 py-0.5 text-[10px] font-medium text-me-charcoal/50">待审核</span>
}

function PublishQueueBadge({ status }: { status: PublishQueueStatus }) {
  if (status === 'READY') {
    return <span className="justify-self-start rounded-full bg-[#5C8A4A]/12 px-2 py-0.5 text-[10px] font-medium text-[#5C8A4A]">待排期</span>
  }
  if (status === 'NEEDS_REVISION') {
    return <span className="justify-self-start rounded-full bg-[#C2453A]/10 px-2 py-0.5 text-[10px] font-medium text-[#C2453A]">需修改</span>
  }
  return <span className="justify-self-start rounded-full bg-me-charcoal/[.06] px-2 py-0.5 text-[10px] font-medium text-me-charcoal/50">待审核</span>
}

function ReadinessRow({ label, ok, forceLabel }: { label: string; ok: boolean; forceLabel?: string }) {
  return (
    <li className="flex items-center gap-1.5 text-xs text-me-charcoal/65">
      <span>{ok ? '✅' : '⬜'}</span>
      <span>{label}</span>
      {forceLabel && <span className="text-me-charcoal/40">({forceLabel})</span>}
    </li>
  )
}
