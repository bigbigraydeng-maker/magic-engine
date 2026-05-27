'use client'

/**
 * 项目级鲁班对话抽屉（P8.10.S5.3）
 *
 * FDE 在执行看板顶部点「🔨 项目级鲁班」打开。鲁班看到的是整个项目——
 * 所有处方、所有执行项、全部进度——能回答「哪个 Phase 卡住了」「整体进度对不对」。
 * 桌面右侧滑出，移动全屏。无「存为工作记录」（项目级对话是分析建议，不绑定单个执行项）。
 */

import { useState, useRef, useEffect, useCallback } from 'react'

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
  '整体进度怎么样？对得上时间线吗？',
  '哪个 Phase 卡住了？',
  '哪些维度还没开始动？',
  '现在最该集中精力做什么？',
]

export function ProjectLubanDrawer({ clientId, isOpen, onClose }: Props) {
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
        const res = await fetch(`/api/clients/${clientId}/luban`, {
          cache: 'no-store',
        })
        if (res.ok) {
          const data = await res.json() as { messages: ChatMessage[] }
          setMessages(data.messages ?? [])
        }
      } catch {/* 加载失败就空对话 */}
      finally { setLoadingHistory(false) }
    })()
  }, [isOpen, clientId])

  useEffect(() => {
    if (!isOpen) return
    const orig = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = orig }
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
      const data = await res.json() as { success: boolean; reply?: string; error?: string }
      if (!res.ok || !data.success) {
        throw new Error(data.error ?? `HTTP ${res.status}`)
      }
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply ?? '' }])
    } catch (e) {
      setError(e instanceof Error ? e.message : '鲁班暂时无法回复')
      setMessages(prev => prev.slice(0, -1))
      setInput(trimmed)
    } finally {
      setSending(false)
    }
  }, [sending, clientId])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send(input)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button onClick={onClose} aria-label="关闭" className="absolute inset-0 bg-black/40" />

      <div className="relative bg-white w-full sm:w-[480px] h-full flex flex-col shadow-2xl">
        {/* Header */}
        <div className="shrink-0 border-b border-gray-200 px-4 py-3 flex items-center gap-3">
          <span className="text-xl">🔨</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900">项目级鲁班</p>
            <p className="text-xs text-gray-400 truncate">俯瞰全项目 · 处方 / 执行项 / 进度</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-lg px-2" aria-label="关闭">
            ✕
          </button>
        </div>

        {/* 消息区 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loadingHistory && (
            <p className="text-xs text-gray-400 text-center py-4">加载对话历史…</p>
          )}

          {!loadingHistory && messages.length === 0 && (
            <div className="py-6 px-1">
              <div className="text-center mb-4">
                <p className="text-3xl mb-2">🔨</p>
                <p className="text-sm text-gray-600 font-medium mb-1">项目级鲁班在这里</p>
                <p className="text-xs text-gray-400 leading-relaxed">
                  我能看到这个项目的全部处方、执行项和进度。<br />
                  问我整体进度、卡点、还没动的维度都行。
                </p>
              </div>
              <div className="space-y-1.5">
                {SUGGESTED.map(q => (
                  <button
                    key={q}
                    onClick={() => void send(q)}
                    className="block w-full text-left rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-600 hover:border-indigo-300 hover:text-indigo-700 transition-colors"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap break-words ${
                m.role === 'user'
                  ? 'bg-indigo-600 text-white rounded-br-sm'
                  : 'bg-gray-100 text-gray-800 rounded-bl-sm'
              }`}>
                {m.content}
              </div>
            </div>
          ))}

          {sending && (
            <div className="flex justify-start">
              <div className="bg-gray-100 rounded-2xl rounded-bl-sm px-3.5 py-2.5 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
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

        {/* 输入区 */}
        <div className="shrink-0 border-t border-gray-200 p-3">
          <div className="flex items-end gap-2">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={2}
              placeholder="问鲁班项目整体情况…（Enter 发送，Shift+Enter 换行）"
              disabled={sending}
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm resize-none focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:bg-gray-50"
            />
            <button
              onClick={() => void send(input)}
              disabled={sending || !input.trim()}
              className="shrink-0 rounded-lg bg-indigo-600 text-white px-4 py-2 text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              发送
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
