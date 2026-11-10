'use client'

/**
 * 「提交新提案」（收起的高级区）：把准备好的提案内容（JSON：account、daily_cap、rule）粘进来，
 * 先预览——服务端把规则翻成大白话、绑定当前这一版信——看清楚再点「确认提交」。
 * 提案不是授权：提交后不会发任何信；原来待批的那份提案会被替换。
 */
import { useState } from 'react'
import { MeButton } from '@/components/ui/me-primitives'
import type { TriggeredSendRule } from '@/lib/messaging/triggered-send/rule'
import { describeRule } from '@/lib/messaging/triggered-send/rule-summary'
import { postCommand } from './api'
import { errorText } from './welcome-letter-text'

interface Draft {
  account: string
  daily_cap: number
  rule: unknown
}

function parseDraft(text: string): Draft | null {
  try {
    const value = JSON.parse(text) as Record<string, unknown>
    if (typeof value !== 'object' || value === null) return null
    if (typeof value.account !== 'string' || typeof value.daily_cap !== 'number') return null
    return { account: value.account, daily_cap: value.daily_cap, rule: value.rule }
  } catch {
    return null
  }
}

export function ProposeBox({ clientId, onDone }: { clientId: string; onDone: () => void }): JSX.Element {
  const [text, setText] = useState('')
  const [lines, setLines] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)

  const send = async (confirm: boolean) => {
    const draft = parseDraft(text)
    if (draft === null) {
      setMessage({ tone: 'bad', text: '粘贴的内容不完整：要有 account、daily_cap 和 rule 三项。' })
      return
    }
    setBusy(true)
    setMessage(null)
    const answer = await postCommand(clientId, 'propose', { ...draft, confirm })
    setBusy(false)
    if (!answer.ok) {
      setLines(null)
      setMessage({ tone: 'bad', text: errorText(answer.body) })
      return
    }
    if (!confirm) {
      const proposal = answer.body?.proposal as { rule: TriggeredSendRule; daily_cap: number } | undefined
      setLines(proposal ? describeRule(proposal.rule, proposal.daily_cap) : null)
      return
    }
    setLines(null)
    setText('')
    setMessage({ tone: 'ok', text: '提案已提交。它还不是授权，不会发任何信。' })
    onDone()
  }

  return (
    <details className="rounded-xl border border-me-charcoal/10 bg-me-ivory/40 p-3" data-testid="propose-box">
      <summary className="cursor-pointer text-[13px] font-black text-me-charcoal/70">高级：提交新提案（粘贴准备好的提案内容）</summary>
      <textarea
        className="mt-2 h-40 w-full rounded border border-me-charcoal/20 p-2 font-mono text-xs placeholder:text-[#6b6b6b]"
        value={text}
        disabled={busy}
        onChange={(e) => { setText(e.target.value); setLines(null) }}
        placeholder='{"account": "...", "daily_cap": 20, "rule": { ... }}'
        spellCheck={false}
      />
      {lines !== null && (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-me-charcoal" data-testid="propose-preview">
          {lines.map((l) => <li key={l}>{l}</li>)}
        </ul>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <MeButton variant="ghost" size="sm" disabled={busy || text.trim() === ''} onClick={() => void send(false)}>预览提案</MeButton>
        <MeButton variant="secondary" size="sm" disabled={busy || lines === null} onClick={() => void send(true)}>确认提交</MeButton>
      </div>
      {message !== null && <p className={`mt-2 text-sm ${message.tone === 'ok' ? 'text-[#3F6B33]' : 'font-semibold text-[#C2453A]'}`} role="status">{message.text}</p>}
    </details>
  )
}
