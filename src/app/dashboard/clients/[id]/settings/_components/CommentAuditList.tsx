'use client'

/**
 * CommentAuditList — read-only audit view over the full-auto comment engine.
 *
 * Shows recent decisions from social_comment_engagements: what was replied /
 * DM'd / hidden / flagged for human. FDE can revert an auto-reply (deletes it
 * on Facebook) or mark a needs-human item reviewed.
 */

import { useState, useEffect, useCallback } from 'react'

interface Props {
  clientId: string
}

interface Engagement {
  id: string
  category: string | null
  comment_text: string | null
  author_name: string | null
  public_reply_text: string | null
  private_reply_sent: boolean
  hidden: boolean
  reply_status: string
  needs_human: boolean
  guardrail_flags: string[] | null
  reply_source: string | null
  created_at: string
}

const CATEGORY_META: Record<string, { label: string; cls: string }> = {
  praise:    { label: '夸赞', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  question:  { label: '提问', cls: 'bg-sky-50 text-sky-700 border-sky-200' },
  complaint: { label: '负面', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  spam:      { label: '垃圾', cls: 'bg-slate-100 text-slate-500 border-slate-200' },
  other:     { label: '其他', cls: 'bg-slate-50 text-slate-500 border-slate-200' },
}

const STATUS_LABEL: Record<string, string> = {
  replied: '已回帖', dm_sent: '已私信', hidden: '已隐藏',
  pending: '待人工', skipped: '未处理', reverted: '已撤回', failed: '失败',
}

export function CommentAuditList({ clientId }: Props) {
  const [items, setItems] = useState<Engagement[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/comment-engagements?limit=25`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const { engagements } = (await res.json()) as { engagements: Engagement[] }
      setItems(engagements)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [clientId])

  useEffect(() => { void load() }, [load])

  const act = async (engagementId: string, action: 'revert' | 'mark_reviewed') => {
    setBusyId(engagementId)
    try {
      const res = await fetch(`/api/clients/${clientId}/comment-engagements`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engagement_id: engagementId, action }),
      })
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
        throw new Error(error)
      }
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyId(null)
    }
  }

  if (items === null && !error) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-cyan-600" />
        正在加载最近自动回复…
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        <p className="font-bold">加载失败</p><p>{error}</p>
        <button onClick={load} className="mt-2 font-medium underline">重试</button>
      </div>
    )
  }

  if (!items || items.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-500">
        还没有自动回复记录。开启配置并等下一次 cron 运行后，这里会显示每一条决策。
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {items.map(it => {
        const cat = CATEGORY_META[it.category ?? 'other'] ?? CATEGORY_META.other
        return (
          <div key={it.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <span className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${cat.cls}`}>{cat.label}</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                {STATUS_LABEL[it.reply_status] ?? it.reply_status}
              </span>
              {it.reply_source === 'fallback' && (
                <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-600" title="回复来自安全模板（非 AI 自由发挥）">安全模板</span>
              )}
              {it.needs_human && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-700">需人工</span>
              )}
              <span className="ml-auto text-[11px] text-slate-400">
                {new Date(it.created_at).toLocaleString('zh-CN')}
              </span>
            </div>

            <p className="mt-2 text-sm text-slate-700">
              <span className="font-semibold text-slate-500">{it.author_name ?? '匿名'}：</span>
              {it.comment_text || <span className="italic text-slate-400">（无文本）</span>}
            </p>

            {it.public_reply_text && (
              <p className="mt-1 rounded-lg bg-cyan-50 px-3 py-2 text-sm text-cyan-900">
                ↳ {it.public_reply_text}
                {it.private_reply_sent && <span className="ml-1 text-[11px] font-semibold text-cyan-600">· 已私信</span>}
              </p>
            )}

            <div className="mt-2 flex items-center gap-3">
              {(it.reply_status === 'replied' || it.reply_status === 'dm_sent') && (
                <button onClick={() => act(it.id, 'revert')} disabled={busyId === it.id}
                  className="text-xs font-semibold text-red-600 hover:underline disabled:opacity-50">
                  {busyId === it.id ? '处理中…' : '撤回回复'}
                </button>
              )}
              {it.needs_human && (
                <button onClick={() => act(it.id, 'mark_reviewed')} disabled={busyId === it.id}
                  className="text-xs font-semibold text-slate-600 hover:underline disabled:opacity-50">
                  标记已阅
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
