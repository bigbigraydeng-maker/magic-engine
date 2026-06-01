'use client'

import { useState, useRef, useEffect } from 'react'
import type { MasterBrief, BriefChatMessage } from '@/types/magic-engine'

interface Props {
  briefId: string
  clientId: string
  disabled?: boolean
  onBriefUpdated: (b: MasterBrief) => void
}

export function BriefChat({ briefId, clientId, disabled = false, onBriefUpdated }: Props) {
  const [messages, setMessages] = useState<BriefChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = async () => {
    const text = input.trim()
    if (!text || sending || disabled) return

    const userMsg: BriefChatMessage = { role: 'user', content: text, timestamp: new Date().toISOString() }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setSending(true)
    setError('')

    try {
      const res = await fetch(`/api/clients/${clientId}/brief/${briefId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history: messages }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Request failed')

      const assistantMsg: BriefChatMessage = {
        role: 'assistant',
        content: json.reasoning ?? 'Brief updated.',
        timestamp: new Date().toISOString(),
      }
      setMessages(prev => [...prev, assistantMsg])
      if (json.brief) onBriefUpdated(json.brief)
    } catch (err) {
      setError((err as Error).message)
      setMessages(prev => prev.slice(0, -1))
      setInput(text)
    } finally {
      setSending(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-black/[.06] px-5 py-5">
        <p className="text-[11px] font-black uppercase tracking-[0.14em] text-me-ochre">Strategy Engine</p>
        <h3 className="mt-1 font-display text-lg font-semibold tracking-tight text-me-charcoal">Brief Refinement</h3>
        <p className="mt-1 text-sm font-semibold text-me-charcoal/55">
          {disabled
            ? 'Generate a brief first to enable chat.'
            : 'Describe changes. Strategy Engine updates only the relevant fields.'}
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {messages.length === 0 && !disabled && (
          <div className="space-y-2">
            <p className="pt-4 text-center text-xs font-black uppercase tracking-[0.12em] text-me-charcoal/45">Try asking</p>
            {[
              '语气改得更年轻、更活泼',
              'Add "sustainability" to the content pillars',
              'Update target audience to 25-35 female professionals',
              'Make the brand story more emotional',
            ].map((ex, i) => (
              <button
                key={i}
                onClick={() => setInput(ex)}
                className="block w-full rounded-lg border border-me-ochre/20 bg-me-ochre/10 px-3 py-3 text-left text-sm font-semibold text-me-charcoal/90 transition-colors hover:border-me-ochre/30 hover:bg-me-ochre/15"
              >
                {ex}
              </button>
            ))}
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm font-semibold ${
                msg.role === 'user'
                  ? 'rounded-br-md bg-me-charcoal text-white'
                  : 'rounded-bl-md bg-me-ivory text-me-charcoal/75'
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}

        {sending && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-md bg-me-ivory px-3 py-2">
              <div className="flex h-4 items-center gap-1">
                {[0, 1, 2].map(i => (
                  <span
                    key={i}
                    className="h-1.5 w-1.5 animate-bounce rounded-full bg-me-charcoal/45"
                    style={{ animationDelay: `${i * 0.15}s` }}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {error && (
          <p className="rounded-lg bg-[#C2453A]/10 px-3 py-2 text-xs font-semibold text-[#C2453A]">{error}</p>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="border-t border-black/[.06] p-4">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={disabled ? 'Generate a brief first...' : 'Ask Strategy Engine to refine the brief...'}
            disabled={disabled || sending}
            rows={2}
            className="flex-1 resize-none rounded-xl border border-black/10 bg-me-ivory px-3 py-3 text-sm font-semibold text-me-charcoal/90 placeholder-me-charcoal/45 transition-colors focus:bg-white focus:outline-none focus:ring-2 focus:ring-me-ochre disabled:text-me-charcoal/45 disabled:opacity-60"
          />
          <button
            onClick={() => void handleSend()}
            disabled={!input.trim() || disabled || sending}
            className="rounded-xl bg-me-charcoal px-4 py-3 text-white transition-colors hover:bg-me-charcoal/85 disabled:opacity-40"
            title="Send (Enter)"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" />
            </svg>
          </button>
        </div>
        <p className="mt-2 text-xs font-semibold text-me-charcoal/45">Enter to send · Shift+Enter for newline</p>
      </div>
    </div>
  )
}
