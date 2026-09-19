'use client'

/**
 * The send box.
 *
 * PM decision (2026-07-26): the AI never sends. It writes a draft, a person
 * reads it, edits it if they want, and presses send. Everything here exists to
 * keep that true and obvious:
 *   - the draft is labelled as a draft that has NOT gone out
 *   - send is one deliberate press behind a confirm naming the customer
 *   - whether the text was still the AI's own words is reported to the audit
 *     log as usedAiDraft, so "how much did the AI actually write" stays answerable
 */

import React, { useState } from 'react'
import type { ReplyWindow } from '../types'
import { WindowNotice } from './bits'

/**
 * 渠道差异全收在这两张表里——上面的组件逻辑（草稿/确认/审计）两条渠道
 * 完全一样，唯一不同的是「发去哪」和「失败了怎么翻译成人话」。
 * 2026-09-15 加邮件时改的：新渠道照这两张表添一行就行，不用碰组件本体。
 */
const REPLY_ENDPOINT: Record<'messenger' | 'email', (clientId: string, conversationId: string) => string> = {
  messenger: (c, id) => `/api/clients/${c}/messenger/conversations/${id}/reply`,
  email: (c, id) => `/api/clients/${c}/email/conversations/${id}/reply`,
}

const CONFIRM_TEXT: Record<'messenger' | 'email', (customerName: string) => string> = {
  messenger: (name) => `确定发给 ${name}？\n这条会以 CTS 的 Facebook 主页发出去，客户马上就能看到。`,
  email: (name) => `确定发给 ${name}？\n这条会通过邮件发出去，客户很快就会收到。`,
}

interface Props {
  clientId: string
  conversationId: string
  customerName: string
  /** English draft from the brief. Null when no brief exists yet. */
  draft: string | null
  /**
   * Authoritative window from the thread endpoint; null while still loading
   * (messenger), or always null for email — email has no Meta-style 24h/7d
   * expiry, so there is nothing to show here and `closed` below never fires.
   */
  window: ReplyWindow | null
  viewerEmail: string | null
  onSent: () => void
  /** Which line this goes out on. Defaults to messenger — the only channel this box originally spoke. */
  channel?: 'messenger' | 'email'
}

/** Server failures, said the way a salesperson can act on. Same reasons, one wording per channel. */
function humanError(channel: 'messenger' | 'email', status: number, reason?: string): string {
  if (channel === 'email') {
    if (reason === 'no_thread' || status === 409) {
      return '这个人还没跟你们邮件往来过，发不了。'
    }
    if (reason === 'no_token' || status === 424) {
      return '邮箱授权掉线了，发不出去。请找 Magic Engine 团队重新连一次。'
    }
    if (reason === 'audit_failed' || reason === 'graph_failed' || status === 502) {
      return '邮件没有发出去。稍等一分钟再试一次；连着失败请找团队。'
    }
    if (status === 403) return '你的账号没有权限从这里发消息。'
    return '没发出去，系统已记录。可以再试一次。'
  }
  if (reason === 'window_closed' || status === 409) {
    return 'Facebook 已经不让回这条了 —— 请改用电话或邮件联系客户。'
  }
  if (reason === 'no_token' || status === 424) {
    return 'Facebook 授权掉线了，发不出去。请找 Magic Engine 团队重新连一次。'
  }
  if (reason === 'graph_failed' || status === 502) {
    return 'Facebook 没有收下这条消息。稍等一分钟再试一次；连着失败请找团队。'
  }
  if (status === 403) return '你的账号没有权限从这里发消息。'
  return '没发出去，系统已记录。可以再试一次。'
}

export function ReplyBox({
  clientId,
  conversationId,
  customerName,
  draft,
  window: replyWindow,
  viewerEmail,
  onSent,
  channel = 'messenger',
}: Props) {
  const original = (draft ?? '').trim()
  const [text, setText] = useState(draft ?? '')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const body = text.trim()
  const usedAiDraft = original.length > 0 && body === original
  const closed = replyWindow?.kind === 'closed'

  const send = async () => {
    if (!globalThis.confirm(CONFIRM_TEXT[channel](customerName))) {
      return
    }
    setSending(true)
    setError(null)
    try {
      const res = await fetch(REPLY_ENDPOINT[channel](clientId, conversationId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, usedAiDraft }),
      })
      const json = (await res.json()) as { error?: string; reason?: string }
      if (!res.ok) {
        setError(humanError(channel, res.status, json.reason))
        return
      }
      setSent(true)
      onSent()
    } catch {
      setError('网络没连上，消息没发出去。检查网络后再试一次。')
    } finally {
      setSending(false)
    }
  }

  if (sent) {
    return (
      <p className="rounded-lg bg-[#5C8A4A]/10 px-3 py-2.5 text-sm font-semibold text-[#5C8A4A]">
        已发出 ✓ 客户已经收到了。
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {replyWindow && <WindowNotice window={replyWindow} />}

      <div>
        <label
          htmlFor={`reply-${conversationId}`}
          className="text-[11px] font-black uppercase tracking-[0.1em] text-me-charcoal/45"
        >
          {original ? 'AI 起草的英文回复 · 还没发出去' : '写一条英文回复'}
        </label>
        <textarea
          id={`reply-${conversationId}`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          placeholder="客户在新西兰，用英文写。"
          className="mt-1.5 w-full rounded-lg border border-me-stone bg-white px-3 py-2.5 text-base leading-relaxed text-me-charcoal outline-none focus:border-me-ochre"
        />
      </div>

      <p className="text-[11px] leading-relaxed text-me-charcoal/45">
        {original
          ? usedAiDraft
            ? '这是 AI 原话。你可以直接改，改完再发。'
            : '你已经改过 AI 的稿子。'
          : '还没有 AI 草稿 —— 手写一条。'}
        {viewerEmail && <> 发出去会记在 {viewerEmail} 名下。</>}
      </p>

      <button
        type="button"
        onClick={send}
        disabled={sending || !body || closed}
        className="w-full rounded-lg bg-me-charcoal px-4 py-3 text-sm font-black text-white disabled:opacity-40 sm:w-auto sm:px-6"
      >
        {sending ? '发送中…' : '发送给客户'}
      </button>

      {error && <p className="text-sm font-semibold text-[#C2453A]">{error}</p>}
    </div>
  )
}
