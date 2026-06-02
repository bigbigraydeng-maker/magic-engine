'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useRecentWorkbenchThreads } from './useRecentWorkbenchThreads'
import {
  useWorkbenchSuggestionFeedback,
  type SuggestionFeedbackState,
} from './useWorkbenchSuggestionFeedback'
import { useWorkbenchSuggestionEvents } from './useWorkbenchSuggestionEvents'

interface SummaryItem {
  label: string
  count: number
  tone?: 'indigo' | 'amber' | 'emerald' | 'slate'
}

interface QuickLinkItem {
  label: string
  href: string
}

interface WorkbenchSummaryData {
  social: {
    draft: number
    needs_image: number
    ready_to_publish: number
    scheduled: number
    published: number
  }
  seo: {
    draft: number
    generating: number
  }
  execution: {
    pending: number
    in_progress: number
  }
}

interface WorkbenchSummaryResponse {
  success: boolean
  summary?: WorkbenchSummaryData
}

interface WorkbenchSuggestion {
  id: string
  key: string
  title: string
  detail: string
  href: string
  ctaLabel: string
  tone: 'indigo' | 'amber' | 'emerald' | 'slate'
}

interface Props {
  clientId?: string
  currentHref?: string
  clientLabel: string
  currentAreaLabel: string
  campaignLabel?: string | null
  taskLabel?: string | null
  packageLabel?: string | null
  summaryItems?: SummaryItem[]
  quickLinks?: QuickLinkItem[]
  onOpenChat: () => void
  anchorClassName?: string
}

const TONE_STYLES: Record<NonNullable<SummaryItem['tone']>, string> = {
  indigo: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  amber: 'border-amber-200 bg-amber-50 text-amber-700',
  emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  slate: 'border-slate-200 bg-slate-50 text-slate-700',
}

const FEEDBACK_LABELS: Record<SuggestionFeedbackState, string> = {
  done: '已处理',
  dismissed: '稍后再看',
  irrelevant: '不相关',
}

function mapSummary(summary: WorkbenchSummaryData): SummaryItem[] {
  return [
    { label: '执行待处理', count: summary.execution.pending, tone: 'amber' },
    { label: '执行进行中', count: summary.execution.in_progress, tone: 'indigo' },
    { label: '社媒待审批', count: summary.social.draft, tone: 'amber' },
    { label: '社媒待生图', count: summary.social.needs_image, tone: 'indigo' },
    { label: '社媒待推送', count: summary.social.ready_to_publish, tone: 'emerald' },
    { label: 'SEO 待定稿', count: summary.seo.draft + summary.seo.generating, tone: 'slate' },
  ]
}

