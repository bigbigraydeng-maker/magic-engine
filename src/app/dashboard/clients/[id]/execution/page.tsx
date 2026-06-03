'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useParams, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import type { ExecutionItemStatus, ExecutionLog, ExecutionTarget, LinkedContentPost } from '@/types/diagnostic'
import { FlywheelDrawer } from './_components/FlywheelDrawer'
import { LubanChatDrawer } from './_components/LubanChatDrawer'
import { InlinePrescriptionDrawer } from './_components/InlinePrescriptionDrawer'
import { ProjectLubanDrawer } from './_components/ProjectLubanDrawer'
import { ProjectReviewDrawer } from './_components/ProjectReviewDrawer'
import { ContentStudioDrawer } from './_components/ContentStudioDrawer'
import { AdsFixDrawer } from './_components/AdsFixDrawer'
import { AdsAuditSection } from './_components/AdsAuditSection'
import {
  buildExecutionGroups,
  buildDimensionGroups,
  formatOutcomeLabel,
  isAutonomousItem,
  MARKETING_PLAN_GROUP_PREFIX,
  FDE_MANUAL_GROUP_ID,
  type GroupData,
  type DimensionGroup,
  type ItemWithLogs,
  type MarketingPlanMeta,
  type OutcomeSummary,
  type PrescriptionMeta,
} from './execution-view-model'
import { FdeManualEntryModal } from './_components/FdeManualEntryModal'
import { DataPullbackSection } from './_components/DataPullbackSection'
import { AnomalySignalPanel } from './_components/AnomalySignalPanel'
import { IntelligenceSummarySection } from '../_components/intelligence/IntelligenceSummarySection'
import { BriefGateBanner } from '../_components/BriefGateBanner'
// MemoryAnnotationPanel removed — Phase 20.D item 6: system handles flywheel recording automatically

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// ── 帖子状态徽章配色（与 content 板对齐）─────────────────────────────────────────

const POST_STATUS_META: Record<string, { label: string; cls: string }> = {
  draft:     { label: '草稿',   cls: 'bg-yellow-100 text-yellow-700' },
  approved:  { label: '已批准', cls: 'bg-green-100 text-green-700' },
  scheduled: { label: '已排期', cls: 'bg-blue-100 text-blue-700' },
  published: { label: '已发布', cls: 'bg-gray-100 text-gray-700' },
  rejected:  { label: '已拒绝', cls: 'bg-red-100 text-red-700' },
}

