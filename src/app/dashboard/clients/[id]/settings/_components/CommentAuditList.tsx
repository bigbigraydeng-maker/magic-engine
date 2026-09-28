'use client'

/**
 * CommentAuditList — read-only audit view over the full-auto comment engine.
 *
 * Shows recent decisions from social_comment_engagements: what was replied /
 * DM'd / hidden / flagged for human. FDE can revert an auto-reply (deletes it
 * on Facebook), or mark a row reviewed — this is the only action that clears
 * `reviewed_at`, which is what makes a permanently-stuck row (see
 * comment-autoreply-stuck-items.ts) stop reappearing in the daily todo.
 *
 * "标记已阅" used to only show for `needs_human` rows. A row that's stuck
 * (failed after exhausting retries, dm_sent with no public reply, or stale
 * processing) has no requirement that `needs_human` be true — a plain praise
 * comment that failed to send is still stuck, `needs_human=false` and all —
 * so the button must also cover those, or the "point mark_reviewed to close
 * this todo" instruction in that pm-todo channel has nowhere to click
 * (Codex round 3 复审 P1).
 */

import { useState, useEffect, useCallback } from 'react'
import { MAX_ATTEMPTS, STALE_PROCESSING_MS } from '@/lib/social/comment-autoreply-constants'

interface Props {
  clientId: string
}

export interface Engagement {
  id: string
  category: string | null
  comment_text: string | null
  author_name: string | null
  public_reply_text: string | null
  public_reply_id: string | null
  private_reply_sent: boolean
  hidden: boolean
  reply_status: string
  attempts: number
  needs_human: boolean
  reviewed_at: string | null
  guardrail_flags: string[] | null
  reply_source: string | null
  created_at: string
  updated_at: string
  post_id: string
  comment_id: string
}

/**
 * Facebook's own permalink shape for a comment: post URL + `?comment_id=`
 * deep-links to that comment on the post, scrolled to and highlighted.
 * `post_id`/`comment_id` are stored exactly as Graph API returned them
 * (claimComment's insert), so no extra API call or field is needed to build
 * this (Codex round 18 复审 P2: FDE had no way to open the specific stuck
 * comment on Facebook to check whether it already has a reply there — the
 * audit list only shows author/text/time, not enough to locate a 39-day-old
 * comment on a busy page by hand).
 */
export function facebookCommentUrl(postId: string, commentId: string): string {
  return `https://www.facebook.com/${postId}?comment_id=${commentId}`
}

/**
 * Must mirror comment-autoreply-stuck-items.ts's own "stuck" query exactly,
 * not just loosely by `reply_status` (Codex round 5 复审 P2): a `failed` row
 * still mid-retry, or a `processing` row still well within a normal run, is
 * not actually stuck yet. Showing the button for those anyway invites an
 * early click that writes `reviewed_at` — which `finalise()` never clears —
 * permanently hiding this row from the todo detector if it goes on to become
 * genuinely stuck later. Already-reviewed rows are excluded too, so the
 * button doesn't keep reappearing after being clicked once.
 *
 * Only covers 3 of the 4 categories (Codex round 13 复审 P1): a `failed` row
 * that hasn't exhausted retries but has aged out of the client's configured
 * `lookback_days` is ALSO stuck (comment-autoreply-stuck-items.ts §4), but
 * this function has no way to know that client's lookback_days — it isn't
 * on `Engagement` and this component never fetches client config. The
 * caller covers that 4th category separately, by trusting any row the
 * server's own `?stuck=1` fetch already returned (see `stuckIds` in
 * `CommentAuditList`) rather than trying to re-derive it here.
 */
export function isStuck(it: Engagement, now: number = Date.now()): boolean {
  if (it.reviewed_at) return false
  if (it.reply_status === 'failed') return it.attempts >= MAX_ATTEMPTS
  if (it.reply_status === 'processing') return now - Date.parse(it.updated_at) >= STALE_PROCESSING_MS
  return it.reply_status === 'dm_sent' && !it.public_reply_id
}

/**
 * Union of the recency-windowed page and the always-complete stuck set, by
 * id, newest first (Codex round 7 复审 P1: a stuck row older than the recency
 * window would otherwise never load, so its only closing action — the
 * "标记已阅" button below — becomes permanently unreachable).
 */
