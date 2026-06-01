'use client'

import { useState } from 'react'
import { GoogleSelfServeButton } from '@/components/auth/GoogleSelfServeButton'

const INPUT_CLS = 'mt-1.5 h-12 w-full rounded-xl border-[1.5px] border-me-charcoal/14 bg-white px-3 text-sm text-me-charcoal outline-none transition focus:border-me-ochre focus:shadow-[0_0_0_3px_rgba(196,145,46,.12)]'
const LABEL_CLS = 'text-xs font-bold uppercase tracking-[0.12em] text-me-charcoal/55'

interface RegisterFormProps {
  next: string
  fromProspect: boolean
}

export default function RegisterForm({ next, fromProspect }: RegisterFormProps) {
  const [form, setForm] = useState({
    businessName: '',
    email: '',
    password: '',
    websiteUrl: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/auth/self-register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.email.trim().toLowerCase(),
          password: form.password,
          businessName: form.businessName.trim(),
          websiteUrl: form.websiteUrl.trim() || undefined,
          next,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Registration failed. Please try again.')
        return
      }
      setDone(true)
    } catch {
      setError('Unable to register. Please check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  if (done) {
    return (
      <div className="py-2">
        <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-[#EAF3EE] text-sm font-black text-[#1F7A55]">
          ✓
        </div>
        <h3 className="font-display text-xl font-bold tracking-tight text-me-charcoal">
          Check your email
        </h3>
        <p className="mt-2 text-sm leading-6 text-me-charcoal/60">
          Confirmation link sent to{' '}
          <span className="font-semibold text-me-charcoal">{form.email}</span>.
          {' '}
          {fromProspect
            ? 'Verify it to save your Discovery Report, open your workspace, and receive your '
            : 'Click the link to activate your account and receive your '}
          <strong>500 MTC</strong>
          {fromProspect ? ' welcome bonus.' : ' welcome bonus.'}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <GoogleSelfServeButton next={next} label="Continue with Google" />

      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-me-charcoal/10" />
        <span className="text-xs font-bold uppercase tracking-[0.12em] text-me-charcoal/35">
          or
        </span>
        <div className="h-px flex-1 bg-me-charcoal/10" />
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="businessName" className={LABEL_CLS}>Business name</label>
        <input
          id="businessName"
          name="businessName"
          type="text"
          required
          value={form.businessName}
          onChange={handleChange}
          placeholder="Acme Co"
          className={INPUT_CLS}
        />
      </div>

      <div>
        <label htmlFor="email" className={LABEL_CLS}>Email address</label>
        <input
          id="email"
          name="email"
          type="email"
          required
          value={form.email}
          onChange={handleChange}
          placeholder="you@company.com"
          className={INPUT_CLS}
        />
      </div>

      <div>
        <label htmlFor="password" className={LABEL_CLS}>Password</label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          value={form.password}
          onChange={handleChange}
          placeholder="At least 8 characters"
          className={INPUT_CLS}
        />
      </div>

      <div>
        <label htmlFor="websiteUrl" className={LABEL_CLS}>
          Website URL <span className="font-medium text-me-charcoal/40">(optional)</span>
        </label>
        <input
          id="websiteUrl"
          name="websiteUrl"
          type="url"
          value={form.websiteUrl}
          onChange={handleChange}
          placeholder="https://yoursite.com.au"
          className={INPUT_CLS}
        />
      </div>

      {error && (
        <p className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-sm font-semibold text-[#B91C1C]">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="flex h-12 w-full items-center justify-center rounded-xl text-sm font-bold text-[#2A2008] shadow-[0_18px_50px_rgba(196,145,46,.22)] transition active:translate-y-px disabled:cursor-wait disabled:opacity-60"
        style={{ background: 'linear-gradient(135deg,#EBCB8B,#C4912E 55%,#A6781F)' }}
      >
        {loading ? 'Creating account…' : 'Create account — free'}
      </button>
      </form>
    </div>
  )
}
