'use client'

import { useState } from 'react'

const GOLD_GRAD = 'linear-gradient(135deg,#EBCB8B,#C4912E 55%,#A6781F)'
const CHARCOAL = '#1A1A1A'

type State = 'idle' | 'submitting' | 'done' | 'error'

/**
 * The confirm-and-suppress control on the unsubscribe page. A deliberate click
 * (POST) — never an auto-opt-out on load — so link-prefetching email scanners
 * can't unsubscribe someone who never clicked. On success the whole panel flips
 * to the confirmation copy.
 */
export default function UnsubscribeButton({ prospectId }: { prospectId: string }) {
  const [state, setState] = useState<State>('idle')

  async function submit() {
    setState('submitting')
    try {
      const res = await fetch(`/api/unsubscribe/${prospectId}`, { method: 'POST' })
      if (!res.ok) throw new Error(String(res.status))
      setState('done')
    } catch {
      setState('error')
    }
  }

  if (state === 'done') {
    return (
      <div className="text-center">
        <div className="mb-3 text-3xl">✓</div>
        <h2 className="text-lg font-semibold">You're unsubscribed</h2>
        <p className="mt-2 text-sm" style={{ color: 'rgba(26,26,26,0.55)' }}>
          You won't hear from us again. Sorry for the interruption — all the best with the business.
        </p>
      </div>
    )
  }

  return (
    <div className="text-center">
      <button
        onClick={() => void submit()}
        disabled={state === 'submitting'}
        className="rounded-xl px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
        style={{ background: GOLD_GRAD }}
      >
        {state === 'submitting' ? 'One moment…' : 'Unsubscribe me'}
      </button>
      {state === 'error' && (
        <p className="mt-3 text-sm" style={{ color: '#C2453A' }}>
          Something went wrong — please try once more, or just reply to the email and we'll take you off.
        </p>
      )}
      <p className="mt-4 text-xs" style={{ color: 'rgba(26,26,26,0.4)', maxWidth: 320 }}>
        Prefer to reply instead? Just answer the email with "no thanks" and{' '}
        <span style={{ color: CHARCOAL }}>we'll do the same thing</span>. We never share or sell your details.
      </p>
    </div>
  )
}
