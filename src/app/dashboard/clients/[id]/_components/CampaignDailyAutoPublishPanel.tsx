'use client'

/**
 * PM-only controls for the unattended Daily Plan publisher.
 *
 * This panel never publishes anything itself — every check lives on the
 * server. Its whole job is to make the PM's two decisions legible and
 * reversible: authorise the unattended publisher for ONE reviewed plan, and
 * stop it. Everything the PM reads is plain Chinese; the words idempotency,
 * tombstone, claim, cron and token never appear here.
 *
 * Two rules shape the interface:
 *   - A failed status read is never dressed up as "not authorised". If we
 *     cannot see the state we say so in red, because "nothing is running"
 *     and "we don't know what is running" are very different things.
 *   - Going live always costs a second, explicit click, exactly like the
 *     manual publish panel next to it.
 */
import { useCallback, useEffect, useState } from 'react'

interface Props {
  clientId: string
  campaignId: string
  planId: string | null
  planRevision: string | null
  reviewRevision: string | null
  facebookPageId: string | null
  reviewedDates: string[]
  queueReceiptReady: boolean
  onChanged?: () => Promise<void> | void
}

interface Authorization {
  id: string
  dates: string[]
  lifted_dates: string[]
  authorized_by_email: string
  authorized_at: string
  activated_at: string | null
  expires_at: string
  state: 'active' | 'not_activated' | 'expired' | 'plan_changed' | 'revoked'
}

interface Attempt {
  date: string
  status: string
  reason_code: string | null
  attempt_no: number
  next_retry_at: string | null
  post_id: string | null
}

interface StatusResult {
  can_manage: boolean
  mode?: 'practice' | 'live'
  authorization?: Authorization | null
  attempts?: Attempt[]
}

interface PreviewPost {
  date: string
  message_preview: string
}

interface PreviewResult {
  would_publish: PreviewPost[]
  would_lift_recalled: string[]
}

interface RevokeResult {
  in_flight_status?: string
  in_flight?: Array<{ date: string }>
}

/** Plain-Chinese translations for the error codes the routes can return. */
const ERROR_TEXT: Record<string, string> = {
  GLOBAL_ADMIN_REQUIRED: '只有管理员能操作自动发布',
  DATE_IN_PAST: '有日期已经过去了，不能授权',
  PAGE_ID_MISMATCH: 'Facebook 主页号和客户登记的不一致',
  CLIENT_HAS_NO_FACEBOOK_PAGE: '这个客户还没登记 Facebook 主页',
  ALREADY_AUTHORIZED: '这份计划已经授权了，先停止再重新授权',
  PRICE_CLAIM_UNBACKED: '有帖子写了价格，但配图证明不了这个价格，整批被拦',
  PRICE_FACT_UNVERIFIED: '有帖子里的价格和客户资料对不上，整批被拦',
  FIRST_COMMENT_CHECK_FAILED: '有帖子正文里带了链接或行动号召，整批被拦',
  POSTS_NOT_READY_FOR_PUBLISH: '有帖子还没准备好（图片或文案不可用）',
  PUBLISH_QUEUE_RECEIPT_REQUIRED: '发布准备回执缺失或过期，要重新生成',
  PUBLISH_QUEUE_RECEIPT_STALE: '发布准备回执缺失或过期，要重新生成',
  REVIEW_REVISION_MISMATCH: '计划被改过了，请刷新页面',
  PLAN_REVISION_MISMATCH: '计划被改过了，请刷新页面',
  PLAN_SUPERSEDED: '计划被改过了，请刷新页面',
  AUTHORIZATION_EVENT_NOT_SENT: '授权没成功（系统没能记录），请稍后再试',
  AUTHORIZATION_NOT_ACTIVATED: '授权没能生效，请稍后再试',
  NO_ACTIVE_AUTHORIZATION: '没有生效中的授权',
  NO_UNKNOWN_OUTCOME: '这一条已经被处理过了，请刷新',
  INTERNAL_ERROR: '系统出错了，请稍后再试',
}

function translateError(code: unknown): string {
  if (typeof code === 'string' && ERROR_TEXT[code]) return ERROR_TEXT[code]
  return `请求没成功（${typeof code === 'string' ? code : '未知错误'}）`
}

function formatWhen(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('zh-CN', { timeZone: 'Pacific/Auckland', hour12: false })
}

function shortDate(date: string): string {
  return date.slice(5)
}

