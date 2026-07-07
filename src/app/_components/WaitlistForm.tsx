'use client'

/**
 * Waitlist form for businesses outside Auckland (the founding 100 is
 * Auckland-only — in-person onboarding). Posts to the existing /api/contact
 * endpoint (Resend email + attribution log), with the city folded into the
 * message so no new table or endpoint is needed.
 */

import { useState } from 'react'

type Status = 'idle' | 'submitting' | 'success' | 'error'

const INPUT_CLASS =
  'w-full rounded-lg border bg-white px-4 py-2.5 text-sm placeholder:text-[rgba(26,26,26,0.35)] focus:outline-none focus:ring-2'

const inputStyle = { borderColor: 'rgba(26,26,26,0.14)', color: '#1A1A1A' }

export default function WaitlistForm() {
  const [status, setStatus] = useState<Status>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setStatus('submitting')
    setErrorMsg('')

    const form = e.currentTarget
    const value = (name: string) => (form.elements.namedItem(name) as HTMLInputElement).value
    const data = {
      name: value('name'),
      email: value('email'),
      company: value('business'),
      message: `Waitlist signup (outside Auckland).\nCity: ${value('city')}\nBusiness: ${value('business') || '—'}`,
    }

    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      const json = await res.json()
      if (!res.ok) {
        setErrorMsg(json.error ?? 'Something went wrong. Please try again.')
        setStatus('error')
      } else {
        setStatus('success')
      }
    } catch {
      setErrorMsg('Network error. Please check your connection and try again.')
      setStatus('error')
    }
  }

  if (status === 'success') {
    return (
      <div className="rounded-2xl border p-8 text-center" style={{ background: 'rgba(92,138,74,0.08)', borderColor: 'rgba(92,138,74,0.35)' }}>
        <p className="text-lg font-semibold" style={{ color: '#3F6B31' }}>You&apos;re on the list ✓</p>
        <p className="mt-2 text-sm" style={{ color: 'rgba(26,26,26,0.6)' }}>
          We&apos;ll email you as soon as we open up your city.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
      <input name="name" type="text" required autoComplete="name" placeholder="Your name *" aria-label="Your name" className={INPUT_CLASS} style={inputStyle} />
      <input name="email" type="email" required autoComplete="email" placeholder="Email *" aria-label="Email" className={INPUT_CLASS} style={inputStyle} />
      <input name="business" type="text" autoComplete="organization" placeholder="Business name" aria-label="Business name" className={INPUT_CLASS} style={inputStyle} />
      <input name="city" type="text" required placeholder="Your city (e.g. Wellington) *" aria-label="Your city" className={INPUT_CLASS} style={inputStyle} />
      {status === 'error' && (
        <p className="rounded-lg border px-4 py-3 text-sm sm:col-span-2" style={{ background: 'rgba(194,69,58,0.08)', borderColor: 'rgba(194,69,58,0.35)', color: '#A63D31' }}>
          {errorMsg}
        </p>
      )}
      <button
        type="submit"
        disabled={status === 'submitting'}
        className="h-12 rounded-xl text-sm font-semibold transition-all hover:-translate-y-px disabled:opacity-50 sm:col-span-2"
        style={{ background: '#1A1A1A', color: '#fff' }}
      >
        {status === 'submitting' ? 'Joining…' : 'Join the waitlist'}
      </button>
    </form>
  )
}
