'use client'

/**
 * PlanEditor — Marketing Plan 详情和编辑视图
 *
 * 显示：
 *   - Executive summary（AI 总览）
 *   - Social 矩阵（各平台数量/频率）
 *   - Blog 主题清单
 *   - KPI
 *   - 任务清单（批准后会派发到执行看板）
 *
 * 操作：
 *   - 编辑文本字段（保存到 plan_data）
 *   - 批准 → 派发任务（调 /approve 路由）
 *   - 归档
 */

import { useState, useMemo } from 'react'
import Link from 'next/link'
import type {
  MarketingPlan,
  MarketingPlanData,
  PlanTask,
  SocialPlatform,
  PlatformContentMix,
  BlogTopicPlan,
} from '@/lib/marketing-plan/types'

interface Props {
  clientId: string
  plan: MarketingPlan
  onUpdated: (plan: MarketingPlan) => void
}

const PLATFORM_LABEL: Record<SocialPlatform, string> = {
  facebook:  'Facebook',
  instagram: 'Instagram',
  tiktok:    'TikTok',
  linkedin:  'LinkedIn',
}

const TASK_KIND_META: Record<PlanTask['kind'], { icon: string; label: string; cls: string }> = {
  social_post:  { icon: '📝', label: '社媒帖子',  cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  social_reel:  { icon: '🎬', label: 'Reel 视频', cls: 'bg-purple-50 text-purple-700 border-purple-200' },
  social_story: { icon: '⚡', label: 'Story',     cls: 'bg-pink-50 text-pink-700 border-pink-200' },
  blog_article: { icon: '📰', label: '博客文章',  cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
}

export function PlanEditor({ clientId, plan, onUpdated }: Props) {
  // 本地 draft — 编辑时改本地，保存后回写
  const [draft, setDraft] = useState<MarketingPlanData>(plan.plan_data)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [approving, setApproving] = useState(false)
  const [msg, setMsg] = useState('')
  const [msgOk, setMsgOk] = useState<boolean | null>(null)

  // 重置 draft 当切换 plan 时
  // 用 useMemo 检测 plan.id 变化并触发重置
  useMemo(() => {
    setDraft(plan.plan_data)
    setDirty(false)
    setMsg('')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan.id])

  const editable = plan.status === 'draft'
  const taskCount = (draft.tasks ?? []).length

  const setMessage = (text: string, ok: boolean) => {
    setMsg(text)
    setMsgOk(ok)
    if (ok) setTimeout(() => setMsg(''), 3000)
  }

  // ── Save 编辑 ────────────────────────────────────────────────────────────
  const saveDraft = async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/marketing-plan/${plan.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_data: draft }),
      })
      const json = await res.json() as { success: boolean; plan?: MarketingPlan; error?: string }
      if (!json.success || !json.plan) throw new Error(json.error ?? 'Save failed')
      onUpdated(json.plan)
      setDirty(false)
      setMessage('✓ 已保存', true)
    } catch (err) {
      setMessage(`✗ ${(err as Error).message}`, false)
    } finally {
      setSaving(false)
    }
  }

  // ── Approve + Dispatch ──────────────────────────────────────────────────
  const approve = async () => {
    if (taskCount === 0) {
      setMessage('✗ 没有任务可派发 — 请先生成或编辑 plan_data.tasks', false)
      return
    }
    if (!confirm(`确认批准这份 Plan？将会派发 ${taskCount} 个任务到执行看板（鲁班）。`)) return

    setApproving(true)
    try {
      // 先保存最新编辑
      if (dirty) await saveDraft()
      // 然后批准
      const res = await fetch(`/api/clients/${clientId}/marketing-plan/${plan.id}/approve`, {
        method: 'POST',
      })
      const json = await res.json() as {
        success: boolean
        plan?: MarketingPlan
        dispatch?: { tasks_created: number }
        error?: string
      }
      if (!json.success || !json.plan) throw new Error(json.error ?? 'Approve failed')
      onUpdated(json.plan)
      setMessage(`✓ Plan 已批准，派发了 ${json.dispatch?.tasks_created ?? 0} 个任务到执行看板`, true)
    } catch (err) {
      setMessage(`✗ ${(err as Error).message}`, false)
    } finally {
      setApproving(false)
    }
  }

  // ── 编辑辅助 ────────────────────────────────────────────────────────────
  const updateSocialPlatform = (platform: SocialPlatform, field: keyof PlatformContentMix, value: number | string | null) => {
    setDraft(d => {
      const existing = (d.social[platform] ?? { posts_per_week: 0, reels_per_month: 0, stories_per_week: 0 }) as PlatformContentMix
      return {
        ...d,
        social: {
          ...d.social,
          [platform]: { ...existing, [field]: value } as PlatformContentMix,
        },
      }
    })
    setDirty(true)
  }

  const updateBlogTopic = (idx: number, field: keyof BlogTopicPlan, value: string | number | null) => {
    setDraft(d => {
      const topics = [...d.blog.topics]
      topics[idx] = { ...topics[idx], [field]: value } as BlogTopicPlan
      return { ...d, blog: { ...d.blog, topics } }
    })
    setDirty(true)
  }

  const updateKpi = (key: keyof MarketingPlanData['kpis'], value: string) => {
    setDraft(d => ({ ...d, kpis: { ...d.kpis, [key]: value || null } }))
    setDirty(true)
  }

  // ── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">

      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-100 flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold text-gray-900">{plan.title}</h2>
          <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
            {plan.start_date && plan.end_date && (
              <span>📅 {plan.start_date} → {plan.end_date}</span>
            )}
            <span>📋 {taskCount} 个任务</span>
            {plan.approved_at && (
              <span className="text-green-600">✓ 已于 {plan.approved_at.slice(0, 10)} 批准</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {editable && (
            <>
              {dirty && (
                <button
                  onClick={saveDraft}
                  disabled={saving}
                  className="text-xs bg-gray-800 hover:bg-gray-900 text-white px-3 py-1.5 rounded-lg disabled:opacity-50"
                >
                  {saving ? '保存中…' : '💾 保存编辑'}
                </button>
              )}
              <button
                onClick={approve}
                disabled={approving || taskCount === 0}
                className="text-sm bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-1.5 rounded-lg disabled:opacity-50 font-semibold"
                title={taskCount === 0 ? '没有任务可派发' : `派发 ${taskCount} 个任务到执行看板`}
              >
                {approving ? '派发中…' : `🚀 批准并派发 (${taskCount})`}
              </button>
            </>
          )}
          {plan.status === 'approved' && (
            <Link
              href={`/dashboard/clients/${clientId}/execution`}
              className="text-sm bg-green-600 hover:bg-green-700 text-white px-4 py-1.5 rounded-lg font-medium"
            >
              查看执行看板 →
            </Link>
          )}
        </div>
      </div>

      {/* Message */}
      {msg && (
        <div className={`px-5 py-2 text-xs ${msgOk ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {msg}
        </div>
      )}

      {/* Executive summary */}
      {draft.executive_summary && (
        <div className="px-5 py-3 bg-indigo-50/50 border-b border-indigo-100">
          <p className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider mb-1">📌 Executive Summary</p>
          <p className="text-sm text-gray-800 leading-relaxed">{draft.executive_summary}</p>
        </div>
      )}

      {/* Body — 5 sections */}
      <div className="p-5 space-y-5">

        {/* ── Social 矩阵 ─────────────────────────────────────────────────── */}
        <section>
          <p className="text-xs font-bold text-gray-700 uppercase tracking-wide mb-2">📱 社媒内容矩阵</p>
          <div className="rounded-xl border border-gray-100 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">平台</th>
                  <th className="px-3 py-2 text-center font-medium">每周帖子</th>
                  <th className="px-3 py-2 text-center font-medium">每月 Reels</th>
                  <th className="px-3 py-2 text-center font-medium">每周 Stories</th>
                </tr>
              </thead>
              <tbody>
                {(['facebook', 'instagram', 'tiktok', 'linkedin'] as SocialPlatform[]).map(plat => {
                  const cfg = draft.social[plat]
                  if (!cfg && !editable) return null
                  return (
                    <tr key={plat} className="border-t border-gray-100">
                      <td className="px-3 py-2 font-medium text-gray-700">{PLATFORM_LABEL[plat]}</td>
                      {(['posts_per_week', 'reels_per_month', 'stories_per_week'] as const).map(field => (
                        <td key={field} className="px-3 py-2 text-center">
                          {editable ? (
                            <input
                              type="number"
                              min={0}
                              max={50}
                              value={cfg?.[field] ?? 0}
                              onChange={e => updateSocialPlatform(plat, field, parseInt(e.target.value) || 0)}
                              className="w-14 text-center rounded border border-gray-200 px-1 py-0.5 text-xs focus:border-indigo-400 focus:outline-none"
                            />
                          ) : (
                            <span className="font-mono text-gray-900">{cfg?.[field] ?? 0}</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Blog 主题清单 ──────────────────────────────────────────────────── */}
        <section>
          <p className="text-xs font-bold text-gray-700 uppercase tracking-wide mb-2">
            📰 博客主题清单（计划月度数: {draft.blog.monthly_count}）
          </p>
          <div className="space-y-2">
            {draft.blog.topics.length === 0 ? (
              <p className="text-xs text-gray-400 italic px-3 py-2">无博客主题</p>
            ) : (
              draft.blog.topics.map((topic, i) => (
                <div key={i} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                  <div className="flex items-start gap-2 mb-1.5">
                    <span className="shrink-0 text-[10px] font-bold bg-emerald-100 text-emerald-700 rounded-full px-1.5 py-0.5 mt-0.5">
                      W{topic.due_week}
                    </span>
                    {editable ? (
                      <input
                        value={topic.title}
                        onChange={e => updateBlogTopic(i, 'title', e.target.value)}
                        className="flex-1 text-sm font-semibold text-gray-900 bg-transparent border-b border-dashed border-gray-300 focus:border-indigo-400 focus:outline-none"
                      />
                    ) : (
                      <p className="text-sm font-semibold text-gray-900 flex-1">{topic.title}</p>
                    )}
                    {topic.content_mode && (
                      <span className="text-[10px] bg-indigo-50 text-indigo-700 rounded px-1.5 py-0.5">
                        {topic.content_mode}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-500 italic ml-7">{topic.rationale}</p>
                  {topic.primary_keyword && (
                    <p className="text-[10px] text-gray-400 ml-7 mt-1">
                      🔑 {topic.primary_keyword}
                      {topic.keyword_volume != null && ` · vol ${topic.keyword_volume}`}
                      {topic.keyword_kd != null && ` · kd ${topic.keyword_kd}`}
                    </p>
                  )}
                </div>
              ))
            )}
          </div>
        </section>

        {/* ── KPI ───────────────────────────────────────────────────────────── */}
        <section>
          <p className="text-xs font-bold text-gray-700 uppercase tracking-wide mb-2">🎯 KPI</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {([
              ['social_engagement', '社媒互动', '#f0f9ff'],
              ['blog_traffic',      '博客流量', '#fef3c7'],
              ['ai_visibility',     'AI 可见度', '#ede9fe'],
            ] as const).map(([key, label]) => (
              <div key={key} className="rounded-lg border border-gray-100 bg-gray-50 p-2.5">
                <p className="text-[10px] font-bold text-gray-500 uppercase mb-1">{label}</p>
                {editable ? (
                  <input
                    value={draft.kpis[key] ?? ''}
                    onChange={e => updateKpi(key, e.target.value)}
                    placeholder="设定目标…"
                    className="w-full text-xs text-gray-900 bg-transparent border-b border-dashed border-gray-300 focus:border-indigo-400 focus:outline-none"
                  />
                ) : (
                  <p className="text-xs text-gray-800">{draft.kpis[key] || '—'}</p>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* ── 任务清单预览 ─────────────────────────────────────────────────────── */}
        <section>
          <p className="text-xs font-bold text-gray-700 uppercase tracking-wide mb-2">
            📋 任务清单预览（批准后派发到执行看板）
          </p>
          <div className="space-y-1.5">
            {(draft.tasks ?? []).length === 0 ? (
              <p className="text-xs text-gray-400 italic px-3 py-2">无任务</p>
            ) : (
              (draft.tasks ?? []).map((task, i) => {
                const meta = TASK_KIND_META[task.kind] ?? TASK_KIND_META.social_post
                return (
                  <div key={i} className="rounded-lg border border-gray-100 bg-white p-2.5 flex items-start gap-2">
                    <span className={`shrink-0 text-[10px] font-medium border rounded-full px-1.5 py-0.5 ${meta.cls}`}>
                      {meta.icon} {meta.label}
                    </span>
                    {task.platform && (
                      <span className="shrink-0 text-[10px] text-gray-400">{PLATFORM_LABEL[task.platform]}</span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-gray-900 truncate">{task.title}</p>
                      <p className="text-[10px] text-gray-500 line-clamp-1">{task.description}</p>
                    </div>
                    <span className="shrink-0 text-[10px] text-gray-400">📅 {task.due_date}</span>
                  </div>
                )
              })
            )}
          </div>
        </section>

      </div>
    </div>
  )
}
