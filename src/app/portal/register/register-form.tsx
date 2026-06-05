'use client'

import { useEffect, useRef, useState } from 'react'
import { GoogleSelfServeButton } from '@/components/auth/GoogleSelfServeButton'

const INPUT_CLS = 'mt-1.5 h-12 w-full rounded-xl border-[1.5px] border-me-charcoal/14 bg-white px-3 text-sm text-me-charcoal outline-none transition focus:border-me-ochre focus:shadow-[0_0_0_3px_rgba(196,145,46,.12)]'
const LABEL_CLS = 'text-xs font-bold uppercase tracking-[0.12em] text-me-charcoal/55'
const RESEND_COOLDOWN_SEC = 60

interface RegisterFormProps {
  next: string
  fromProspect: boolean
}

export default function RegisterForm({ next, fromProspect }: RegisterFormProps) {
  const [form, setForm] = useState({
    businessName: '',
    email: '',
    websiteUrl: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // OTP verification step (P0-B): after self-register succeeds we ask the user
  // for the 6-digit code we emailed, instead of telling them to click a link.
  const [step, setStep] = useState<'form' | 'verify'>('form')
  const [pending, setPending] = useState<{ email: string; next: string }>({ email: '', next })
  const [code, setCode] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [verifyError, setVerifyError] = useState('')
  const [resendCooldown, setResendCooldown] = useState(0)
  const [resendNotice, setResendNotice] = useState('')
  const [resending, setResending] = useState(false)
  const codeInputRef = useRef<HTMLInputElement>(null)

  // Countdown for the resend cooldown.
  useEffect(() => {
    if (resendCooldown <= 0) return
    const t = setTimeout(() => setResendCooldown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [resendCooldown])

  // Focus the code field as soon as we enter the verify step.
  useEffect(() => {
    if (step === 'verify') codeInputRef.current?.focus()
  }, [step])

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }))
  }

  function registerPayload() {
    return {
      email: form.email.trim().toLowerCase(),
      businessName: form.businessName.trim(),
      websiteUrl: form.websiteUrl.trim() || undefined,
      next,
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/auth/self-register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(registerPayload()),
      })

      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Registration failed. Please try again.')
        return
      }
      setPending({ email: data.email ?? form.email.trim().toLowerCase(), next: data.next ?? next })
      setResendCooldown(RESEND_COOLDOWN_SEC)
      setStep('verify')
    } catch {
      setError('Unable to register. Please check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }

  async function submitCode(value: string) {
    setVerifying(true)
    setVerifyError('')
    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: pending.email, token: value, next: pending.next }),
      })
      const data = await res.json()
      if (!res.ok) {
        setVerifyError(data.error ?? 'Verification failed. Please try again.')
        setCode('')
        return
      }
      // Session cookie is set server-side; go straight to the resolved landing.
      window.location.href = data.redirect ?? '/dashboard'
    } catch {
      setVerifyError('Unable to verify right now. Please try again.')
    } finally {
      setVerifying(false)
    }
  }

  function handleCodeChange(e: React.ChangeEvent<HTMLInputElement>) {
    const digits = e.target.value.replace(/\D/g, '').slice(0, 6)
    setCode(digits)
    setVerifyError('')
    if (digits.length === 6 && !verifying) {
      void submitCode(digits)
    }
  }

  async function handleResend() {
    if (resendCooldown > 0 || resending) return
    setResending(true)
    setVerifyError('')
    setResendNotice('')
    try {
      const res = await fetch('/api/auth/self-register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(registerPayload()),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setResendNotice('A new code is on its way.')
        setResendCooldown(RESEND_COOLDOWN_SEC)
      } else if (res.status === 409) {
        // Account already exists from the first send — code is still valid.
        setResendNotice('Your previous code is still valid — check your inbox.')
        setResendCooldown(RESEND_COOLDOWN_SEC)
      } else {
        setVerifyError(data.error ?? 'Could not resend the code. Please try again.')
      }
    } catch {
      setVerifyError('Could not resend the code. Please try again.')
    } finally {
      setResending(false)
    }
  }

  if (step === 'verify') {
    return (
      <div className="py-2">
        <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-[#EAF3EE] text-sm font-black text-[#1F7A55]">
          ✓
        </div>
        <h3 className="font-display text-xl font-bold tracking-tight text-me-charcoal">
          Enter your verification code
        </h3>
        <p className="mt-2 text-sm leading-6 text-me-charcoal/60">
          We emailed a 6-digit code to{' '}
          <span className="font-semibold text-me-charcoal">{pending.email}</span>.
          {' '}Enter it below to activate your account and receive your{' '}
          <strong>500 MTC</strong> welcome bonus.
        </p>

        <input
          ref={codeInputRef}
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          value={code}
          onChange={handleCodeChange}
          disabled={verifying}
          placeholder="123456"
          aria-label="6-digit verification code"
          className="mt-5 h-14 w-full rounded-xl border-[1.5px] border-me-charcoal/14 bg-white px-3 text-center font-display text-2xl font-bold tracking-[0.5em] text-me-charcoal outline-none transition focus:border-me-ochre focus:shadow-[0_0_0_3px_rgba(196,145,46,.12)] disabled:opacity-60"
        />

        {verifyError && (
          <p className="mt-3 rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-sm font-semibold text-[#B91C1C]">
            {verifyError}
          </p>
        )}

        {resendNotice && !verifyError && (
          <p className="mt-3 text-sm font-medium text-[#1F7A55]">{resendNotice}</p>
        )}

        <div className="mt-5 flex items-center justify-between text-sm">
          <button
            type="button"
            onClick={handleResend}
            disabled={resendCooldown > 0 || resending}
            className="font-semibold text-me-ochre transition disabled:cursor-not-allowed disabled:text-me-charcoal/35"
          >
            {resendCooldown > 0
              ? `Resend code in ${resendCooldown}s`
              : resending
                ? 'Sending…'
                : 'Resend code'}
          </button>
          {verifying && <span className="text-me-charcoal/45">Verifying…</span>}
        </div>
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
