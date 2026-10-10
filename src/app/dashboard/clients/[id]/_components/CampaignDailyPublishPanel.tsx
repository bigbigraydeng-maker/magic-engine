'use client'

/**
 * Facebook publish controls for reviewed Daily Plan Posts.
 *
 * Deliberately two clicks, never one: "试发布" is read-only and shows exactly
 * what would go out, and only a completed dry run unlocks the real publish,
 * which then asks for one more explicit confirmation. Nobody should ever have
 * to open a console or paste an id to publish — every field the API demands is
 * supplied from the loaded plan, and the Page comes from the client record.
 */
import { useCallback, useEffect, useState } from 'react'
import { TuneSuggestionInline } from './TuneSuggestionInline'
import type { TuneRecommendation } from '@/lib/flywheel/tune/types'

interface Props {
  clientId: string
  campaignId: string
  planId: string | null
  planRevision: string | null
  reviewRevision: string | null
  facebookPageId: string | null
  /** The no-publish queue receipt exists for this exact snapshot. */
  queueReceiptReady: boolean
  publishReceipt: PublishReceipt | null
  onPublished: () => Promise<void> | void
}

export interface PublishedPost {
  date: string
  /** Tune suggestions are keyed by this, not post_id (a scheduled post's
   *  receipt holds the photo id; its measurement row holds the story id). */
  idempotency_key: string
  post_id: string
  page_id: string
  published_at: string
  permalink: string
}

export interface PublishReceipt {
  status: 'DRY_RUN' | 'PUBLISHED' | 'PARTIAL' | 'FAILED'
  page_id: string
  created_at: string
  published: PublishedPost[]
  failed: Array<{ date: string; error: string; failed_at: string }>
}

interface DryRunPost {
  date: string
  idempotency_key: string
  message_preview: string
  cta_url: string
}

interface DryRunResult {
  would_publish: DryRunPost[]
  already_published: Array<{ date: string }>
}

interface PublishApiResult {
  would_publish?: DryRunPost[]
  already_published?: Array<{ date: string }>
  receipt?: unknown
}

function formatWhen(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('zh-CN', { timeZone: 'Pacific/Auckland', hour12: false })
}

