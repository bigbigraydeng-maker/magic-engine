'use client'

/**
 * "推广这条帖子" under a published Daily Plan Post. One click only proposes a
 * confirmation card; nothing is built and no money is spent here. The card is
 * confirmed on the ads-health page, which creates a paused ad; opening it is a
 * second card.
 */
import Link from 'next/link'
import { useState } from 'react'

interface Props {
  clientId: string
  planId: string | null
  date: string
}

type State =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'done' }
  | { kind: 'error'; message: string }

export function PromotePostButton({ clientId, planId, date }: Props) {
  const [state, setState] = useState<State>({ kind: 'idle' })
  if (!planId) return null

  async function propose() {
    setState({ kind: 'busy' })
    try {
      const res = await fetch(`/api/clients/${clientId}/campaign-daily-plan/promote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_id: planId, date }),
      })
      const json = (await res.json().catch(() => null)) as { success?: boolean; reason?: string; error?: string } | null
      if (res.ok && json?.success) {
        setState({ kind: 'done' })
        return
      }
      const message = json?.reason
        ?? (json?.error === 'ADMIN_REQUIRED' ? '只有管理员能推广帖子。' : `没出成（${res.status}），没有建广告。`)
      setState({ kind: 'error', message })
    } catch {
      setState({ kind: 'error', message: '网络出错，没有建广告。可以稍后再试。' })
    }
  }

  const cardsHref = `/dashboard/clients/${clientId}/ads-health`
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
      {state.kind !== 'done' && (
        <button
          type="button"
          onClick={propose}
          disabled={state.kind === 'busy'}
          className="rounded-md border border-me-ochre/40 px-2 py-0.5 font-medium text-me-ochre hover:bg-me-ochre/10 disabled:opacity-50"
        >
          {state.kind === 'busy' ? '正在核对…' : '推广这条帖子'}
        </button>
      )}
      {state.kind === 'done' && (
        <span className="text-[#5C8A4A]">
          已出确认卡，还没建广告。
          <Link href={cardsHref} className="ml-1 font-medium text-me-ochre hover:underline">去广告页确认 ↗</Link>
        </span>
      )}
      {state.kind === 'error' && (
        <span className="text-[#C2453A]">
          {state.message}
          {state.message.includes('已经有一张推广卡') && (
            <Link href={cardsHref} className="ml-1 font-medium text-me-ochre hover:underline">去广告页确认 ↗</Link>
          )}
        </span>
      )}
    </div>
  )
}
