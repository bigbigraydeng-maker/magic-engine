'use client'

import { useCallback, useEffect, useState } from 'react'
import type { WorkOrderStatus } from '@/lib/factory/types'
import type { PublishedView } from '@/lib/factory/publish/publish-display'
import { REEL_HUMAN_CHECK_KEYS, type CheckItemOutcome, type ContentCheckItemResult, type ContentCheckItemKey } from '@/lib/social/content-review'
import { defaultFactSourceRef, reviewErrorZh, reviewGate } from '@/lib/factory/review-ui'
import { isAcceptableFlagCategory } from '@/lib/factory/review-flag-categories'
import { factoryVideoUrl } from '@/lib/factory/outlets'
import { FactoryChat } from './FactoryChat'
import { OneClickConfirm } from './OneClickConfirm'
import { OrderNo } from './OrderNo'
import { PublishOutlets } from './PublishOutlets'
import { publishedBadge } from './statusMeta'
import { PendingCardHead, ReadOnlyTile } from './OrderTile'
import { groupCounts, parseAngle } from './reviewCardMeta'

// P21.J ME 原生化 P1 — 审核 Inbox(spec me-native-design v0.2 §2.1)
// 试验田:看片 + 拍板。in_review 工单 → 大号播放器 + 人话理由 +
// 「通过并投放(上限 $50)」一步轻确认 + 一键打回理由。审完自动翻下一条。

interface WorkOrder {
  id: string
  client_id: string
  client_name: string
  status: WorkOrderStatus
  fact_source_url?: string | null // 工单自带的官网产品页(brief.copy.endcard.url),用来预填「事实有来源」
  angle: string
  rationale_one_liner: string
  created_at?: string
  published?: PublishedView | null
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
  accepted_flags?: Array<{ category: string; accepted_at: string; accepted_by: string }>
}

const redlineHitsOf = (o: WorkOrder): string[] =>
  Array.isArray(o.output?.redline_hits) ? o.output.redline_hits.filter((h) => typeof h === 'string' && h) : []

const qualityFlagsOf = (o: WorkOrder): Array<{ category: string; detail: string }> =>
  Array.isArray(o.output?.quality_flags)
    ? o.output.quality_flags
        .filter((f) => f && typeof f === 'object')
        .map((f) => ({
          category: typeof f.category === 'string' && f.category ? f.category : 'unknown',
          detail: typeof f.detail === 'string' ? f.detail : '',
        }))
    : []

const autoChecklistOf = (o: WorkOrder): ContentCheckItemResult[] =>
  Array.isArray(o.output?.quality_checklist_auto) ? o.output.quality_checklist_auto : []
const autoChecklistReady = (o: WorkOrder): boolean =>
  autoChecklistOf(o).length > 0 && autoChecklistOf(o).every(item => item.judge === 'AUTO' && item.outcome === 'PASS')

const acceptedCategoriesOf = (o: WorkOrder): string[] => (o.accepted_flags ?? []).map(f => f.category)

const acceptedDateOf = (o: WorkOrder, category: string): string | null => {
  const entry = (o.accepted_flags ?? []).find(f => f.category === category)
  return entry ? entry.accepted_at.slice(0, 10) : null
}

const gateOf = (o: WorkOrder) => reviewGate({
  autoReady: autoChecklistReady(o),
  redlineHits: redlineHitsOf(o),
  qualityFlags: qualityFlagsOf(o),
  acceptedCategories: acceptedCategoriesOf(o),
  factSourcePrefilled: defaultFactSourceRef(o.fact_source_url) !== '',
})

const QUALITY_FLAG_LABEL: Record<string, string> = {
  competitor_brand: '⚠️ 疑似把竞品品牌当自己卖点',
  placeholder_caption: '⚠️ 字幕疑似内部标签冒充文案',
  narrator_voice_mismatch: '⚠️ 人称口吻疑似不符简报要求',
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
  format_is_reel: '发布格式为 Reel',
  cta_in_first_comment_not_body: 'CTA 位于首评而非正文',
  first_comment_link_has_tracking_params: '首评链接含追踪参数',
}

type ChecklistDraft = Record<ContentCheckItemKey, { outcome: CheckItemOutcome; detail: string; source_ref: string }>
const FACT_KEYS: readonly ContentCheckItemKey[] = ['factual_claims_have_source', 'factual_claims_source_verified']
const emptyChecklistDraft = (factSource = ''): ChecklistDraft => Object.fromEntries(
  REEL_HUMAN_CHECK_KEYS.map(key => [key, { outcome: 'NOT_MEASURED', detail: '', source_ref: FACT_KEYS.includes(key) ? factSource : '' }]),
) as ChecklistDraft

