'use client'

/**
 * One customer, one card.
 *
 * Reading order is the salesperson's own order of questions: who is this and
 * are they hot → what did we promise them → what do they want → what do I do
 * next → how do I reach them → reply. Everything below the fold (transcript)
 * loads only when asked for.
 */

import React, { useCallback, useState } from 'react'
import type { Conversation, ContactDetails, ThreadResponse, TripDetails } from '../types'
import { BulletBlock, FollowUpChip, IntentBadge, WindowNotice, formatMoment } from './bits'
import { ReplyBox } from './ReplyBox'
import { Transcript } from './Transcript'

// ─── Facts the customer volunteered ───────────────────────────────────────────

/** Only what the customer actually said — the brief prompt leaves the rest null,
 *  and a blank field is more honest than a guessed one. */
function TripFacts({ trip }: { trip: TripDetails }) {
  const facts: Array<[string, string]> = []
  if (trip.tour_interest) facts.push(['想去的团', trip.tour_interest])
  if (trip.travel_window) facts.push(['打算什么时候走', trip.travel_window])
  if (trip.party_size) facts.push(['几个人', `${trip.party_size} 人`])
  if (trip.departure_city) facts.push(['从哪出发', trip.departure_city])
  if (trip.first_time_to_china !== null) {
    facts.push(['第一次去中国', trip.first_time_to_china ? '是' : '不是'])
  }
  if (trip.budget_signal) facts.push(['预算口风', trip.budget_signal])

  if (!facts.length) return null

  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5">
      {facts.map(([label, value]) => (
        <span key={label} className="text-xs text-me-charcoal/45">
          {label} <span className="font-semibold text-me-charcoal/80">{value}</span>
        </span>
      ))}
    </div>
  )
}

/** Big tap targets: on a phone this is the fastest path from card to call. */
function ContactRow({ contact }: { contact: ContactDetails }) {
  if (!contact.phone && !contact.email) return null
  const style =
    'rounded-lg border border-me-stone px-3 py-2 text-sm font-semibold text-me-charcoal'
  return (
    <div className="flex flex-wrap gap-2">
      {contact.phone && (
        <a href={`tel:${contact.phone}`} className={style}>
          📞 {contact.phone}
        </a>
      )}
      {contact.email && (
        <a href={`mailto:${contact.email}`} className={`${style} break-all`}>
          ✉️ {contact.email}
        </a>
      )}
    </div>
  )
}

// ─── Card ─────────────────────────────────────────────────────────────────────

