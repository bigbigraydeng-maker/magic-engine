'use client'

/**
 * PM-only controls for the unattended Daily Plan publisher.
 *
 * This panel never publishes anything itself — every check lives on the
 * server. Its whole job is to make the PM's decisions legible and reversible:
 * authorise the unattended publisher for ONE reviewed plan, stop it, and settle
 * any Post whose outcome the system could not determine. Everything the PM reads
 * is plain Chinese; internal words (idempotency, tombstone, claim, cron, token)
 * never appear here.
 *
 * Rules that shape the interface:
 *   - A failed status read is never dressed up as "not authorised". If we cannot
 *     see the state we say so in red — and the STOP control stays reachable,
 *     because "we don't know what is running" is exactly when you need it.
 *   - Practice mode and live mode look different and say so; anything that is not
 *     explicitly `live` is never shown as live.
 *   - Going live always costs a second, explicit click, and the confirmation says
 *     what will actually happen.
 *   - After any failed action the state is read again: a failure message must not
 *     leave the screen disagreeing with the server.
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
  /** The current moment; default the real clock. Injectable for tests. */
  now?: Date
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
  /** The server's clock (ISO) when it answered — the page trusts it over the PM's computer clock. */
  server_now?: string
}

interface PreviewPost {
  date: string
  message_preview: string
  first_comment_preview?: string
}

interface PreviewResult {
  would_publish: PreviewPost[]
  would_lift_recalled: string[]
}

interface RevokeResult {
  in_flight_status?: string
  in_flight?: Array<{ date: string }>
  in_flight_unconfirmed?: Array<{ date: string }>
}

/** Plain-Chinese translations (with a next step) for the error codes the routes can return. */
const ERROR_TEXT: Record<string, string> = {
  GLOBAL_ADMIN_REQUIRED: '只有管理员能操作自动发布，请找管理员操作。',
  DATE_IN_PAST: '有日期已经过去了，不能授权。请刷新页面，只授权今天及以后的日期。',
  PAGE_ID_MISMATCH: 'Facebook 主页号和客户登记的不一致。请到客户设置核对主页，改好后再授权。',
  CLIENT_HAS_NO_FACEBOOK_PAGE: '这个客户还没登记 Facebook 主页。请先到客户设置里登记。',
  ALREADY_AUTHORIZED: '这份计划已经授权了，先停止再重新授权。',
  PRICE_CLAIM_UNBACKED: '有帖子写了价格，但配图证明不了这个价格，整批被拦。请到社媒日常的图文帖子里找出写了价格的帖子，改掉价格或换成有价格的图。',
  PRICE_FACT_UNVERIFIED: '有帖子里的价格和客户资料对不上，整批被拦。请核对该帖子里的价格和客户资料，改对后重新审核。',
  FIRST_COMMENT_CHECK_FAILED: '有帖子正文里带了链接或行动号召，整批被拦。请把正文里的链接和「点击」「预订」这类话删掉，链接放在第一条评论里。',
  POSTS_NOT_READY_FOR_PUBLISH: '有帖子还没准备好（图片或文案不可用）。请到社媒日常的图文帖子里看哪条图片或文案缺了，补齐后再授权。',
  REVIEW_CHECKLIST_REQUIRED: '还有帖子没有审核通过。请先把图文帖子里所有帖子审核完，再来授权。',
  PUBLISH_QUEUE_RECEIPT_REQUIRED: '还没有「发布准备回执」。请回到社媒日常的图文帖子，先点「生成发布准备回执」。',
  PUBLISH_QUEUE_RECEIPT_STALE: '这份计划在生成回执之后被改动过，回执已经对不上，不能再授权。需要重新建一份图文帖子计划，审核后再授权。',
  REVIEW_REVISION_MISMATCH: '计划被改过了，请刷新页面，刷新后重新预览再授权。',
  PLAN_REVISION_MISMATCH: '计划被改过了，请刷新页面，刷新后重新预览再授权。',
  PLAN_SUPERSEDED: '计划被改过了，请刷新页面，刷新后重新预览再授权。',
  PLAN_NOT_FOUND: '找不到这份计划，请刷新页面。',
  PLAN_STATE_INVALID: '这份计划的数据状态不对，请截图给开发。',
  REVIEW_STATE_INVALID: '这份计划的审核记录状态不对，请截图给开发。',
  DATE_NOT_IN_REVIEWED_SET: '有日期不在已审核的帖子里，请刷新页面后重新预览。',
  NO_POSTS_TO_PUBLISH: '这份计划里没有可发的帖子。',
  INVALID_AUTHORIZE_COMMAND: '页面提交的内容不完整，请刷新页面再试。',
  INVALID_REVOKE_COMMAND: '停止原因没填，或页面提交的内容不完整，请刷新页面再试。',
  INVALID_CONFIRM_COMMAND: '页面提交的内容不完整，请刷新页面再试。',
  CLIENT_ID_MISMATCH: '页面和客户对不上，请刷新页面再试。',
  AUTHORIZATION_EVENT_NOT_SENT: '授权没成功（系统没能记录）。别重复点，先刷新页面看是否已授权，没有的话再试一次。',
  AUTHORIZATION_NOT_ACTIVATED: '授权没能生效。别重复点，先刷新页面看是否已授权，没有的话再试一次。',
  AUTHORIZATION_REVOKED_DURING_ARMING: '授权刚建好就被停止了，请刷新页面看当前状态。',
  RECALL_BLOCKS_NOT_LIFTED: '授权没成功（撤回过的日期没能解除）。请刷新页面看当前状态，没有授权的话再试一次。',
  NO_ACTIVE_AUTHORIZATION: '没有生效中的授权，可能已经过期或被停止，刷新页面看当前状态。',
  NO_UNKNOWN_OUTCOME: '这一条已经被处理过了，请刷新页面。',
  INTERNAL_ERROR: '系统出错了，请稍后再试。如果多次出现，请截图给开发。',
  Unauthorized: '登录已过期，请刷新页面重新登录。',
  Forbidden: '没有权限做这个操作。',
}

