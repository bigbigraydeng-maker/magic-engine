'use client'

/**
 * Lead-capture form on a prospect's report page (Phase 35). Replaces the
 * mailto CTAs — a form captures the lead straight into the CRM (prospect flips
 * to `replied`) instead of relying on the owner to open their email client.
 * Styled for the dark charcoal offer card it sits inside.
 */

import { useState } from 'react'

const GOLD_GRAD = 'linear-gradient(135deg,#EBCB8B,#C4912E 55%,#A6781F)'
const CHARCOAL = '#1A1A1A'

type Status = 'idle' | 'submitting' | 'success' | 'error'

const inputClass =
  'w-full rounded-xl border-0 px-4 py-2.5 text-sm text-[#1A1A1A] placeholder:text-[rgba(26,26,26,0.4)] focus:outline-none focus:ring-2 focus:ring-[#EBCB8B]'
const inputStyle = { background: 'rgba(255,255,255,0.94)' }

export default function ReportLeadForm({
  prospectId,
  prefillName = '',
  prefillEmail = '',
}: {
  prospectId: string
  prefillName?: string
  prefillEmail?: string
}) {
  const [status, setStatus] = useState<Status>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  // We pre-fill name + email from what we already know (we emailed this owner),
  // so the reader only adds phone + message. Both stay editable to correct.
  const prefilled = Boolean(prefillEmail)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setStatus('submitting')
    setErrorMsg('')

    const form = e.currentTarget
    const value = (n: string) => (form.elements.namedItem(n) as HTMLInputElement | HTMLTextAreaElement).value
    try {
      const res = await fetch(`/api/report/${prospectId}/interest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: value('name'), email: value('email'),
          phone: value('phone'), message: value('message'),
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErrorMsg(json.error ?? 'Something went wrong — please try again.')
        setStatus('error')
      } else {
        setStatus('success')
      }
    } catch {
      setErrorMsg('Network error — please check your connection and try again.')
      setStatus('error')
    }
  }

  if (status === 'success') {
    return (
      <div className="rounded-2xl p-5 text-center" style={{ background: 'rgba(92,138,74,0.22)' }}>
        <p className="text-base font-semibold" style={{ color: '#A7D18F' }}>Thanks — we’ve got it ✓</p>
        <p className="mt-1.5 text-sm" style={{ color: 'rgba(255,255,255,0.78)' }}>
          One of our New Zealand team will be in touch within one business day. Talk soon.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-3">
      {prefilled && (
        <p className="text-xs" style={{ color: 'rgba(255,255,255,0.6)' }}>
          Just add your phone or a note and hit send — we’ll take it from there.
        </p>
      )}
      <input name="phone" type="tel" autoComplete="tel" placeholder="Best phone to reach you (optional)" aria-label="Phone" className={inputClass} style={inputStyle} />
      <textarea name="message" rows={3} placeholder="Anything you’d like us to know? (optional)" aria-label="Message" className={`${inputClass} resize-none`} style={inputStyle} />
      <div className="grid gap-3 sm:grid-cols-2">
        <input name="name" type="text" required autoComplete="name" defaultValue={prefillName} placeholder="Your name *" aria-label="Your name" className={inputClass} style={inputStyle} />
        <input name="email" type="email" required autoComplete="email" defaultValue={prefillEmail} placeholder="Email *" aria-label="Email" className={inputClass} style={inputStyle} />
      </div>
      {status === 'error' && (
        <p className="rounded-lg px-3 py-2 text-sm" style={{ background: 'rgba(194,69,58,0.2)', color: '#F0B8B2' }}>
          {errorMsg}
        </p>
      )}
      <button
        type="submit"
        disabled={status === 'submitting'}
        className="h-12 rounded-xl text-sm font-semibold transition-all hover:-translate-y-px disabled:opacity-60"
        style={{ background: GOLD_GRAD, color: CHARCOAL }}
      >
        {status === 'submitting' ? 'Sending…' : 'Yes — show me the 90-day plan'}
      </button>
      <p className="text-center text-xs" style={{ color: 'rgba(255,255,255,0.5)' }}>
        No pressure, no obligation. We’ll walk you through everything on a quick call or in person.
      </p>
    </form>
  )
}
