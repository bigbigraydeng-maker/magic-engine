'use client'

import { useRef, useState } from 'react'

/**
 * 行程单的主入口：一个对话框。
 *
 * 顾问手里通常已经有现成文字（邮件 / 微信 / Word 草稿），粘进来一次成型；
 * 之后用人话改（「第 5 天改成杭州」「价格 6480」）。逐格填表是校对用的，不是录入用的。
 */

export type ChatTurn = { role: 'user' | 'assistant'; content: string }

const PLACEHOLDER_FIRST = `把行程原文整段粘进来 —— 邮件、微信、Word 里的都行，格式乱没关系。

例如：
Day 1  8 May (Sat)  Auckland → Guangzhou
自行前往奥克兰机场，搭乘 CZ306，22:30 起飞。
Day 2  9 May (Sun)  Guangzhou → Beijing
CZ3101 08:00/11:00，抵京后司导接机送酒店…`

const PLACEHOLDER_FOLLOW_UP = `用人话说要改什么，例如：
「第 5 天改成杭州，加西湖游船」
「每人价格 6480 纽币」
「把亮点改成 5 条，突出美食」`

export default function AiComposer({
  onSubmit,
  busy,
  turns,
  error,
}: {
  onSubmit: (message: string) => void
  busy: boolean
  turns: ChatTurn[]
  error: string | null
}) {
  const [text, setText] = useState('')
  const taRef = useRef<HTMLTextAreaElement>(null)
  const isFirst = turns.length === 0

  const submit = () => {
    const v = text.trim()
    if (!v || busy) return
    onSubmit(v)
    setText('')
  }

  return (
    <section className="rounded-xl border border-black/10 bg-white p-5">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-me-charcoal text-[10px] font-black text-white">
          AI
        </span>
        <h2 className="text-sm font-black text-me-charcoal">
          {isFirst ? '把行程内容贴进来' : '继续修改'}
        </h2>
      </div>

      {/* 对话历史：只回放助手的话，用户粘的原文太长没有回看价值 */}
      {turns.length > 0 && (
        <div className="mb-3 max-h-44 space-y-2 overflow-y-auto pr-1">
          {turns.map((t, i) =>
            t.role === 'assistant' ? (
              <p key={i} className="rounded-lg bg-me-ivory px-3 py-2 text-xs leading-relaxed text-me-charcoal/80">
                {t.content}
              </p>
            ) : (
              <p key={i} className="truncate px-3 text-[11px] text-me-charcoal/40">
                你：{t.content.slice(0, 60)}
                {t.content.length > 60 ? '…' : ''}
              </p>
            )
          )}
        </div>
      )}

      <textarea
        ref={taRef}
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
            e.preventDefault()
            submit()
          }
        }}
        rows={isFirst ? 9 : 4}
        disabled={busy}
        placeholder={isFirst ? PLACEHOLDER_FIRST : PLACEHOLDER_FOLLOW_UP}
        className="w-full resize-y rounded-lg border border-black/10 px-3 py-2.5 text-sm leading-relaxed placeholder:text-me-charcoal/30 focus:border-me-ochre focus:outline-none focus:ring-1 focus:ring-me-ochre disabled:bg-black/[.02]"
      />

      {error && (
        <p className="mt-2 rounded-lg border border-[#C2453A]/25 bg-[#C2453A]/8 px-3 py-2 text-xs text-[#C2453A]">
          {error}
        </p>
      )}

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={busy || !text.trim()}
          className="rounded-lg bg-me-charcoal px-4 py-2 text-sm font-bold text-white transition-colors hover:bg-me-charcoal/90 disabled:bg-black/15"
        >
          {busy ? 'AI 解析中…' : isFirst ? '解析并填入' : '应用修改'}
        </button>
        <span className="text-[11px] text-me-charcoal/40">⌘/Ctrl + Enter 提交</span>
      </div>

      <p className="mt-3 border-t border-black/5 pt-3 text-[11px] leading-relaxed text-me-charcoal/45">
        AI 只照抄原文，<strong className="font-bold text-me-charcoal/70">不会替你补价格、酒店和餐食</strong>。
        原文没写的会留空并列进下方「待确认」，请人工补齐后再发客户。
      </p>
    </section>
  )
}