function formatSavedAt(savedAt: string) {
  const diff = Date.now() - new Date(savedAt).getTime()
  const minutes = Math.max(1, Math.floor(diff / 60000))

  if (minutes < 60) return `${minutes} 分钟前`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`

  const days = Math.floor(hours / 24)
  return `${days} 天前`
}

function findQuickLink(quickLinks: QuickLinkItem[], keyword: string) {
  return quickLinks.find(link => link.href.includes(keyword))?.href
}

function makeKey(base: string, count: number) {
  return `${base}:${count}`
}

function buildSuggestions({
  summary,
  clientId,
  currentAreaLabel,
  quickLinks,
}: {
  summary: WorkbenchSummaryData
  clientId: string
  currentAreaLabel: string
  quickLinks: QuickLinkItem[]
}): WorkbenchSuggestion[] {
  const launchHubHref = findQuickLink(quickLinks, '/dashboard/content') ?? `/dashboard/content?client=${clientId}`
  const executionHref = findQuickLink(quickLinks, '/execution') ?? `/dashboard/clients/${clientId}/execution`
  const marketingPlanHref = findQuickLink(quickLinks, '/marketing-plan') ?? executionHref

  const suggestions: WorkbenchSuggestion[] = []

  if (summary.social.draft > 0) {
    suggestions.push({
      id: 'social-approve',
      key: makeKey('social-approve', summary.social.draft),
      title: `先审批 ${summary.social.draft} 条社媒草稿`,
      detail:
        currentAreaLabel === 'Launch Hub'
          ? '这些草稿已经生成完成，先把最接近发布的一批过掉，会让后面的生图和推送更顺。'
          : '社媒草稿已经在队列里，先去 Launch Hub 审批，能最快把当前 campaign 往发布推进一段。',
      href: launchHubHref,
      ctaLabel: currentAreaLabel === 'Launch Hub' ? '继续审批' : '去 Launch Hub',
      tone: 'amber',
    })
  }

  if (summary.social.needs_image > 0) {
    suggestions.push({
      id: 'social-image',
      key: makeKey('social-image', summary.social.needs_image),
      title: `补完 ${summary.social.needs_image} 条待生图内容`,
      detail:
        currentAreaLabel === 'Launch Hub'
          ? '这些帖子已经通过审批，但还缺视觉产物。把图片补齐后，推送和排期会顺很多。'
          : '当前有一批社媒内容卡在视觉阶段，先回 Launch Hub 完成生图，能避免 approved 内容堆积。',
      href: launchHubHref,
      ctaLabel: currentAreaLabel === 'Launch Hub' ? '继续生图' : '去补图片',
      tone: 'indigo',
    })
  }

  if (summary.social.ready_to_publish > 0) {
    suggestions.push({
      id: 'social-publish',
      key: makeKey('social-publish', summary.social.ready_to_publish),
      title: `安排 ${summary.social.ready_to_publish} 条可推送内容`,
      detail:
        currentAreaLabel === 'Launch Hub'
          ? '这些帖子已经具备发布条件，下一步最值钱的是排期或推送到 Publishing Hub。'
          : '当前已有可推送内容，不用再等生成；先把它们排期或推送，最能带来真实进度。',
      href: launchHubHref,
      ctaLabel: currentAreaLabel === 'Launch Hub' ? '去排期 / 推送' : '去安排发布',
      tone: 'emerald',
    })
  }

  if (summary.execution.pending > 0) {
    suggestions.push({
      id: 'execution-pending',
      key: makeKey('execution-pending', summary.execution.pending),
      title: `处理 ${summary.execution.pending} 个待执行项`,
      detail:
        currentAreaLabel === 'Execution 看板'
          ? '看板里还有待处理任务，先清最上游的执行项，能减少后续内容链路的堵点。'
          : '执行看板里还有挂起任务，先清掉这批待处理项，会让 campaign 的整体节奏更稳。',
      href: executionHref,
      ctaLabel: currentAreaLabel === 'Execution 看板' ? '回到看板处理' : '去 Execution',
      tone: 'amber',
    })
  }

  if (summary.seo.draft + summary.seo.generating > 0) {
    const seoOpenCount = summary.seo.draft + summary.seo.generating
    suggestions.push({
      id: 'seo-open',
      key: makeKey('seo-open', seoOpenCount),
      title: `跟进 ${seoOpenCount} 个 SEO 待定稿项`,
      detail:
        currentAreaLabel === 'Execution 看板'
          ? '当前有 SEO 内容还没收口，适合回到对应任务继续推进或调整计划节奏。'
          : 'SEO 队列还有内容未完成，先回计划 / 执行层确认节奏，避免社媒和 SEO 两边脱节。',
      href: marketingPlanHref,
      ctaLabel: marketingPlanHref === executionHref ? '回执行层看 SEO' : '看 Marketing Plan',
      tone: 'slate',
    })
  }

  const deduped = suggestions.filter((item, index, list) => list.findIndex(candidate => candidate.id === item.id) === index)
  return deduped.slice(0, 3)
}

export function ZhugeWorkbenchFab({
  clientId,
  currentHref,
  clientLabel,
  currentAreaLabel,
  campaignLabel,
  taskLabel,
  packageLabel,
  summaryItems = [],
  quickLinks = [],
  onOpenChat,
  anchorClassName = 'bottom-5 right-5',
}: Props) {
  const [open, setOpen] = useState(false)
  const [remoteSummary, setRemoteSummary] = useState<SummaryItem[] | null>(null)
  const [summaryData, setSummaryData] = useState<WorkbenchSummaryData | null>(null)
  const [feedbackNotice, setFeedbackNotice] = useState<string | null>(null)

  const currentThread = useMemo(() => {
    if (!clientId || !currentHref) return null

    return {
      clientId,
      clientLabel,
      currentAreaLabel,
      campaignLabel,
      taskLabel,
      packageLabel,
      href: currentHref,
    }
  }, [campaignLabel, clientId, clientLabel, currentAreaLabel, currentHref, packageLabel, taskLabel])

  const recentThreads = useRecentWorkbenchThreads(currentThread)
  const { suppressedKeys, recordFeedback, clearFeedbackForKeys, visibleEntries } =
    useWorkbenchSuggestionFeedback(clientId)
  const { pendingCount, trackFeedbackEvent } = useWorkbenchSuggestionEvents()

  useEffect(() => {
    if (!clientId) {
      setRemoteSummary(null)
      setSummaryData(null)
      return
    }

    let cancelled = false

    void (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/workbench-summary`, { cache: 'no-store' })
        const json = await res.json() as WorkbenchSummaryResponse
        if (!res.ok || !json.success || !json.summary || cancelled) return
        setSummaryData(json.summary)
        setRemoteSummary(mapSummary(json.summary))
      } catch {
        if (!cancelled) {
          setRemoteSummary(null)
          setSummaryData(null)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [clientId])

  const displaySummary = remoteSummary ?? summaryItems

  const allSuggestions = useMemo(() => {
    if (!clientId || !summaryData) return []
    return buildSuggestions({
      summary: summaryData,
      clientId,
      currentAreaLabel,
      quickLinks,
    })
  }, [clientId, currentAreaLabel, quickLinks, summaryData])

  const visibleSuggestions = useMemo(
    () => allSuggestions.filter(suggestion => !suppressedKeys.has(suggestion.key)),
    [allSuggestions, suppressedKeys],
  )

  const hiddenSuggestionKeys = useMemo(
    () => allSuggestions.filter(suggestion => suppressedKeys.has(suggestion.key)).map(suggestion => suggestion.key),
    [allSuggestions, suppressedKeys],
  )

  const handleFeedback = (suggestion: WorkbenchSuggestion, state: SuggestionFeedbackState) => {
    if (!clientId) return

    recordFeedback({
      clientId,
      suggestionId: suggestion.id,
      suggestionKey: suggestion.key,
      state,
    })

    trackFeedbackEvent({
      clientId,
      suggestionId: suggestion.id,
      suggestionKey: suggestion.key,
      suggestionTitle: suggestion.title,
      state,
      currentAreaLabel,
      currentHref,
      clientLabel,
      campaignLabel,
      taskLabel,
      packageLabel,
    })

    setFeedbackNotice(`已记录「${suggestion.title}」为${FEEDBACK_LABELS[state]}。这批建议会先让开。`)
  }

  const handleRestoreSuggestions = () => {
    clearFeedbackForKeys(hiddenSuggestionKeys)
    setFeedbackNotice('已恢复当前批次建议。')
  }

  return (
    <div className={`fixed z-[99] ${anchorClassName}`}>
      {open && (
        <>
          <div className="fixed inset-0" onClick={() => setOpen(false)} />
          <div className="absolute bottom-14 right-0 w-[23rem] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between bg-slate-950 px-4 py-3">
              <div>
                <p className="text-xs font-black tracking-wide text-white">诸葛亮工作台</p>
                <p className="mt-0.5 text-[10px] text-slate-300">当前线程、待处理摘要、最近工作和 AI 入口</p>
              </div>
              <button onClick={() => setOpen(false)} className="text-sm text-slate-400 hover:text-white">
                ×
              </button>
            </div>

            <div className="max-h-[75vh] space-y-4 overflow-y-auto px-4 py-4">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">当前工作线程</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-700">{clientLabel}</span>
                  <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-700">{currentAreaLabel}</span>
                  {campaignLabel && (
                    <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-700">
                      {campaignLabel}
                    </span>
                  )}
                  {taskLabel && (
                    <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-700">
                      {taskLabel}
                    </span>
                  )}
                  {packageLabel && (
                    <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-700">
                      {packageLabel}
                    </span>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">待处理摘要</p>
                  <button
                    onClick={() => {
                      setOpen(false)
                      onOpenChat()
                    }}
                    className="rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-indigo-700"
                  >
                    问诸葛亮
                  </button>
                </div>
                {displaySummary.length > 0 ? (
                  <div className="grid grid-cols-2 gap-2">
                    {displaySummary.map(item => (
                      <div
                        key={item.label}
                        className={`rounded-xl border px-3 py-2 ${TONE_STYLES[item.tone ?? 'slate']}`}
                      >
                        <p className="text-lg font-black">{item.count}</p>
                        <p className="text-[11px] font-medium">{item.label}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-4 text-xs text-slate-500">
                    暂无可汇总的待处理项，但你仍可随时打开诸葛亮工作台继续推进。
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">下一步建议</p>
                  <span className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-700">
                    Beta
                  </span>
                </div>

                {feedbackNotice && (
                  <div className="rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-2 text-[11px] text-cyan-900">
                    {feedbackNotice}
                  </div>
                )}

                {visibleSuggestions.length > 0 ? (
                  <div className="space-y-2">
                    {visibleSuggestions.map(suggestion => (
                      <div
                        key={suggestion.key}
                        className={`rounded-xl border px-3 py-3 ${TONE_STYLES[suggestion.tone]}`}
                      >
                        <p className="text-[12px] font-bold">{suggestion.title}</p>
                        <p className="mt-1 text-[11px] leading-5 opacity-90">{suggestion.detail}</p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Link
                            href={suggestion.href}
                            onClick={() => setOpen(false)}
                            className="inline-flex rounded-lg bg-white/80 px-3 py-1.5 text-[11px] font-semibold text-slate-800 hover:bg-white"
                          >
                            {suggestion.ctaLabel}
                          </Link>
                          <button
                            onClick={() => handleFeedback(suggestion, 'done')}
                            className="rounded-lg border border-white/70 bg-white/50 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-white"
                          >
                            已处理
                          </button>
                          <button
                            onClick={() => handleFeedback(suggestion, 'dismissed')}
                            className="rounded-lg border border-white/70 bg-white/50 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-white"
                          >
                            稍后再看
                          </button>
                          <button
                            onClick={() => handleFeedback(suggestion, 'irrelevant')}
                            className="rounded-lg border border-white/70 bg-white/50 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 hover:bg-white"
                          >
                            不相关
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-4 text-xs text-slate-500">
                    当前这批建议都已经被处理、延后或判定为不相关了。你可以继续当前线程，或直接问诸葛亮下一步怎么推进。
                  </div>
                )}

                {hiddenSuggestionKeys.length > 0 && (
                  <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-600">
                    <span>已隐藏 {hiddenSuggestionKeys.length} 条当前批次建议</span>
                    <button
                      onClick={handleRestoreSuggestions}
                      className="font-semibold text-indigo-600 hover:text-indigo-700"
                    >
                      恢复建议
                    </button>
                  </div>
                )}

                {visibleEntries.length > 0 && (
                  <p className="text-[10px] text-slate-400">
                    Beta 反馈已本地记住，并会尽量异步写入分析事件，供后续排序调优使用。
                  </p>
                )}

                {pendingCount > 0 && (
                  <p className="text-[10px] text-amber-600">
                    还有 {pendingCount} 条反馈事件待补发，系统会在后台继续同步，不影响当前操作。
                  </p>
                )}
              </div>

              {recentThreads.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">最近工作线程</p>
                  <div className="space-y-2">
                    {recentThreads.map(thread => (
                      <Link
                        key={thread.href}
                        href={thread.href}
                        className="block rounded-xl border border-slate-200 bg-white px-3 py-2.5 hover:border-indigo-200 hover:bg-indigo-50"
                        onClick={() => setOpen(false)}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-[12px] font-semibold text-slate-800">
                              {thread.clientLabel} · {thread.currentAreaLabel}
                            </p>
                            <p className="mt-1 truncate text-[11px] text-slate-500">
                              {[thread.campaignLabel, thread.taskLabel, thread.packageLabel].filter(Boolean).join(' / ') || '回到刚才的工作位置'}
                            </p>
                          </div>
                          <span className="shrink-0 text-[10px] font-medium text-slate-400">
                            {formatSavedAt(thread.savedAt)}
                          </span>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {quickLinks.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">快捷切换</p>
                  <div className="flex flex-wrap gap-2">
                    {quickLinks.map(link => (
                      <Link
                        key={link.href}
                        href={link.href}
                        className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-slate-700 hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-700"
                        onClick={() => setOpen(false)}
                      >
                        {link.label}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      <button
        onClick={() => setOpen(v => !v)}
        title="打开诸葛亮工作台"
        className={`inline-flex h-12 items-center gap-2 rounded-full border px-4 shadow-lg transition-all duration-200 ${
          open
            ? 'border-slate-800 bg-slate-950 text-white shadow-slate-900/30'
            : 'border-indigo-200 bg-white text-indigo-700 shadow-slate-200/60 hover:border-indigo-300 hover:bg-indigo-50'
        }`}
      >
        <span className="text-base font-black">诸</span>
        <span className="text-sm font-black">工作台</span>
      </button>
    </div>
  )
}
