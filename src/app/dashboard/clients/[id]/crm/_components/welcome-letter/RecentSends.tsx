'use client'

/**
 * 「最近发送」：真发这边处理过的客人（含暂缓和不发的，彩排不算）。结果不明、等人标的信全部排在最前面（不受 20 封的限制，
 * 封数是服务端数的），其余按最新有动静排。每封写清楚：现在什么状态、为什么、什么时候、发信服务接没接。
 * 不显示客人邮箱：点「看客人」去客户档案看是谁。「结果不明」的信，PM 本人核对后可以标「已发出 / 没发出」（`ResolveBox`）。
 */
import { MePill } from '@/components/ui/me-primitives'
import { ResolveBox } from './ResolveBox'
import {
  nzTime,
  providerImpactText,
  RECEIPT_OVERRODE_NOT_SENT,
  sendReasonText,
  sendStatusText,
  sendStatusTone,
  STUCK_PENDING_TEXT,
  type Notice,
  type RecentSendView,
} from './welcome-letter-text'

interface Props {
  clientId: string
  /** null = 读不到。 */
  rows: RecentSendView[] | null
  limit: number
  /** 等人标的结果不明的信（服务端数的）；null = 读不到。 */
  unknown: { count: number; more: boolean } | null
  /** 服务器现在的时间（判断「停在半路超过 20 小时」用）。 */
  serverNow: string | null
  canResolve: boolean
  onDone: (notice: Notice) => void
}

/** 这些状态 = 信已经离开发信服务（和回执那边「离开发信服务」的口径一致）。 */
const LEFT_PROVIDER = new Set(['sent', 'delivery_delayed', 'delivered', 'bounced', 'complained'])
/** 发信方 20 小时后不再重试同一封信。 */
const REPLAY_HOURS_MS = 20 * 3_600_000

function stuck(send: RecentSendView, serverNow: string | null): boolean {
  if (send.status !== 'pending' || send.first_attempt_at === null || serverNow === null) return false
  const first = Date.parse(send.first_attempt_at)
  const now = Date.parse(serverNow)
  return !Number.isNaN(first) && !Number.isNaN(now) && now - first > REPLAY_HOURS_MS
}

function contactHref(clientId: string, contactId: string): string {
  return `/dashboard/clients/${encodeURIComponent(clientId)}/crm/all?contact=${encodeURIComponent(contactId)}`
}

function bounceText(kind: string | null): string {
  if (kind === 'permanent') return '（永久退信：这个邮箱以后不会再自动发）'
  if (kind === 'transient') return '（临时退信）'
  return ''
}

function Resolution({ send }: { send: RecentSendView }): JSX.Element | null {
  const r = send.resolution
  if (r === null) return null
  return <p className="mt-1 text-xs text-me-charcoal/60">{r.by} 在 {nzTime(r.at)} 核对后标了「{r.outcome === 'sent' ? '已发出' : '没发出'}」。</p>
}

type RowProps = Pick<Props, 'clientId' | 'serverNow' | 'canResolve' | 'onDone'> & { send: RecentSendView }

function SendRow({ clientId, send, serverNow, canResolve, onDone }: RowProps): JSX.Element {
  const reason = send.reason_code ?? send.last_block_reason
  const needsPerson = send.status === 'unknown_outcome' && send.resolution === null
  const overridden = send.reason_code === 'not_sent_confirmed' && LEFT_PROVIDER.has(send.status)
  return (
    <li className="border-b border-me-charcoal/10 py-2 last:border-b-0" data-testid="recent-send">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <MePill tone={sendStatusTone(send.status)}>{sendStatusText(send.status)}{send.status === 'bounced' ? bounceText(send.bounce_kind) : ''}</MePill>
        <span className="text-xs text-me-charcoal/60">{nzTime(send.sent_at ?? send.first_attempt_at ?? send.updated_at)}</span>
        <a className="text-xs text-me-charcoal/80 underline" href={contactHref(clientId, send.contact_id)}>看客人</a>
      </div>
      {reason !== null && <p className="mt-1 text-sm text-me-charcoal/80">{sendReasonText(reason)}</p>}
      <p className="mt-1 text-xs text-me-charcoal/60">
        {providerImpactText(send.provider_impact)}
        {send.attempts > 1 ? `；试过 ${send.attempts} 次` : ''}
      </p>
      <Resolution send={send} />
      {overridden && <p className="mt-1 text-sm font-semibold text-[#C2453A]" data-testid="receipt-overrode">{RECEIPT_OVERRODE_NOT_SENT}</p>}
      {stuck(send, serverNow) && <p className="mt-1 text-sm text-[#9A6B12]" data-testid="stuck-pending">{STUCK_PENDING_TEXT}</p>}
      {needsPerson && (canResolve
        ? <ResolveBox clientId={clientId} send={send} onDone={onDone} />
        : <p className="mt-2 text-xs text-me-charcoal/70" data-testid="resolve-not-approver">只有 PM 本人能标「已发出 / 没发出」。</p>)}
    </li>
  )
}

function UnknownCount({ unknown }: { unknown: Props['unknown'] }): JSX.Element | null {
  if (unknown === null || unknown.count === 0) return null
  const more = unknown.more ? '（太多了，下面只列出最早的一部分，其余请让发信窗口查）' : ''
  return <p className="mb-2 text-sm font-semibold text-[#9A6B12]" data-testid="unknown-count">有 {unknown.count} 封信结果不明，要核对后标一下（都排在最上面）{more}。</p>
}

export function RecentSends({ clientId, rows, limit, unknown, serverNow, canResolve, onDone }: Props): JSX.Element {
  return (
    <section className="mb-4 rounded-xl border border-me-charcoal/10 bg-me-ivory/40 p-3" data-testid="recent-sends">
      <h2 className="mb-2 text-[13px] font-black text-me-charcoal/70">② 最近发送（真发这边处理过的客人，含暂缓和不发的；彩排不算）</h2>
      {rows === null && <p className="text-sm font-semibold text-[#C2453A]">暂时读不到最近发送，稍后点「刷新」再看。</p>}
      {rows !== null && rows.length === 0 && <p className="text-sm text-me-charcoal/70">还没有真发过信。</p>}
      <UnknownCount unknown={unknown} />
      {rows !== null && rows.length > 0 && (
        <ul>
          {rows.map((send) => <SendRow key={send.id} clientId={clientId} send={send} serverNow={serverNow} canResolve={canResolve} onDone={onDone} />)}
        </ul>
      )}
      <p className="mt-2 text-xs text-me-charcoal/60">结果不明的全部列出，其余只显示最近 {limit} 封。这里不显示客人邮箱：点「看客人」去客户档案看是谁。</p>
    </section>
  )
}