/** Chinese status word for one attempt row. */
function attemptLabel(attempt: Attempt): string {
  switch (attempt.status) {
    case 'published':
      return '已交给 Facebook'
    case 'claimed':
      return '正在处理'
    case 'blocked':
      return attempt.reason_code === 'RECALLED'
        ? '已撤回，不会再自动发'
        : `被发布前检查拦住了（原因：${attempt.reason_code ?? '未知'}）`
    case 'failed_retryable':
      return `出错了，会自动再试（第 ${attempt.attempt_no} 次）`
    case 'failed_final':
      return '多次出错，已放弃'
    case 'unknown_outcome':
      return '不确定有没有发出去'
    case 'missed_window':
      return '发布时间已过，没有补发'
    case 'dry_run':
      return '演练'
    default:
      return attempt.status
  }
}

export function CampaignDailyAutoPublishPanel({
  clientId,
  campaignId,
  planId,
  planRevision,
  reviewRevision,
  facebookPageId,
  reviewedDates,
  queueReceiptReady,
  onChanged,
}: Props) {
  const [status, setStatus] = useState<StatusResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [readError, setReadError] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [liftDates, setLiftDates] = useState<string[]>([])
  const [recalledDates, setRecalledDates] = useState<string[]>([])
  const [confirmingAuthorize, setConfirmingAuthorize] = useState(false)
  const [confirmingRevoke, setConfirmingRevoke] = useState(false)
  const [stopReason, setStopReason] = useState('')
  const [inFlight, setInFlight] = useState<RevokeResult | null>(null)
  const [confirmingUnknown, setConfirmingUnknown] = useState<string | null>(null)

  const identityReady = Boolean(planId && planRevision && reviewRevision)

  /**
   * One POST, parsed defensively.
   *
   * A proxy in front of the app answers timeouts with an HTML page; parsing
   * that as JSON used to surface as "Unexpected token '<'", which hides the
   * one thing worth knowing — the status code and who sent it.
   */
  const post = useCallback(
    async (path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> => {
      const res = await fetch(`/api/clients/${clientId}/campaign-daily-plan/auto-publish/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const raw = await res.text()
      let json: Record<string, unknown> | null = null
      try {
        json = JSON.parse(raw) as Record<string, unknown>
      } catch {
        const snippet = raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)
        throw new Error(`HTTP ${res.status} · 服务器没返回数据，返回了一个网页${snippet ? `：${snippet}` : ''}`)
      }
      if (!res.ok || json.success === false) {
        const err = new Error(translateError(json.error)) as Error & { code?: unknown; dates?: string[] }
        err.code = json.error
        if (Array.isArray(json.dates)) err.dates = json.dates as string[]
        throw err
      }
      return json
    },
    [clientId]
  )

  const loadStatus = useCallback(async () => {
    if (!planId) return
    setLoading(true)
    setReadError('')
    try {
      const res = await fetch(
        `/api/clients/${clientId}/campaign-daily-plan/auto-publish/status?plan_id=${encodeURIComponent(planId)}&plan_revision=${encodeURIComponent(planRevision ?? '')}&review_revision=${encodeURIComponent(reviewRevision ?? '')}`,
        { cache: 'no-store' }
      )
      const raw = await res.text()
      let json: Record<string, unknown> | null = null
      try {
        json = JSON.parse(raw) as Record<string, unknown>
      } catch {
        const snippet = raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)
        setReadError(`HTTP ${res.status} · 服务器没返回数据，返回了一个网页${snippet ? `：${snippet}` : ''}`)
        setStatus(null)
        return
      }
      // Not logged in / not allowed: this section is simply not for this visitor — say nothing, show nothing.
      if (res.status === 401 || res.status === 403) {
        setStatus({ can_manage: false })
        return
      }
      if (!res.ok || json.success === false) {
        setReadError(`HTTP ${res.status} · ${translateError(json.error)}`)
        setStatus(null)
        return
      }
      setStatus(json as unknown as StatusResult)
    } catch (err) {
      setReadError((err as Error).message)
      setStatus(null)
    } finally {
      setLoading(false)
    }
  }, [clientId, planId, planRevision, reviewRevision])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  const runAuthorize = useCallback(
    async (confirm: boolean, lift: string[]) => {
      setError('')
      setBusy(true)
      try {
        const json = await post('authorize', {
          client_id: clientId,
          campaign_id: campaignId,
          plan_id: planId,
          plan_revision: planRevision,
          review_revision: reviewRevision,
          page_id: facebookPageId,
          dates: reviewedDates,
          max_per_day: 1,
          expires_in_days: 14,
          confirm,
          lift_recalled_dates: lift,
        })
        if (!confirm) {
          setPreview({
            would_publish: (json.would_publish ?? []) as PreviewPost[],
            would_lift_recalled: (json.would_lift_recalled ?? []) as string[],
          })
          setLiftDates(lift)
          setRecalledDates([])
        } else {
          setPreview(null)
          setConfirmingAuthorize(false)
          setLiftDates([])
          setRecalledDates([])
          await loadStatus()
          await onChanged?.()
        }
      } catch (err) {
        const e = err as Error & { code?: unknown; dates?: string[] }
        if (e.code === 'DATE_RECALLED' && Array.isArray(e.dates)) {
          setRecalledDates(e.dates)
          setError('')
        } else {
          setError(e.message)
        }
      } finally {
        setBusy(false)
      }
    },
    [campaignId, clientId, facebookPageId, loadStatus, onChanged, planId, planRevision, post, reviewRevision, reviewedDates]
  )

  const runRevoke = useCallback(async () => {
    setError('')
    setBusy(true)
    try {
      const json = await post('revoke', {
        client_id: clientId,
        campaign_id: campaignId,
        plan_id: planId,
        reason: stopReason.trim(),
      })
      setInFlight({
        in_flight_status: typeof json.in_flight_status === 'string' ? json.in_flight_status : undefined,
        in_flight: Array.isArray(json.in_flight) ? (json.in_flight as Array<{ date: string }>) : [],
      })
      setConfirmingRevoke(false)
      setStopReason('')
      await loadStatus()
      await onChanged?.()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }, [campaignId, clientId, loadStatus, onChanged, planId, post, stopReason])

  const runConfirmUnknown = useCallback(
    async (date: string, outcome: 'published' | 'not_published') => {
      setError('')
      setBusy(true)
      try {
        await post('confirm-unknown', { client_id: clientId, plan_id: planId, date, outcome })
        setConfirmingUnknown(null)
        await loadStatus()
        await onChanged?.()
      } catch (err) {
        setError((err as Error).message)
      } finally {
        setBusy(false)
      }
    },
    [clientId, loadStatus, onChanged, planId, post]
  )

  if (!planId) return null
  if (loading && !status) {
    return <p className="text-[11px] text-me-charcoal/45">自动发布：读取中…</p>
  }
  if (readError) {
    return <p className="text-[11px] text-[#C2453A]">读不到自动发布的状态：{readError}</p>
  }
  if (!status || !status.can_manage) return null

  const authorization = status.authorization ?? null
  const attempts = status.attempts ?? []
  const isActive = authorization?.state === 'active'
  const missingPage = !facebookPageId
  const missingQueue = !queueReceiptReady
  const missingDates = reviewedDates.length === 0
  const missingIdentity = !identityReady
  const blocked = missingPage || missingQueue || missingDates || missingIdentity

  return (
    <div className="border-t border-black/[.06] pt-3" data-testid="auto-publish-panel">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-me-charcoal/55">自动发布</p>
      </div>

      {status.mode === 'practice' ? (
        <p className="mb-2 rounded-lg bg-me-ochre/[.10] px-3 py-2 text-[11px] leading-relaxed text-me-charcoal/70">
          现在是演练模式：就算授权了，系统也只会每小时检查一遍，不会真的发到 Facebook。
        </p>
      ) : (
        <p className="mb-2 rounded-lg bg-[#5C8A4A]/[.08] px-3 py-2 text-[11px] leading-relaxed text-[#5C8A4A]">
          已开启真发：授权后，系统会每天早上 8 点（新西兰时间）让 Facebook 发出对应的帖子。
        </p>
      )}

      {blocked && (
        <p className="mb-2 text-[11px] leading-relaxed text-me-charcoal/45">
          {missingPage
            ? '这个客户还没登记 Facebook 主页。'
            : '要先让全部 Post 通过审核并生成发布准备回执，才能授权自动发布。'}
        </p>
      )}

      {!blocked && !isActive && (
        <div className="space-y-2">
          {authorization && authorization.state !== 'active' && (
            <p className="rounded-lg bg-me-ochre/[.10] px-3 py-2 text-[11px] leading-relaxed text-me-charcoal/70">
              上一次的授权已失效：
              {authorization.state === 'expired'
                ? '已过期'
                : authorization.state === 'plan_changed'
                  ? '计划改过了，需要重新授权'
                  : '没有生效'}
            </p>
          )}

          {!preview && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void runAuthorize(false, [])}
              className="rounded-md bg-me-charcoal/[.08] px-3 py-1.5 text-xs font-medium text-me-charcoal/70 transition-colors hover:bg-me-charcoal/[.12] disabled:opacity-50"
            >
              预览自动发布（先看，不授权）
            </button>
          )}

          {preview && (
            <div className="rounded-lg bg-me-ivory/70 px-3 py-2">
              <p className="mb-1.5 text-[11px] font-semibold text-me-charcoal/60">
                授权后会自动发这 {preview.would_publish.length} 条
              </p>
              <div className="space-y-1">
                {preview.would_publish.map(item => (
                  <div key={item.date} className="rounded border border-black/[.06] bg-white px-2 py-1.5">
                    <p className="text-[11px] font-medium text-me-charcoal/70">{shortDate(item.date)}</p>
                    <p className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-me-charcoal/50">
                      {item.message_preview}
                    </p>
                  </div>
                ))}
              </div>
              <p className="mt-1.5 text-[10px] text-me-charcoal/40">
                系统每小时检查一次，只处理今天和明天的帖子；授权 14 天有效，你随时可以点「停止自动发布」。
              </p>
              {preview.would_lift_recalled.length > 0 && (
                <p className="mt-1 text-[10px] text-[#C2453A]">
                  其中 {preview.would_lift_recalled.length} 之前撤回过，授权后会重新发出
                </p>
              )}
            </div>
          )}

          {recalledDates.length > 0 && (
            <div className="rounded-lg bg-[#C2453A]/[.06] px-3 py-2">
              <p className="text-[11px] leading-relaxed text-[#C2453A]">
                这些日期之前撤回过：{recalledDates.map(shortDate).join('、')}。确定要重新发它们吗？
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void runAuthorize(false, recalledDates)}
                className="mt-1.5 rounded bg-[#C2453A] px-2.5 py-1 text-[11px] font-medium text-white hover:bg-[#A63A30] disabled:opacity-50"
              >
                是，这些日期也要发
              </button>
            </div>
          )}

          {preview && preview.would_publish.length > 0 && !confirmingAuthorize && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setConfirmingAuthorize(true)}
              className="rounded-md bg-me-ochre px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-me-gold disabled:opacity-50"
            >
              确认授权自动发布
            </button>
          )}

          {confirmingAuthorize && (
            <div className="flex flex-wrap items-center gap-2 rounded-md bg-[#C2453A]/[.06] px-2.5 py-1.5">
              <span className="text-[11px] font-medium text-[#C2453A]">授权后，系统会按计划自动发帖，确定？</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => void runAuthorize(true, liftDates)}
                className="rounded bg-[#C2453A] px-2.5 py-1 text-[11px] font-medium text-white hover:bg-[#A63A30] disabled:opacity-50"
              >
                确定，授权
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmingAuthorize(false)}
                className="rounded px-2 py-1 text-[11px] font-medium text-me-charcoal/50 hover:text-me-charcoal/70"
              >
                取消
              </button>
            </div>
          )}
        </div>
      )}

      {isActive && authorization && (
        <div className="space-y-2">
          <div className="rounded-lg border border-[#5C8A4A]/25 bg-[#5C8A4A]/[.05] px-2.5 py-2 text-xs">
            <p className="font-medium text-[#5C8A4A]">已授权自动发布</p>
            <p className="mt-0.5 text-[10px] text-me-charcoal/55">授权人 {authorization.authorized_by_email}</p>
            <p className="text-[10px] text-me-charcoal/55">授权时间 {formatWhen(authorization.authorized_at)}</p>
            <p className="text-[10px] text-me-charcoal/55">到期 {formatWhen(authorization.expires_at)}</p>
            <p className="text-[10px] text-me-charcoal/55">
              覆盖日期：{authorization.dates.map(shortDate).join('、')}
            </p>
          </div>

        </div>
      )}

      {/* Stopping must stay reachable whatever else is missing: a grant that cannot be stopped is the worst case. */}
      {(authorization || inFlight) && (
        <div className="mt-2 space-y-2">
          {authorization && (
            <>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              aria-label="停止原因"
              placeholder="为什么要停？（必填）"
              value={stopReason}
              onChange={e => setStopReason(e.target.value)}
              className="rounded-md border border-black/[.10] px-2 py-1 text-[11px] text-me-charcoal/70"
            />
            <button
              type="button"
              disabled={busy || stopReason.trim() === ''}
              onClick={() => setConfirmingRevoke(true)}
              className="rounded-md bg-me-charcoal/[.08] px-3 py-1.5 text-xs font-medium text-me-charcoal/70 transition-colors hover:bg-me-charcoal/[.12] disabled:opacity-50"
            >
              停止自动发布
            </button>
          </div>

          {confirmingRevoke && (
            <div className="flex flex-wrap items-center gap-2 rounded-md bg-[#C2453A]/[.06] px-2.5 py-1.5">
              <span className="text-[11px] font-medium text-[#C2453A]">
                停止后系统不再自动发帖。已经交给 Facebook、还没公开的帖子不会被撤下，确定？
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => void runRevoke()}
                className="rounded bg-[#C2453A] px-2.5 py-1 text-[11px] font-medium text-white hover:bg-[#A63A30] disabled:opacity-50"
              >
                确定，停止
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setConfirmingRevoke(false)}
                className="rounded px-2 py-1 text-[11px] font-medium text-me-charcoal/50 hover:text-me-charcoal/70"
              >
                取消
              </button>
            </div>
          )}

            </>
          )}
          {inFlight && (
            <div className="text-[11px] leading-relaxed">
              {inFlight.in_flight_status === 'UNKNOWN' ? (
                <p className="text-[#C2453A]">
                  没能确认有没有已经交给 Facebook、还没公开的帖子，请到 Facebook 主页的「已定时」里看一眼
                </p>
              ) : inFlight.in_flight && inFlight.in_flight.length > 0 ? (
                <p className="text-me-charcoal/70">
                  这些帖子已经交给 Facebook、还没公开，停止不会撤下它们（要撤回请用手动发布区的撤回功能）：
                  {inFlight.in_flight.map(item => shortDate(item.date)).join('、')}
                </p>
              ) : (
                <p className="text-me-charcoal/45">没有已经交给 Facebook、还没公开的帖子。</p>
              )}
            </div>
          )}
        </div>
      )}

      {attempts.length > 0 && (
        <div className="mt-3 space-y-1">
          {attempts.map(attempt => (
            <div
              key={`${attempt.date}-${attempt.attempt_no}`}
              className="rounded border border-black/[.06] bg-white px-2 py-1.5 text-[11px]"
            >
              <p className="text-me-charcoal/70">
                {shortDate(attempt.date)} · {attemptLabel(attempt)}
              </p>
              {attempt.status === 'unknown_outcome' && (
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  {confirmingUnknown === attempt.date ? (
                    <>
                      <span className="text-[10px] text-[#C2453A]">
                        请先打开客户的 Facebook 主页，同时看「已定时」和「已发布」两处，确认了再点。确定？
                      </span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void runConfirmUnknown(attempt.date, 'published')}
                        className="rounded bg-[#C2453A] px-2 py-0.5 text-[10px] font-medium text-white hover:bg-[#A63A30] disabled:opacity-50"
                      >
                        主页上有这条（已发出）
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void runConfirmUnknown(attempt.date, 'not_published')}
                        className="rounded bg-[#C2453A] px-2 py-0.5 text-[10px] font-medium text-white hover:bg-[#A63A30] disabled:opacity-50"
                      >
                        主页上没有（没发出）
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setConfirmingUnknown(null)}
                        className="rounded px-2 py-0.5 text-[10px] font-medium text-me-charcoal/50 hover:text-me-charcoal/70"
                      >
                        取消
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setConfirmingUnknown(attempt.date)}
                        className="rounded bg-me-charcoal/[.08] px-2 py-0.5 text-[10px] font-medium text-me-charcoal/70 hover:bg-me-charcoal/[.12] disabled:opacity-50"
                      >
                        主页上有这条（已发出）
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setConfirmingUnknown(attempt.date)}
                        className="rounded bg-me-charcoal/[.08] px-2 py-0.5 text-[10px] font-medium text-me-charcoal/70 hover:bg-me-charcoal/[.12] disabled:opacity-50"
                      >
                        主页上没有（没发出）
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {error && <p className="mt-2 text-[11px] text-[#C2453A]">✗ {error}</p>}
    </div>
  )
}
