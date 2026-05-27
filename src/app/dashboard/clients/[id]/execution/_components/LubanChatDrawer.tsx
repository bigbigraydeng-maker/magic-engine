'use client'

/**
 * 鲁班对话抽屉（P8.10.S4.2）
 *
 * FDE 用自然语言跟鲁班对话，鲁班懂这个执行项的全部上下文。
 * 桌面：右侧滑出抽屉；移动：全屏。
 * 鲁班每条回复下方有「💾 存为工作记录」→ 落进 execution_logs。
 */

import { useState, useRef, useEffect, useCallback } from 'react'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  /** 本地标记：assistant 消息是否已存为工作记录 */
  saved?: boolean
}

interface Props {
  clientId: string
  itemId: string
  itemTitle: string
  isOpen: boolean
  onClose: () => void
  /** 鲁班回复被「存为工作记录」后，通知父组件刷新该项的 logs */
  onLogSaved: () => void
  /** 打开时预填充到输入框的第一句话（来自 FlywheelDrawer 的快捷行动） */
  initialMessage?: string
}

export function LubanChatDrawer({
  clientId, itemId, itemTitle, isOpen, onClose, onLogSaved, initialMessage,
}: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  // 打开时加载历史；若无历史且有预填充消息，填入输入框
  useEffect(() => {
    if (!isOpen) return
    setLoadingHistory(true)
    setError(null)
    void (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/execution/${itemId}/luban`, {
          cache: 'no-store',
        })
        if (res.ok) {
          const data = await res.json() as { messages: ChatMessage[] }
          const history = data.messages ?? []
          setMessages(history)
          // 只在没有历史对话时才预填充（避免覆盖已有上下文）
          if (history.length === 0 && initialMessage) {
            setInput(initialMessage)
          }
        }
      } catch {/* 加载失败就空对话 */}
      finally { setLoadingHistory(false) }
    })()
  }, [isOpen, clientId, itemId, initialMessage])

  // 锁定 body 滚动
  useEffect(() => {
    if (!isOpen) return
    const orig = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = orig }
  }, [isOpen])

  // 滚到底
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || sending) return

    setMessages(prev => [...prev, { role: 'user', content: text }])
    setInput('')
    setSending(true)
    setError(null)

    try {
      const res = await fetch(`/api/clients/${clientId}/execution/${itemId}/luban`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      })
      const data = await res.json() as { success: boolean; reply?: string; error?: string }
      if (!res.ok || !data.success) {
        throw new Error(data.error ?? `HTTP ${res.status}`)
      }
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply ?? '' }])
    } catch (e) {
      setError(e instanceof Error ? e.message : '鲁班暂时无法回复')
      // 回滚乐观添加的用户消息
      setMessages(prev => prev.slice(0, -1))
      setInput(text)
    } finally {
      setSending(false)
    }
  }, [input, sending, clientId, itemId])

  // 把鲁班的某条回复存为工作记录
  const handleSaveAsLog = useCallback(async (idx: number, content: string) => {
    try {
      const res = await fetch(`/api/clients/${clientId}/execution/${itemId}/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'ai_assist', author: 'luban', content }),
      })
      if (!res.ok) return
      setMessages(prev => prev.map((m, i) => i === idx ? { ...m, saved: true } : m))
      onLogSaved()
    } catch {/* non-fatal */}
  }, [clientId, itemId, onLogSaved])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  if (!isOpen) return null

  return (
    <>
      {/* 遮罩 */}
      <button
        onClick={onClose}
        aria-label="关闭"
        className="fixed inset-0 z-[60] bg-black/40"
      />

      {/* 抽屉本体 — 桌面右侧 480px，移动全屏 */}
      <div className="fixed inset-y-0 right-0 z-[80] flex h-full w-full flex-col overflow-hidden border-l border-slate-200 bg-white shadow-2xl transition-[width] duration-200 lg:w-[min(780px,calc(100vw-30rem))] xl:w-[min(880px,48vw)]">
        {/* Header */}
        <div className="shrink-0 border-b border-gray-200 px-4 py-3 flex items-center gap-3">
          <span className="text-xl">🔨</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900">与鲁班对话</p>
            <p className="text-xs text-gray-400 truncate">{itemTitle}</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-700 text-lg px-2"
            aria-label="关闭"
          >
            ✕
          </button>
        </div>

        {/* 消息区 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loadingHistory && (
            <p className="text-xs text-gray-400 text-center py-4">加载对话历史…</p>
          )}

          {!loadingHistory && messages.length === 0 && (
            <div className="text-center py-8 px-4">
              <p className="text-3xl mb-2">🔨</p>
              <p className="text-sm text-gray-600 font-medium mb-1">鲁班在这里</p>
              <p className="text-xs text-gray-400 leading-relaxed">
                我知道这个执行项的全部上下文。<br />
                可以让我起草内容、分析卡点、拆解下一步——<br />
                像跟同事聊天一样直接说就行。
              </p>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] ${m.role === 'user' ? 'order-2' : ''}`}>
                <div className={`rounded-2xl px-3.5 py-2.5 text-sm whitespace-pre-wrap break-words ${
                  m.role === 'user'
                    ? 'bg-indigo-600 text-white rounded-br-sm'
                    : 'bg-gray-100 text-gray-800 rounded-bl-sm'
                }`}>
                  {m.content}
                </div>
                {/* 鲁班回复 → 存为工作记录 */}
                {m.role === 'assistant' && (
                  <button
                    onClick={() => void handleSaveAsLog(i, m.content)}
                    disabled={m.saved}
                    className={`mt-1 text-[11px] font-medium transition-colors ${
                      m.saved
                        ? 'text-green-600 cursor-default'
                        : 'text-indigo-600 hover:text-indigo-800'
                    }`}
                  >
                    {m.saved ? '✓ 已存入工作记录' : '💾 存为工作记录'}
                  </button>
                )}
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
              placeholder="跟鲁班说…（Enter 发送，Shift+Enter 换行）"
              disabled={sending}
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm resize-none focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:bg-gray-50"
            />
            <button
              onClick={() => void handleSend()}
              disabled={sending || !input.trim()}
              className="shrink-0 rounded-lg bg-indigo-600 text-white px-4 py-2 text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              发送
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
