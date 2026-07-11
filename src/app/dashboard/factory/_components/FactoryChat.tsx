'use client'

import { useCallback, useRef, useState } from 'react'

// P21.J P2 — 内容工厂对话框(spec me-native-design v0.2,合体屏右半)
// 说人话打回/调预算,底层调 /api/factory/chat(不给"通过",花钱只走左边按钮)。
// stateless:UI 持有对话历史,每次带最近几轮给后端。

interface Msg { role: 'user' | 'assistant'; content: string }

export function FactoryChat({ clientId, onActed }: { clientId: string; onActed?: () => void }) {
  const [messages, setMessages] = useState<Msg[]>([
    { role: 'assistant', content: '有片要改就跟我说,比如「第一条节奏太慢,开头改成价格反转」或「把预算降到 $20」。通过投放你在左边点按钮。' },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || loading) return
    const history = messages.filter((m) => m.role === 'user' || m.role === 'assistant')
    setMessages((prev) => [...prev, { role: 'user', content: text }])
    setInput('')
    setLoading(true)
    try {
      const res = await fetch('/api/factory/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, message: text, history }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? `出错了 (${res.status})`)
      setMessages((prev) => [...prev, { role: 'assistant', content: json.text || '(没有回复)' }])
      if (Array.isArray(json.tool_calls) && json.tool_calls.length > 0) onActed?.() // 打回/调预算了 → 刷新左边
    } catch (e) {
      setMessages((prev) => [...prev, { role: 'assistant', content: `⚠️ ${e instanceof Error ? e.message : '出错了'}` }])
    } finally {
      setLoading(false)
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }))
    }
  }, [input, loading, messages, clientId, onActed])

  return (
    <div className="flex flex-col border border-slate-200 rounded-xl bg-white overflow-hidden h-full min-h-[320px]">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-100">
        <span className="text-blue-600">✦</span>
        <span className="text-sm font-medium text-slate-800">问 Claude · 只管这个客户</span>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-2.5">
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap ${
              m.role === 'user' ? 'bg-blue-50 text-blue-900' : 'bg-slate-50 text-slate-700'
            }`}>{m.content}</div>
          </div>
        ))}
        {loading && <div className="flex justify-start"><div className="bg-slate-50 text-slate-400 rounded-xl px-3 py-2 text-sm">思考中…</div></div>}
      </div>

      <div className="flex items-center gap-2 p-2 border-t border-slate-100">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }}
          placeholder="说人话,或贴个竞品链接…"
          disabled={loading}
          className="flex-1 text-sm px-3 h-9 rounded-lg border border-slate-200 focus:outline-none focus:border-slate-400 disabled:opacity-50"
        />
        <button
          onClick={() => void send()}
          disabled={loading || !input.trim()}
          className="w-9 h-9 rounded-lg bg-slate-900 text-white grid place-items-center hover:bg-slate-700 disabled:opacity-40"
          aria-label="发送"
        >↑</button>
      </div>
    </div>
  )
}
