'use client'

/**
 * 在 CRM 抽屉里给一个**还没有邮件往来**的客人写第一封邮件。
 * 设计稿：docs/specs/2026-10-21-crm-send-first-email-design-v0.md
 *
 * 和 `EmailReply` 互斥：它只在「这个人没有可回复的邮件线」时出现（同一个读接口
 * `/crm/contacts/[cid]/email` 一次返回线程状态 + compose 预览，判断全在服务端）。
 *
 * - 功能没开通 / 读失败 / 预览说不能写的「静默」原因 → 什么都不渲染（不给一个点了没用的框）。
 * - 「他没咨询过我们」「别再联系」→ 渲染一行原因，让销售知道为什么这个人不能在这里发。
 * - requestId 每个「写邮件」框生成一次：双击、重试用同一个，服务端据此不重复发；发成功后换新的。
 */

import { useCallback, useEffect, useRef, useState } from 'react'

type Preview =
  | { canCompose: true; recipient: string; mailbox: string; sentToContactLast7Days: number }
  | { canCompose: false; reason: string; message: string }

interface Payload {
  conversationId: string | null
  compose?: Preview
}

/** 这些原因值得告诉销售（其余的，比如功能没开通，静默不渲染）。 */
const VISIBLE_REASONS = new Set(['not_enquirer', 'do_not_contact', 'no_recipient', 'no_mailbox'])

function newRequestId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : '00000000-0000-4000-8000-' + Math.random().toString(16).slice(2, 14).padEnd(12, '0')
}

export function ComposeEmail({
  clientId,
  contactId,
  onSent,
}: {
  clientId: string
  contactId: string
  onSent: () => void
}) {
  const [data, setData] = useState<Payload | null>(null)
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const requestId = useRef(newRequestId())

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/clients/${clientId}/crm/contacts/${contactId}/email`)
      if (!res.ok) throw new Error('load failed')
      setData((await res.json()) as Payload)
    } catch {
      setData(null)
    }
  }, [clientId, contactId])

  useEffect(() => {
    void load()
  }, [load])

  if (!data || data.conversationId || !data.compose) return null
  const compose = data.compose

  if (!compose.canCompose) {
    if (!VISIBLE_REASONS.has(compose.reason)) return null
    return (
      <p className="mt-4 text-xs text-me-charcoal/55" data-testid="compose-blocked">
        ✉️ 不能在这里给他发邮件：{compose.message}
      </p>
    )
  }

  const send = async (): Promise<void> => {
    if (sending) return
    setSending(true)
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/crm/contacts/${contactId}/email/compose`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, body, requestId: requestId.current, expectedRecipient: compose.recipient }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setError(json.error ?? '发送失败，请稍后再试')
        return
      }
      requestId.current = newRequestId()
      setSubject('')
      setBody('')
      setDone(true)
      onSent()
      void load()
    } catch {
      setError('网络出错，发送状态不明。请先看时间线确认，别重复发送。')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="mt-4 rounded-xl border border-me-charcoal/10 bg-me-ivory/40 p-3" data-testid="compose-email">
      <p className="mb-1 text-[13px] font-black text-me-charcoal/70">✉️ 给他写第一封邮件</p>
      <p className="mb-2 text-xs text-me-charcoal/60">
        将用 {compose.mailbox} 发给 {compose.recipient}
        {compose.sentToContactLast7Days > 0 ? `（最近 7 天已发给他 ${compose.sentToContactLast7Days} 封）` : ''}
      </p>
      <input
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        placeholder="主题"
        maxLength={200}
        className="mb-2 w-full rounded-lg border border-me-stone bg-white px-3 py-2 text-sm"
        aria-label="邮件主题"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="正文（纯文本）"
        rows={6}
        maxLength={10000}
        className="w-full rounded-lg border border-me-stone bg-white px-3 py-2 text-sm"
        aria-label="邮件正文"
      />
      {error && (
        <p className="mt-2 text-xs font-semibold text-red-700" role="alert">
          {error}
        </p>
      )}
      {done && !error && <p className="mt-2 text-xs font-semibold text-green-700">✓ 邮件已发出</p>}
      <button
        type="button"
        onClick={() => void send()}
        disabled={sending || subject.trim() === '' || body.trim() === ''}
        className="mt-2 rounded-lg bg-me-charcoal px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
      >
        {sending ? '发送中…' : '发送'}
      </button>
    </div>
  )
}