function LinkedContentCard({ post, clientId }: { post: LinkedContentPost; clientId: string }) {
  const [generating, setGenerating] = useState(false)
  const [genMsg, setGenMsg] = useState<string | null>(null)
  const [localAssetUrl, setLocalAssetUrl] = useState<string | null>(post.visual_asset_url)

  const meta = POST_STATUS_META[post.status] ?? { label: post.status, cls: 'bg-gray-100 text-gray-600' }
  const scheduledLabel = post.scheduled_at
    ? new Date(post.scheduled_at).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
    : null

  const handleGenerateImage = async () => {
    setGenerating(true)
    setGenMsg(null)
    try {
      const res = await fetch('/api/visual/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ post_id: post.id, client_id: clientId, aspect_ratio: '1:1' }),
      })
      const json = await res.json() as { success: boolean; storage_url?: string; error?: string }
      if (!json.success) throw new Error(json.error ?? '生成失败')
      setLocalAssetUrl(json.storage_url ?? null)
      setGenMsg('✓ 已生成')
    } catch (e) {
      setGenMsg(`✗ ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="mt-2 rounded-lg border border-indigo-100 bg-indigo-50/40 p-2.5 flex gap-3 items-start">
      {/* Thumbnail */}
      {localAssetUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={localAssetUrl}
          alt={post.title}
          className="w-16 h-16 rounded-md object-cover border border-indigo-200 flex-shrink-0 bg-white"
        />
      ) : (
        <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-md border border-dashed border-cyan-200 bg-white text-[10px] font-black text-cyan-800">
          DOC
        </div>
      )}
      {/* Body */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 mb-1">
          <p className="text-xs font-semibold text-gray-900 truncate">{post.title}</p>
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium whitespace-nowrap ${meta.cls}`}>
            {meta.label}
          </span>
        </div>
        {post.caption && (
          <p className="text-[11px] text-gray-500 line-clamp-2 leading-snug">{post.caption}</p>
        )}
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          {post.platforms.slice(0, 4).map(p => (
            <span key={p} className="text-[10px] bg-white border border-gray-200 px-1.5 py-0.5 rounded capitalize text-gray-600">
              {p}
            </span>
          ))}
          {scheduledLabel && (
            <span className="text-[10px] text-blue-600 font-medium">📅 {scheduledLabel}</span>
          )}
        </div>
        {/* Action row */}
        <div className="flex items-center gap-2 mt-2 flex-wrap">
          {post.status === 'draft' && !localAssetUrl && (
            <button
              onClick={() => void handleGenerateImage()}
              disabled={generating}
              className="text-xs px-2 py-1 rounded bg-violet-100 text-violet-700 hover:bg-violet-200 disabled:opacity-50 font-medium transition-colors"
            >
              {generating ? '生成中…' : '生成图片'}
            </button>
          )}
          <Link
            href={`/dashboard/content?client=${clientId}&highlight=${post.id}`}
            target="_blank"
            rel="noreferrer"
            className="text-xs px-2 py-1 rounded bg-white border border-indigo-200 text-indigo-600 hover:bg-indigo-50 font-medium transition-colors"
          >
            查看详情 →
          </Link>
          {genMsg && (
            <span className={`text-[11px] ${genMsg.startsWith('✓') ? 'text-green-600' : 'text-red-500'}`}>
              {genMsg}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

const FIX_TYPE_META: Record<string, { label: string; cls: string; icon?: string }> = {
  me_auto:     { label: 'ME 自动',  cls: 'bg-blue-100 text-blue-700',  icon: '⚡' },
  fde_manual:  { label: 'FDE 手动', cls: 'bg-cyan-50 text-cyan-800',   icon: '🛠' },
  third_party: { label: '第三方',   cls: 'bg-gray-100 text-gray-600',  icon: '🔗' },
}

const STATUS_META: Record<ExecutionItemStatus, { label: string; color: string }> = {
  pending:     { label: '待处理', color: 'bg-gray-100 text-gray-600' },
  in_progress: { label: '进行中', color: 'bg-blue-100 text-blue-700' },
  completed:   { label: '已完成', color: 'bg-green-100 text-green-700' },
  skipped:     { label: '已跳过', color: 'bg-yellow-100 text-yellow-700' },
}

const STATUS_FLOW: ExecutionItemStatus[] = ['pending', 'in_progress', 'completed', 'skipped']

// 下拉菜单内每个状态项前的色点 — STATUS_META.color 太浅，单独取饱和色
const STATUS_DOT: Record<ExecutionItemStatus, string> = {
  pending:     'bg-gray-400',
  in_progress: 'bg-blue-500',
  completed:   'bg-green-500',
  skipped:     'bg-yellow-500',
}

// 可在内容工作台（ContentStudioDrawer）生成内容的诊断维度
const CONTENT_STUDIO_DIMENSIONS = new Set<string>(['seo', 'ai_visibility', 'social'])

const PHASE_LABELS: Record<number, { name: string; color: string; talkToUs?: boolean }> = {
  1: { name: 'Phase 1 — 即时修复',  color: 'bg-indigo-600' },
  2: { name: 'Phase 2 — 结构改善',  color: 'bg-purple-600' },
  3: { name: 'Phase 3 — 长期增长',  color: 'bg-teal-600', talkToUs: true },
}

const TALK_TO_US_HREF = '/discover'

// module → 工作台跳转（legacy fallback，适用于 execution_target 为 null 的旧数据）
// path 接 (clientId, itemId) — itemId 透传给目标页（ContentHub 等）用于自动关联生成的内容
const MODULE_ROUTE: Record<string, { label: string; path: (clientId: string, itemId: string) => string }> = {
  seo_engine:       { label: 'SEO 引擎',  path: (c, i) => `/dashboard/clients/${c}/site-audit/pages?exec=${i}` },
  social_matrix:    { label: '社媒矩阵',  path: (c, i) => `/dashboard/clients/${c}?tab=reels&exec=${i}` },
  ads_intelligence: { label: '广告',      path: (c, i) => `/dashboard/clients/${c}?tab=campaigns&exec=${i}` },
  insight_reports:  { label: '数据报告',  path: (c, _i) => `/dashboard/clients/${c}` },
}

// flywheel → in_house 按钮标签
const FLYWHEEL_IN_HOUSE_LABEL: Record<string, string> = {
  seo:    'SEO 引擎',
  geo:    'GEO Composer',
  ads:    '广告工作台',
  social: '社媒矩阵',
}

// flywheel → third_party 跳转路由
// path 接 (clientId, itemId) — itemId 透传给目标页用于自动关联生成的内容到执行项
const FLYWHEEL_THIRD_PARTY_ROUTE: Record<string, { label: string; path: (clientId: string, itemId: string) => string }> = {
  ads:    { label: '广告平台',  path: (c, i) => `/dashboard/clients/${c}?tab=campaigns&exec=${i}` },
  social: { label: '社媒平台',  path: (c, i) => `/dashboard/clients/${c}?tab=reels&exec=${i}` },
  seo:    { label: 'SEO 工具', path: (c, i) => `/dashboard/clients/${c}/site-audit/pages?exec=${i}` },
  geo:    { label: 'GEO 工具', path: (c, _i) => `/dashboard/clients/${c}` },
}

const LOG_KIND_META: Record<string, { label: string; cls: string }> = {
  note:          { label: 'Note', cls: 'text-slate-600' },
  status_change: { label: 'Status', cls: 'text-blue-700' },
  ai_assist:     { label: 'Assist', cls: 'text-cyan-800' },
  blocker:       { label: 'Blocker', cls: 'text-red-700' },
  adjustment:    { label: 'Adjust', cls: 'text-amber-700' },
}

// ---------------------------------------------------------------------------
// OutcomeChip — P12.A.10
// ---------------------------------------------------------------------------

const VERDICT_META: Record<string, { icon: string; cls: string }> = {
  confirmed:    { icon: '✅', cls: 'bg-green-50 border-green-200 text-green-700' },
  inconclusive: { icon: '⚠️', cls: 'bg-yellow-50 border-yellow-200 text-yellow-700' },
  reversed:     { icon: '❌', cls: 'bg-red-50 border-red-200 text-red-700' },
}

function OutcomeChip({ outcome }: { outcome: OutcomeSummary }) {
  const vm = VERDICT_META[outcome.verdict] ?? VERDICT_META.inconclusive
  const label = formatOutcomeLabel(outcome)

  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border font-medium ${vm.cls}`}
      title={`归因计算时间：${new Date(outcome.computed_at).toLocaleString('zh-CN')}`}
    >
      {vm.icon} {label}
    </span>
  )
}

// ---------------------------------------------------------------------------
// ActiveCampaignBanner — FDE 工作上下文锚点
// ---------------------------------------------------------------------------
//
// Master Brief（品牌 DNA）× Campaign Brief（活动目标）= 内容生产的上下文基座。
// 看板顶部常驻显示，让 FDE 在执行任务时随时看到当前服务的 Campaign。
// 多 Campaign 时全部展示（通常 1–2 条），无 Campaign 时显示 amber 警告。

interface ActiveCampaignLite {
  id: string
  title: string
  description?: string | null
  valid_from?: string | null
  valid_until?: string | null
  semrush_keywords?: unknown[] | null
  source_urls?: string[] | null
}

function CampaignRow({ c, clientId }: { c: ActiveCampaignLite; clientId: string }) {
  const [expanded, setExpanded] = useState(false)
  const dateLabel = (() => {
    if (c.valid_from && c.valid_until) return `${c.valid_from} → ${c.valid_until}`
    if (c.valid_from)  return `${c.valid_from} 起`
    if (c.valid_until) return `至 ${c.valid_until}`
    return null
  })()
  const keywords     = Array.isArray(c.semrush_keywords) ? (c.semrush_keywords as string[]) : []
  const sourceUrls   = Array.isArray(c.source_urls) ? c.source_urls : []

  return (
    <div className="rounded-lg border border-indigo-100 bg-white/70">
      {/* Clickable summary row */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-indigo-50/50 transition-colors rounded-lg"
      >
        <span className="inline-flex items-center text-[10px] font-bold bg-green-100 text-green-700 rounded-full px-1.5 py-0.5 mt-0.5 shrink-0">
          进行中
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-gray-900">{c.title}</p>
          {!expanded && c.description && (
            <p className="text-[11px] text-gray-500 line-clamp-1 leading-snug">{c.description}</p>
          )}
          <div className="flex items-center gap-3 mt-0.5 text-[10px] text-gray-400">
            {dateLabel && <span>📅 {dateLabel}</span>}
            {keywords.length > 0 && <span>🔑 {keywords.length} 关键词</span>}
          </div>
        </div>
        <span className="shrink-0 text-[10px] text-indigo-400 font-semibold mt-0.5">
          {expanded ? '▲ 收起' : '▼ 详情'}
        </span>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-3 pb-3 space-y-2 border-t border-indigo-100 pt-2">
          {c.description && (
            <div>
              <p className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider mb-0.5">活动目标</p>
              <p className="text-[11px] text-gray-700 leading-relaxed whitespace-pre-wrap">{c.description}</p>
            </div>
          )}
          {keywords.length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider mb-1">核心关键词</p>
              <div className="flex flex-wrap gap-1">
                {keywords.slice(0, 20).map((kw, i) => (
                  <span key={i} className="text-[10px] bg-indigo-50 text-indigo-700 border border-indigo-200 rounded px-1.5 py-0.5">{String(kw)}</span>
                ))}
                {keywords.length > 20 && (
                  <span className="text-[10px] text-gray-400">+{keywords.length - 20} 更多</span>
                )}
              </div>
            </div>
          )}
          {sourceUrls.length > 0 && (
            <div>
              <p className="text-[10px] font-bold text-indigo-500 uppercase tracking-wider mb-1">参考资料</p>
              <div className="space-y-0.5">
                {sourceUrls.map((url, i) => (
                  <p key={i} className="text-[10px] text-gray-500 truncate">{url}</p>
                ))}
              </div>
            </div>
          )}
          <div className="flex justify-end pt-1">
            <Link
              href={`/dashboard/clients/${clientId}`}
              className="text-[10px] font-semibold text-indigo-600 hover:text-indigo-800 underline"
            >
              在客户页编辑 →
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}

function ActiveCampaignBanner({ clientId }: { clientId: string }) {
  const [campaigns, setCampaigns] = useState<ActiveCampaignLite[]>([])
  const [loaded, setLoaded]       = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/campaign?status=active`)
        if (!res.ok) { if (!cancelled) setLoaded(true); return }
        const json = await res.json() as { campaigns?: ActiveCampaignLite[] }
        if (!cancelled) {
          setCampaigns(json.campaigns ?? [])
          setLoaded(true)
        }
      } catch {
        if (!cancelled) setLoaded(true)
      }
    })()
    return () => { cancelled = true }
  }, [clientId])

  if (!loaded) return null

  // 无活跃 Campaign — amber 警告
  if (campaigns.length === 0) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-lg shrink-0">⚠</span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-amber-900">尚无活跃 Campaign</p>
            <p className="text-xs text-amber-700">
              内容生成将仅依据品牌 DNA — 建议为本期工作设置一个 Campaign 提供清晰目标
            </p>
          </div>
        </div>
        <Link
          href={`/dashboard/clients/${clientId}`}
          className="shrink-0 text-xs font-semibold text-amber-700 hover:text-amber-900 underline whitespace-nowrap"
        >
          前往设置 →
        </Link>
      </div>
    )
  }

  // 有活跃 Campaign — 蓝色条，每行可内联展开详情
  return (
    <div className="rounded-xl border border-indigo-200 bg-gradient-to-r from-indigo-50 to-white px-4 py-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider">
          ⚓ 当前 Campaign 上下文
        </span>
        <span className="text-[10px] text-gray-400">
          ({campaigns.length === 1 ? '1 个活跃' : `${campaigns.length} 个并行`}) · 点击行查看详情
        </span>
      </div>
      <div className="space-y-1.5">
        {campaigns.map(c => (
          <CampaignRow key={c.id} c={c} clientId={clientId} />
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ProgressBar
// ---------------------------------------------------------------------------

function ProgressBar({ completed, total }: { completed: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((completed / total) * 100)
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 flex items-center gap-4">
      <div className="flex-1">
        <div className="flex justify-between items-center mb-1">
          <span
            className="text-sm font-medium text-gray-700 inline-flex items-center gap-1.5"
            title="统计范围：所有 FDE 执行项 + 飞轮自主行动。项目级鲁班抽屉里的数字只含 FDE 执行项，会比这里少。"
          >
            整体执行进度
            <span className="text-[10px] font-normal text-gray-400 border border-gray-200 rounded px-1 py-px">
              含飞轮自主行动
            </span>
          </span>
          <span className="text-sm font-bold text-indigo-700">{pct}%</span>
        </div>
        <div className="w-full bg-gray-100 rounded-full h-2">
          <div
            className="bg-indigo-500 h-2 rounded-full transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <div className="text-right whitespace-nowrap">
        <span className="text-2xl font-bold text-indigo-700">{completed}</span>
        <span className="text-sm text-gray-400"> / {total}</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// 工作日志时间线
// ---------------------------------------------------------------------------

const BLOG_REF_RE = /\s*\[blog:([a-zA-Z0-9_-]+)\]/

function WorklogTimeline({ logs, clientId }: { logs: ExecutionLog[]; clientId: string }) {
  if (logs.length === 0) {
    return <p className="text-xs text-gray-400 py-2">暂无工作记录</p>
  }

  // Deduplicate consecutive ai_assist logs with identical content — keep only the latest.
  const deduped = logs.reduce<ExecutionLog[]>((acc, log) => {
    if (log.kind === 'ai_assist') {
      const existingIdx = acc.findIndex(l => l.kind === 'ai_assist' && l.content === log.content)
      if (existingIdx !== -1) {
        // Replace older entry with the newer one (logs are ordered oldest-first from API)
        acc[existingIdx] = log
        return acc
      }
    }
    acc.push(log)
    return acc
  }, [])

  return (
    <ul className="space-y-2">
      {deduped.map(log => {
        const m = LOG_KIND_META[log.kind] ?? { label: 'Log', cls: 'text-slate-500' }
        const when = new Date(log.created_at).toLocaleString('zh-CN', {
          timeZone: 'Pacific/Auckland', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit',
        })
        const authorLabel = log.author === 'fde' ? 'FDE' : log.author === 'luban' ? '鲁班' : '系统'
        const blogMatch = BLOG_REF_RE.exec(log.content)
        const blogPostId = blogMatch?.[1]
        const displayContent = log.content.replace(BLOG_REF_RE, '')
        return (
          <li key={log.id} className="flex gap-2 text-xs">
            <span className="mt-0.5 h-fit shrink-0 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-black uppercase tracking-[0.08em] text-slate-400">
              {m.label}
            </span>
            <div className="flex-1 min-w-0">
              <span className={`${m.cls} break-words`}>{displayContent}</span>
              {blogPostId && (
                <Link
                  href={`/dashboard/clients/${clientId}/blog/${blogPostId}`}
                  className="ml-1.5 inline-flex items-center gap-0.5 text-indigo-600 hover:text-indigo-800 font-medium underline underline-offset-2"
                >
                  查看文章 →
                </Link>
              )}
              <span className="text-gray-300 ml-2 whitespace-nowrap">{authorLabel} · {when}</span>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// FDE 元数据行（从 steps_json 读取华佗写入的字段）
// ---------------------------------------------------------------------------

function FdeMetaRow({ stepsJson }: { stepsJson: Record<string, unknown> | null }) {
  if (!stepsJson) return null
  const hours   = typeof stepsJson.estimated_hours === 'number' ? stepsJson.estimated_hours : null
  const skills  = Array.isArray(stepsJson.required_skills) ? stepsJson.required_skills as string[] : []
  const measure = typeof stepsJson.measurement_method === 'string' ? stepsJson.measurement_method : null
  const deps    = Array.isArray(stepsJson.dependencies) ? stepsJson.dependencies as string[] : []

  if (hours == null && skills.length === 0 && !measure && deps.length === 0) return null

  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-gray-500">
      {hours != null && <span>⏱ 预计 <strong className="text-gray-700">{hours}h</strong></span>}
      {skills.length > 0 && <span>🛠 {skills.join(' / ')}</span>}
      {measure && <span>📏 {measure}</span>}
      {deps.length > 0 && <span className="text-amber-600">↳ 依赖 {deps.length} 项</span>}
    </div>
  )
}

// StatusDropdown - compact status switcher scoped to the active drawer/card.
// Keep the menu local so it never floats over a lower board layer.
// ---------------------------------------------------------------------------

function StatusDropdown({
  status,
  onChange,
}: {
  status: ExecutionItemStatus
  onChange: (status: ExecutionItemStatus) => void
}) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const current = STATUS_META[status]

  useEffect(() => {
    if (!open) return
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', closeOnOutsideClick)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick)
    }
  }, [open])

  return (
    <div ref={menuRef} className="relative inline-block shrink-0">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        title="Change status"
        className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${current.color} hover:ring-2 hover:ring-inset hover:ring-black/10 transition`}
      >
        {current.label}
        <span className="opacity-50 text-[10px]">v</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-[90] mt-1 w-36 rounded-lg border border-slate-200 bg-white py-1 shadow-xl shadow-slate-900/10">
          {STATUS_FLOW.map(s => (
            <button
              key={s}
              type="button"
              onClick={() => { setOpen(false); if (s !== status) onChange(s) }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-slate-50 ${
                s === status ? 'font-semibold text-slate-950' : 'text-slate-600'
              }`}
            >
              <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[s]}`} />
              <span className="flex-1">{STATUS_META[s].label}</span>
              {s === status && <span className="text-indigo-500">*</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ExecutionItemCard — 紧凑卡片（点击打开右侧详情抽屉）
// ---------------------------------------------------------------------------

const DIMENSION_CARD_META: Record<string, { label: string; cls: string }> = {
  seo:           { label: 'SEO',  cls: 'bg-blue-50 text-blue-600' },
  ai_visibility: { label: 'GEO', cls: 'bg-violet-50 text-violet-600' },
  social:        { label: '社媒', cls: 'bg-pink-50 text-pink-600' },
  ads:           { label: '广告', cls: 'bg-orange-50 text-orange-600' },
  reputation:    { label: '口碑', cls: 'bg-teal-50 text-teal-600' },
  competitor:    { label: '竞品', cls: 'bg-yellow-50 text-yellow-600' },
}

function ExecutionItemCard({
  item,
  isActive,
  onOpenDetail,
  isBackgroundGenerating = false,
  initiativeLabel,
}: {
  item:         ItemWithLogs
  isActive:     boolean
  onOpenDetail: (item: ItemWithLogs) => void
  isBackgroundGenerating?: boolean
  /** Phase 33: Initiative title for badge — shown when item.initiative_id is set */
  initiativeLabel?: string
}) {
  const fixMeta     = FIX_TYPE_META[item.fix_type ?? ''] ?? FIX_TYPE_META.fde_manual
  const statusMeta  = STATUS_META[item.status]
  const dimMeta     = DIMENSION_CARD_META[item.dimension ?? '']
  const dueDate     = item.due_date
  const hasAiAssist = item.logs?.some(l => l.kind === 'ai_assist') ?? false
  const logCount    = item.logs?.length ?? 0

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpenDetail(item)}
      onKeyDown={e => e.key === 'Enter' && onOpenDetail(item)}
      className={`cursor-pointer select-none rounded-lg border p-2.5 transition-all ${
        isActive
          ? 'border-cyan-300 bg-cyan-50 shadow-sm'
          : isBackgroundGenerating
            ? 'border-cyan-200 bg-cyan-50/50 shadow-sm'
            : 'border-slate-200 bg-white hover:border-cyan-200 hover:shadow-sm'
      }`}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-950 text-[9px] font-black text-white">
          {fixMeta.label.slice(0, 2).toUpperCase()}
        </span>
        <div className="flex-1 min-w-0">
          <p className="line-clamp-2 text-xs font-black leading-tight text-slate-900">{item.title}</p>
          {item.description && (
            <p className="mt-0.5 line-clamp-1 text-[11px] font-semibold text-slate-400">{item.description}</p>
          )}
        </div>
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${statusMeta.color}`}>
          {statusMeta.label}
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
        {dimMeta && (
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${dimMeta.cls}`}>{dimMeta.label}</span>
        )}
        {dueDate && <span className="text-[10px] text-gray-400">{dueDate}</span>}
        {isBackgroundGenerating && (
          <span className="flex items-center gap-1 text-[10px] font-bold text-cyan-700">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-500" />
            制作中
          </span>
        )}
        {item.source === 'proactive_signal' && (
          <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">⚡ 系统检测</span>
        )}
        {!isBackgroundGenerating && hasAiAssist && <span className="text-[10px] font-bold text-cyan-700">AI 草稿</span>}
        {logCount > 0 && <span className="text-[10px] text-gray-400">{logCount} 条日志</span>}
        {initiativeLabel && (
          <span className="text-[10px] font-bold text-me-ochre bg-me-ochre/10 px-1.5 py-0.5 rounded truncate max-w-[120px]" title={initiativeLabel}>
            ◈ {initiativeLabel}
          </span>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// TaskDetailDrawer — 右侧详情抽屉（FDE 工作台，不离开看板）
// ---------------------------------------------------------------------------

function TaskDetailDrawer({
  item,
  clientId,
  editable,
  onClose,
  onStatusChange,
  onAddLog,
  onOpenChat,
  onOpenFlywheel,
  onOpenStudio,
  onEditItem,
  onDeleteItem,
  onOpenAdsFixDrawer,
  railOpen = false,
}: {
  item:           ItemWithLogs | null
  clientId:       string
  editable:       boolean
  onClose:        () => void
  onStatusChange: (id: string, status: ExecutionItemStatus) => void
  onAddLog:       (id: string, content: string, kind: 'note' | 'blocker') => Promise<void>
  onOpenChat:     (item: ItemWithLogs) => void
  onOpenFlywheel: (item: ItemWithLogs, target: ExecutionTarget) => void
  onOpenStudio:   (item: ItemWithLogs) => void
  onEditItem:     (itemId: string, fields: { title?: string; description?: string }) => Promise<boolean>
  onDeleteItem:   (itemId: string) => Promise<void>
  onOpenAdsFixDrawer?: (item: ItemWithLogs) => void
  railOpen?:       boolean
}) {
  const [mounted, setMounted]           = useState(false)
  const [addingLog, setAddingLog]       = useState(false)
  const [noteText, setNoteText]         = useState('')
  const [editingTitle, setEditingTitle] = useState(false)
  const [editTitle, setEditTitle]       = useState('')
  const [editingDesc, setEditingDesc]   = useState(false)
  const [editDesc, setEditDesc]         = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  // P21.8 — AI Factory 一键量产
  const [factoryLoading, setFactoryLoading] = useState(false)
  const [factoryResult, setFactoryResult]   = useState<{ successCount: number; packageId: string | null } | null>(null)
  const [factoryError, setFactoryError]     = useState<string | null>(null)
  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    setNoteText('')
    setEditingTitle(false)
    setEditingDesc(false)
    setConfirmDelete(false)
  }, [item?.id])

  if (!mounted || !item) return null
  const activeItem = item

  // P21.8 — AI Factory 一键量产处理器
  const stepsJson = activeItem.steps_json as Record<string, unknown> | null
  const factoryTopic    = typeof stepsJson?.topic === 'string' ? stepsJson.topic : null
  const factoryPlatform = typeof stepsJson?.platform === 'string' ? stepsJson.platform : null
  const isFactoryTask   = stepsJson?.source === 'marketing_plan' && !!factoryTopic

  async function handleFactoryFanOut() {
    if (!factoryTopic) return
    setFactoryLoading(true)
    setFactoryResult(null)
    setFactoryError(null)
    try {
      const platforms = factoryPlatform ? [factoryPlatform] : undefined
      const res = await fetch(`/api/clients/${clientId}/ai-factory/fan-out`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic:          factoryTopic,
          platforms,
          executionItemId: activeItem.id,
        }),
      })
      const data = await res.json() as { success: boolean; successCount?: number; packageId?: string; error?: string }
      if (!data.success) throw new Error(data.error ?? '量产失败')
      setFactoryResult({ successCount: data.successCount ?? 0, packageId: data.packageId ?? null })
    } catch (err) {
      setFactoryError(err instanceof Error ? err.message : '量产失败，请重试')
    } finally {
      setFactoryLoading(false)
    }
  }

  const fixMeta      = FIX_TYPE_META[item.fix_type ?? ''] ?? FIX_TYPE_META.fde_manual
  const isDone       = item.status === 'completed' || item.status === 'skipped'
  const isReadonly   = !editable || isAutonomousItem(item)
  const execTarget = item.execution_target

  const execButton = (() => {
    if (!execTarget) return null
    // in_house flywheel recording removed (item 6) — system auto-records, no FDE manual entry
    if (execTarget.mode === 'in_house') return null
    if (execTarget.mode === 'third_party') {
      const route = FLYWHEEL_THIRD_PARTY_ROUTE[execTarget.flywheel]
      // Ads flywheel: show both "Fix Now (Meta API)" and external link
      if (execTarget.flywheel === 'ads' && onOpenAdsFixDrawer) {
        return (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => onOpenAdsFixDrawer(item)}
              className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-orange-200 bg-orange-50 px-3 text-xs font-black text-orange-800 transition-colors hover:bg-orange-100"
            >
              直接执行 (Meta API)
            </button>
            {route && (
              <a href={route.path(item.client_id, item.id)}
                target="_blank" rel="noopener noreferrer"
                className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 transition-colors hover:border-slate-300"
              >
                Open in {route.label}
              </a>
            )}
          </div>
        )
      }
      if (!route) return null
      return (
        <a href={route.path(item.client_id, item.id)}
          target="_blank" rel="noopener noreferrer"
          className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-cyan-200 bg-cyan-50 px-3 text-xs font-black text-cyan-800 transition-colors hover:bg-cyan-100"
        >
          Open in {route.label}
        </a>
      )
    }
    if (execTarget.mode === 'external_manual') {
      return (
        <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-500">
          Mark complete after FDE work
        </span>
      )
    }
    return null
  })()

  const submitNote = async (kind: 'note' | 'blocker') => {
    if (!noteText.trim()) return
    setAddingLog(true)
    await onAddLog(item.id, noteText.trim(), kind)
    setNoteText('')
    setAddingLog(false)
  }

  const drawerContent = (
    <div className={`fixed inset-y-0 z-[70] flex w-full flex-col overflow-hidden border-l border-slate-200 bg-[#f6f7f2] shadow-2xl transition-[right] duration-200 sm:w-[420px] lg:w-[480px] ${
      railOpen
        ? 'right-0 lg:right-[min(780px,calc(100vw-30rem))] xl:right-[min(880px,48vw)]'
        : 'right-0'
    }`}>
      {/* 抽屉头 */}
      <div className="shrink-0 border-b border-slate-200 px-4 py-4">
        <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-cyan-200 bg-cyan-50 text-base font-black text-cyan-800">
          {fixMeta.label.slice(0, 2).toUpperCase()}
        </span>
        <div className="flex-1 min-w-0">
          {editingTitle ? (
            <div className="flex items-center gap-1.5">
              <input
                autoFocus
                value={editTitle}
                onChange={e => setEditTitle(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    if (editTitle.trim() && editTitle.trim() !== item.title) {
                      void onEditItem(item.id, { title: editTitle.trim() })
                    }
                    setEditingTitle(false)
                  }
                  if (e.key === 'Escape') setEditingTitle(false)
                }}
                className="flex-1 bg-transparent px-0 py-0 text-sm font-black text-slate-950 border-b border-cyan-500 focus:outline-none"
              />
              <button onClick={() => setEditingTitle(false)} className="text-xs font-black text-slate-400">x</button>
            </div>
          ) : (
            <div className="flex items-center gap-1 group/title">
              <p className="truncate text-base font-black leading-tight text-slate-950">{item.title}</p>
              {!isReadonly && (
                <button
                  onClick={() => { setEditTitle(item.title); setEditingTitle(true) }}
                  className="text-xs font-black text-slate-300 opacity-0 transition-opacity hover:text-cyan-700 group-hover/title:opacity-100"
                  title="编辑标题"
                >Edit</button>
              )}
            </div>
          )}
          <FdeMetaRow stepsJson={item.steps_json} />
          {item.source === 'proactive_signal' && (
            <span className="mt-1 inline-block text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">⚡ 系统检测 · 诸葛亮主动发现</span>
          )}
        </div>
        <button
          onClick={onClose}
          className="ml-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-lg font-black text-slate-400 transition hover:border-slate-300 hover:text-slate-700"
          aria-label="Close task detail"
        >
          x
        </button>
        </div>
      </div>

      {/* 主体（可滚动） */}
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {/* 状态控制 */}
        {!isReadonly
          ? <StatusDropdown status={item.status} onChange={status => onStatusChange(item.id, status)} />
          : <span className={`inline-block text-xs px-2 py-1 rounded-full font-medium ${STATUS_META[item.status].color}`}>{STATUS_META[item.status].label}</span>
        }

        {/* 说明 */}
        <div>
          <div className="flex items-center gap-1 mb-1 group/desc">
            <p className="text-xs font-medium text-gray-500">说明</p>
            {!isReadonly && !editingDesc && (
              <button
                onClick={() => { setEditDesc(item.description ?? ''); setEditingDesc(true) }}
                className="opacity-0 group-hover/desc:opacity-100 text-gray-400 hover:text-indigo-500 text-xs transition-opacity"
              >✎</button>
            )}
          </div>
          {editingDesc ? (
            <div className="space-y-1.5">
              <textarea
                autoFocus
                value={editDesc}
                onChange={e => setEditDesc(e.target.value)}
                rows={4}
                className="w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-700 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
              />
              <div className="flex gap-2">
                <button onClick={() => setEditingDesc(false)}
                  className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
                >取消</button>
                <button
                  onClick={async () => {
                    if (editDesc.trim() !== (item.description ?? '')) {
                      await onEditItem(item.id, { description: editDesc.trim() })
                    }
                    setEditingDesc(false)
                  }}
                  className="flex-1 rounded bg-slate-950 px-2 py-1 text-xs font-black text-white hover:bg-slate-800"
                >保存</button>
              </div>
            </div>
          ) : (
            <p className="text-xs text-gray-700 leading-relaxed whitespace-pre-wrap">
              {item.description || <span className="text-gray-400 italic">暂无说明</span>}
            </p>
          )}
        </div>

        {/* 关联内容 */}
        {item.linked_post && <LinkedContentCard post={item.linked_post} clientId={clientId} />}

        {/* Outcome chip */}
        {item.outcome && <OutcomeChip outcome={item.outcome} />}

        {/* 操作按钮区 */}
        {/* Item 5: 进行中 → 已生成则显示工作台链接，否则显示进度条 */}
        {item.status === 'in_progress' && (() => {
          const socialDone = item.logs?.some(
            l => l.kind === 'ai_assist' && l.content?.includes('社媒内容已在后台生成完成')
          ) ?? false
          if (socialDone) {
            return (
              <div className="w-full rounded-lg border border-green-100 bg-green-50/60 px-3 py-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-black text-green-700 uppercase tracking-wide">✓ 内容已生成</span>
                  <a
                    href={`/dashboard/content?client=${clientId}`}
                    className="text-[11px] font-bold text-cyan-600 hover:text-cyan-800 underline"
                  >
                    打开工作台 →
                  </a>
                </div>
              </div>
            )
          }
          return (
            <div className="w-full rounded-lg border border-cyan-100 bg-cyan-50/60 px-3 py-2.5">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[11px] font-black text-cyan-700 uppercase tracking-wide">制作中</span>
                <span className="text-[10px] text-cyan-500">系统处理中…</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-cyan-100">
                <div className="h-full animate-pulse rounded-full bg-cyan-500" style={{ width: '70%' }} />
              </div>
            </div>
          )
        })()}
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            onClick={() => onOpenChat(item)}
            className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 transition hover:border-slate-300 hover:text-slate-950"
          >
            Luban
          </button>
          {/* Item 5: 只在 pending 显示；Item 4: 自主飞轮不显示 */}
          {CONTENT_STUDIO_DIMENSIONS.has(item.dimension ?? '') && !isAutonomousItem(item) && item.status === 'pending' && (
            <button
              onClick={() => onOpenStudio(item)}
              className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-cyan-200 bg-cyan-50 px-3 text-xs font-black text-cyan-800 transition hover:bg-cyan-100"
            >
              Generate content
            </button>
          )}
          {CONTENT_STUDIO_DIMENSIONS.has(item.dimension ?? '') && !isAutonomousItem(item) && item.status === 'in_progress' && item.logs?.some(l => l.kind === 'ai_assist' && l.content?.includes('社媒内容已在后台生成完成')) && (
            <button
              onClick={() => onOpenStudio(item)}
              className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-green-200 bg-green-50 px-3 text-xs font-black text-green-800 transition hover:bg-green-100"
            >
              查看 / 调整内容
            </button>
          )}
          {/* Item 4: 自主飞轮操作全部关闭；Item 6: in_house 在 execButton 内已 return null */}
          {!isAutonomousItem(item) && execButton}

          {/* P21.8 — AI Factory 一键量产（仅 marketing_plan 来源且有 topic 的任务） */}
          {isFactoryTask && !isDone && (
            <button
              onClick={() => void handleFactoryFanOut()}
              disabled={factoryLoading}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 text-xs font-black text-violet-800 transition hover:bg-violet-100 disabled:opacity-60"
            >
              {factoryLoading ? (
                <><span className="h-2 w-2 animate-spin rounded-full border border-violet-500 border-t-transparent" />量产中…</>
              ) : (
                <>⚡ 一键量产</>
              )}
            </button>
          )}
        </div>

        {/* P21.8 — AI Factory 量产结果反馈 */}
        {factoryResult && (
          <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs font-bold text-green-700">
            ✅ 已生成 {factoryResult.successCount} 条草稿 — 前往
            <a
              href={
                factoryResult.packageId
                  ? `/dashboard/clients/${clientId}/production/${factoryResult.packageId}`
                  : `/dashboard/content?client=${clientId}`
              }
              className="ml-1 underline hover:text-green-900"
            >
              生产包
            </a>
            查看
          </div>
        )}
        {factoryError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">
            ❌ {factoryError}
          </div>
        )}

        {/* 工作日志时间线 */}
        {(item.logs?.length ?? 0) > 0 && (
          <WorklogTimeline logs={item.logs!} clientId={item.client_id} />
        )}

        {/* 加日志 */}
        {!isDone && !isReadonly && (
          <div className="flex items-start gap-2 pt-1">
            <textarea
              value={noteText}
              onChange={e => setNoteText(e.target.value)}
              rows={2}
              placeholder="记录执行进度，或标记卡点…"
              className="min-h-20 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-700 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
            />
            <div className="flex shrink-0 flex-col gap-1.5">
              <button type="button" onClick={() => void submitNote('note')}
                disabled={addingLog || !noteText.trim()}
                className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-black text-white hover:bg-slate-800 disabled:opacity-50"
              >Record</button>
              <button type="button" onClick={() => void submitNote('blocker')}
                disabled={addingLog || !noteText.trim()}
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-black text-red-700 hover:bg-red-100 disabled:opacity-50"
              >Blocker</button>
            </div>
          </div>
        )}

        {/* 删除区 — 仅限 pending 状态 */}
        {!isReadonly && item.status === 'pending' && (
          <div className="pt-2 border-t border-gray-100">
            {confirmDelete ? (
              <div className="flex items-center gap-2">
                <p className="text-xs text-gray-500 flex-1">确认移除此任务？</p>
                <button onClick={() => setConfirmDelete(false)}
                  className="text-xs px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
                >取消</button>
                <button
                  onClick={async () => { await onDeleteItem(item.id); onClose() }}
                  className="text-xs px-2 py-1 rounded bg-red-600 text-white hover:bg-red-700"
                >移除</button>
              </div>
            ) : (
              <button onClick={() => setConfirmDelete(true)}
                className="text-xs text-red-400 hover:text-red-600 transition-colors"
              >移除此任务</button>
            )}
          </div>
        )}
      </div>
    </div>
  )

  return createPortal(drawerContent, document.body)
}

// ---------------------------------------------------------------------------
// Phase 看板列（kanban column — 可折叠）
// ---------------------------------------------------------------------------

const DIMENSION_OPTIONS: { v: string; label: string }[] = [
  { v: 'seo', label: 'SEO' },
  { v: 'ai_visibility', label: 'AI可见度' },
  { v: 'social', label: '社媒' },
  { v: 'reputation', label: '口碑' },
  { v: 'ads', label: '广告' },
  { v: 'competitor', label: '竞品' },
]
const FIX_TYPE_OPTIONS: { v: string; label: string }[] = [
  { v: 'fde_manual', label: 'FDE 手动' },
  { v: 'me_auto', label: 'ME 自动' },
  { v: 'third_party', label: '第三方' },
]
const SOCIAL_PLATFORM_OPTIONS: { v: string; label: string }[] = [
  { v: 'facebook',  label: 'Facebook' },
  { v: 'instagram', label: 'Instagram' },
  { v: 'tiktok',    label: 'TikTok' },
]
const SOCIAL_KIND_OPTIONS: { v: string; label: string }[] = [
  { v: 'social_post',  label: '帖子' },
  { v: 'social_reel',  label: 'Reel 视频' },
  { v: 'social_story', label: 'Story' },
]

function PhaseColumn({
  phase,
  items,
  defaultOpen,
  prescriptionId,
  editable,
  isMarketingPlan,
  activeDetailId,
  onOpenDetail,
  onAddItem,
  bgGeneratingIds,
  onReorder,
}: {
  phase: number
  items: ItemWithLogs[]
  defaultOpen: boolean
  prescriptionId: string
  editable: boolean
  isMarketingPlan: boolean
  activeDetailId: string | null
  onOpenDetail: (item: ItemWithLogs) => void
  onAddItem: (prescriptionId: string, phase: number, fields: AddItemFields) => Promise<boolean>
  bgGeneratingIds?: Set<string>
  onReorder?: (draggedId: string, targetId: string, columnItems: ItemWithLogs[]) => void
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [adding, setAdding] = useState(false)
  const [aTitle, setATitle] = useState('')
  const [aDesc, setADesc]   = useState('')
  const [aDim, setADim]     = useState('seo')
  const [aFix, setAFix]     = useState('fde_manual')
  const [aPlatform, setAPlatform] = useState('facebook')
  const [aKind, setAKind]         = useState('social_post')
  const [submitting, setSubmitting] = useState(false)
  const [dragOverId, setDragOverId] = useState<string | null>(null)

  const meta      = PHASE_LABELS[phase] ?? { name: `Phase ${phase}`, color: 'bg-gray-600' }
  const completed = items.filter(i => i.status === 'completed').length

  const submitAdd = async () => {
    if (!aTitle.trim()) return
    setSubmitting(true)
    const fields: AddItemFields = isMarketingPlan
      ? { title: aTitle.trim(), description: aDesc.trim() || aTitle.trim(), dimension: 'social', fix_type: 'fde_manual', platform: aPlatform, kind: aKind }
      : { title: aTitle.trim(), description: aDesc.trim() || aTitle.trim(), dimension: aDim, fix_type: aFix }
    const ok = await onAddItem(prescriptionId, phase, fields)
    setSubmitting(false)
    if (ok) {
      setATitle(''); setADesc(''); setADim('seo'); setAFix('fde_manual')
      setAPlatform('facebook'); setAKind('social_post')
      setAdding(false)
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden flex flex-col">
      {/* 列头 — 点击折叠/展开 */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3.5 py-3 bg-white hover:bg-gray-50 transition-colors border-b border-gray-100"
      >
        <span className={`w-2 h-2 rounded-full shrink-0 ${meta.color}`} />
        <span className="font-semibold text-sm text-gray-900 flex-1 text-left truncate">{meta.name}</span>
        <span className="text-xs text-gray-400 shrink-0">{completed}/{items.length}</span>
        <span className="text-gray-400 text-xs shrink-0">{open ? '▲' : '▼'}</span>
      </button>

      {/* 列体 — 卡片纵向堆叠 */}
      {open && (
        <div className="bg-gray-50 p-2.5 space-y-2.5 flex-1 min-h-[80px]">
          {/* Phase 3 Talk to Us 提示横幅 */}
          {meta.talkToUs && (
            <div className="rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 flex items-center justify-between gap-2">
              <p className="text-[11px] text-teal-700 leading-snug">
                这些行动建议先与我们沟通，制定专属策略后再执行
              </p>
              <a
                href={TALK_TO_US_HREF}
                className="shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold text-teal-700 border border-teal-300 rounded px-2 py-0.5 hover:bg-teal-100 transition-colors whitespace-nowrap"
              >
                Talk to Us →
              </a>
            </div>
          )}
          {items.length === 0 && !adding && (
            <p className="text-xs text-gray-400 text-center py-6">此阶段暂无执行项</p>
          )}
          {items.map(item => (
            <div
              key={item.id}
              draggable={!!onReorder}
              onDragStart={e => { e.dataTransfer.setData('text/plain', item.id); e.dataTransfer.effectAllowed = 'move' }}
              onDragOver={e => { if (!onReorder) return; e.preventDefault(); setDragOverId(item.id) }}
              onDragLeave={() => setDragOverId(null)}
              onDrop={e => {
                if (!onReorder) return
                e.preventDefault()
                setDragOverId(null)
                const draggedId = e.dataTransfer.getData('text/plain')
                if (draggedId && draggedId !== item.id) onReorder(draggedId, item.id, items)
              }}
              className={dragOverId === item.id ? 'ring-2 ring-inset ring-indigo-400 rounded-lg' : undefined}
            >
              <ExecutionItemCard
                item={item}
                isActive={activeDetailId === item.id}
                onOpenDetail={onOpenDetail}
                isBackgroundGenerating={bgGeneratingIds?.has(item.id) ?? false}
              />
            </div>
          ))}

          {/* 加执行项表单 */}
          {editable && adding && (
            <div className="rounded-lg border-2 border-dashed border-indigo-200 bg-white p-2.5 space-y-2">
              <input
                value={aTitle}
                onChange={e => setATitle(e.target.value)}
                placeholder="执行项标题"
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs focus:border-indigo-400 focus:outline-none"
              />
              <textarea
                value={aDesc}
                onChange={e => setADesc(e.target.value)}
                rows={2}
                placeholder="说明（可选，留空用标题）"
                className="w-full rounded border border-gray-300 px-2 py-1.5 text-xs focus:border-indigo-400 focus:outline-none"
              />
              <div className="flex gap-2">
                {isMarketingPlan ? (
                  <>
                    <select
                      value={aPlatform} onChange={e => setAPlatform(e.target.value)}
                      className="flex-1 rounded border border-gray-300 px-1.5 py-1 text-xs"
                    >
                      {SOCIAL_PLATFORM_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
                    </select>
                    <select
                      value={aKind} onChange={e => setAKind(e.target.value)}
                      className="flex-1 rounded border border-gray-300 px-1.5 py-1 text-xs"
                    >
                      {SOCIAL_KIND_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
                    </select>
                  </>
                ) : (
                  <>
                    <select
                      value={aDim} onChange={e => setADim(e.target.value)}
                      className="flex-1 rounded border border-gray-300 px-1.5 py-1 text-xs"
                    >
                      {DIMENSION_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
                    </select>
                    <select
                      value={aFix} onChange={e => setAFix(e.target.value)}
                      className="flex-1 rounded border border-gray-300 px-1.5 py-1 text-xs"
                    >
                      {FIX_TYPE_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
                    </select>
                  </>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => { setAdding(false); setATitle(''); setADesc('') }}
                  className="flex-1 rounded border border-gray-300 px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  onClick={() => void submitAdd()}
                  disabled={!aTitle.trim() || submitting}
                  className="flex-1 rounded bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {submitting ? '添加中…' : '添加'}
                </button>
              </div>
            </div>
          )}

          {/* + 加执行项 触发按钮 */}
          {editable && !adding && (
            <button
              onClick={() => setAdding(true)}
              className="w-full rounded-lg border border-dashed border-gray-300 py-2 text-xs text-gray-500 hover:border-indigo-300 hover:text-indigo-600 transition-colors"
            >
              ＋ 加执行项
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// FdeManualGroup — Phase 20.D：FDE 手动录入任务的平铺分组（可拖拽排序）
// ---------------------------------------------------------------------------

const REQUIRES_META: Record<string, { icon: string; label: string; cls: string }> = {
  client_photo: { icon: '📷', label: '需要照片', cls: 'bg-yellow-50 text-yellow-700 border border-yellow-200' },
  client_video: { icon: '🎬', label: '需要视频', cls: 'bg-orange-50 text-orange-700 border border-orange-200' },
  client_info:  { icon: '📄', label: '需要资料', cls: 'bg-sky-50 text-sky-700 border border-sky-200' },
  none:         { icon: '✅', label: '可自动生成', cls: 'bg-green-50 text-green-700 border border-green-200' },
}

function FdeManualGroup({
  group,
  activeDetailId,
  onOpenDetail,
  onReorder,
}: {
  group:          GroupData
  activeDetailId: string | null
  onOpenDetail:   (item: ItemWithLogs) => void
  onReorder:      (draggedId: string, targetId: string) => void
}) {
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const completed = group.items.filter(i => i.status === 'completed').length

  return (
    <div className="rounded-xl border border-indigo-200 bg-white overflow-hidden">
      {/* Group header */}
      <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-3 flex-wrap bg-indigo-50/40">
        <span className="text-xs font-semibold rounded-full px-2.5 py-1 bg-indigo-100 text-indigo-700">
          📝 FDE 录入工作
        </span>
        <span className="text-xs text-gray-400">{completed}/{group.items.length} 完成</span>
        <span className="text-xs text-gray-400 italic">拖拽任务可调整优先级</span>
      </div>

      {/* Flat item list */}
      <div className="p-4 bg-gray-50 space-y-2">
        {group.items.length === 0 && (
          <p className="text-xs text-gray-400 text-center py-6">暂无 FDE 录入工作</p>
        )}
        {group.items.map(item => {
          const dimMeta     = DIMENSION_CARD_META[item.dimension ?? '']
          const statusMeta  = STATUS_META[item.status]
          const fixMeta     = FIX_TYPE_META[item.fix_type ?? ''] ?? FIX_TYPE_META.fde_manual
          const requiresKey = (item.steps_json as Record<string, unknown> | null)?.requires as string | undefined
          const reqMeta     = requiresKey ? REQUIRES_META[requiresKey] : null

          return (
            <div
              key={item.id}
              draggable
              onDragStart={e => { e.dataTransfer.setData('text/plain', item.id); e.dataTransfer.effectAllowed = 'move' }}
              onDragOver={e => { e.preventDefault(); setDragOverId(item.id) }}
              onDragLeave={() => setDragOverId(null)}
              onDrop={e => {
                e.preventDefault()
                setDragOverId(null)
                const draggedId = e.dataTransfer.getData('text/plain')
                if (draggedId && draggedId !== item.id) onReorder(draggedId, item.id)
              }}
              role="button"
              tabIndex={0}
              onClick={() => onOpenDetail(item)}
              onKeyDown={ev => ev.key === 'Enter' && onOpenDetail(item)}
              className={`rounded-lg border p-2.5 cursor-pointer transition-all select-none ${
                dragOverId === item.id
                  ? 'border-indigo-400 bg-indigo-50/60 shadow-inner'
                  : activeDetailId === item.id
                    ? 'border-indigo-400 bg-indigo-50 shadow-sm'
                    : 'border-gray-200 bg-white hover:border-indigo-200 hover:shadow-sm'
              }`}
            >
              <div className="flex items-start gap-2">
                {/* Drag handle */}
                <span className="text-gray-300 text-sm mt-0.5 cursor-grab shrink-0" title="拖拽排序">⠿</span>
                <span className="text-base shrink-0 mt-0.5">{fixMeta.icon}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-900 line-clamp-2 leading-tight">{item.title}</p>
                  {item.description && (
                    <p className="text-[11px] text-gray-400 line-clamp-1 mt-0.5">{item.description}</p>
                  )}
                </div>
                <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded font-medium ${statusMeta.color}`}>
                  {statusMeta.label}
                </span>
              </div>
              <div className="mt-1.5 flex items-center gap-1.5 flex-wrap ml-9">
                {dimMeta && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${dimMeta.cls}`}>{dimMeta.label}</span>
                )}
                {item.due_date && <span className="text-[10px] text-gray-400">{item.due_date}</span>}
                {reqMeta && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${reqMeta.cls}`}>
                    {reqMeta.icon} {reqMeta.label}
                  </span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// PrescriptionGroup — 一个处方的执行项分组（P8.10.S5）
// ---------------------------------------------------------------------------

type AddItemFields = { title: string; description: string; dimension: string; fix_type: string; platform?: string; kind?: string }

function PrescriptionGroup({
  group,
  defaultOpen,
  activeDetailId,
  onDerive,
  onOpenDetail,
  onAddItem,
  bgGeneratingIds,
  onReorder,
}: {
  group: GroupData
  defaultOpen: boolean
  activeDetailId: string | null
  onDerive: (mode: 'supplement' | 'revision', priorId: string, priorLabel: string) => void
  onOpenDetail: (item: ItemWithLogs) => void
  onAddItem: (prescriptionId: string, phase: number, fields: AddItemFields) => Promise<boolean>
  bgGeneratingIds?: Set<string>
  onReorder?: (draggedId: string, targetId: string, columnItems: ItemWithLogs[]) => void
}) {
  const { items, label, archived, derivable, pid, meta, marketingPlanMeta, editable, kind } = group

  // 该处方内按 phase 分组，并按 sort_order 排序（拖拽排序依赖此顺序）
  const byPhase: Record<number, ItemWithLogs[]> = {}
  for (const it of items) {
    ;(byPhase[it.phase ?? 1] ??= []).push(it)
  }
  for (const key of Object.keys(byPhase)) {
    byPhase[Number(key)].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  }
  const completed = items.filter(i => i.status === 'completed').length

  // 分组日期 — 处方用 generated_at，Marketing Plan 用 approved_at
  const groupDate = (() => {
    const iso = meta?.generated_at ?? marketingPlanMeta?.approved_at ?? null
    if (!iso) return null
    return new Date(iso).toLocaleDateString('zh-CN', { timeZone: 'Pacific/Auckland' })
  })()
  const dateLabel = kind === 'marketing_plan' ? '批准于' : '生成于'

  const labelCls = (() => {
    if (kind === 'marketing_plan') {
      return archived ? 'bg-gray-100 text-gray-500' : 'bg-purple-100 text-purple-700'
    }
    if (kind === 'autonomous') return 'bg-green-100 text-green-700'
    // prescription
    if (label === '原处方')        return 'bg-indigo-100 text-indigo-700'
    if (label === '补充处方')      return 'bg-blue-100 text-blue-700'
    if (label === '修订版')        return 'bg-amber-100 text-amber-700'
    return 'bg-gray-200 text-gray-500'
  })()

  return (
    <div className={`rounded-xl border ${archived ? 'border-gray-200 opacity-75' : 'border-gray-300'} bg-white overflow-hidden`}>
      {/* 处方组头 */}
      <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-3 flex-wrap">
        <span className={`text-xs font-semibold rounded-full px-2.5 py-1 ${labelCls}`}>
          {label}
        </span>
        {groupDate && <span className="text-xs text-gray-400">{dateLabel} {groupDate}</span>}
        {kind === 'marketing_plan' && marketingPlanMeta?.start_date && marketingPlanMeta.end_date && (
          <span className="text-xs text-gray-400">
            📅 {marketingPlanMeta.start_date} → {marketingPlanMeta.end_date}
          </span>
        )}
        <span className="text-xs text-gray-400">{completed}/{items.length} 完成</span>

        {/* 派生按钮 — 仅已批准的活跃处方。内联抽屉，不跳转 */}
        {derivable && (
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => onDerive('supplement', pid, label)}
              className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 transition-colors"
              title="为这份处方生成增量动作，原处方不动"
            >
              🧩 补充处方
            </button>
            <button
              onClick={() => onDerive('revision', pid, label)}
              className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100 transition-colors"
              title="生成修订版 v2，批准后这份处方归档"
            >
              ↻ 修订处方
            </button>
          </div>
        )}
        {archived && (
          <span className="ml-auto text-xs text-gray-400">此处方已被修订版取代，仅供存档参考</span>
        )}
      </div>

      {/* 该处方的 3 个 phase — kanban 并列列布局 */}
      <div className="p-4 bg-gray-50">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-start">
          {[1, 2, 3].map(phase => (
            <PhaseColumn
              key={phase}
              phase={phase}
              items={byPhase[phase] ?? []}
              defaultOpen={defaultOpen}
              prescriptionId={pid}
              editable={editable}
              isMarketingPlan={kind === 'marketing_plan'}
              activeDetailId={activeDetailId}
              onOpenDetail={onOpenDetail}
              onAddItem={onAddItem}
              bgGeneratingIds={bgGeneratingIds}
              onReorder={onReorder}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// DimensionGroupSection — collapsible dimension group with 5-item preview
// ---------------------------------------------------------------------------

const PREVIEW_COUNT = 5

function DimensionGroupSection({
  group,
  activeDetailId,
  onOpenDetail,
  bgGeneratingIds,
  initiativeMap,
}: {
  group: DimensionGroup
  activeDetailId: string | null
  onOpenDetail: (item: ItemWithLogs) => void
  bgGeneratingIds?: Set<string>
  /** Phase 33: initiative_id → title for badge display */
  initiativeMap?: Map<string, string>
}) {
  const [expanded, setExpanded] = useState(false)

  const pending     = group.items.filter(i => i.status === 'pending').length
  const inProgress  = group.items.filter(i => i.status === 'in_progress').length
  const completed   = group.items.filter(i => i.status === 'completed').length
  const total       = group.items.length

  const visibleItems = expanded ? group.items : group.items.slice(0, PREVIEW_COUNT)
  const hiddenCount  = total - PREVIEW_COUNT

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      {/* Group header */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-3 px-5 py-3.5 bg-gray-50 border-b border-gray-100 hover:bg-gray-100 transition-colors text-left"
      >
        <span className="text-base">{group.icon}</span>
        <span className="text-sm font-black text-gray-900">{group.label}</span>
        <div className="flex items-center gap-2 ml-2">
          {inProgress > 0 && (
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700">
              {inProgress} 进行中
            </span>
          )}
          {pending > 0 && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">
              {pending} 待处理
            </span>
          )}
          {completed > 0 && (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-700">
              {completed} 已完成
            </span>
          )}
        </div>
        <span className="ml-auto text-xs text-gray-400">
          {expanded ? '▲ 收起' : `▼ 展开 · 共 ${total} 条`}
        </span>
      </button>

      {/* Items */}
      <div className="divide-y divide-gray-100 px-4 py-2 space-y-2">
        {visibleItems.map(item => (
          <ExecutionItemCard
            key={item.id}
            item={item}
            isActive={item.id === activeDetailId}
            onOpenDetail={onOpenDetail}
            isBackgroundGenerating={bgGeneratingIds?.has(item.id) ?? false}
            initiativeLabel={item.initiative_id ? initiativeMap?.get(item.initiative_id) : undefined}
          />
        ))}
      </div>

      {/* Show more / show less */}
      {!expanded && hiddenCount > 0 && (
        <button
          onClick={() => setExpanded(true)}
          className="w-full py-2.5 text-xs font-semibold text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 transition-colors border-t border-gray-100"
        >
          还有 {hiddenCount} 条 · 点击展开
        </button>
      )}
      {expanded && total > PREVIEW_COUNT && (
        <button
          onClick={() => setExpanded(false)}
          className="w-full py-2.5 text-xs font-semibold text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors border-t border-gray-100"
        >
          收起
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function ExecutionPage() {
  const params         = useParams()
  const searchParams   = useSearchParams()
  const clientId       = params.id as string
  const prescriptionId = searchParams.get('prescription_id') ?? undefined

  const [items, setItems]     = useState<ItemWithLogs[]>([])
  const [prescriptions, setPrescriptions] = useState<PrescriptionMeta[]>([])
  const [marketingPlans, setMarketingPlans] = useState<MarketingPlanMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)       // 页面加载错误（整页）
  const [opError, setOpError] = useState<string | null>(null)       // 操作错误（内联横幅）
  // 当前打开鲁班对话的执行项（null = 抽屉关闭）
  const [chatItem, setChatItem] = useState<ItemWithLogs | null>(null)
  // FlywheelDrawer done 后转交给鲁班的预填充消息
  const [lubanInitialMessage, setLubanInitialMessage] = useState('')
  // 当前打开飞轮执行抽屉的执行项 + target
  const [flywheelState, setFlywheelState] = useState<{ item: ItemWithLogs; target: ExecutionTarget } | null>(null)
  // 当前打开 Meta Ads 直接执行抽屉的执行项（P18.A.2）
  const [adsFixItem, setAdsFixItem] = useState<ItemWithLogs | null>(null)
  // 当前打开内容工作台的执行项（null = 关闭）
  const [studioItem, setStudioItem] = useState<ItemWithLogs | null>(null)
  // 内联补充/修订抽屉
  const [deriveDrawer, setDeriveDrawer] = useState<
    { mode: 'supplement' | 'revision'; priorId: string; priorLabel: string } | null
  >(null)
  // 项目级鲁班 / 三代理复盘抽屉（S5.3 / S6）
  const [projectLubanOpen, setProjectLubanOpen] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [isDocxLoading, setIsDocxLoading] = useState(false)
  const [showOverflow, setShowOverflow] = useState(false)
  // 右侧详情抽屉
  const [detailItem, setDetailItem]       = useState<ItemWithLogs | null>(null)
  const [detailEditable, setDetailEditable] = useState(false)
  // 维度过滤
  const [activeDimension, setActiveDimension] = useState<string>('all')
  // 状态过滤（全部/待处理/进行中/已完成）
  const [statusFilter, setStatusFilter] = useState<string>('all')
  // Phase 33: Goal filter — 'all' | goalId
  const [goalFilter, setGoalFilter] = useState<string>('all')
  // Phase 33: initiatives for the current client (id → title map + goal membership)
  const [initiativeMap, setInitiativeMap] = useState<Map<string, string>>(new Map())
  // Phase 33: goals for filter dropdown {id, title}
  const [goalsForFilter, setGoalsForFilter] = useState<Array<{ id: string; title: string }>>([])
  // Phase 33: goalId → Set<initiativeId> for filtering items by goal
  const [goalInitiativeIds, setGoalInitiativeIds] = useState<Map<string, Set<string>>>(new Map())
  // 客户名（面包屑导航用）
  const [clientName, setClientName] = useState<string | null>(null)
  // Phase 20.D: FDE 手动录入
  const [showManualEntry, setShowManualEntry] = useState(false)
  // 后台生成中的执行项 ID 集合（关闭 drawer 后仍在 AI 生成，kanban 卡片显示"制作中"）
  const [bgGeneratingIds, setBgGeneratingIds] = useState<Set<string>>(new Set())
  // 图片生成中的执行项 ID 集合（drawer 还开着，但图片在 Visual Studio 渲染，kanban 卡片也要显示"制作中"）
  const [imageGenActiveIds, setImageGenActiveIds] = useState<Set<string>>(new Set())
  // 后台图片生成任务（关抽屉后继续跑）：itemId → count（同一任务可能有多张并发）
  const [bgImageGenCount, setBgImageGenCount] = useState(0)
  // 指南针浮动面板
  const [compassOpen, setCompassOpen] = useState(false)
  const handleDownloadDocx = async () => {
    setIsDocxLoading(true)
    try {
      const qs = prescriptionId ? `?prescription_id=${prescriptionId}` : ''
      const res = await fetch(`/api/clients/${clientId}/execution/docx${qs}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const cd = res.headers.get('Content-Disposition') ?? ''
      const match = /filename="([^"]+)"/.exec(cd)
      a.download = match?.[1] ?? 'luban_execution.docx'
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      setOpError(e instanceof Error ? e.message : '下载失败')
    } finally {
      setIsDocxLoading(false)
    }
  }

  // silent=true 时不触发整页 loading skeleton — 用于状态切换/加日志后的静默刷新，
  // 避免每次操作都把整个看板替换成 skeleton 一闪（也保留了卡片的 expanded 状态）。
  const fetchItems = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError(null)
    try {
      const qs = prescriptionId ? `?prescription_id=${prescriptionId}` : ''
      // 并行拉 execution items + marketing plans，互不阻塞
      const [execRes, mpRes] = await Promise.all([
        fetch(`/api/clients/${clientId}/execution${qs}`, {
          cache: 'no-store',
        }),
        fetch(`/api/clients/${clientId}/marketing-plan`, { cache: 'no-store' }).catch(() => null),
      ])
      if (!execRes.ok) throw new Error(`HTTP ${execRes.status}`)
      const data = await execRes.json() as { items: ItemWithLogs[]; prescriptions?: PrescriptionMeta[] }
      setItems(data.items ?? [])
      setPrescriptions(data.prescriptions ?? [])

      // Marketing Plan meta — 失败不阻塞主流程
      if (mpRes && mpRes.ok) {
        try {
          const mpJson = await mpRes.json() as {
            success: boolean
            plans?: { id: string; title: string; status: MarketingPlanMeta['status']; start_date: string | null; end_date: string | null; approved_at: string | null }[]
          }
          if (mpJson.success && mpJson.plans) {
            setMarketingPlans(mpJson.plans.map(p => ({
              id: p.id, title: p.title, status: p.status,
              start_date: p.start_date, end_date: p.end_date, approved_at: p.approved_at,
            })))
          }
        } catch { /* non-fatal */ }
      }
    } catch (e) {
      if (!silent) setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [clientId, prescriptionId])

  useEffect(() => { void fetchItems() }, [fetchItems])

  // 客户名（面包屑展示用）— 非阻塞
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}`)
        if (!res.ok) return
        const json = await res.json() as { client?: { name: string } }
        if (json.client?.name) setClientName(json.client.name)
      } catch { /* non-fatal */ }
    })()
  }, [clientId])

  // Phase 33: load initiatives for badge + Goal filter
  useEffect(() => {
    void (async () => {
      try {
        const [initRes, goalRes] = await Promise.all([
          fetch(`/api/clients/${clientId}/initiatives`),
          fetch(`/api/clients/${clientId}/goals`),
        ])
        if (initRes.ok) {
          const j = await initRes.json() as {
            initiatives?: Array<{ id: string; title: string; goal_id: string }>
          }
          const titleMap = new Map<string, string>()
          const goalMap  = new Map<string, Set<string>>()
          for (const i of j.initiatives ?? []) {
            titleMap.set(i.id, i.title)
            if (i.goal_id) {
              if (!goalMap.has(i.goal_id)) goalMap.set(i.goal_id, new Set())
              goalMap.get(i.goal_id)!.add(i.id)
            }
          }
          setInitiativeMap(titleMap)
          setGoalInitiativeIds(goalMap)
        }
        if (goalRes.ok) {
          const j = await goalRes.json() as { goals?: Array<{ id: string; title: string }> }
          setGoalsForFilter((j.goals ?? []).filter(g => g.title !== '[Migration] Unassigned Backlog'))
        }
      } catch { /* non-fatal — badge/filter are enhancements */ }
    })()
  }, [clientId])

  // 静默刷新后同步 detailItem（保持抽屉内容最新）
  useEffect(() => {
    if (!detailItem) return
    const fresh = items.find(i => i.id === detailItem.id)
    if (fresh && fresh !== detailItem) setDetailItem(fresh)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items])

  // 状态变更 — 乐观更新（点击立即变）+ 失败回滚并报错
  const handleStatusChange = useCallback(async (itemId: string, status: ExecutionItemStatus) => {
    // 1. 乐观更新：立即把 UI 改成新状态
    setItems(cur => cur.map(i => i.id === itemId ? { ...i, status } : i))
    setOpError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/execution/${itemId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ status }),
        cache:   'no-store',
      })
      if (!res.ok) {
        setOpError(`状态更新失败（HTTP ${res.status}）`)
        await fetchItems(true)   // 回滚到服务器真实状态
        return
      }
      // 成功 — 重新拉取拿到新的 status_change 日志
      await fetchItems(true)
    } catch {
      setOpError('状态更新失败，请重试')
      await fetchItems(true)     // 回滚
    }
  }, [clientId, fetchItems])

  // 加工作日志 — 失败可见
  const handleAddLog = useCallback(async (itemId: string, content: string, kind: 'note' | 'blocker') => {
    setOpError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/execution/${itemId}/log`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ content, kind }),
        cache:   'no-store',
      })
      if (!res.ok) {
        setOpError(`工作记录保存失败（HTTP ${res.status}）`)
        return
      }
      const data = await res.json() as { log: ExecutionLog }
      // 把新 log 追加到对应 item
      setItems(prev => prev.map(it =>
        it.id === itemId ? { ...it, logs: [...it.logs, data.log] } : it
      ))
    } catch {
      setOpError('工作记录保存失败，请重试')
    }
  }, [clientId])

  // 新增执行项（处方活化 S5.2 / Marketing Plan 看板加任务）
  const handleAddItem = useCallback(async (
    prescriptionId: string,
    phase: number,
    fields: AddItemFields,
  ): Promise<boolean> => {
    setOpError(null)
    try {
      const isMP = prescriptionId.startsWith(MARKETING_PLAN_GROUP_PREFIX)
      const body = isMP
        ? { marketing_plan_id: prescriptionId.slice(MARKETING_PLAN_GROUP_PREFIX.length), phase, ...fields }
        : { prescription_id: prescriptionId, phase, ...fields }
      const res = await fetch(`/api/clients/${clientId}/execution`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(body),
        cache:   'no-store',
      })
      if (!res.ok) {
        let msg = `新增执行项失败（HTTP ${res.status}）`
        try { const eb = await res.json() as { error?: string }; if (eb?.error) msg = eb.error } catch {/* */}
        setOpError(msg)
        return false
      }
      await fetchItems(true)
      return true
    } catch {
      setOpError('新增执行项失败，请重试')
      return false
    }
  }, [clientId, fetchItems])

  // 编辑执行项标题/说明（处方活化 S5.2）
  const handleEditItem = useCallback(async (
    itemId: string,
    fields: { title?: string; description?: string },
  ): Promise<boolean> => {
    setOpError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/execution/${itemId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(fields),
        cache:   'no-store',
      })
      if (!res.ok) {
        setOpError(`编辑执行项失败（HTTP ${res.status}）`)
        return false
      }
      await fetchItems(true)
      return true
    } catch {
      setOpError('编辑执行项失败，请重试')
      return false
    }
  }, [clientId, fetchItems])

  // Phase 20.D: FDE 手动排序（drag-to-reorder）
  const handleReorder = useCallback(async (draggedId: string, targetId: string) => {
    if (draggedId === targetId) return
    const fdeItems = items.filter(i => i.source === 'fde_manual')
    const dragIdx  = fdeItems.findIndex(i => i.id === draggedId)
    const targIdx  = fdeItems.findIndex(i => i.id === targetId)
    if (dragIdx === -1 || targIdx === -1) return

    // Compute midpoint sort_order between adjacent items
    const reordered = [...fdeItems]
    const [dragged] = reordered.splice(dragIdx, 1)
    reordered.splice(targIdx, 0, dragged)

    // Assign new sort orders at intervals of 10, then PATCH only the moved item
    const newOrders = reordered.map((it, idx) => ({ id: it.id, sort_order: (idx + 1) * 10 }))

    // Optimistic update
    setItems(prev => prev.map(it => {
      const o = newOrders.find(x => x.id === it.id)
      return o ? { ...it, sort_order: o.sort_order } : it
    }))

    // Persist all reordered items
    await Promise.all(newOrders.map(({ id, sort_order }) =>
      fetch(`/api/clients/${clientId}/execution/${id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ sort_order }),
      }).then(r => { if (!r.ok) throw new Error(`PATCH ${id} failed`) })
    )).catch(async () => {
      setOpError('排序更新失败，请重试')
      await fetchItems(true)
    })
  }, [items, clientId, fetchItems])

  // 处方 Phase 列内拖拽排序（通用版，传入列内 items 作为排序上下文）
  const handleReorderItems = useCallback(async (
    draggedId: string,
    targetId: string,
    columnItems: ItemWithLogs[],
  ) => {
    if (draggedId === targetId) return
    const dragIdx = columnItems.findIndex(i => i.id === draggedId)
    const targIdx = columnItems.findIndex(i => i.id === targetId)
    if (dragIdx === -1 || targIdx === -1) return

    const reordered = [...columnItems]
    const [dragged] = reordered.splice(dragIdx, 1)
    reordered.splice(targIdx, 0, dragged)

    const newOrders = reordered.map((it, idx) => ({ id: it.id, sort_order: (idx + 1) * 10 }))

    setItems(prev => prev.map(it => {
      const o = newOrders.find(x => x.id === it.id)
      return o ? { ...it, sort_order: o.sort_order } : it
    }))

    await Promise.all(newOrders.map(({ id, sort_order }) =>
      fetch(`/api/clients/${clientId}/execution/${id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ sort_order }),
      }).then(r => { if (!r.ok) throw new Error(`PATCH ${id} failed`) })
    )).catch(async () => {
      setOpError('排序更新失败，请重试')
      await fetchItems(true)
    })
  }, [clientId, fetchItems])

  // 移除执行项（仅限 pending 状态）
  const handleDeleteItem = useCallback(async (itemId: string): Promise<void> => {
    setOpError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/execution/${itemId}`, {
        method:  'DELETE',
        cache:   'no-store',
      })
      if (!res.ok) {
        let msg = `移除失败（HTTP ${res.status}）`
        try { const eb = await res.json() as { error?: string }; if (eb?.error) msg = eb.error } catch {/* */}
        setOpError(msg)
        return
      }
      setItems(prev => prev.filter(i => i.id !== itemId))
    } catch {
      setOpError('移除失败，请重试')
    }
  }, [clientId])

  // 后台社媒内容生成（关闭 ContentStudioDrawer 后继续跑，完成后刷新看板）
  const handleBackgroundGenerate = useCallback((
    itemId: string,
    params: {
      campaignId: string
      platform: string
      posts_count: number
      stories_count: number
      reels_count: number
      angle_focus?: string
    },
  ) => {
    setBgGeneratingIds(prev => { const s = new Set(prev); s.add(itemId); return s })
    void (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/social-plan`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            campaign_brief_id:  params.campaignId,
            platform:           params.platform,
            posts_count:        params.posts_count,
            stories_count:      params.stories_count,
            reels_count:        params.reels_count,
            execution_item_id:  itemId,
            ...(params.angle_focus ? { angle_focus: params.angle_focus } : {}),
          }),
        })
        const json = await res.json() as { success: boolean; plan_id?: string; error?: string }
        if (json.success) {
          // Save generated plan to content_posts so it appears in Launch Hub
          if (json.plan_id) {
            await fetch(`/api/clients/${clientId}/social-plan/${json.plan_id}/save-to-board`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
            }).catch(() => {})
          }
          await fetch(`/api/clients/${clientId}/execution/${itemId}/log`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ kind: 'ai_assist', author: 'luban', content: '社媒内容已在后台生成完成，可打开工作台查看' }),
          }).catch(() => {})
          // 读取 DB 最新状态（不依赖可能已过期的 items 快照），确保状态持久写入后再刷新
          const statusRes = await fetch(`/api/clients/${clientId}/execution/${itemId}`).catch(() => null)
          const statusJson = statusRes?.ok ? await statusRes.json() as { item?: { status: string } } : null
          if (!statusJson?.item || statusJson.item.status === 'pending') {
            await fetch(`/api/clients/${clientId}/execution/${itemId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ status: 'in_progress' }),
            })
          }
        }
      } catch { /* non-fatal */ } finally {
        setBgGeneratingIds(prev => { const s = new Set(prev); s.delete(itemId); return s })
        void fetchItems(true)
      }
    })()
  }, [clientId, items, fetchItems])

  // 图片生成进行中（drawer 仍开着，Visual Studio 在渲染图片）→ 同样在 kanban 卡片显示"制作中"
  const handleImageGeneratingChange = useCallback((itemId: string, active: boolean) => {
    setImageGenActiveIds(prev => {
      const s = new Set(prev)
      if (active) { s.add(itemId) } else { s.delete(itemId) }
      return s
    })
  }, [])

  // 后台图片生成：关抽屉后继续跑。
  // 有 post_id → 走 POST /clients/[id]/visual-assets（落库 visual_assets，追加为新 variant）
  // 无 post_id → 降级到 /api/visual/image-preview（batch mode 临时图）
  const handleBackgroundImageGenerate = useCallback(async (
    _itemId: string,
    params: { prompt: string; aspectRatio: string; postId?: string },
  ): Promise<import('./_components/SocialPlanSection').GalleryAsset> => {
    setBgImageGenCount(c => c + 1)
    try {
      if (params.postId) {
        // 持久化路径
        const res = await fetch(`/api/clients/${clientId}/visual-assets`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            post_id:      params.postId,
            prompt:       params.prompt,
            aspect_ratio: params.aspectRatio,
          }),
        })
        const json = await res.json() as {
          success: boolean
          asset?: import('./_components/SocialPlanSection').GalleryAsset
          error?: string
        }
        if (!json.success || !json.asset) throw new Error(json.error ?? '生成失败')
        return json.asset
      }
      // 降级：batch mode 临时图
      const res = await fetch('/api/visual/image-preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: params.prompt, client_id: clientId, aspect_ratio: params.aspectRatio }),
      })
      const json = await res.json() as { success: boolean; image_url?: string; error?: string }
      if (!json.success) throw new Error(json.error ?? '生成失败')
      return {
        id:          `local-${Date.now()}`,
        storage_url: json.image_url ?? '',
        prompt_used: params.prompt,
        is_selected: true,
        created_at:  new Date().toISOString(),
      }
    } finally {
      setBgImageGenCount(c => Math.max(0, c - 1))
    }
  }, [clientId])

  // 合并两种"制作中"来源，传给 PrescriptionGroup → ExecutionItemCard
  const allBgGeneratingIds = useMemo<Set<string>>(() => {
    if (imageGenActiveIds.size === 0) return bgGeneratingIds
    if (bgGeneratingIds.size === 0) return imageGenActiveIds
    const merged = new Set(bgGeneratingIds)
    imageGenActiveIds.forEach(id => merged.add(id))
    return merged
  }, [bgGeneratingIds, imageGenActiveIds])

  // 打开 detail 抽屉
  const openDetailAndRemember = useCallback((item: ItemWithLogs, editable: boolean) => {
    setDetailItem(item)
    setDetailEditable(editable)
  }, [])

  const filteredItems = (() => {
    let result = activeDimension === 'all' ? items : items.filter(i => i.dimension === activeDimension)
    if (statusFilter !== 'all') result = result.filter(i => i.status === statusFilter)
    if (goalFilter !== 'all') {
      const initiativeIdsForGoal = goalInitiativeIds.get(goalFilter)
      if (initiativeIdsForGoal) {
        result = result.filter(i =>
          i.initiative_id === null || initiativeIdsForGoal.has(i.initiative_id),
        )
      }
    }
    return result
  })()
  const availableDimensions = Array.from(new Set(items.map(i => i.dimension).filter(Boolean))) as string[]
  const completedCount      = filteredItems.filter(i => i.status === 'completed').length

  // P33.10 fix: when a goal filter is active, items with initiative_id=null go to the
  // "未归类 Actions" block below — exclude them from dimension groups to avoid duplication
  const itemsForDimensionGroups = goalFilter !== 'all'
    ? filteredItems.filter(i => i.initiative_id !== null)
    : filteredItems
  // New dimension-based grouping — excludes autonomous/flywheel items
  const dimensionGroups = buildDimensionGroups(itemsForDimensionGroups)

  // Legacy prescription groups — kept for derive/supplement/revision flows only
  const prescriptionGroups  = buildExecutionGroups(filteredItems, prescriptions, marketingPlans)
    .filter(g => g.items.length > 0)

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6 animate-pulse">
        <div className="max-w-4xl mx-auto space-y-4">
          <div className="h-7 w-56 bg-gray-200 rounded" />
          <div className="h-14 bg-gray-200 rounded-xl" />
          {[1, 2, 3].map(i => <div key={i} className="h-24 bg-gray-200 rounded-xl" />)}
        </div>
      </div>
    )
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-4xl mx-auto">
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-700">
            {error}
          </div>
        </div>
      </div>
    )
  }

  // ── Empty ─────────────────────────────────────────────────────────────────
  if (items.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-xl border border-gray-200 p-12 text-center space-y-3">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-cyan-800">No prescription</p>
            <h2 className="font-semibold text-gray-900">暂无执行计划</h2>
            <p className="text-sm text-gray-500">
              请先生成并批准一份处方，系统将自动创建执行计划。
            </p>
            <Link
              href={`/dashboard/clients/${clientId}/prescription/new`}
              className="inline-block rounded-lg bg-indigo-600 px-5 py-2 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors"
            >
              生成处方
            </Link>
          </div>
        </div>
      </div>
    )
  }

  // ── Main render ───────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#f6f7f2]">
      {/* 悬浮：图片后台生成 toast — 关抽屉/刷新页面都不影响 */}
      {bgImageGenCount > 0 && (
        <div className="fixed bottom-5 right-5 z-[100] flex items-center gap-3 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 shadow-xl">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-violet-400 border-t-violet-800 shrink-0" />
          <div className="min-w-0">
            <p className="text-xs font-black text-violet-800">🎨 Visual Studio 生成中（{bgImageGenCount} 张）</p>
            <p className="text-[10px] text-violet-600 mt-0.5">关窗口不影响，完成后自动保存到画廊</p>
          </div>
        </div>
      )}

      {/* 指南针：浮动进度按钮 + 面板 */}
      <div className={`fixed z-[99] transition-all duration-200 ${bgImageGenCount > 0 ? 'bottom-20 right-5' : 'bottom-5 right-5'}`}>
        {compassOpen && (
          <>
            <div className="fixed inset-0" onClick={() => setCompassOpen(false)} />
            <div className="absolute bottom-12 right-0 w-72 rounded-xl border border-slate-200 bg-white shadow-2xl overflow-hidden">
              <div className="px-4 py-3 bg-slate-900 flex items-center justify-between">
                <span className="text-xs font-black text-white">🧭 执行进度总览</span>
                <button onClick={() => setCompassOpen(false)} className="text-slate-400 hover:text-white text-sm">✕</button>
              </div>
              <div className="divide-y divide-slate-100">
                {(() => {
                  const DIM_META: Record<string, { label: string; emoji: string }> = {
                    social:        { label: '社媒', emoji: '📱' },
                    seo:           { label: 'SEO', emoji: '🔍' },
                    ai_visibility: { label: 'GEO', emoji: '🤖' },
                    ads:           { label: '广告', emoji: '📢' },
                    reputation:    { label: '口碑', emoji: '⭐' },
                    competitor:    { label: '竞品', emoji: '🔭' },
                  }
                  const dims = Array.from(new Set(items.map(i => i.dimension).filter(Boolean))) as string[]
                  if (dims.length === 0) {
                    return (
                      <div className="px-4 py-6 text-center text-xs text-slate-400">暂无执行项</div>
                    )
                  }
                  return dims.map(dim => {
                    const dimItems  = items.filter(i => i.dimension === dim)
                    const done      = dimItems.filter(i => i.status === 'completed').length
                    const inProg    = dimItems.filter(i => i.status === 'in_progress').length
                    const total     = dimItems.length
                    const pct       = total === 0 ? 0 : Math.round(done / total * 100)
                    const meta      = DIM_META[dim] ?? { label: dim, emoji: '📋' }
                    return (
                      <div key={dim} className="px-4 py-2.5">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[11px] font-semibold text-slate-700">{meta.emoji} {meta.label}</span>
                          <span className="text-[10px] text-slate-400">
                            {done}/{total}
                            {inProg > 0 && <span className="ml-1 text-blue-500">·{inProg} 进行中</span>}
                          </span>
                        </div>
                        <div className="w-full bg-slate-100 rounded-full h-1.5">
                          <div
                            className="h-1.5 rounded-full transition-all duration-500"
                            style={{
                              width: `${pct}%`,
                              backgroundColor: pct === 100 ? '#22c55e' : pct > 0 ? '#6366f1' : '#e2e8f0',
                            }}
                          />
                        </div>
                      </div>
                    )
                  })
                })()}
                <div className="px-4 py-2.5 bg-slate-50">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-black text-slate-700">总计</span>
                    <span className="text-[11px] font-bold text-indigo-700">
                      {items.filter(i => i.status === 'completed').length} / {items.length} 已完成
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
        <button
          onClick={() => setCompassOpen(v => !v)}
          title="执行进度总览"
          className={`flex h-10 w-10 items-center justify-center rounded-full shadow-lg border transition-all duration-200 text-base ${
            compassOpen
              ? 'bg-slate-900 border-slate-700 text-white shadow-slate-900/30'
              : 'bg-white border-slate-200 text-slate-600 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 shadow-slate-200/60'
          }`}
        >
          🧭
        </button>
      </div>

      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-[#f6f7f2]/95 px-4 py-3 backdrop-blur md:px-6">
        {/* 面包屑导航 — FDE 随时知道自己在哪 */}
        <div className="mx-auto max-w-7xl mb-2.5">
          <nav className="flex items-center gap-1.5 text-[11px] font-semibold">
            <Link href="/dashboard" className="text-slate-400 hover:text-indigo-600 transition-colors">← Dashboard</Link>
            {clientName && (
              <>
                <span className="text-slate-300">/</span>
                <Link
                  href={`/dashboard/clients/${clientId}`}
                  className="max-w-[180px] truncate text-slate-500 hover:text-indigo-600 transition-colors"
                >
                  {clientName}
                </Link>
              </>
            )}
            <span className="text-slate-300">/</span>
            <span className="font-black text-slate-800">执行看板</span>
          </nav>
        </div>
        <BriefGateBanner clientId={clientId} featureLabel="execution dashboard actions">
          <div className="mx-auto flex max-w-7xl flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="text-xl font-black text-slate-950">{clientName ?? '执行看板'}</h1>
              <p className="mt-0.5 text-xs font-semibold text-slate-500">按阶段跟踪处方落地、内容生成与执行证明</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {/* 主操作：录入工作 */}
              <button
                onClick={() => setShowManualEntry(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 transition-colors"
              >
                ＋ 录入工作
              </button>
              {/* 主操作：Marketing Plan */}
              <Link
                href={`/dashboard/clients/${clientId}/marketing-plan`}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-cyan-200 bg-cyan-50 px-3 text-xs font-black text-cyan-800 transition-colors hover:bg-cyan-100"
              >
                Marketing Plan
              </Link>
              {/* 项目级鲁班 — 常驻按钮 */}
              <button
                onClick={() => setProjectLubanOpen(true)}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 text-xs font-black text-violet-800 transition-colors hover:bg-violet-100"
              >
                🤖 鲁班
              </button>
              {/* 溢出菜单 */}
              <div className="relative">
                <button
                  onClick={() => setShowOverflow(v => !v)}
                  className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 transition-colors hover:border-slate-300 hover:text-slate-950"
                >
                  ···
                </button>
                {showOverflow && (
                  <>
                    {/* 透明遮罩：点击外部关闭 */}
                    <div className="fixed inset-0 z-10" onClick={() => setShowOverflow(false)} />
                    <div className="absolute right-0 top-full z-20 mt-1 w-44 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                      <button
                        onClick={() => { setReviewOpen(true); setShowOverflow(false) }}
                        className="w-full px-4 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        复盘
                      </button>
                      {items.length > 0 && (
                        <button
                          onClick={() => { void handleDownloadDocx(); setShowOverflow(false) }}
                          disabled={isDocxLoading}
                          className="w-full px-4 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        >
                          {isDocxLoading ? '下载中…' : '↓ 下载执行方案'}
                        </button>
                      )}
                      <div className="my-1 border-t border-slate-100" />
                      <Link
                        href={`/dashboard/clients/${clientId}/prescription/new`}
                        onClick={() => setShowOverflow(false)}
                        className="block px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        ＋ 新处方
                      </Link>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </BriefGateBanner>
      </div>

      <div className="mx-auto max-w-7xl space-y-4 px-4 py-6 transition-all duration-200 md:px-6">
        {/* 操作错误提示（状态变更 / 加日志失败时） */}
        {opError && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 flex items-center justify-between gap-3 text-sm text-red-700">
            <span>{opError}</span>
            <button onClick={() => setOpError(null)} className="text-red-400 hover:text-red-600 text-lg leading-none">×</button>
          </div>
        )}

        {/* Campaign 上下文锚点 — FDE 执行任务时随时可见 */}
        <ActiveCampaignBanner clientId={clientId} />

        {/* 维度过滤 tabs */}
        {availableDimensions.length > 1 && (() => {
          const DIM_TABS = [
            { v: 'all',           label: '全部' },
            { v: 'social',        label: '📱 社媒' },
            { v: 'seo',           label: '🔍 SEO' },
            { v: 'ai_visibility', label: '🤖 GEO' },
            { v: 'ads',           label: '📢 广告' },
            { v: 'reputation',    label: '⭐ 口碑' },
            { v: 'competitor',    label: '🔭 竞品' },
          ].filter(t => t.v === 'all' || (availableDimensions as string[]).includes(t.v))
          return (
            <div className="flex items-center gap-1.5 flex-wrap">
              {DIM_TABS.map(t => (
                <button
                  key={t.v}
                  onClick={() => setActiveDimension(t.v)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    activeDimension === t.v
                      ? 'bg-indigo-600 text-white'
                      : 'bg-white border border-gray-200 text-gray-600 hover:border-indigo-300 hover:text-indigo-700'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )
        })()}

        {/* Phase 33 P33.9 — Goal filter (只在有多个 Goal 时显示) */}
        {goalsForFilter.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-bold uppercase tracking-wide text-me-charcoal/45 mr-1">按 Goal</span>
            <button
              onClick={() => setGoalFilter('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                goalFilter === 'all'
                  ? 'bg-me-ochre text-white'
                  : 'bg-white border border-gray-200 text-gray-600 hover:border-me-ochre/50 hover:text-me-ochre'
              }`}
            >
              全部
            </button>
            {goalsForFilter.map(g => (
              <button
                key={g.id}
                onClick={() => setGoalFilter(g.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  goalFilter === g.id
                    ? 'bg-me-ochre text-white'
                    : 'bg-white border border-gray-200 text-gray-600 hover:border-me-ochre/50 hover:text-me-ochre'
                }`}
              >
                {g.title}
              </button>
            ))}
          </div>
        )}

        {/* 状态过滤 chips */}
        {(() => {
          const STATUS_TABS = [
            { v: 'all',         label: '全部' },
            { v: 'pending',     label: '⏳ 待处理' },
            { v: 'in_progress', label: '🔄 进行中' },
            { v: 'completed',   label: '✅ 已完成' },
          ]
          // P33.9 fix: counts reflect active dimension+goal filters (exclude statusFilter itself)
          const countsBase = (() => {
            let r = activeDimension === 'all' ? items : items.filter(i => i.dimension === activeDimension)
            if (goalFilter !== 'all') {
              const ids = goalInitiativeIds.get(goalFilter)
              if (ids) r = r.filter(i => i.initiative_id === null || ids.has(i.initiative_id))
            }
            return r
          })()
          const counts: Record<string, number> = {
            pending:     countsBase.filter(i => i.status === 'pending').length,
            in_progress: countsBase.filter(i => i.status === 'in_progress').length,
            completed:   countsBase.filter(i => i.status === 'completed').length,
          }
          return (
            <div className="flex items-center gap-1.5 flex-wrap">
              {STATUS_TABS.map(t => (
                <button
                  key={t.v}
                  onClick={() => setStatusFilter(t.v)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    statusFilter === t.v
                      ? 'bg-slate-900 text-white'
                      : 'bg-white border border-gray-200 text-gray-600 hover:border-slate-400 hover:text-slate-700'
                  }`}
                >
                  {t.label}{t.v !== 'all' && counts[t.v] !== undefined ? ` ${counts[t.v]}` : ''}
                </button>
              ))}
            </div>
          )
        })()}

        <ProgressBar completed={completedCount} total={filteredItems.length} />

        {/* Phase 22.D — AnomalyDetector 信号面板 */}
        <AnomalySignalPanel clientId={clientId} />

        <DataPullbackSection clientId={clientId} />

        {/* Data Intelligence compact — key signals + top insights */}
        <IntelligenceSummarySection clientId={clientId} variant="compact" />

        {/* P18.A.3 — Meta Ads 操作历史与撤销 */}
        <AdsAuditSection clientId={clientId} />

        {/* 按工作类型分组 — 社媒 / SEO / GEO / 广告 / 口碑 / 竞品（飞轮自主任务已过滤）*/}
        {dimensionGroups.map(group => (
          <DimensionGroupSection
            key={group.dimension}
            group={group}
            activeDetailId={detailItem?.id ?? null}
            onOpenDetail={item => {
              const legacy = prescriptionGroups.find(g => g.items.some(i => i.id === item.id))
              openDetailAndRemember(item, legacy?.editable ?? true)
            }}
            bgGeneratingIds={allBgGeneratingIds}
            initiativeMap={initiativeMap}
          />
        ))}

        {/* Phase 33 P33.10 — Unassigned Backlog: items with initiative_id=null (only shown when Goal filter active) */}
        {goalFilter !== 'all' && (() => {
          const unassigned = filteredItems.filter(i => i.initiative_id === null && !isAutonomousItem(i))
          if (unassigned.length === 0) return null
          return (
            <div className="rounded-xl border border-dashed border-me-charcoal/20 bg-me-ivory/60 overflow-hidden">
              <div className="flex items-center gap-3 px-5 py-3 bg-me-ivory border-b border-me-charcoal/10">
                <span className="text-sm">📥</span>
                <span className="text-sm font-black text-me-charcoal/70">未归类 Actions</span>
                <span className="rounded-full bg-me-charcoal/10 px-2 py-0.5 text-[10px] font-bold text-me-charcoal/55">
                  {unassigned.length} 条
                </span>
                <span className="ml-auto text-[11px] font-semibold text-me-charcoal/45">
                  这些 actions 尚未关联到任何 Initiative — 请在 Goal 页面归类
                </span>
              </div>
              <div className="divide-y divide-me-charcoal/5 px-4 py-2 space-y-2">
                {unassigned.map(item => (
                  <ExecutionItemCard
                    key={item.id}
                    item={item}
                    isActive={item.id === detailItem?.id}
                    onOpenDetail={i => openDetailAndRemember(i, true)}
                    isBackgroundGenerating={allBgGeneratingIds.has(item.id)}
                  />
                ))}
              </div>
            </div>
          )
        })()}

        {/* FDE 手动录入分组 — 平铺 + 拖拽排序（仍保留） */}
        {prescriptionGroups.filter(g => g.kind === 'fde_manual').map(group => (
          <FdeManualGroup
            key={group.pid}
            group={group}
            activeDetailId={detailItem?.id ?? null}
            onOpenDetail={item => openDetailAndRemember(item, true)}
            onReorder={handleReorder}
          />
        ))}
      </div>

      {/* 右侧任务详情抽屉 */}
      <TaskDetailDrawer
        item={detailItem}
        clientId={clientId}
        editable={detailEditable}
        onClose={() => {
          setDetailItem(null)
          setStudioItem(null)
          setChatItem(null)
          setLubanInitialMessage('')
          setFlywheelState(null)
        }}
        onStatusChange={handleStatusChange}
        onAddLog={handleAddLog}
        onOpenChat={item => {
          setChatItem(item)
          setStudioItem(null)
          setFlywheelState(null)
        }}
        onOpenFlywheel={(item, target) => {
          setFlywheelState({ item, target })
          setStudioItem(null)
          setChatItem(null)
          setLubanInitialMessage('')
        }}
        onOpenStudio={item => {
          setStudioItem(item)
          setChatItem(null)
          setLubanInitialMessage('')
          setFlywheelState(null)
        }}
        onOpenAdsFixDrawer={item => {
          setAdsFixItem(item)
          setDetailItem(null)
        }}
        onEditItem={handleEditItem}
        onDeleteItem={handleDeleteItem}
        railOpen={!!studioItem || !!chatItem || !!flywheelState}
      />

      {/* 飞轮执行抽屉（in_house 模式） */}
      {flywheelState && (
        <FlywheelDrawer
          clientId={clientId}
          item={flywheelState.item}
          target={flywheelState.target}
          onClose={() => setFlywheelState(null)}
          onOpenLuban={(msg) => {
            setLubanInitialMessage(msg)
            setChatItem(flywheelState.item)
            setStudioItem(null)
            setFlywheelState(null)
          }}
        />
      )}

      {/* P18.A.2 — Meta Ads 直接执行抽屉 */}
      {adsFixItem && (
        <AdsFixDrawer
          clientId={clientId}
          item={adsFixItem}
          onClose={() => setAdsFixItem(null)}
        />
      )}

      {/* 鲁班对话抽屉 */}
      {chatItem && (
        <LubanChatDrawer
          clientId={clientId}
          itemId={chatItem.id}
          itemTitle={chatItem.title}
          isOpen={true}
          onClose={() => { setChatItem(null); setLubanInitialMessage('') }}
          onLogSaved={() => void fetchItems()}
          initialMessage={lubanInitialMessage}
        />
      )}

      {/* 内联补充/修订处方抽屉 */}
      {deriveDrawer && (
        <InlinePrescriptionDrawer
          clientId={clientId}
          mode={deriveDrawer.mode}
          priorPrescriptionId={deriveDrawer.priorId}
          priorLabel={deriveDrawer.priorLabel}
          onClose={() => setDeriveDrawer(null)}
          onApproved={() => void fetchItems()}
        />
      )}

      {/* 项目级鲁班对话抽屉（S5.3） */}
      <ProjectLubanDrawer
        clientId={clientId}
        isOpen={projectLubanOpen}
        onClose={() => setProjectLubanOpen(false)}
      />

      {/* 三代理复盘抽屉（S6） */}
      <ProjectReviewDrawer
        clientId={clientId}
        isOpen={reviewOpen}
        onClose={() => setReviewOpen(false)}
      />

      {/* 内容工作台抽屉 — 诊断驱动的内容生成（SEO 文章 / 社媒视频） */}
      {studioItem && (
        <ContentStudioDrawer
          clientId={clientId}
          item={studioItem}
          onClose={() => {
            // 关闭 drawer 时清除该 item 的图片生成标记
            setImageGenActiveIds(prev => { const s = new Set(prev); s.delete(studioItem.id); return s })
            setStudioItem(null)
          }}
          onContentGenerated={() => void fetchItems(true)}
          onBackgroundGenerate={handleBackgroundGenerate}
          onImageGeneratingChange={handleImageGeneratingChange}
          onBackgroundImageGenerate={handleBackgroundImageGenerate}
          readonly={isAutonomousItem(studioItem)}
        />
      )}

      {/* Phase 20.D: FDE 手动录入 Modal */}
      <FdeManualEntryModal
        clientId={clientId}
        open={showManualEntry}
        onClose={() => setShowManualEntry(false)}
        onCreated={() => { setShowManualEntry(false); void fetchItems(true) }}
      />
    </div>
  )
}
