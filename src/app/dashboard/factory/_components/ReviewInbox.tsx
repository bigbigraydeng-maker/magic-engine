'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { WorkOrderStatus } from '@/lib/factory/types'
import { REEL_HUMAN_CHECK_KEYS_V3, type CheckItemOutcome, type ContentCheckItemResult, type ContentCheckItemKey } from '@/lib/social/content-review'
import { defaultFactSourceRef, reviewErrorZh, reviewGate } from '@/lib/factory/review-ui'
import { factoryVideoUrl } from '@/lib/factory/outlets'
import type { RemotionMusicChoice } from '@/lib/factory/remotion-music-options.mjs'
import { OneClickConfirm } from './OneClickConfirm'
import { OrderNo } from './OrderNo'
import { PublishOutlets } from './PublishOutlets'
import { PendingCardHead } from './OrderTile'
import { RejectDialog } from './RejectDialog'
import { groupCounts, parseAngle } from './reviewCardMeta'
import { maliangReviewNote, type MaliangReviewTone } from '@/lib/maliang/review-note'
import { engineCardNote } from '@/lib/factory/engine-catalog.mjs'

// P21.J ME 原生化 P1 — 审核 Inbox(spec me-native-design v0.2 §2.1)
// 试验田:看片 + 拍板。in_review 工单 → 大号播放器 + 人话理由 +
// 「通过并投放(上限 $50)」一步轻确认 + 一键打回理由。审完自动翻下一条。

interface WorkOrder {
  id: string
  client_id: string
  client_name: string
  status: WorkOrderStatus
  template_id?: string | null
  music_file?: string | null
  deliverable?: string | null // brief.remotion.deliverable;'asset_only' = 素材,不单独发布
  fact_source_url?: string | null // 工单自带的官网产品页(brief.copy.endcard.url),用来预填「事实有来源」
  angle: string
  rationale_one_liner: string
  created_at?: string
  reject_reason?: string | null
  // redline_hits:交付时服务端复扫命中的品牌红线词(complete-work-order.ts)。
  // 设计是「命中不打回,标红让人审有的放矢」——但此前唯一的「标红」实现在 Airtable 审核卡里,
  // 随 Airtable 退役一起没了。成片直连 in_review 后这条护栏必须在这里补上,否则命中红线的片子
  // 和干净片子长得一模一样,人审拿不到任何信息 = 护栏静默失效。
  // quality_flags:同一交付点新增的语义品控(2026-09-20 Jev 评估)—— 静态红线短语查不出的
  // 竞品品牌当角度 / 内部标签冒充字幕 / 人称不符,同样是「命中不打回,标红转人工」。
  output: {
    video_path?: string
    redline_hits?: string[]
    quality_flags?: Array<{ category: string; detail: string }>
    quality_checklist_auto?: ContentCheckItemResult[]
  } | null
}

const redlineHitsOf = (o: WorkOrder): string[] =>
  Array.isArray(o.output?.redline_hits) ? o.output.redline_hits.filter((h) => typeof h === 'string' && h) : []

// 「人称口吻不符简报」检测已于 2026-10-16 取消;历史工单里残留的这类标记只在展示层过滤,不改库。
const RETIRED_FLAG_CATEGORIES = ['narrator_voice_mismatch']

const TEMPLATE_LABELS: Record<string, string> = {
  list: '清单节奏',
  montage: '快切蒙太奇',
  datacard: '数据卡',
  postcard: '场景明信片',
  atmosphere: '单镜氛围',
}

function maliangNoteBox(tone: MaliangReviewTone): string {
  const color = tone === 'fail'
    ? 'border-status-rej/30 bg-status-rej/10 text-status-rej'
    : 'border-status-exec/30 bg-status-exec/10 text-me-charcoal'
  return `mb-2 rounded-lg border px-2 py-1.5 text-xs font-medium ${color}`
}

function renderChoiceLabel(templateId?: string | null): string {
  if (!templateId) return '未记录'
  return TEMPLATE_LABELS[templateId] ?? templateId
}