export function ConversationCard({
  clientId,
  conversation,
  viewerEmail,
}: {
  clientId: string
  conversation: Conversation
  viewerEmail: string | null
}) {
  const [replyOpen, setReplyOpen] = useState(false)
  const [transcriptOpen, setTranscriptOpen] = useState(false)
  const [thread, setThread] = useState<ThreadResponse | null>(null)
  const [threadError, setThreadError] = useState<string | null>(null)
  const [replied, setReplied] = useState(false)

  const brief = conversation.brief
  const name = conversation.participantName ?? '未留姓名的客户'

  // Fetched once per card, and only when a human opens the reply box or the
  // transcript — 200 threads must not each pull their messages on page load.
  const loadThread = useCallback(async () => {
    if (thread) return
    try {
      const res = await fetch(
        `/api/clients/${clientId}/messenger/conversations/${conversation.id}/messages`,
      )
      const json = (await res.json()) as ThreadResponse
      if (!res.ok) {
        setThreadError(json.error ?? '对话记录读不出来')
        return
      }
      setThread(json)
    } catch {
      setThreadError('对话记录读不出来，检查网络后再试。')
    }
  }, [clientId, conversation.id, thread])

  const open = (which: 'reply' | 'transcript') => {
    if (which === 'reply') setReplyOpen((v) => !v)
    else setTranscriptOpen((v) => !v)
    void loadThread()
  }

  const awaiting = conversation.awaitingReply && !replied

  return (
    <article className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate font-black text-me-charcoal">{name}</h2>
          <p className="mt-0.5 text-[11px] text-me-charcoal/45">
            {conversation.messageCount} 条消息 · 最后一条 {formatMoment(conversation.lastMessageAt)}
          </p>
        </div>
        <IntentBadge level={brief?.intent_level ?? 'unknown'} />
      </div>

      <div className="mt-2.5 flex flex-wrap gap-2 empty:mt-0">
        {awaiting && (
          <p className="inline-block rounded-full bg-[#C2453A]/10 px-2.5 py-1 text-xs font-black text-[#C2453A]">
            等我们回{conversation.hoursWaiting !== null && ` · 已经 ${conversation.hoursWaiting} 小时`}
          </p>
        )}
        {!replied && (
          <FollowUpChip
            dueAt={conversation.followUpDueAt}
            overdue={conversation.followUpOverdue}
          />
        )}
      </div>

      {!brief && (
        <p className="mt-3 rounded-lg bg-me-ivory px-3 py-2.5 text-sm text-me-charcoal/60">
          AI 还没读这段对话（每小时整理一次）。可以先看完整对话。
        </p>
      )}

      {brief && (
        <div className="mt-3 space-y-3">
          <p className="text-sm leading-relaxed text-me-charcoal">{brief.summary}</p>

          {/* Promises first: staff cannot honour what they never saw. */}
          <BulletBlock title="我们答应过客户" items={brief.promises_made} tone="warn" />
          <BulletBlock title="要注意" items={brief.risk_flags} tone="alert" />
          <BulletBlock title="客户想要" items={brief.customer_needs} />
          <BulletBlock title="客户的顾虑" items={brief.objections} />

          <TripFacts trip={brief.trip} />

          {brief.next_action && (
            <div className="rounded-lg border border-me-stone bg-me-ivory px-3 py-2.5">
              <p className="text-[11px] font-black uppercase tracking-[0.1em] text-me-ochre">
                下一步
              </p>
              <p className="mt-1 text-sm font-semibold leading-relaxed text-me-charcoal">
                {brief.next_action}
              </p>
            </div>
          )}

          <ContactRow contact={brief.contact} />
        </div>
      )}

      {/* The list view can only work the countdown out for threads where the
          customer spoke last; once the thread is loaded we show the real one. */}
      {!thread && conversation.replyWindow && !replied && (
        <div className="mt-3">
          <WindowNotice window={conversation.replyWindow} />
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2 border-t border-me-stone pt-3">
        <button
          type="button"
          onClick={() => open('reply')}
          className="rounded-lg bg-me-charcoal px-4 py-2 text-sm font-black text-white"
        >
          {replyOpen ? '收起' : '写回复'}
        </button>
        <button
          type="button"
          onClick={() => open('transcript')}
          className="rounded-lg border border-me-stone px-4 py-2 text-sm font-semibold text-me-charcoal/70"
        >
          {transcriptOpen ? '收起对话' : '看完整对话'}
        </button>
      </div>

      {threadError && <p className="mt-2 text-sm text-[#C2453A]">{threadError}</p>}

      {replyOpen && (
        <div className="mt-3">
          <ReplyBox
            clientId={clientId}
            conversationId={conversation.id}
            customerName={name}
            draft={brief?.draft_reply ?? null}
            window={thread?.replyWindow ?? conversation.replyWindow}
            viewerEmail={viewerEmail}
            onSent={() => setReplied(true)}
          />
        </div>
      )}

      {transcriptOpen && (
        <div className="mt-3">
          {thread ? (
            <Transcript messages={thread.messages} />
          ) : (
            !threadError && <p className="text-sm text-me-charcoal/45">读取中…</p>
          )}
        </div>
      )}

      {brief && (
        <p className="mt-3 text-[11px] text-me-charcoal/30">
          需求卡由 AI 生成于 {formatMoment(brief.generated_at)} · 发送前请自己过一眼
        </p>
      )}
    </article>
  )
}