export function CampaignDailyPublishPanel({
  clientId,
  campaignId,
  planId,
  planRevision,
  reviewRevision,
  facebookPageId,
  queueReceiptReady,
  publishReceipt,
  onPublished,
}: Props) {
  const [dryRun, setDryRun] = useState<DryRunResult | null>(null)
  const [busy, setBusy] = useState<'none' | 'dry' | 'live'>('none')
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [progress, setProgress] = useState('')
  const [tuneSuggestions, setTuneSuggestions] = useState<Record<string, TuneRecommendation | null>>({})
  const [tuneFetchFailed, setTuneFetchFailed] = useState(false)

  const identityReady = Boolean(planId && planRevision && reviewRevision)
  const canDryRun = identityReady && queueReceiptReady && Boolean(facebookPageId)

  /**
   * One publish request.
   *
   * `dates` scopes a live call to a single Post: publishing all seven in one
   * request meant a single upstream timeout took down the whole batch and told
   * us nothing about which Post it died on. One request per Post keeps every
   * failure attributable and every success durable.
   */
  const post = useCallback(
    async (body: Record<string, unknown>): Promise<PublishApiResult> => {
      const res = await fetch(`/api/clients/${clientId}/campaign-daily-plan/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          campaign_id: campaignId,
          plan_id: planId,
          plan_revision: planRevision,
          review_revision: reviewRevision,
          page_id: facebookPageId,
          approved: true,
          publish_authorization: true,
          ...body,
        }),
      })

      // The response is not always ours: a proxy in front of the app answers
      // timeouts and gateway errors with an HTML page. Parsing that as JSON
      // used to surface as "Unexpected token '<'", which hides the one thing
      // worth knowing — the status code and who sent it.
      const raw = await res.text()
      let json: Record<string, unknown> | null = null
      try {
        json = JSON.parse(raw) as Record<string, unknown>
      } catch {
        const snippet = raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)
        throw new Error(`HTTP ${res.status} · 服务器没返回数据，返回了一个网页${snippet ? `：${snippet}` : ''}`)
      }

      if (!res.ok || json.success === false) {
        const err = new Error(
          `HTTP ${res.status} · ${typeof json.error === 'string' ? json.error : '请求失败'}`
        ) as Error & { receipt?: unknown }
        err.receipt = json.receipt
        throw err
      }
      return json as PublishApiResult
    },
    [campaignId, clientId, facebookPageId, planId, planRevision, reviewRevision]
  )

  const runDryRun = useCallback(async () => {
    setError('')
    setProgress('')
    setBusy('dry')
    try {
      const json = await post({ no_publish: true })
      setDryRun({
        would_publish: (json.would_publish ?? []) as DryRunPost[],
        already_published: (json.already_published ?? []) as Array<{ date: string }>,
      })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy('none')
    }
  }, [post])

  /** Publish the dry-run list one Post at a time, stopping at the first failure. */
  const runLive = useCallback(async () => {
    if (!dryRun) return
    setError('')
    setBusy('live')
    let done = 0
    try {
      for (const target of dryRun.would_publish) {
        setProgress(`正在发第 ${done + 1} 条 / 共 ${dryRun.would_publish.length} 条（${target.date}）…`)
        try {
          await post({ no_publish: false, dates: [target.date] })
        } catch (err) {
          // Stop here rather than firing the rest blindly: whatever broke this
          // Post is likely to break the next one too, and a half-finished
          // batch nobody can name is exactly what we are trying to avoid.
          setError(`${target.date} 没发出去，已停下：${(err as Error).message}`)
          break
        }
        done += 1
      }
    } finally {
      setProgress('')
      setBusy('none')
      setConfirming(false)
      if (done > 0) {
        setDryRun(null)
        await onPublished()
      }
    }
  }, [dryRun, onPublished, post])

  const publishedPosts = publishReceipt?.published ?? []

  /**
   * 一次拉齐本活动所有已发布帖子的 Tune 建议（Gate B/3，只读）。
   *
   * 读失败必须**显式**告知 UI —— PITFALLS「读失败别显示空输入框」：
   * 若把 500/403/网络断了当空数据处理，PM 会看到「等 T+72」占位并误以为
   * 「时间还没到」，而实际是后台挂了。因此这里区分三态：ok / failed / idle。
   *
   * 依赖 key 用每条 post_id 拼接 —— 用 length 会漏掉「撤一条 + 发一条」这种
   * 数量不变但内容变的情况。
   */
  const publishedPostKey = publishedPosts.map((p) => p.post_id).join(',')
  useEffect(() => {
    if (publishedPosts.length === 0) {
      setTuneSuggestions({})
      setTuneFetchFailed(false)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(
          `/api/clients/${clientId}/campaign-daily-plan/tune-suggestions?campaign_id=${encodeURIComponent(campaignId)}`,
          { cache: 'no-store' },
        )
        if (!res.ok) {
          if (!cancelled) { setTuneFetchFailed(true); setTuneSuggestions({}) }
          return
        }
        const json = (await res.json()) as { success?: boolean; suggestions?: Record<string, TuneRecommendation | null> }
        if (cancelled) return
        if (json.success && json.suggestions) {
          setTuneSuggestions(json.suggestions)
          setTuneFetchFailed(false)
        } else {
          setTuneFetchFailed(true)
          setTuneSuggestions({})
        }
      } catch {
        if (!cancelled) { setTuneFetchFailed(true); setTuneSuggestions({}) }
      }
    })()
    return () => { cancelled = true }
    // publishedPostKey 已经包含 length，改依赖后 length 无需再列。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, campaignId, publishedPostKey])

  return (
    <div className="border-t border-black/[.06] pt-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-me-charcoal/55">发到 Facebook</p>
        {publishReceipt && publishedPosts.length > 0 && (
          <span className="rounded-full bg-[#5C8A4A]/12 px-2 py-0.5 text-[10px] font-medium text-[#5C8A4A]">
            已发 {publishedPosts.length} 条
          </span>
        )}
      </div>

      {!facebookPageId && (
        <p className="mb-2 rounded-lg bg-[#C2453A]/[.06] px-3 py-2 text-[11px] leading-relaxed text-[#C2453A]">
          这个客户还没登记 Facebook 主页，发不了。需要先在客户设置里填上主页 ID。
        </p>
      )}
      {facebookPageId && !queueReceiptReady && (
        <p className="mb-2 text-[11px] leading-relaxed text-me-charcoal/45">
          要先让全部 Post 通过审核并生成上面的发布准备回执，这里才会亮。
        </p>
      )}

      {/* Already published — the authoritative record, shown first. */}
      {publishedPosts.length > 0 && (
        <div className="mb-3 space-y-1.5">
          {publishedPosts.map(post => (
            <div key={post.post_id} className="rounded-lg border border-[#5C8A4A]/25 bg-[#5C8A4A]/[.05] px-2.5 py-2 text-xs">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium text-me-charcoal/70">{post.date.slice(5)} 已发出</span>
                <a
                  href={post.permalink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] font-medium text-me-ochre hover:underline"
                >
                  在 Facebook 上打开 ↗
                </a>
              </div>
              <p className="mt-0.5 text-[10px] text-me-charcoal/45">
                发布时间 {formatWhen(post.published_at)} · 帖子编号 {post.post_id}
              </p>
              <TuneSuggestionInline
                suggestion={tuneSuggestions[post.idempotency_key] ?? null}
                fetchFailed={tuneFetchFailed}
              />
            </div>
          ))}
        </div>
      )}

      {publishReceipt?.failed?.map(failure => (
        <p key={failure.date} className="mb-1.5 text-[11px] text-[#C2453A]">
          {failure.date.slice(5)} 没发出去：{failure.error}
        </p>
      ))}

      {/* Dry-run result — what a real publish would do right now. */}
      {dryRun && (
        <div className="mb-3 rounded-lg bg-me-ivory/70 px-3 py-2">
          <p className="mb-1.5 text-[11px] font-semibold text-me-charcoal/60">
            试发布结果：会发 {dryRun.would_publish.length} 条
            {dryRun.already_published.length > 0 && `，跳过 ${dryRun.already_published.length} 条（已经发过）`}
          </p>
          <div className="space-y-1">
            {dryRun.would_publish.map(post => (
              <div key={post.idempotency_key} className="rounded border border-black/[.06] bg-white px-2 py-1.5">
                <p className="text-[11px] font-medium text-me-charcoal/70">{post.date.slice(5)}</p>
                <p className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-me-charcoal/50">
                  {post.message_preview}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-1.5 text-[10px] text-me-charcoal/40">这一步没有发布任何东西。</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!canDryRun || busy !== 'none'}
          onClick={() => void runDryRun()}
          className="rounded-md bg-me-charcoal/[.08] px-3 py-1.5 text-xs font-medium text-me-charcoal/70 transition-colors hover:bg-me-charcoal/[.12] disabled:opacity-50"
        >
          {busy === 'dry' ? '检查中…' : '试发布（只看，不发）'}
        </button>

        {dryRun && dryRun.would_publish.length > 0 && !confirming && (
          <button
            type="button"
            disabled={busy !== 'none'}
            onClick={() => setConfirming(true)}
            className="rounded-md bg-me-ochre px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-me-gold disabled:opacity-50"
          >
            确认发布这 {dryRun.would_publish.length} 条
          </button>
        )}

        {confirming && (
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-[#C2453A]/[.06] px-2.5 py-1.5">
            <span className="text-[11px] font-medium text-[#C2453A]">发出去就撤不回来了，确定？</span>
            <button
              type="button"
              disabled={busy !== 'none'}
              onClick={() => void runLive()}
              className="rounded bg-[#C2453A] px-2.5 py-1 text-[11px] font-medium text-white hover:bg-[#A63A30] disabled:opacity-50"
            >
              {busy === 'live' ? '发布中…' : '确定，发'}
            </button>
            <button
              type="button"
              disabled={busy !== 'none'}
              onClick={() => setConfirming(false)}
              className="rounded px-2 py-1 text-[11px] font-medium text-me-charcoal/50 hover:text-me-charcoal/70"
            >
              取消
            </button>
          </div>
        )}
      </div>

      {progress && <p className="mt-2 text-[11px] text-me-charcoal/55">{progress}</p>}
      {error && <p className="mt-2 text-[11px] text-[#C2453A]">✗ {error}</p>}
    </div>
  )
}