function musicChoiceLabel(musicFile?: string | null): string {
  if (!musicFile?.trim()) return '未记录'
  return musicFile.split('/').pop() ?? musicFile
}

const qualityFlagsOf = (o: WorkOrder): Array<{ category: string; detail: string }> =>
  Array.isArray(o.output?.quality_flags)
    ? o.output.quality_flags
        .filter((f) => f && typeof f === 'object')
        .filter((f) => !RETIRED_FLAG_CATEGORIES.includes((f as { category?: string }).category ?? ''))
        .map((f) => ({
          category: typeof f.category === 'string' && f.category ? f.category : 'unknown',
          detail: typeof f.detail === 'string' ? f.detail : '',
        }))
    : []

const autoChecklistOf = (o: WorkOrder): ContentCheckItemResult[] =>
  Array.isArray(o.output?.quality_checklist_auto) ? o.output.quality_checklist_auto : []
const autoChecklistReady = (o: WorkOrder): boolean =>
  autoChecklistOf(o).length > 0 && autoChecklistOf(o).every(item => item.judge === 'AUTO' && item.outcome === 'PASS')

const gateOf = (o: WorkOrder) => reviewGate({
  autoReady: autoChecklistReady(o),
  redlineHits: redlineHitsOf(o),
  qualityFlags: qualityFlagsOf(o),
  factSourcePrefilled: defaultFactSourceRef(o.fact_source_url) !== '',
})

const QUALITY_FLAG_LABEL: Record<string, string> = {
  competitor_brand: '⚠️ 疑似把竞品品牌当自己卖点',
  placeholder_caption: '⚠️ 字幕疑似内部标签冒充文案',
  quality_check_unavailable: '⚠️ 品控检测暂不可用,请重点人工复核',
}

const HUMAN_CHECK_LABEL: Record<ContentCheckItemKey, string> = {
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
  bgm_listened_no_vocals: '我已开声音听过，背景音乐里没有人声',
  standalone_understandable: '这条单独发给粉丝，他们能看懂在讲什么',
  format_is_reel: '发布格式为 Reel',
  cta_in_first_comment_not_body: 'CTA 位于首评而非正文',
  first_comment_link_has_tracking_params: '首评链接含追踪参数',
}

type ChecklistDraft = Record<ContentCheckItemKey, { outcome: CheckItemOutcome; detail: string; source_ref: string }>
const FACT_KEYS: readonly ContentCheckItemKey[] = ['factual_claims_have_source', 'factual_claims_source_verified']
const emptyChecklistDraft = (factSource = ''): ChecklistDraft => Object.fromEntries(
  REEL_HUMAN_CHECK_KEYS_V3.map(key => [key, { outcome: 'NOT_MEASURED', detail: '', source_ref: FACT_KEYS.includes(key) ? factSource : '' }]),
) as ChecklistDraft

// The listened-to-the-audio and the stand-alone-understandable items are never bulk-passed: it only counts if the reviewer ticks it themselves.
const MANUAL_ONLY_KEYS: readonly ContentCheckItemKey[] = ['bgm_listened_no_vocals', 'standalone_understandable']
const allPass = (draft: ChecklistDraft): ChecklistDraft =>
  Object.fromEntries(REEL_HUMAN_CHECK_KEYS_V3.map(key => [key, MANUAL_ONLY_KEYS.includes(key) ? draft[key] : { ...draft[key], outcome: 'PASS' }])) as ChecklistDraft

// One-click path: the confirm button is only enabled after the reviewer ticks "listened, no vocals".
const markListened = (draft: ChecklistDraft): ChecklistDraft => ({
  ...draft,
  bgm_listened_no_vocals: { ...draft.bgm_listened_no_vocals, outcome: 'PASS' },
  standalone_understandable: { ...draft.standalone_understandable, outcome: 'PASS' },
})

