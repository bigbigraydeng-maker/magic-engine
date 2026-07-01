'use client'

import { useEffect, useRef, useState } from 'react'
import { GoogleSelfServeButton } from '@/components/auth/GoogleSelfServeButton'

interface Props {
  next: string
  authFailed?: boolean
}

const RESEND_COOLDOWN_SEC = 60

export default function PortalLoginForm({ next, authFailed }: Props) {
  const [step, setStep] = useState<'form' | 'verify'>('form')
  const [email, setEmail] = useState('')
  const [pendingEmail, setPendingEmail] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const [code, setCode] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [verifyError, setVerifyError] = useState('')
  const [resending, setResending] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)
  const [resendNotice, setResendNotice] = useState('')
  const codeInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (resendCooldown <= 0) return
    const t = setTimeout(() => setResendCooldown((n) => n - 1), 1000)
    return () => clearTimeout(t)
  }, [resendCooldown])

  useEffect(() => {
    if (step === 'verify') codeInputRef.current?.focus()
  }, [step])

  async function sendCode(targetEmail: string): Promise<'ok' | 'err'> {
    const redirectTo = `${window.location.origin}/auth/implicit-callback?next=${encodeURIComponent(next)}`
    try {
      const res = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: targetEmail.trim().toLowerCase(), redirectTo }),
      })
      return res.ok ? 'ok' : 'err'
    } catch {
      return 'err'
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const trimmed = email.trim().toLowerCase()
    const result = await sendCode(trimmed)
    setLoading(false)
    if (result === 'err') {
      setError('Unable to send code. Please check your email address.')
      return
    }
    setPendingEmail(trimmed)
    setStep('verify')
    setResendCooldown(RESEND_COOLDOWN_SEC)
  }

  function handleCodeChange(e: React.ChangeEvent<HTMLInputElement>) {
    // Supabase Email OTP length varies by project setting (6-10). Accept up to 10.
    const digits = e.target.value.replace(/\D/g, '').slice(0, 10)
    setCode(digits)
    setVerifyError('')
  }

  async function submitCode(value: string) {
    setVerifying(true)
    setVerifyError('')
    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // type='email' — existing user passwordless sign-in. Supabase returns
        // "Token has expired or is invalid" if we send 'signup' for a
        // magic-link OTP issued by signInWithOtp on a confirmed account.
        body: JSON.stringify({ email: pendingEmail, token: value, next, type: 'email' }),
      })
      const data = await res.json()
      if (!res.ok) {
        setVerifyError(data.error ?? 'Verification failed. Please try again.')
        setCode('')
        return
      }
      window.location.href = data.redirect ?? '/dashboard'
    } catch {
      setVerifyError('Unable to verify right now. Please try again.')
    } finally {
      setVerifying(false)
    }
  }

  async function handleResend() {
    if (resendCooldown > 0 || resending) return
    setResending(true)
    setVerifyError('')
    setResendNotice('')
    const result = await sendCode(pendingEmail)
    setResending(false)
    if (result === 'ok') {
      setResendNotice('A new code is on its way.')
      setResendCooldown(RESEND_COOLDOWN_SEC)
    } else {
      setVerifyError('Could not resend the code. Please try again.')
    }
  }

  function useDifferentEmail() {
    setStep('form')
    setCode('')
    setVerifyError('')
    setResendNotice('')
    setResendCooldown(0)
    setPendingEmail('')
  }

  if (step === 'verify') {
    return (
      <div className="py-2">
        <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-[#EAF3EE] text-sm font-black text-[#1F7A55]">
          ✓
        </div>
        <h3 className="font-display text-xl font-bold tracking-tight text-me-charcoal">
          Enter your login code
        </h3>
        <p className="mt-2 text-sm leading-6 text-me-charcoal/60">
          We emailed a code to{' '}
          <span className="font-semibold text-me-charcoal">{pendingEmail}</span>.
          {' '}Enter it below to access your workspace.
        </p>

        <input
          ref={codeInputRef}
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6,10}"
          maxLength={10}
          value={code}
          onChange={handleCodeChange}
          disabled={verifying}
          placeholder="123456"
          aria-label="Verification code"
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

        <button
          type="button"
          onClick={() => { if (code.length >= 6 && !verifying) void submitCode(code) }}
          disabled={code.length < 6 || verifying}
          className="mt-5 flex h-12 w-full items-center justify-center rounded-xl text-sm font-bold text-[#2A2008] shadow-[0_18px_50px_rgba(196,145,46,.22)] transition active:translate-y-px disabled:cursor-not-allowed disabled:opacity-60"
          style={{ background: 'linear-gradient(135deg,#EBCB8B,#C4912E 55%,#A6781F)' }}
        >
          {verifying ? 'Verifying…' : 'Verify & continue →'}
        </button>

        <div className="mt-4 flex items-center justify-between text-sm">
          <button
            type="button"
            onClick={handleResend}
            disabled={resendCooldown > 0 || resending || verifying}
            className="font-semibold text-me-ochre transition disabled:cursor-not-allowed disabled:text-me-charcoal/35"
          >
            {resendCooldown > 0
              ? `Resend code in ${resendCooldown}s`
              : resending
                ? 'Sending…'
                : 'Resend code'}
          </button>
          <button
            type="button"
            onClick={useDifferentEmail}
            disabled={verifying}
            className="font-semibold text-me-charcoal/60 transition hover:text-me-charcoal disabled:cursor-not-allowed disabled:opacity-40"
          >
            Use a different email
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <GoogleSelfServeButton next={next} label="Continue with Google" />

      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-me-charcoal/10" />
        <span className="text-xs font-bold uppercase tracking-[0.12em] text-me-charcoal/35">
          or
        </span>
        <div className="h-px flex-1 bg-me-charcoal/10" />
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div>
        <label
          htmlFor="portal-email"
          className="mb-1.5 block text-xs font-bold uppercase tracking-[0.12em] text-me-charcoal/55"
        >
          Email address
        </label>
        <input
          id="portal-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          className="h-12 w-full rounded-xl border-[1.5px] border-me-charcoal/14 bg-white px-3 text-sm text-me-charcoal outline-none transition focus:border-me-ochre focus:shadow-[0_0_0_3px_rgba(196,145,46,.12)]"
        />
      </div>

      {(error || authFailed) && (
        <p className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-sm font-semibold text-[#B91C1C]">
          {error || 'Authentication failed. Please request a new code.'}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="flex h-12 w-full items-center justify-center rounded-xl text-sm font-bold text-[#2A2008] shadow-[0_18px_50px_rgba(196,145,46,.22)] transition active:translate-y-px disabled:cursor-wait disabled:opacity-60"
        style={{ background: 'linear-gradient(135deg,#EBCB8B,#C4912E 55%,#A6781F)' }}
      >
        {loading ? 'Sending…' : 'Send code →'}
      </button>

      <p className="text-center text-xs text-me-charcoal/45">
        Have a password?{' '}
        <a href="/portal/forgot-password" className="font-semibold text-me-ochre no-underline hover:underline">
          Reset it →
        </a>
      </p>
      </form>
    </div>
  )
}
