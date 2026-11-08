'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

const SUGGESTED = [
  '现在这个客户最该先推进什么？',
  '这一轮卡在哪一步？',
  '下一步最值得做的 3 件事是什么？',
]

/**
 * The existing 诸葛 thread, laid out for this page: a large box on top, the reply underneath.
 * Spend, publish and Meta writes still go through the cards, the same as the drawer.
 */
export function ZhugePageChat({
  clientId,
  contextLine,
  prescribeHref,
}: {
  clientId: string
  contextLine: string
  prescribeHref: string
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/luban`, { cache: 'no-store' })
        if (!res.ok || !alive) return
        const data = await res.json() as { messages?: ChatMessage[] }
        if (alive) setMessages(data.messages ?? [])
      } catch {
        if (alive) setMessages([])
      }
    })()
    return () => { alive = false }
  }, [clientId])

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || sending) return
    setMessages((prev) => [...prev, { role: 'user', content: trimmed }])
    setInput('')
    setSending(true)
    setError(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/luban`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: trimmed }),
      })
      const data = await res.json() as { success?: boolean; reply?: string; error?: string }
      if (!res.ok || !data.success) throw new Error(data.error ?? '诸葛这次没答上')
      setMessages((prev) => [...prev, { role: 'assistant', content: data.reply ?? '' }])
    } catch (err) {
      setError(err instanceof Error ? err.message : '诸葛这次没答上')
      setMessages((prev) => prev.slice(0, -1))
      setInput(trimmed)
    } finally {
      setSending(false)
    }
  }, [clientId, sending])

  return (
    <PageBody
      contextLine={contextLine}
      prescribeHref={prescribeHref}
      input={input}
      sending={sending}
      messages={messages}
      error={error}
      onChange={setInput}
      onSend={(text) => void send(text)}
    />
  )
}

function PageBody({
  contextLine,
  prescribeHref,
  input,
  sending,
  messages,
  error,
  onChange,
  onSend,
}: {
  contextLine: string
  prescribeHref: string
  input: string
  sending: boolean
  messages: ChatMessage[]
  error: string | null
  onChange: (value: string) => void
  onSend: (text: string) => void
}) {
  return (
    <section aria-label="诸葛" className="rounded-3xl border border-me-charcoal/12 bg-white p-5 shadow-card">
      <h2 className="font-display text-xl font-black text-me-charcoal">跟诸葛说</h2>
      <p className="mt-1 max-w-[65ch] text-sm leading-6 text-me-charcoal/70">
        只帮你看和起草。花钱、发布、改广告，还是要点下面的确认卡。在这里说确认不算。
      </p>
      <p className="mt-2 text-sm font-semibold text-me-charcoal">{contextLine}</p>
      <Composer input={input} sending={sending} onChange={onChange} onSend={() => onSend(input)} />
      <div className="mt-3 flex flex-wrap gap-2">
        {SUGGESTED.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => onSend(prompt)}
            disabled={sending}
            className="rounded-full border border-me-charcoal/15 px-3 py-1 text-left text-xs font-semibold text-me-charcoal/70 hover:border-me-ochre hover:text-me-charcoal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-me-ochre disabled:opacity-50"
          >
            {prompt}
          </button>
        ))}
      </div>
      <Thread messages={messages} sending={sending} error={error} />
      <p className="mt-4 text-sm text-me-charcoal/70">
        开方去找华佗。
        <Link href={prescribeHref} className="ml-2 font-bold text-me-ochre hover:underline">打开华佗</Link>
      </p>
    </section>
  )
}

function Composer({
  input,
  sending,
  onChange,
  onSend,
}: {
  input: string
  sending: boolean
  onChange: (value: string) => void
  onSend: () => void
}) {
  return (
    <div className="mt-4">
      <label htmlFor="zhuge-page-input" className="text-sm font-bold text-me-charcoal">跟诸葛说</label>
      <textarea
        id="zhuge-page-input"
        value={input}
        rows={6}
        disabled={sending}
        placeholder="直接问这一轮卡在哪、下一步做什么。（Enter 发送，Shift+Enter 换行）"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            onSend()
          }
        }}
        className="mt-2 min-h-40 w-full resize-y rounded-3xl border border-me-charcoal/15 bg-white px-4 py-3 text-base leading-7 text-me-charcoal outline-none focus:border-me-ochre focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-me-ochre disabled:bg-me-ivory"
      />
      <button
        type="button"
        onClick={onSend}
        disabled={sending || !input.trim()}
        className="mt-3 min-h-11 rounded-lg bg-me-charcoal px-5 text-sm font-semibold text-white hover:bg-me-black focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-me-ochre disabled:cursor-not-allowed disabled:opacity-50"
      >
        {sending ? '在问…' : '发送'}
      </button>
    </div>
  )
}

function Thread({ messages, sending, error }: { messages: ChatMessage[]; sending: boolean; error: string | null }) {
  if (messages.length === 0 && !sending && !error) return null
  return (
    <div className="mt-4 space-y-2">
      {messages.map((message, index) => (
        <p
          key={`${message.role}-${index}`}
          className={`max-w-[65ch] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-6 ${
            message.role === 'user' ? 'ml-auto bg-me-charcoal text-white' : 'bg-me-ivory text-me-charcoal'
          }`}
        >
          {message.content}
        </p>
      ))}
      {sending ? <p className="text-sm text-me-charcoal/60">诸葛在看…</p> : null}
      {error ? <p className="text-sm font-semibold text-[#C2453A]">{error}</p> : null}
    </div>
  )
}