const checklistPayload = (draft: ChecklistDraft): ContentCheckItemResult[] =>
  REEL_HUMAN_CHECK_KEYS_V3.map(key => ({
    key,
    judge: 'HUMAN',
    outcome: draft[key].outcome,
    detail: draft[key].detail.trim() || null,
    source_ref: draft[key].source_ref.trim() || null,
  }))

// 品控提示:有就显示黄框(只读;没有「接受」按钮,提示本身就该被处理)
function QualityFlagsBlock({ o }: { o: WorkOrder }) {
  const flags = qualityFlagsOf(o)
  if (flags.length === 0) return null
  return (
    <div className="mb-2 rounded-lg border border-status-exec/30 bg-status-exec/10 px-2 py-1.5 space-y-1">
      {flags.map((f, i) => (
        <p key={i} className="text-xs text-me-charcoal/75">
          <span className="font-medium">{QUALITY_FLAG_LABEL[f.category] ?? '⚠️ 品控提示'}</span>
          <span className="block text-me-charcoal/75 mt-0.5">{f.detail}</span>
        </p>
      ))}
    </div>
  )
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const publicUrl = (path?: string) =>
  path ? `${SUPABASE_URL}/storage/v1/object/public/content-factory/${path}` : ''

// clientId:只看该客户的待审。审片入口在视频工厂；客户首页概览不再挂这只框。
// hideWhenEmpty:没待审就不渲染(不占地方)
export function ReviewInbox({ clientId, hideWhenEmpty, onReviewed }: { clientId?: string; hideWhenEmpty?: boolean; onReviewed?: () => void } = {}) {
  const [orders, setOrders] = useState<WorkOrder[]>([])
  const [engineNotice, setEngineNotice] = useState<string | null>(null)
  const [assets, setAssets] = useState<WorkOrder[]>([])
  const [rejecting, setRejecting] = useState<{ order: WorkOrder; mode: 'quality' | 'budget' } | null>(null)
  const [musicChoicesByOrder, setMusicChoicesByOrder] = useState<Record<string, RemotionMusicChoice[]>>({})
  const [musicChoicesLoaded, setMusicChoicesLoaded] = useState<Record<string, boolean>>({})
  const [musicOptionsLoading, setMusicOptionsLoading] = useState<string | null>(null)
  const [musicOptionsError, setMusicOptionsError] = useState<Record<string, string>>({})
  const musicOptionsInFlight = useRef(new Set<string>())
  const [notice, setNotice] = useState<string | null>(null)
  const inFlight = useRef(false) // 同一帧连点也只发一次
  const [groupFilter, setGroupFilter] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [hasShown, setHasShown] = useState(false) // 显示过一次就常驻,刷新不卸载(防对话框丢历史)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<WorkOrder | null>(null)
  const [checklistDraft, setChecklistDraft] = useState<ChecklistDraft>(emptyChecklistDraft)
  const [showDetails, setShowDetails] = useState(false)

  const beginReject = (order: WorkOrder) => {
    setError(null)
    setRejecting({ order, mode: 'quality' })
    if (musicChoicesLoaded[order.id] || musicOptionsInFlight.current.has(order.id)) return
    musicOptionsInFlight.current.add(order.id)
    setMusicOptionsLoading(order.id)
    setMusicOptionsError((prev) => ({ ...prev, [order.id]: '' }))
    void (async () => {
      try {
        const res = await fetch(`/api/factory/work-orders/${order.id}/music-options`)
        const json = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(json.error ?? `读取音乐选项失败 (${res.status})`)
        const choices = Array.isArray(json.music_choices) ? json.music_choices as RemotionMusicChoice[] : []
        setMusicChoicesByOrder((prev) => ({ ...prev, [order.id]: choices }))
        setMusicChoicesLoaded((prev) => ({ ...prev, [order.id]: true }))
      } catch (e) {
        const message = e instanceof Error ? e.message : '读取音乐选项失败'
        setMusicOptionsError((prev) => ({ ...prev, [order.id]: message }))
      } finally {
        musicOptionsInFlight.current.delete(order.id)
        setMusicOptionsLoading((current) => current === order.id ? null : current)
      }
    })()
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/factory/work-orders')
      if (!res.ok) throw new Error(`加载失败 (${res.status})`)
      const json = await res.json()
      const noticeText = json.worker?.engine_notice
      setEngineNotice(typeof noticeText === 'string' && noticeText.trim() ? noticeText : null)
      const inReview = (json.orders ?? []).filter(
        (o: WorkOrder & { client_id?: string }) =>
          o.status === 'in_review' && (!clientId || o.client_id === clientId),
      )
      // 素材（asset_only）不是成片：单独分区，没有「通过」按钮
      const pending = inReview.filter((o: WorkOrder) => o.deliverable !== 'asset_only')
      setOrders(pending)
      setAssets(inReview.filter((o: WorkOrder) => o.deliverable === 'asset_only'))
      if (inReview.length > 0) setHasShown(true)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, 30_000)
    const onFocus = () => { if (document.visibilityState === 'visible') void load() }
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', onFocus)
    }
  }, [load])

  // 选中的团已不存在 → 清掉筛选,避免旧筛选把剩余待审卡片过滤光
  useEffect(() => {
    if (groupFilter && !groupCounts(orders.map((o) => o.angle)).some((g) => g.group === groupFilter)) setGroupFilter(null)
  }, [groupFilter, orders])

  const act = useCallback(async (id: string, payload: Record<string, unknown>, okNotice?: string) => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(id)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch(`/api/factory/work-orders/${id}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? `操作失败 (${res.status})`)
      }
      const resJson = (await res.json().catch(() => ({}))) as { reopened_work_order_id?: string | null }
      setOrders((prev) => prev.filter((o) => o.id !== id)) // 审完自动翻下一条
      setConfirming(null)
      setRejecting(null)
      // 模板出片（remotion）的单被打回后系统不会自动重做：提醒要改下单参数后另提新单
      const noRedo = payload.action === 'reject_quality' && resJson.reopened_work_order_id === null
      if (okNotice || noRedo) setNotice([okNotice, noRedo ? '模板出片的单不会自动重做：请改下单参数（加内容，或明确标成素材）后另提新单。' : ''].filter(Boolean).join(' '))
      onReviewed?.() // 通知父页刷新工单,待审数才会变,自动切客户才会触发
      if (okNotice) void load()
    } catch (e) {
      setError(e instanceof Error ? reviewErrorZh(e.message, k => HUMAN_CHECK_LABEL[k as ContentCheckItemKey] ?? k) : '操作失败')
    } finally {
      inFlight.current = false
      setBusy(null)
    }
  }, [onReviewed, load])

  const acceptAsset = useCallback(async (id: string) => {
    if (inFlight.current) return
    inFlight.current = true
    setBusy(id)
    setError(null)
    try {
      const res = await fetch(`/api/factory/work-orders/${id}/asset-accept`, { method: 'POST' })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? `操作失败 (${res.status})`)
      }
      setAssets((prev) => prev.filter((o) => o.id !== id))
      setNotice('已收入素材库（这不是发布；成片文件需另行搬进素材目录）。')
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败')
    } finally {
      inFlight.current = false
      setBusy(null)
    }
  }, [])

  // 只在「从没显示过 + 当前没有待审」时隐藏；显示过后保留审核对话框的状态。
  if (hideWhenEmpty && !hasShown && orders.length === 0 && assets.length === 0) return null
  const groups = groupCounts(orders.map((o) => o.angle))
  const activeGroup = groupFilter && groups.some((g) => g.group === groupFilter) ? groupFilter : null
  if (!hasShown && loading) return <p className="text-sm text-me-charcoal/55 mb-6">加载待审…</p>

  const inGroup = (o: WorkOrder) => !activeGroup || parseAngle(o.angle).group === activeGroup
  const shownPending = orders.filter(inGroup)
  const gridCls = 'grid gap-3 grid-cols-[repeat(auto-fill,minmax(200px,1fr))]'

  return (
    <section className="mb-8">
      {error && !confirming && !rejecting && <div className="mb-3 px-4 py-2 rounded-lg bg-status-rej/10 text-status-rej text-sm">{error}</div>}
      {notice && <div role="status" className="mb-3 px-4 py-2 rounded-lg bg-status-exec/10 text-me-charcoal text-sm">{notice}</div>}

      <p className="mb-3 text-xs text-me-charcoal/55">只列出待审核视频。已通过、已打回和被新版替代的记录自动从待办中收起，原工单记录保留。</p>
      {engineNotice && (
        <div className="mb-3 rounded-lg border border-status-rej/30 bg-status-rej/10 px-3 py-2 text-sm text-me-charcoal" data-testid="engine-stale-notice">
          {engineNotice}
        </div>
      )}

      {groups.length > 1 && (
        <div className="flex flex-wrap gap-2 mb-4" role="group" aria-label="按团筛选">
          {[{ group: null as string | null, count: orders.length }, ...groups].map((g) => (
            <button
              key={g.group ?? 'all'}
              type="button"
              onClick={() => setGroupFilter(g.group)}
              aria-pressed={activeGroup === g.group}
              className={`px-3 min-h-11 rounded-full text-xs font-medium border ${activeGroup === g.group ? 'bg-me-ochre text-white border-me-ochre' : 'bg-white text-me-charcoal/75 border-black/10 hover:bg-me-ivory'}`}
            >{g.group ?? '全部'} · {g.count}</button>
          ))}
        </div>
      )}

      <>
        {shownPending.length === 0 && <p className="text-sm text-me-charcoal/55">现在没有待审核视频。新片做好后会自动出现在这里（页面每 30 秒自动刷新），你不用做别的。</p>}
        <div className={gridCls}>
          {shownPending.map((o) => {
              const maliangNote = maliangReviewNote(o.output)
              const staleNote = engineCardNote(o.output)
              return (
              <div key={o.id} className="border border-black/10 rounded-xl bg-white p-3 flex flex-col">
                <PendingCardHead
                  id={o.id}
                  angle={o.angle}
                  rationale={o.rationale_one_liner}
                  clientName={o.client_name}
                  createdAt={o.created_at}
                  videoSrc={publicUrl(o.output?.video_path)}
                />

                <div className="mb-2 flex flex-wrap gap-1.5 text-[11px] text-me-charcoal/75" aria-label="本次成片模板和音乐">
                  <span className="rounded bg-me-stone/60 px-2 py-1">模板 · {renderChoiceLabel(o.template_id)}</span>
                  <span className="rounded bg-me-stone/60 px-2 py-1">BGM · {musicChoiceLabel(o.music_file)}</span>
                </div>

                {staleNote && (
                  <div className="mb-2 rounded-lg border border-status-rej/30 bg-status-rej/10 px-2 py-1.5 text-xs text-me-charcoal" data-testid="engine-stale-card">
                    {staleNote}
                  </div>
                )}

                {maliangNote && (
                  <div className={maliangNoteBox(maliangNote.tone)} data-testid="maliang-review-note" data-tone={maliangNote.tone}>
                    <p>{maliangNote.text}</p>
                  </div>
                )}

                {redlineHitsOf(o).length > 0 && (
                  <div className="mb-2 rounded-lg border border-status-rej/30 bg-status-rej/10 px-2 py-1.5">
                    <p className="text-xs font-medium text-status-rej">⚠️ 文案命中品牌红线,请逐字核对后再通过</p>
                    <p className="mt-1 flex flex-wrap gap-1">
                      {redlineHitsOf(o).map((h) => (
                        <span key={h} className="text-xs bg-status-rej/15 text-status-rej rounded px-1.5 py-0.5 font-mono">{h}</span>
                      ))}
                    </p>
                  </div>
                )}

                <QualityFlagsBlock o={o} />

                {!autoChecklistReady(o) && (
                  <div className="mb-2 rounded-lg border border-status-rej/30 bg-status-rej/10 px-2 py-1.5">
                    <p className="text-xs font-medium text-status-rej">自动媒体检测未完成,服务端会阻断通过</p>
                    <p className="mt-1 text-xs text-status-rej">
                      {autoChecklistOf(o).length > 0
                        ? autoChecklistOf(o).filter(item => item.outcome !== 'PASS').map(item => `${HUMAN_CHECK_LABEL[item.key] ?? item.key}：${item.detail ?? '未测'}`).join('；')
                        : '自动检查清单缺失'}
                    </p>
                  </div>
                )}

                <div className="mt-auto flex flex-col gap-2">
                  <button
                    onClick={() => { setError(null); setConfirming(o); setShowDetails(false); setChecklistDraft(emptyChecklistDraft(defaultFactSourceRef(o.fact_source_url))) }}
                    disabled={busy === o.id}
                    className="w-full h-11 rounded-lg bg-me-ochre text-white text-sm font-medium hover:bg-me-ochre/90 disabled:opacity-50"
                  >{busy === o.id ? '处理中…' : '✓ 通过·待发布'}</button>
                  <button
                    type="button"
                    onClick={() => beginReject(o)}
                    disabled={busy === o.id}
                    className="w-full h-11 rounded-lg border border-status-rej/30 bg-white text-status-rej text-sm font-medium hover:bg-status-rej/10 disabled:opacity-50"
                  >打回</button>
                  {o.output?.video_path && (
                    <a
                      href={factoryVideoUrl(o.output.video_path, SUPABASE_URL, `${o.id.slice(0, 8)}.mp4`)}
                      download
                      className="w-full h-11 rounded-lg border border-black/10 bg-white text-me-charcoal/75 text-sm font-medium grid place-items-center hover:bg-me-ivory"
                      target="_blank"
                      rel="noopener noreferrer"
                    >下载成片</a>
                  )}
                  {!o.output?.video_path && <span className="w-full h-11 rounded-lg border border-black/10 text-me-charcoal/55 text-sm grid place-items-center">无成片</span>}
                  <PublishOutlets />
                </div>
              </div>
              )
          })}
        </div>
        {assets.length > 0 && (
          <div className="mt-6" data-testid="asset-only-section">
            <h3 className="text-sm font-medium text-me-charcoal mb-1">素材（不单独发布）</h3>
            <p className="text-xs text-me-charcoal/55 mb-2">这些是标成「素材」的工单：不能通过、不能发布，只能验收入库。</p>
            <div className={gridCls}>
              {assets.map((o) => (
                <div key={o.id} className="border border-dashed border-black/15 rounded-xl bg-me-ivory p-3 flex flex-col">
                  <PendingCardHead
                    id={o.id}
                    angle={o.angle}
                    rationale={o.rationale_one_liner}
                    clientName={o.client_name}
                    createdAt={o.created_at}
                    videoSrc={publicUrl(o.output?.video_path)}
                  />
                  <button
                    type="button"
                    onClick={() => void acceptAsset(o.id)}
                    disabled={busy === o.id}
                    className="mt-2 min-h-11 rounded-lg border border-black/10 bg-white text-sm text-me-charcoal/75 hover:bg-me-ivory disabled:opacity-50"
                  >{busy === o.id ? '处理中…' : '收入素材库'}</button>
                </div>
              ))}
            </div>
          </div>
        )}
      </>

      {rejecting && (
        <RejectDialog
          mode={rejecting.mode}
          orderNo={rejecting.order.id.slice(0, 8)}
          busy={busy === rejecting.order.id}
          error={error}
          onClose={() => { setRejecting(null); setError(null) }}
          onModeChange={(mode) => { setError(null); setRejecting({ order: rejecting.order, mode }) }}
          templateId={rejecting.order.template_id}
          currentMusicFile={rejecting.order.music_file}
          musicChoices={musicChoicesByOrder[rejecting.order.id] ?? []}
          musicChoicesLoading={musicOptionsLoading === rejecting.order.id}
          musicChoicesError={musicOptionsError[rejecting.order.id] || null}
          onSubmit={(payload) => void act(
            rejecting.order.id,
            payload,
            rejecting.mode === 'quality'
              ? `已打回 #${rejecting.order.id.slice(0, 8)}:${String(payload.feedback ?? '')}`
              : `已调整预算 #${rejecting.order.id.slice(0, 8)}:$${String(payload.new_budget_usd ?? '')}(片子仍在待审,没有发布)`,
          )}
        />
      )}

      {confirming && (
        <div className="fixed inset-0 z-40 bg-black/45 grid place-items-center p-4" onClick={() => setConfirming(null)}>
          <div role="dialog" aria-modal="true" className="bg-white rounded-xl p-6 max-w-3xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-1">
              <p className="font-medium text-me-charcoal">通过并排入发布队列</p>
              <OrderNo id={confirming.id} />
            </div>

            {redlineHitsOf(confirming).length > 0 && (
              <div className="mb-3 rounded-lg border border-status-rej/30 bg-status-rej/10 px-3 py-2">
                <p className="text-sm font-medium text-status-rej">⚠️ 这条命中了品牌红线</p>
                <p className="mt-1 flex flex-wrap gap-1.5">
                  {redlineHitsOf(confirming).map((h) => (
                    <span key={h} className="text-xs bg-status-rej/15 text-status-rej rounded px-1.5 py-0.5 font-mono">{h}</span>
                  ))}
                </p>
              </div>
            )}

            {qualityFlagsOf(confirming).length > 0 && (
              <div className="mb-3 rounded-lg border border-status-exec/30 bg-status-exec/10 px-3 py-2 space-y-1">
                {qualityFlagsOf(confirming).map((f, i) => (
                  <p key={i} className="text-sm text-me-charcoal/75">
                    <span className="font-medium">{QUALITY_FLAG_LABEL[f.category] ?? '⚠️ 品控提示'}</span>
                    <span className="block text-xs text-me-charcoal/75 mt-0.5">{f.detail}</span>
                  </p>
                ))}
              </div>
            )}

            {(() => {
              const gate = gateOf(confirming)
              const detailsOpen = showDetails || !gate.oneClick
              if (!detailsOpen) {
                return (
                  <div className="mb-4">
                    <OneClickConfirm
                      itemLabels={REEL_HUMAN_CHECK_KEYS_V3.map(k => HUMAN_CHECK_LABEL[k])}
                      sourceUrl={defaultFactSourceRef(confirming.fact_source_url)}
                      busy={busy === confirming.id}
                      onConfirm={() => void act(confirming.id, { action: 'approve', checklist_human: checklistPayload(allPass(markListened(checklistDraft))) })}
                      onExpand={() => setShowDetails(true)}
                    />
                  </div>
                )
              }
              return (
                <>
                  {!gate.oneClick && (
                    <div className="mb-3 rounded-lg border border-status-exec/30 bg-status-exec/10 px-3 py-2">
                      <p className="text-sm font-medium text-me-charcoal/75">不能一键通过,请逐项核对:</p>
                      <ul className="mt-1 list-disc list-inside space-y-0.5">
                        {gate.reasons.map((r, i) => (
                          <li key={i} className="text-xs text-me-charcoal/75">{r}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="mb-4 space-y-3">
                    <h3 className="text-sm font-medium text-me-charcoal">人工审核清单</h3>
              <p className="text-xs text-me-charcoal/75">所有项需逐项标记 PASS 才能通过。「事实有来源」两项要填来源网址:已按这条片的链接预填,请确认这个页面确实支持片里的价格/天数/日期,不是就改成对应产品页。点「全部标为通过」前请先逐项看过。</p>
              <button
                type="button"
                onClick={() => setChecklistDraft(prev => allPass(prev))}
                className="px-3 min-h-11 rounded-lg border border-black/10 bg-white text-xs text-me-charcoal/75 hover:bg-me-ivory"
              >{REEL_HUMAN_CHECK_KEYS_V3.length - MANUAL_ONLY_KEYS.length} 项全部标为通过（“已听声音”“能看懂”需单独勾）</button>
              {REEL_HUMAN_CHECK_KEYS_V3.map(key => (
                <div key={key} className="rounded-lg border border-black/10 p-3">
                  <p className="text-sm font-medium text-me-charcoal">{HUMAN_CHECK_LABEL[key]}</p>
                  <div className="mt-2 flex gap-4 text-xs">
                    {(['PASS', 'FAIL', 'NOT_MEASURED'] as const).map(outcome => (
                      <label key={outcome} className="flex min-h-11 items-center gap-1.5">
                        <input
                          type="radio"
                          name={`check-${confirming.id}-${key}`}
                          checked={checklistDraft[key].outcome === outcome}
                          onChange={() => setChecklistDraft(prev => ({ ...prev, [key]: { ...prev[key], outcome } }))}
                        />
                        {outcome === 'NOT_MEASURED' ? '未检查' : outcome}
                      </label>
                    ))}
                  </div>
                  {checklistDraft[key].outcome === 'FAIL' && (
                    <input
                      className="mt-2 w-full rounded border border-black/15 px-2 py-2 text-sm text-me-charcoal"
                      placeholder="说明未通过原因"
                      value={checklistDraft[key].detail}
                      onChange={e => setChecklistDraft(prev => ({ ...prev, [key]: { ...prev[key], detail: e.target.value } }))}
                    />
                  )}
                  {(key === 'factual_claims_have_source' || key === 'factual_claims_source_verified') && (
                    <input
                      className="mt-2 w-full rounded border border-black/15 px-2 py-2 text-sm text-me-charcoal"
                      placeholder="来源 HTTPS URL 或 client_asset:<ID>"
                      value={checklistDraft[key].source_ref}
                      onChange={e => setChecklistDraft(prev => ({ ...prev, [key]: { ...prev[key], source_ref: e.target.value } }))}
                    />
                  )}
                    </div>
                  ))}
                  </div>
                </>
              )
            })()}

            {/* 文案只陈述能保证的事实:发布 cron 每小时跑一次;全局开关没开时只发草稿。 */}
            <p className="text-sm text-me-charcoal/75 mb-5">
              通过 = 标记这条合格、<span className="font-medium text-me-charcoal">排入发布队列</span>。
              发布程序每小时自动跑一次,队列里的片子会自动发到客户主页;
              <span className="font-medium text-me-charcoal">全局发布开关没开时只存成草稿、不公开</span>(看板会标「Facebook 草稿，未公开」)。请按「已经会发出去」的标准把关。确定通过?
            </p>
            {error && <div className="mb-3 px-3 py-2 rounded-lg bg-status-rej/10 text-status-rej text-sm">{error}</div>}
            <div className="flex gap-3">
              {(showDetails || !gateOf(confirming).oneClick) && (
                <button
                  onClick={() => void act(confirming.id, { action: 'approve', checklist_human: checklistPayload(checklistDraft) })}
                  disabled={busy === confirming.id || !autoChecklistReady(confirming) || REEL_HUMAN_CHECK_KEYS_V3.some(key => checklistDraft[key].outcome !== 'PASS')}
                  className="flex-1 min-h-11 rounded-lg bg-me-ochre text-white text-sm font-medium hover:bg-me-ochre/90 disabled:opacity-50"
                >{busy === confirming.id ? '处理中…' : '确定通过'}</button>
              )}
              <button onClick={() => setConfirming(null)} className="px-5 min-h-11 rounded-lg border border-black/10 bg-white text-me-charcoal/75 text-sm hover:bg-me-ivory">再想想</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
