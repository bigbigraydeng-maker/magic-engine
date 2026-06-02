'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface Props {
  clientId: string
  isOpen: boolean
  onClose: () => void
}

const SUGGESTED = [
  '现在这个客户最该先推进什么？',
  '帮我总结当前 campaign 的进度和卡点。',
  '社媒和 SEO 现在分别走到哪一步了？',
  '告诉我下一步最值得做的 3 件事。',
]

export function ZhugeWorkbenchDrawer({ clientId, isOpen, onClose }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    setLoadingHistory(true)
    setError(null)
    void (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/luban`, { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json() as { messages?: ChatMessage[] }
        setMessages(data.messages ?? [])
      } catch {
        setMessages([])
      } finally {
        setLoadingHistory(false)
      }
    })()
  }, [isOpen, clientId])

  useEffect(() => {
    if (!isOpen) return
    const original = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = original
    }
  }, [isOpen])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  const send = useCallback(async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || sending) return

    setMessages(prev => [...prev, { role: 'user', content: trimmed }])
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
      if (!res.ok || !data.success) {
        throw new Error(data.error ?? `HTTP ${res.status}`)
      }
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply ?? '' }])
    } catch (err) {
      setError(err instanceof Error ? err.message : '诸葛亮暂时无法回复')
      setMessages(prev => prev.slice(0, -1))
      setInput(trimmed)
    } finally {
      setSending(false)
    }
  }, [clientId, sending])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send(input)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[110] flex justify-end">
      <button
        onClick={onClose}
        aria-label="关闭诸葛亮工作台"
        className="absolute inset-0 bg-slate-950/45 backdrop-blur-sm"
      />

      <div className="relative flex h-dvh w-full flex-col overflow-hidden border-l border-slate-200 bg-[#fbfcf7] shadow-2xl sm:w-[min(680px,100vw)] xl:w-[720px]">
        <div className="flex shrink-0 items-start gap-3 border-b border-slate-200 bg-white px-5 py-4">
          <span className="text-xl">诸</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-gray-900">诸葛亮工作台</p>
            <p className="truncate text-xs text-gray-400">统一 AI 助手 · 当前线程 · 下一步建议</p>
          </div>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-xl font-black text-slate-400 transition-colors hover:border-slate-300 hover:text-slate-700"
          >
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-5 py-5">
          {loadingHistory && (
            <p className="py-4 text-center text-xs text-gray-400">加载诸葛亮历史对话…</p>
          )}

          {!loadingHistory && messages.length === 0 && (
            <div className="px-1 py-6">
              <div className="mb-4 text-center">
                <p className="mb-2 text-3xl">诸</p>
                <p className="mb-1 text-sm font-medium text-gray-700">诸葛亮在这里陪你推进工作</p>
                <p className="text-xs leading-relaxed text-gray-400">
                  你可以直接问当前客户、当前 campaign、社媒、SEO 或执行卡点。
                  <br />
                  它的目标不是聊天，而是帮 FDE 少走弯路。
                </p>
              </div>
              <div className="space-y-1.5">
                {SUGGESTED.map(prompt => (
                  <button
                    key={prompt}
                    onClick={() => void send(prompt)}
                    className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-xs font-semibold text-slate-600 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-800"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message, index) => (
            <div key={`${message.role}-${index}`} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-sm ${
                  message.role === 'user'
                    ? 'rounded-br-sm bg-indigo-600 text-white'
                    : 'rounded-bl-sm bg-white text-slate-800 ring-1 ring-slate-200'
                }`}
              >
                {message.content}
              </div>
            </div>
          ))}

          {sending && (
            <div className="flex justify-start">
              <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-sm bg-white px-3.5 py-2.5 ring-1 ring-slate-200">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: '0ms' }} />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: '150ms' }} />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
              {error}
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        <div className="shrink-0 border-t border-slate-200 bg-white p-4">
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={2}
              placeholder="直接问诸葛亮当前客户、campaign 或下一步…（Enter 发送，Shift+Enter 换行）"
              disabled={sending}
              className="flex-1 resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-900 outline-none transition focus:border-indigo-300 focus:ring-4 focus:ring-indigo-100 disabled:bg-slate-50"
            />
            <button
              onClick={() => void send(input)}
              disabled={sending || !input.trim()}
              className="shrink-0 rounded-lg bg-slate-950 px-4 py-2 text-sm font-black text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              发送
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
