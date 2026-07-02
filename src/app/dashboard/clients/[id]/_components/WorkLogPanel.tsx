'use client'

import { useState, useEffect, useRef } from 'react'

interface WorkLog {
  id: string
  log_date: string
  summary: string
  author_email: string
  created_at: string
}

export function WorkLogPanel({ clientId }: { clientId: string }) {
  const [logs, setLogs] = useState<WorkLog[]>([])
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  async function fetchLogs() {
    const res = await fetch(`/api/clients/${clientId}/work-logs`)
    if (res.ok) {
      const { logs: data } = await res.json()
      setLogs(data ?? [])
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchLogs()
    const timer = setInterval(fetchLogs, 60_000)
    return () => clearInterval(timer)
  }, [clientId])

  async function handleSave() {
    const summary = text.trim()
    if (!summary || saving) return
    setSaving(true)
    const res = await fetch(`/api/clients/${clientId}/work-logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ summary }),
    })
    if (res.ok) {
      const { log } = await res.json()
      setLogs(prev => [log, ...prev])
      setText('')
      textareaRef.current?.focus()
    }
    setSaving(false)
  }

  async function handleDelete(logId: string) {
    const res = await fetch(`/api/clients/${clientId}/work-logs/${logId}`, { method: 'DELETE' })
    if (res.ok) setLogs(prev => prev.filter(l => l.id !== logId))
  }

  // Group logs by date
  const grouped: Record<string, WorkLog[]> = {}
  for (const log of logs) {
    ;(grouped[log.log_date] ??= []).push(log)
  }
  const dates = Object.keys(grouped).sort((a, b) => b.localeCompare(a))

  function formatDate(d: string) {
    return new Date(d + 'T00:00:00').toLocaleDateString('zh-CN', {
      month: 'long', day: 'numeric', weekday: 'short',
    })
  }

  function authorInitials(email: string) {
    return email.split('@')[0].slice(0, 2).toUpperCase()
  }

  function formatTime(iso: string) {
    return new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }

  const today = new Date().toISOString().slice(0, 10)

  return (
    <div className="space-y-4">
      {/* ── Quick-add area ── */}
      <div className="rounded-xl border border-black/10 bg-white p-4">
        <p className="mb-2 text-xs font-black uppercase tracking-[0.14em] text-me-ochre">今天做了什么</p>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSave()
          }}
          placeholder="写几句今天做的事情，⌘↵ 保存…"
          rows={3}
          className="w-full resize-none rounded-lg border border-black/10 bg-me-ivory px-3 py-2 text-sm text-me-charcoal placeholder:text-me-charcoal/35 focus:border-me-ochre/60 focus:outline-none"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs text-me-charcoal/40">{text.length > 0 ? `${text.length} 字` : ''}</span>
          <button
            onClick={handleSave}
            disabled={!text.trim() || saving}
            className="rounded-lg bg-me-charcoal px-4 py-1.5 text-sm font-black text-white disabled:opacity-35 hover:bg-me-charcoal/80"
          >
            {saving ? '保存中…' : '保存日志'}
          </button>
        </div>
      </div>

      {/* ── Log list ── */}
      {loading ? (
        <div className="py-8 text-center text-sm text-me-charcoal/40">加载中…</div>
      ) : dates.length === 0 ? (
        <div className="rounded-xl border border-dashed border-black/15 py-10 text-center">
          <p className="text-sm font-bold text-me-charcoal/50">还没有日志</p>
          <p className="mt-1 text-xs text-me-charcoal/35">每天写几句，帮助客户和团队看到进展</p>
        </div>
      ) : (
        <div className="space-y-5">
          {dates.map(date => (
            <div key={date}>
              {/* Date header */}
              <div className="mb-2 flex items-center gap-2">
                <span className={`text-xs font-black ${date === today ? 'text-me-ochre' : 'text-me-charcoal/50'}`}>
                  {date === today ? '今天 · ' : ''}{formatDate(date)}
                </span>
                <div className="h-px flex-1 bg-black/8" />
              </div>
              {/* Entries for this date */}
              <div className="space-y-2">
                {grouped[date].map(log => (
                  <div
                    key={log.id}
                    className="group relative rounded-xl border border-black/8 bg-white px-4 py-3"
                  >
                    <div className="flex items-start gap-3">
                      {/* Author avatar */}
                      <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-me-charcoal text-[10px] font-black text-white">
                        {authorInitials(log.author_email)}
                      </div>
                      {/* Body */}
                      <div className="min-w-0 flex-1">
                        <p className="whitespace-pre-wrap text-sm leading-relaxed text-me-charcoal">
                          {log.summary}
                        </p>
                        <p className="mt-1 text-[11px] text-me-charcoal/35">
                          {log.author_email.split('@')[0]} · {formatTime(log.created_at)}
                        </p>
                      </div>
                      {/* Delete */}
                      <button
                        onClick={() => handleDelete(log.id)}
                        className="shrink-0 opacity-0 group-hover:opacity-100 text-me-charcoal/30 hover:text-red-500 transition-opacity text-xs font-bold"
                        title="删除"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