const allPass = (draft: ChecklistDraft): ChecklistDraft =>
  Object.fromEntries(REEL_HUMAN_CHECK_KEYS.map(key => [key, { ...draft[key], outcome: 'PASS' }])) as ChecklistDraft

const checklistPayload = (draft: ChecklistDraft): ContentCheckItemResult[] =>
  REEL_HUMAN_CHECK_KEYS.map(key => ({
    key,
    judge: 'HUMAN',
    outcome: draft[key].outcome,
    detail: draft[key].detail.trim() || null,
    source_ref: draft[key].source_ref.trim() || null,
  }))

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const publicUrl = (path?: string) =>
  path ? `${SUPABASE_URL}/storage/v1/object/public/content-factory/${path}` : ''

// clientId:只看该客户的待审(客户页概览用);hideWhenEmpty:没待审就不渲染(不占地方)
export function ReviewInbox({ clientId, hideWhenEmpty }: { clientId?: string; hideWhenEmpty?: boolean } = {}) {
  const [orders, setOrders] = useState<WorkOrder[]>([])
  const [published, setPublished] = useState<WorkOrder[]>([]) // 只读展示:已发布
  const [superseded, setSuperseded] = useState<WorkOrder[]>([]) // 只读展示:已作废,折叠在页面底部
  const [groupFilter, setGroupFilter] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [hasShown, setHasShown] = useState(false) // 显示过一次就常驻,刷新不卸载(防对话框丢历史)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [acceptedFlagsError, setAcceptedFlagsError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<WorkOrder | null>(null)
  const [checklistDraft, setChecklistDraft] = useState<ChecklistDraft>(emptyChecklistDraft)
  const [showDetails, setShowDetails] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/factory/work-orders')
      if (!res.ok) throw new Error(`加载失败 (${res.status})`)
      const json = await res.json()
      const pending = (json.orders ?? []).filter(
        (o: WorkOrder & { client_id?: string }) =>
          o.status === 'in_review' && (!clientId || o.client_id === clientId),
      )
      setOrders(pending)
      const mine = (json.orders ?? []).filter((o: WorkOrder & { client_id?: string }) => !clientId || o.client_id === clientId)
      setPublished(mine.filter((o: WorkOrder) => o.status === 'published'))
      setSuperseded(mine.filter((o: WorkOrder) => o.status === 'superseded'))
      if (pending.length > 0) setHasShown(true)
      setError(null)
      setAcceptedFlagsError(typeof json.accepted_flags_error === 'string' && json.accepted_flags_error ? json.accepted_flags_error : null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [clientId])

  useEffect(() => { void load() }, [load])

  const act = useCallback(async (id: string, payload: Record<string, unknown>) => {
    setBusy(id)
    setError(null)
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
      setOrders((prev) => prev.filter((o) => o.id !== id)) // 审完自动翻下一条
      setConfirming(null)
    } catch (e) {
      setError(e instanceof Error ? reviewErrorZh(e.message, k => HUMAN_CHECK_LABEL[k as ContentCheckItemKey] ?? k) : '操作失败')
    } finally {
      setBusy(null)
    }
  }, [])

  const acceptFlag = useCallback(async (id: string, category: string) => {
    setBusy(id)
    setError(null)
    try {
      const res = await fetch(`/api/factory/work-orders/${id}/accept-flag`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setError(`没接受成功:${j.error ?? res.status}`)
        return
      }
      await load()
    } finally {
      setBusy(null)
    }
  }, [load])

  // 只在「从没显示过 + 当前也没待审」时隐藏。一旦显示过就常驻——刷新时绝不整体卸载,
  // 否则右侧对话框(ReviewInbox 的子组件)会被连带卸载,历史 + 正在输入的指令全丢(PM 报的 bug)。
  if (hideWhenEmpty && !hasShown && orders.length === 0 && published.length === 0 && superseded.length === 0) return null
  // 选中的团已无卡片(例如最后一条审完)→ 视同「全部」,否则剩余卡片被过滤光且筛选控件可能已隐藏
  const groups = groupCounts([...orders, ...published].map((o) => o.angle))
  const activeGroup = groupFilter && groups.some((g) => g.group === groupFilter) ? groupFilter : null
  if (!hasShown && loading) return <p className="text-sm text-slate-400 mb-6">加载待审…</p>

  return (
    <section className="mb-8">
      <h2 className="text-sm font-medium text-slate-600 mb-3">
        待审 {orders.length > 0 ? <span className="text-amber-600">· 今天 {orders.length} 条等你</span> : <span className="text-slate-400">· 都审完了,去忙别的</span>}
      </h2>

      {error && !confirming && <div className="mb-3 px-4 py-2 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>}
      {acceptedFlagsError && <div className="mb-3 px-4 py-2 rounded-lg bg-red-50 text-red-700 text-sm">「已接受」记录读取失败,已接受的提醒可能显示不准:{acceptedFlagsError}</div>}

      <div className={clientId ? 'grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4 items-start' : ''}>
      <div>
        {(() => {
          if (groups.length <= 1) return null
          return (
            <div className="flex flex-wrap gap-2 mb-4" role="group" aria-label="按团筛选">
              {[{ group: null as string | null, count: orders.length + published.length }, ...groups].map((g) => (
                <button
                  key={g.group ?? 'all'}
                  type="button"
                  onClick={() => setGroupFilter(g.group)}
                  aria-pressed={activeGroup === g.group}
                  className={`px-3 h-8 rounded-full text-xs font-medium border ${activeGroup === g.group ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}
                >{g.group ?? '全部'} · {g.count}</button>
              ))}
            </div>
          )
        })()}
        <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(240px,1fr))]">
        {orders.filter((o) => !activeGroup || parseAngle(o.angle).group === activeGroup).map((o) => (
          <div key={o.id} className="border border-slate-200 rounded-xl bg-white p-3 flex flex-col">
            <PendingCardHead
              id={o.id}
              angle={o.angle}
              rationale={o.rationale_one_liner}
              clientName={o.client_name}
              createdAt={o.created_at}
              videoSrc={publicUrl(o.output?.video_path)}
            />

            <div className="flex-1 min-w-0 flex flex-col">
              {redlineHitsOf(o).length > 0 && (
                <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                  <p className="text-sm font-medium text-red-800">⚠️ 文案命中品牌红线,请逐字核对后再通过</p>
                  <p className="mt-1 flex flex-wrap gap-1.5">
                    {redlineHitsOf(o).map((h) => (
                      <span key={h} className="text-xs bg-red-100 text-red-800 rounded px-1.5 py-0.5 font-mono">{h}</span>
                    ))}
                  </p>
                </div>
              )}

              {qualityFlagsOf(o).length > 0 && (
                <div className="mb-4 space-y-1">
                  {qualityFlagsOf(o).filter(f => isAcceptableFlagCategory(f.category) && acceptedCategoriesOf(o).includes(f.category)).map((f, i) => (
                    <p key={`accepted-${i}`} className="text-sm text-slate-500">
                      已接受({acceptedDateOf(o, f.category)}) · {QUALITY_FLAG_LABEL[f.category]?.replace('⚠️ ', '') ?? '品控提示'}
                    </p>
                  ))}
                  {qualityFlagsOf(o).some(f => !(isAcceptableFlagCategory(f.category) && acceptedCategoriesOf(o).includes(f.category))) && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 space-y-1">
                      {qualityFlagsOf(o).filter(f => !(isAcceptableFlagCategory(f.category) && acceptedCategoriesOf(o).includes(f.category))).map((f, i) => (
                        <div key={i}>
                          <p className="text-sm text-amber-800">
                            <span className="font-medium">{QUALITY_FLAG_LABEL[f.category] ?? '⚠️ 品控提示'}</span>
                            <span className="block text-xs text-amber-700 mt-0.5">{f.detail}</span>
                          </p>
                          {isAcceptableFlagCategory(f.category) && (
                            <>
                              <button
                                type="button"
                                onClick={() => void acceptFlag(o.id, f.category)}
                                disabled={busy === o.id}
                                title="接受 = 这份简报下以后同类口吻提醒不再挡路;改了人设会重新提醒"
                                className="mt-1 px-2 h-7 rounded border border-amber-300 text-xs text-amber-800 hover:bg-amber-100 disabled:opacity-50"
                              >PM 已接受</button>
                              <p className="mt-1 text-xs text-amber-700">接受 = 这份简报下以后同类口吻提醒不再挡路;改了人设会重新提醒</p>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {!autoChecklistReady(o) && (
                <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                  <p className="text-sm font-medium text-red-800">自动媒体检测未完成，服务端会阻断通过</p>
                  <p className="mt-1 text-xs text-red-700">
                    {autoChecklistOf(o).length > 0
                      ? autoChecklistOf(o).filter(item => item.outcome !== 'PASS').map(item => `${HUMAN_CHECK_LABEL[item.key] ?? item.key}：${item.detail ?? '未测'}`).join('；')
                      : '自动检查清单缺失'}
                  </p>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2 mb-2">
                <button
                  onClick={() => { setError(null); setConfirming(o); setShowDetails(false); setChecklistDraft(emptyChecklistDraft(defaultFactSourceRef(o.fact_source_url))) }}
                  disabled={busy === o.id}
                  className="w-full sm:w-auto px-5 h-11 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-50"
                >{busy === o.id ? '处理中…' : '✓ 通过·待发布'}</button>
                {o.output?.video_path && (
                  <a
                    href={factoryVideoUrl(o.output.video_path, SUPABASE_URL, `${o.id.slice(0, 8)}.mp4`)}
                    download
                    className="ml-3 text-sm text-blue-600 underline"
                    target="_blank"
                    rel="noopener noreferrer"
                  >下载成片</a>
                )}
              </div>

              <PublishOutlets />

              <p className="text-xs text-slate-400">要改画面或调预算?在右边跟 Claude 说人话即可。</p>
            </div>
          </div>
        ))}
        </div>

        {(() => {
          const shown = published.filter((o) => !activeGroup || parseAngle(o.angle).group === activeGroup)
          if (shown.length === 0) return null
          return (
            <div className="mt-8">
              <h2 className="text-sm font-medium text-slate-600 mb-3">已发布 · {shown.length} 条</h2>
              <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(240px,1fr))]">
                {shown.map((o) => {
                  const b = publishedBadge(o.published ?? null)
                  const tone = b.color.includes('green') ? 'green' : b.color.includes('slate') ? 'slate' : 'amber'
                  return (
                  <ReadOnlyTile
                    key={o.id}
                    id={o.id}
                    angle={o.angle}
                    rationale={o.rationale_one_liner}
                    clientName={o.client_name}
                    createdAt={o.created_at}
                    videoSrc={publicUrl(o.output?.video_path)}
                    status={{ label: b.label, tone }}
                    link={b.href ? { href: b.href, label: '在 Facebook 查看' } : null}
                  />
                  )
                })}
              </div>
            </div>
          )
        })()}

        {superseded.length > 0 && (
          <details className="mt-8 group">
            <summary className="cursor-pointer select-none text-sm font-medium text-slate-500">已作废 · {superseded.length} 条(旧版,已被新版替换,默认收起)</summary>
            <div className="mt-3 grid gap-4 grid-cols-[repeat(auto-fill,minmax(240px,1fr))]">
              {superseded.map((o) => (
                <ReadOnlyTile
                  key={o.id}
                  id={o.id}
                  angle={o.angle}
                  rationale={o.rationale_one_liner}
                  clientName={o.client_name}
                  createdAt={o.created_at}
                  videoSrc={publicUrl(o.output?.video_path)}
                  status={{ label: '已作废', tone: 'slate' }}
                  dim
                />
              ))}
            </div>
          </details>
        )}
      </div>

        {clientId && <FactoryChat clientId={clientId} onActed={load} />}
      </div>

      {confirming && (
        <div className="fixed inset-0 z-40 bg-black/45 grid place-items-center p-4" onClick={() => setConfirming(null)}>
          <div role="dialog" aria-modal="true" className="bg-white rounded-xl p-6 max-w-3xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-1">
              <p className="font-medium text-slate-900">通过并排入发布队列</p>
              <OrderNo id={confirming.id} />
            </div>

            {redlineHitsOf(confirming).length > 0 && (
              <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                <p className="text-sm font-medium text-red-800">⚠️ 这条命中了品牌红线</p>
                <p className="mt-1 flex flex-wrap gap-1.5">
                  {redlineHitsOf(confirming).map((h) => (
                    <span key={h} className="text-xs bg-red-100 text-red-800 rounded px-1.5 py-0.5 font-mono">{h}</span>
                  ))}
                </p>
              </div>
            )}

            {qualityFlagsOf(confirming).length > 0 && (
              <div className="mb-3 space-y-1">
                {qualityFlagsOf(confirming).filter(f => isAcceptableFlagCategory(f.category) && acceptedCategoriesOf(confirming).includes(f.category)).map((f, i) => (
                  <p key={`accepted-${i}`} className="text-sm text-slate-500">
                    已接受({acceptedDateOf(confirming, f.category)}) · {QUALITY_FLAG_LABEL[f.category]?.replace('⚠️ ', '') ?? '品控提示'}
                  </p>
                ))}
                {qualityFlagsOf(confirming).some(f => !(isAcceptableFlagCategory(f.category) && acceptedCategoriesOf(confirming).includes(f.category))) && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 space-y-1">
                    {qualityFlagsOf(confirming).filter(f => !(isAcceptableFlagCategory(f.category) && acceptedCategoriesOf(confirming).includes(f.category))).map((f, i) => (
                      <p key={i} className="text-sm text-amber-800">
                        <span className="font-medium">{QUALITY_FLAG_LABEL[f.category] ?? '⚠️ 品控提示'}</span>
                        <span className="block text-xs text-amber-700 mt-0.5">{f.detail}</span>
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {(() => {
              const gate = gateOf(confirming)
              const detailsOpen = showDetails || !gate.oneClick
              if (!detailsOpen) {
                return (
                  <div className="mb-4">
                    <OneClickConfirm
                      itemLabels={REEL_HUMAN_CHECK_KEYS.map(k => HUMAN_CHECK_LABEL[k])}
                      sourceUrl={defaultFactSourceRef(confirming.fact_source_url)}
                      busy={busy === confirming.id}
                      onConfirm={() => void act(confirming.id, { action: 'approve', checklist_human: checklistPayload(allPass(checklistDraft)) })}
                      onExpand={() => setShowDetails(true)}
                    />
                  </div>
                )
              }
              return (
                <>
                  {!gate.oneClick && (
                    <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                      <p className="text-sm font-medium text-amber-800">不能一键通过,请逐项核对:</p>
                      <ul className="mt-1 list-disc list-inside space-y-0.5">
                        {gate.reasons.map((r, i) => (
                          <li key={i} className="text-xs text-amber-700">{r}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div className="mb-4 space-y-3">
                    <h3 className="text-sm font-medium text-slate-800">人工审核清单</h3>
              <p className="text-xs text-amber-700">所有项需逐项标记 PASS 才能通过。「事实有来源」两项要填来源网址:已按这条片的链接预填,请确认这个页面确实支持片里的价格/天数/日期,不是就改成对应产品页。点「全部标为通过」前请先逐项看过。</p>
              <button
                type="button"
                onClick={() => setChecklistDraft(prev => Object.fromEntries(REEL_HUMAN_CHECK_KEYS.map(key => [key, { ...prev[key], outcome: 'PASS' }])) as ChecklistDraft)}
                className="px-3 h-8 rounded-lg border border-slate-300 text-xs hover:bg-slate-50"
              >{REEL_HUMAN_CHECK_KEYS.length} 项全部标为通过</button>
              {REEL_HUMAN_CHECK_KEYS.map(key => (
                <div key={key} className="rounded-lg border border-slate-200 p-3">
                  <p className="text-sm font-medium text-slate-800">{HUMAN_CHECK_LABEL[key]}</p>
                  <div className="mt-2 flex gap-4 text-xs">
                    {(['PASS', 'FAIL', 'NOT_MEASURED'] as const).map(outcome => (
                      <label key={outcome} className="flex items-center gap-1">
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
                      className="mt-2 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                      placeholder="说明未通过原因"
                      value={checklistDraft[key].detail}
                      onChange={e => setChecklistDraft(prev => ({ ...prev, [key]: { ...prev[key], detail: e.target.value } }))}
                    />
                  )}
                  {(key === 'factual_claims_have_source' || key === 'factual_claims_source_verified') && (
                    <input
                      className="mt-2 w-full rounded border border-slate-300 px-2 py-1 text-sm"
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
            <p className="text-sm text-slate-600 mb-5">
              通过 = 标记这条合格、<span className="font-medium text-slate-900">排入发布队列</span>。
              发布程序每小时自动跑一次,队列里的片子会自动发到客户主页;
              <span className="font-medium text-slate-900">全局发布开关没开时只存成草稿、不公开</span>(看板会标「发布时存为草稿」)。请按「已经会发出去」的标准把关。确定通过?
            </p>
            {error && <div className="mb-3 px-3 py-2 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>}
            <div className="flex gap-3">
              {(showDetails || !gateOf(confirming).oneClick) && (
                <button
                  onClick={() => void act(confirming.id, { action: 'approve', checklist_human: checklistPayload(checklistDraft) })}
                  disabled={busy === confirming.id || !autoChecklistReady(confirming) || REEL_HUMAN_CHECK_KEYS.some(key => checklistDraft[key].outcome !== 'PASS')}
                  className="flex-1 h-10 rounded-lg bg-slate-900 text-white text-sm font-medium hover:bg-slate-700 disabled:opacity-50"
                >{busy === confirming.id ? '处理中…' : '确定通过'}</button>
              )}
              <button onClick={() => setConfirming(null)} className="px-5 h-10 rounded-lg border border-slate-200 text-sm">再想想</button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
