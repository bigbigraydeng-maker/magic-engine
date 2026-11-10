'use client'

/**
 * 「最近发送」：真发的信（彩排不算），最新有动静的在上面。每封写清楚：现在什么状态、为什么、什么时候、发信服务接没接。
 * 不显示邮箱：点「看客人」去客户档案看是谁。「结果不明」的信，PM 本人核对后可以标「已发出 / 没发出」（`ResolveBox`）。
 */
import { MePill } from '@/components/ui/me-primitives'
import { ResolveBox } from './ResolveBox'
import {
  nzTime,
  providerImpactText,
  sendReasonText,
  sendStatusText,
  sendStatusTone,
  type Notice,
  type RecentSendView,
} from './welcome-letter-text'

interface Props {
  clientId: string
  /** null = 读不到。 */
  rows: RecentSendView[] | null
  limit: number
  canResolve: boolean
  onDone: (notice: Notice) => void
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

function SendRow({ clientId, send, canResolve, onDone }: Omit<Props, 'rows' | 'limit'> & { send: RecentSendView }): JSX.Element {
  const reason = send.reason_code ?? send.last_block_reason
  const needsPerson = send.status === 'unknown_outcome' && send.resolution === null
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
      {needsPerson && (canResolve
        ? <ResolveBox clientId={clientId} send={send} onDone={onDone} />
        : <p className="mt-2 text-xs text-me-charcoal/70" data-testid="resolve-not-approver">只有 PM 本人能标「已发出 / 没发出」。</p>)}
    </li>
  )
}

export function RecentSends({ clientId, rows, limit, canResolve, onDone }: Props): JSX.Element {
  const unknown = rows === null ? 0 : rows.filter((r) => r.status === 'unknown_outcome' && r.resolution === null).length
  return (
    <section className="mb-4 rounded-xl border border-me-charcoal/10 bg-me-ivory/40 p-3" data-testid="recent-sends">
      <h2 className="mb-2 text-[13px] font-black text-me-charcoal/70">② 最近发送（真发的信，彩排不算）</h2>
      {rows === null && <p className="text-sm font-semibold text-[#C2453A]">暂时读不到最近发送，稍后点「刷新」再看。</p>}
      {rows !== null && rows.length === 0 && <p className="text-sm text-me-charcoal/70">还没有真发过信。</p>}
      {unknown > 0 && <p className="mb-2 text-sm font-semibold text-[#9A6B12]" data-testid="unknown-count">有 {unknown} 封信结果不明，要核对后标一下（见下面）。</p>}
      {rows !== null && rows.length > 0 && (
        <ul>
          {rows.map((send) => <SendRow key={send.id} clientId={clientId} send={send} canResolve={canResolve} onDone={onDone} />)}
        </ul>
      )}
      <p className="mt-2 text-xs text-me-charcoal/60">只显示最近 {limit} 封。这里不显示邮箱：点「看客人」去客户档案看是谁。</p>
    </section>
  )
}
