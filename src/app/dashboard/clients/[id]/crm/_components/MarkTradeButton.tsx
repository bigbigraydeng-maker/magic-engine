'use client'

/**
 * 「这是同行」—— 员工在客人卡上一点，把他邮箱的整个域名加进同行名单（PM 2026-10-29）。
 *
 * 以前只能去设置页填域名，实际是 PM 看到一个说一个、开发再去改；新同行天天冒出来，
 * 这条路跟不上。走的是设置页同一个接口（`leads-config` 的 tradeDomains），不另开写入口。
 * 私人邮箱（Gmail 等）不给按 —— 按了会把所有用 Gmail 的客人一起扔出名单。
 */

import { useState } from 'react'
import { tradeDomainFor } from '@/lib/crm/contact-kind'

type State = { kind: 'idle' } | { kind: 'busy' } | { kind: 'done'; text: string } | { kind: 'error'; text: string }

export async function markDomainAsTrade(clientId: string, domain: string): Promise<{ ok: boolean; text: string }> {
  const url = `/api/clients/${clientId}/leads-config`
  const res = await fetch(url)
  if (!res.ok) return { ok: false, text: '读不到同行名单，没改，稍后再试' }
  const current = ((await res.json()) as { config?: { tradeDomains?: string[] } }).config?.tradeDomains ?? []
  if (current.includes(domain)) return { ok: true, text: `${domain} 本来就在同行名单里` }
  const patch = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tradeDomains: [...current, domain] }),
  })
  if (!patch.ok) return { ok: false, text: '没存上，稍后再试' }
  return { ok: true, text: `已标为同行：${domain} 的人以后不进「今天要联系」` }
}

export function MarkTradeButton({ clientId, email, onDone }: { clientId: string; email: string; onDone: (msg: string) => void }) {
  const [state, setState] = useState<State>({ kind: 'idle' })
  const domain = tradeDomainFor(email)
  if (!domain) return null
  if (state.kind === 'done') return <span className="px-1 py-2 text-xs font-semibold text-me-charcoal/60">✓ 已是同行</span>
  return (
    <button
      type="button"
      data-testid="mark-trade"
      disabled={state.kind === 'busy'}
      title={`把 ${domain} 整个域名标成同行（旅行社 / 分销），这家所有人都不再进「今天要联系」`}
      onClick={async () => {
        if (!window.confirm(`把 ${domain} 标成同行？\n这家用 ${domain} 邮箱的所有人都会移出「今天要联系」。`)) return
        setState({ kind: 'busy' })
        const r = await markDomainAsTrade(clientId, domain)
        setState(r.ok ? { kind: 'done', text: r.text } : { kind: 'error', text: r.text })
        onDone(r.text)
      }}
      className="rounded-lg border border-me-stone bg-white px-3 py-2 text-xs font-semibold text-me-charcoal/70"
    >
      {state.kind === 'busy' ? '标记中…' : state.kind === 'error' ? '重试：这是同行' : '🤝 这是同行'}
    </button>
  )
}