function translateError(code: unknown): string {
  if (typeof code === 'string' && ERROR_TEXT[code]) return ERROR_TEXT[code]
  return '操作没成功，请刷新页面再试，仍然不行请截图给开发。'
}

function formatWhen(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString('zh-CN', { timeZone: 'Pacific/Auckland', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function shortDate(date: string): string {
  return date.slice(5)
}

/** New Zealand calendar date and minutes since midnight for an instant. */
function nzClock(at: Date): { date: string; minutes: number } {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Auckland' }).format(at)
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Pacific/Auckland', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(at)
  const hour = Number(parts.find(part => part.type === 'hour')?.value ?? '0') % 24
  const minute = Number(parts.find(part => part.type === 'minute')?.value ?? '0')
  return { date, minutes: hour * 60 + minute }
}

/** Today's 08:00 slot counts as passed from 07:45 (the server will not schedule a post less than 15 minutes ahead). */
const TODAY_SLOT_CUTOFF_MINUTES = 7 * 60 + 45

/** A date that can no longer go out at its own slot: in the past, or today once the slot is (nearly) gone. */
function isGone(date: string, clock: { date: string; minutes: number }): boolean {
  return date < clock.date || (date === clock.date && clock.minutes >= TODAY_SLOT_CUTOFF_MINUTES)
}

function blockedReasonWords(code: string | null): string {
  if (code === 'ABORTED_BEFORE_SEND') return '发之前一刻检查没通过（授权被停止或这一天被改动），没有发出'
  if (code && code.startsWith('PRICE_')) return '价格检查没通过，这条不会发。请到社媒日常的图文帖子里看这条的价格'
  return '被发布前检查拦住了，这条不会发。请到社媒日常的图文帖子里看这条的检查结果'
}

/** Chinese status word for one attempt row. */
function attemptLabel(attempt: Attempt): string {
  switch (attempt.status) {
    case 'published':
      return '已提交 Facebook（到点自动公开）'
    case 'claimed':
      return '正在处理，一两分钟后刷新看结果'
    case 'blocked':
      return attempt.reason_code === 'RECALLED' ? '已撤回，不会再自动发' : blockedReasonWords(attempt.reason_code)
    case 'failed_retryable':
      return `出错了，下次检查时会自动再试（已试 ${attempt.attempt_no} 次）`
    case 'failed_final':
      return '多次出错，已放弃，这条不会再自动发。需要发就到手动发布区发。'
    case 'unknown_outcome':
      return '不确定有没有发出去，请核对后登记 ↓'
    case 'missed_window':
      return '发布时间已过，没有补发，需要发请用手动发布区'
    case 'dry_run':
      return '演练（没有真发）'
    default:
      return '状态未知，请联系开发'
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
  now,
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
  const [stopReason, setStopReason] = useState('')
  const [confirmingRevoke, setConfirmingRevoke] = useState(false)
  const [settlingDate, setSettlingDate] = useState<string | null>(null)
  const [inFlight, setInFlight] = useState<RevokeResult | null>(null)
  const [clockSkewMs, setClockSkewMs] = useState(0)

  const identityReady = Boolean(planId && planRevision && reviewRevision)
  const clock = nzClock(now ?? new Date(Date.now() + clockSkewMs))
  // A past date — or today once its 08:00 slot is (nearly) gone — can no longer go out at its slot. The server would
  // refuse the first and never publish the second late, so neither is offered.
  const datesToAuthorize = reviewedDates.filter(date => !isGone(date, clock))
  const skippedPastDates = reviewedDates.filter(date => isGone(date, clock))

  /**
   * One POST, parsed defensively.
   *
   * A proxy in front of the app answers timeouts with an HTML page; parsing that as JSON used to surface as
   * "Unexpected token '<'", which hides the one thing worth knowing — the status code and who sent it.
   */
  const post = useCallback(
    async (path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> => {
      let res: Response
      try {
        res = await fetch(`/api/clients/${clientId}/campaign-daily-plan/auto-publish/${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
      } catch {
        throw new Error('网络没连上')
      }
      const raw = await res.text()
      let json: Record<string, unknown> | null = null
      try {
        json = JSON.parse(raw) as Record<string, unknown>
      } catch {
        throw new Error('服务暂时没响应')
      }
      if (!res.ok || json.success === false) {
        const err = new Error(translateError(json.error)) as Error & { code?: unknown; dates?: string[]; rollback?: unknown }
        err.code = json.error
        err.rollback = json.rollback
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
    // readError is NOT cleared here: while a failed read is being retried the stop control must stay on screen.
    try {
      const res = await fetch(
        `/api/clients/${clientId}/campaign-daily-plan/auto-publish/status?plan_id=${encodeURIComponent(planId)}&plan_revision=${encodeURIComponent(planRevision ?? '')}&review_revision=${encodeURIComponent(reviewRevision ?? '')}`,
        { cache: 'no-store' }
      )
      // Not logged in / not allowed: this section is simply not for this visitor — say nothing, show nothing.
      // (Decided before parsing: a proxy may answer a 401/403 with a web page.)
      if (res.status === 401 || res.status === 403) {
        setReadError('')
        setStatus({ can_manage: false })
        return
      }
      const raw = await res.text()
      let json: Record<string, unknown> | null = null
      try {
        json = JSON.parse(raw) as Record<string, unknown>
      } catch {
        setReadError('服务暂时没响应')
        setStatus(null)
        return
      }
      if (!res.ok || json.success === false) {
        setReadError(translateError(json.error))
        setStatus(null)
        return
      }
      // A 200 that is not shaped like a status must not make the section silently vanish.
      if (typeof json.can_manage !== 'boolean') {
        setReadError('服务返回的内容异常，请刷新页面')
        setStatus(null)
        return
      }
      const parsed = json as unknown as StatusResult
      const serverMs = typeof parsed.server_now === 'string' ? Date.parse(parsed.server_now) : NaN
      setClockSkewMs(Number.isNaN(serverMs) ? 0 : serverMs - Date.now())
      setReadError('')
      setStatus(parsed)
    } catch (err) {
      setReadError(err instanceof TypeError ? '网络没连上' : (err as Error).message)
      setStatus(null)
    } finally {
      setLoading(false)
    }
  }, [clientId, planId, planRevision, reviewRevision])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  // A preview belongs to one version of the plan: when the plan changes, the old preview must not linger.
  useEffect(() => {
    setPreview(null)
    setConfirmingAuthorize(false)
    setLiftDates([])
    setRecalledDates([])
  }, [planId, planRevision, reviewRevision])

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
          dates: reviewedDates.filter(date => !isGone(date, nzClock(now ?? new Date(Date.now() + clockSkewMs)))),
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
          setInFlight(null)
          await loadStatus()
        }
      } catch (err) {
        const e = err as Error & { code?: unknown; dates?: string[]; rollback?: unknown }
        if (e.code === 'DATE_RECALLED' && Array.isArray(e.dates)) {
          setRecalledDates(e.dates)
          setError('')
        } else if (e.rollback === 'FAILED') {
          setError('授权没有成功，而且系统没能把它撤回：授权可能仍然有效。请马上检查，需要的话点「停止自动发布」。')
          void loadStatus()
        } else if (confirm) {
          setError(`没能确认授权是否生效。请先看下面的状态，不要重复点。（${e.message}）`)
          setConfirmingAuthorize(false)
          void loadStatus()
        } else {
          setError(e.message)
        }
      } finally {
        setBusy(false)
      }
    },
    [campaignId, clientId, clockSkewMs, facebookPageId, loadStatus, now, planId, planRevision, post, reviewRevision, reviewedDates]
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
        in_flight_unconfirmed: Array.isArray(json.in_flight_unconfirmed)
          ? (json.in_flight_unconfirmed as Array<{ date: string }>)
          : [],
      })
      setConfirmingRevoke(false)
      setStopReason('')
      await loadStatus()
    } catch (err) {
      const e = err as Error & { code?: unknown }
      setError(
        e.code === 'NO_ACTIVE_AUTHORIZATION'
          ? '当前已经没有生效中的授权，不用停止。'
          : `停止没有成功，自动发布可能仍然有效。请看下面的状态，没停下来就再点一次。（${e.message}）`
      )
      setConfirmingRevoke(false)
      void loadStatus()
    } finally {
      setBusy(false)
    }
  }, [campaignId, clientId, loadStatus, planId, post, stopReason])

  const runConfirmUnknown = useCallback(
    async (date: string, outcome: 'published' | 'not_published') => {
      setError('')
      setBusy(true)
      try {
        await post('confirm-unknown', { client_id: clientId, plan_id: planId, date, outcome })
        setSettlingDate(null)
        await loadStatus()
      } catch (err) {
        setError(`登记没有成功。请看下面的状态，别重复点。（${(err as Error).message}）`)
        setSettlingDate(null)
        void loadStatus()
      } finally {
        setBusy(false)
      }
    },
    [clientId, loadStatus, planId, post]
  )

  /** Stop reason + stop button + confirmation. Used wherever a grant may exist, including when the status cannot be read. */
  const stopControls = (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          aria-label="停止原因"
          placeholder="为什么要停？（必填，写明原因才能点停止）"
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
          <span className="text-xs font-medium leading-relaxed text-[#C2453A]">
            停止后系统不再自动发帖。已在 Facebook 排好时间、还没公开的帖子不会被撤下（要撤请到手动发布区）。确定停止？
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
  )

  /** What stopping did and did not take down. Shown whether or not the status could be read. */
  const inFlightNotice = inFlight ? (
    <div className="text-[11px] leading-relaxed">
      <p className="mb-1 text-xs font-medium text-me-charcoal/70">已停止自动发布，之后不会再自动发帖。</p>
      {inFlight.in_flight_status === 'OK' && inFlight.in_flight && inFlight.in_flight.length > 0 ? (
        <p className="text-me-charcoal/70">
          这些帖子已在 Facebook 排好时间、还没公开，停止不会撤下它们（要撤回请用手动发布区的撤回功能）：
          {inFlight.in_flight.map(item => shortDate(item.date)).join('、')}
        </p>
      ) : inFlight.in_flight_status === 'OK' ? (
        <p className="text-me-charcoal/55">
          按系统记录，没有已在 Facebook 排好时间、还没公开的帖子。保险起见，也请到客户主页的「已定时」里看一眼。
        </p>
      ) : (
        <p className="text-[#C2453A]">
          没能确认 Facebook 上有没有已排好时间、还没公开的帖子，请到该客户 Facebook 主页的「已定时」里看一眼。
        </p>
      )}
      {inFlight.in_flight_unconfirmed && inFlight.in_flight_unconfirmed.length > 0 ? (
        <p className="mt-1 text-[#C2453A]">
          这些日期系统不确定有没有发出去：{inFlight.in_flight_unconfirmed.map(item => shortDate(item.date)).join('、')}。
          请到客户 Facebook 主页看一眼，再回这里登记结果。
        </p>
      ) : null}
    </div>
  ) : null

  if (!planId) return null
  if (loading && !status && !readError) {
    return <p className="text-[11px] text-me-charcoal/45">自动发布：读取中…</p>
  }
  if (readError) {
    return (
      <div className="border-t border-black/[.06] pt-3" data-testid="auto-publish-panel-unreadable">
        <p className="text-xs text-[#C2453A]">
          读不到自动发布的状态：{readError}。在恢复之前请当作可能还在自动发帖，到 Facebook 主页确认，或找开发处理。
        </p>
        <div className="mt-2 space-y-2">
          <p className="text-[11px] text-me-charcoal/55">需要先停下来的话，可以在这里直接停止：</p>
          {stopControls}
          {inFlightNotice}
        </div>
        {error && <p className="mt-2 text-xs text-[#C2453A]">✗ {error}</p>}
      </div>
    )
  }
  if (!status || !status.can_manage) return null

  const authorization = status.authorization ?? null
  const attempts = status.attempts ?? []
  const isActive = authorization?.state === 'active'
  const live = status.mode === 'live'
  const missingPage = !facebookPageId
  const missingQueue = !queueReceiptReady
  const missingDates = datesToAuthorize.length === 0
  const missingIdentity = !identityReady
  const modeKnown = status.mode === 'practice' || status.mode === 'live'
  const blocked = missingPage || missingQueue || missingDates || missingIdentity

  return (
    <div className="border-t border-black/[.06] pt-3" data-testid="auto-publish-panel">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-me-charcoal/55">自动发布</p>
      </div>

      {status.mode === 'practice' ? (
        <p className="mb-2 rounded-lg border border-me-ochre/40 bg-me-ochre/[.12] px-3 py-2 text-[13px] font-medium leading-relaxed text-me-charcoal/80">
          演练模式｜授权了也不会真发：系统只会每小时检查一遍并记录，不会往 Facebook 发任何东西。
        </p>
      ) : live ? (
        <p className="mb-2 rounded-lg border border-[#C2453A]/40 bg-[#C2453A]/[.08] px-3 py-2 text-[13px] font-medium leading-relaxed text-[#C2453A]">
          真发模式：授权后，每天最多发 1 条。系统每小时检查一次，当天的帖子会在新西兰时间每天早上 8 点公开到客户的 Facebook 主页。发出后系统不会替你撤回，只能手动撤回。
        </p>
      ) : (
        <p className="mb-2 rounded-lg border border-[#C2453A]/40 bg-[#C2453A]/[.08] px-3 py-2 text-[13px] font-medium leading-relaxed text-[#C2453A]">
          读不到当前是演练还是真发，请先别授权。
        </p>
      )}

      {!authorization && (
        <p className="mb-2 text-xs text-me-charcoal/60">当前：未授权{blocked || !modeKnown ? '。' : '，系统不会自动发帖。'}</p>
      )}

      {blocked && (
        <p className="mb-2 text-[11px] leading-relaxed text-me-charcoal/55">
          {missingPage
            ? '这个客户还没登记 Facebook 主页。请先到客户设置里填上。'
            : missingIdentity
              ? '计划信息不完整，请刷新页面。'
              : missingQueue
                ? '现在还不能授权：有帖子还没审核通过，或还没生成「发布准备回执」。请先把图文帖子里所有帖子审核完。'
                : '今天没有可发的已审核帖子。'}
        </p>
      )}

      {skippedPastDates.length > 0 && !missingQueue && (
        <p className="mb-2 text-[11px] leading-relaxed text-me-charcoal/55">
          已经过去的日期、以及今天已过早上 8 点的那一条，不会自动发：{skippedPastDates.map(shortDate).join('、')}。
        </p>
      )}

      {!blocked && modeKnown && !isActive && (
        <div className="space-y-2">
          {authorization && authorization.state !== 'active' && (
            <p className="rounded-lg bg-me-ochre/[.10] px-3 py-2 text-xs leading-relaxed text-me-charcoal/70">
              {authorization.state === 'expired'
                ? '上一次授权已过期，要继续自动发需重新授权。'
                : authorization.state === 'plan_changed'
                  ? '计划在授权后被改过，旧授权已作废，需重新授权。'
                  : authorization.state === 'revoked'
                    ? '你已停止了上一次授权。'
                    : '上一次授权没有生效（系统没记录成功），请重新授权。'}
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
              <p className="mb-1.5 text-xs font-semibold text-me-charcoal/70">
                {live
                  ? `授权后会自动发这 ${preview.would_publish.length} 条`
                  : `演练：授权后只会模拟，不会真发这 ${preview.would_publish.length} 条`}
              </p>
              <div className="space-y-1">
                {preview.would_publish.map(item => (
                  <div key={item.date} className="rounded border border-black/[.06] bg-white px-2 py-1.5">
                    <p className="text-[11px] font-medium text-me-charcoal/70">
                      {live ? `${shortDate(item.date)} 早上 8:00（新西兰时间）公开` : `${shortDate(item.date)}（演练：不会真发）`}
                    </p>
                    <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-me-charcoal/60">
                      {item.message_preview}
                    </p>
                    {item.first_comment_preview && (
                      <p className="mt-0.5 line-clamp-2 text-[10px] leading-relaxed text-me-charcoal/45">
                        第一条评论：{item.first_comment_preview}
                      </p>
                    )}
                  </div>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-me-charcoal/55">
                {live
                  ? `授权 ${preview.would_publish.length} 条，14 天内有效，每天最多发 1 条，你随时可以点「停止自动发布」。时间都是新西兰时间。`
                  : '演练授权 14 天内有效，不会往 Facebook 发任何东西。'}
              </p>
              {preview.would_lift_recalled.length > 0 && (
                <p className="mt-1 text-[11px] text-[#C2453A]">
                  其中 {preview.would_lift_recalled.length} 条（{preview.would_lift_recalled.map(shortDate).join('、')}）之前撤回过，授权后会重新发出，请确认。
                </p>
              )}
            </div>
          )}

          {recalledDates.length > 0 && (
            <div className="rounded-lg bg-[#C2453A]/[.06] px-3 py-2">
              <p className="text-xs leading-relaxed text-[#C2453A]">
                这些日期之前撤回过：{recalledDates.map(shortDate).join('、')}。确定要重新发它们吗？
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void runAuthorize(false, recalledDates)}
                className="mt-1.5 rounded bg-[#C2453A] px-2.5 py-1 text-[11px] font-medium text-white hover:bg-[#A63A30] disabled:opacity-50"
              >
                把这些日期加入预览
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
              {live ? `授权真发 ${preview.would_publish.length} 条` : '演练授权（不会真发）'}
            </button>
          )}

          {confirmingAuthorize && preview && (
            <div className="flex flex-wrap items-center gap-2 rounded-md bg-[#C2453A]/[.06] px-2.5 py-1.5">
              <span className="text-xs font-medium leading-relaxed text-[#C2453A]">
                {live
                  ? `确认后，下面这些日期的帖子会在各自当天早上 8 点（新西兰时间）公开发到客户的 Facebook 主页：${preview.would_publish.map(item => shortDate(item.date)).join('、')}，共 ${preview.would_publish.length} 条。公开后系统不会替你撤回，只能手动撤回。授权 14 天内有效，你随时可以停止。确定授权？`
                  : '现在是演练模式：授权只是试跑，不会真的发到 Facebook。确定试跑？'}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => void runAuthorize(true, liftDates)}
                className="rounded bg-[#C2453A] px-2.5 py-1 text-[11px] font-medium text-white hover:bg-[#A63A30] disabled:opacity-50"
              >
                {live ? '确定，真发' : '确定，演练授权'}
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
        <div className={`rounded-lg border px-2.5 py-2 text-xs ${status.mode === 'practice' ? 'border-me-ochre/30 bg-me-ochre/[.06]' : 'border-[#C2453A]/40 bg-[#C2453A]/[.05]'}`}>
          <p className={`text-[13px] font-medium ${status.mode === 'practice' ? 'text-me-charcoal/70' : 'text-[#C2453A]'}`}>
            {live ? '真发授权中' : status.mode === 'practice' ? '已授权（演练中，不会真发）' : '已授权，但读不到当前是演练还是真发'}
          </p>
          <p className="mt-0.5 text-[11px] text-me-charcoal/60">
            覆盖日期：{authorization.dates.map(shortDate).join('、')}（共 {authorization.dates.length} 条），每天最多 1 条
          </p>
          <p className="text-[10px] text-me-charcoal/50">
            授权人 {authorization.authorized_by_email} · 授权时间 {formatWhen(authorization.authorized_at)} · 到期{' '}
            {formatWhen(authorization.expires_at)}（新西兰时间）
          </p>
        </div>
      )}

      {/* Stopping must stay reachable whatever else is missing: a grant that cannot be stopped is the worst case. */}
      {(authorization || inFlight) && (
        <div className="mt-2 space-y-2">
          {authorization && stopControls}

          {inFlightNotice}
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
                <div className="mt-1 space-y-1.5">
                  {settlingDate === attempt.date ? (
                    <>
                      <p className="text-xs font-medium text-[#C2453A]">
                        {shortDate(attempt.date)} 这一条：先打开客户的 Facebook 主页，把「已定时」和「已发布」两处都看一遍，再选：
                      </p>
                      <div>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void runConfirmUnknown(attempt.date, 'published')}
                          className="rounded bg-me-charcoal/[.10] px-2 py-1 text-[11px] font-medium text-me-charcoal/75 hover:bg-me-charcoal/[.16] disabled:opacity-50"
                        >
                          主页上有这条，记为已发出
                        </button>
                        <p className="mt-0.5 text-[10px] text-me-charcoal/50">系统记为已发出，不会再发这一天。</p>
                      </div>
                      <div>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void runConfirmUnknown(attempt.date, 'not_published')}
                          className="rounded bg-[#C2453A] px-2 py-1 text-[11px] font-medium text-white hover:bg-[#A63A30] disabled:opacity-50"
                        >
                          主页上确实没有，允许重发
                        </button>
                        <p className="mt-0.5 text-[10px] text-[#C2453A]">
                          系统会认为没发出去，下一个小时内会重新发这一条。如果其实已经在主页上，会重复发两次。
                        </p>
                      </div>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setSettlingDate(null)}
                        className="rounded px-2 py-0.5 text-[10px] font-medium text-me-charcoal/50 hover:text-me-charcoal/70"
                      >
                        取消
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => setSettlingDate(attempt.date)}
                      className="rounded bg-me-charcoal/[.08] px-2 py-0.5 text-[11px] font-medium text-me-charcoal/70 hover:bg-me-charcoal/[.12] disabled:opacity-50"
                    >
                      核对并登记这一条
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {error && <p className="mt-2 text-xs text-[#C2453A]">✗ {error}</p>}
    </div>
  )
}