export function mergeEngagements(recent: Engagement[], stuck: Engagement[]): Engagement[] {
  const byId = new Map<string, Engagement>()
  for (const it of [...recent, ...stuck]) byId.set(it.id, it)
  return Array.from(byId.values()).sort((a, b) => b.created_at.localeCompare(a.created_at))
}

/**
 * Whether "标记已阅" should render for this row — `needs_human`, or stuck by
 * one of the 3 categories `isStuck` can judge alone, or stuck by the 4th
 * (lookback-orphaned) one that only the server's `?stuck=1` result can prove
 * (Codex round 13 复审 P1 — see `isStuck`'s docstring for why).
 */
export function shouldShowMarkReviewed(it: Engagement, stuckIds: Set<string>, now: number = Date.now()): boolean {
  return it.needs_human || isStuck(it, now) || stuckIds.has(it.id)
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
  // 服务端 `?stuck=1` 返回的 id 集合——`isStuck()` 判不出"越窗未耗尽"这一类
  // （需要这个客户的 lookback_days，这个组件读不到），直接信这个集合，不重算
  // （Codex round 13 复审 P1）。
  const [stuckIds, setStuckIds] = useState<Set<string>>(new Set())

  /**
   * Fetches recent rows AND stuck rows separately, then merges (Codex round 7
   * 复审 P1): the API's default page is a recency window (`?limit=25`), so a
   * stuck row older than that never loads here — its only closing action
   * ("标记已阅" below) becomes permanently unreachable even after an FDE has
   * manually handled it. `?stuck=1` returns every currently-stuck row for
   * this client regardless of age; merging guarantees one is always visible.
   */
  const load = useCallback(async () => {
    setError(null)
    try {
      const [recentRes, stuckRes] = await Promise.all([
        fetch(`/api/clients/${clientId}/comment-engagements?limit=25`),
        fetch(`/api/clients/${clientId}/comment-engagements?stuck=1`),
      ])
      if (!recentRes.ok) throw new Error(`HTTP ${recentRes.status}`)
      if (!stuckRes.ok) throw new Error(`HTTP ${stuckRes.status}`)
      const { engagements: recent } = (await recentRes.json()) as { engagements: Engagement[] }
      const { engagements: stuck } = (await stuckRes.json()) as { engagements: Engagement[] }
      setStuckIds(new Set(stuck.map((it) => it.id)))
      setItems(mergeEngagements(recent, stuck))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [clientId])

  useEffect(() => { void load() }, [load])

  // `expectedUpdatedAt`（mark_reviewed 专用，Codex round 17 复审 P2）：告诉服务端
  // 这次点击是基于哪个版本的行做出的决定——这行如果在点击之后、请求到达之前
  // 又被系统重试改过（`updated_at` 变了），服务端会拒绝这次写入而不是盲目盖过去
  // （见 route.ts PATCH 的注释）。revert 不受这条竞态影响，不用传。
  const act = async (engagementId: string, action: 'revert' | 'mark_reviewed', expectedUpdatedAt?: string) => {
    setBusyId(engagementId)
    try {
      const res = await fetch(`/api/clients/${clientId}/comment-engagements`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          engagement_id: engagementId,
          action,
          ...(expectedUpdatedAt ? { expected_updated_at: expectedUpdatedAt } : {}),
        }),
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
              <a href={facebookCommentUrl(it.post_id, it.comment_id)} target="_blank" rel="noopener noreferrer"
                className="text-xs font-semibold text-blue-600 hover:underline">
                去 Facebook 看原评论 →
              </a>
              {(it.reply_status === 'replied' || it.reply_status === 'dm_sent') && (
                <button onClick={() => act(it.id, 'revert')} disabled={busyId === it.id}
                  className="text-xs font-semibold text-red-600 hover:underline disabled:opacity-50">
                  {busyId === it.id ? '处理中…' : '撤回回复'}
                </button>
              )}
              {shouldShowMarkReviewed(it, stuckIds) && (
                <button onClick={() => act(it.id, 'mark_reviewed', it.updated_at)} disabled={busyId === it.id}
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
