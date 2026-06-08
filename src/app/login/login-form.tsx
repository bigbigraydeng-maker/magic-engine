'use client'

import { useEffect, useRef, useState } from 'react'

const RESEND_COOLDOWN_SEC = 60

export default function LoginForm({ next, authFailed }: { next: string; authFailed?: boolean }) {
  const [email, setEmail]           = useState('')
  const [error, setError]           = useState('')
  const [loading, setLoading]       = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)

  // After signInWithOtp succeeds we ask for the 6-digit code, mirroring
  // /portal/register's verify step. Supabase sends OTP codes (not links) per
  // the project email template that P0-B set, so the UI MUST give the user
  // somewhere to type them — otherwise login deadends with "Check your email"
  // and no input box. (Original symptom: 13333540625@163.com received code
  // 6593251 but had no way to submit it.)
  const [step, setStep] = useState<'form' | 'verify'>('form')
  const [code, setCode] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [verifyError, setVerifyError] = useState('')
  const [resendCooldown, setResendCooldown] = useState(0)
  const [resendNotice, setResendNotice] = useState('')
  const [resending, setResending] = useState(false)
  const codeInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const hash = window.location.hash
    if (!hash) return
    const params = new URLSearchParams(hash.slice(1))
    const code = params.get('error_code')
    if (code === 'otp_expired') {
      setError('Magic link has expired. Please request a new one.')
    } else if (code) {
      setError('Authentication failed. Please try again.')
    }
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  }, [])

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

  function handleGoogleLogin() {
    setGoogleLoading(true)
    setError('')
    window.location.href = `/api/auth/google-login?next=${encodeURIComponent(next)}`
  }

  async function sendCode(targetEmail: string): Promise<boolean> {
    // redirectTo is kept for users who happen to click a real magic link
    // (e.g. if the project email template is ever flipped back to .ConfirmationURL).
    // For the OTP flow it's harmless — Supabase only uses it for the link variant.
    const redirectTo = `${window.location.origin}/auth/implicit-callback?next=${encodeURIComponent(next)}`
    const res = await fetch('/api/auth/magic-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: targetEmail, redirectTo }),
    })
    return res.ok
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const normalised = email.trim().toLowerCase()
    try {
      const ok = await sendCode(normalised)
      if (!ok) {
        setError('Unable to send code. Please try again.')
      } else {
        setEmail(normalised)
        setStep('verify')
        setResendCooldown(RESEND_COOLDOWN_SEC)
      }
    } catch {
      setError('Unable to send code. Please try again.')
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
        // type='email' — this is an existing-user passwordless sign-in, not a
        // first-time signup confirmation. See verify-otp/route.ts docstring.
        body: JSON.stringify({ email, token: value, next, type: 'email' }),
      })
      const data = await res.json().catch(() => ({}))
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

  function handleCodeChange(e: React.ChangeEvent<HTMLInputElement>) {
    // Supabase Email OTP length varies by project setting (6-10). Accept up to 10.
    const digits = e.target.value.replace(/\D/g, '').slice(0, 10)
    setCode(digits)
    setVerifyError('')
  }

  async function handleResend() {
    if (resendCooldown > 0 || resending) return
    setResending(true)
    setVerifyError('')
    setResendNotice('')
    try {
      const ok = await sendCode(email)
      if (ok) {
        setResendNotice('A new code is on its way.')
        setResendCooldown(RESEND_COOLDOWN_SEC)
      } else {
        setVerifyError('Could not resend the code. Please try again.')
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
        <div
          className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg text-sm font-black"
          style={{ background: '#EAF3EE', color: '#1F7A55' }}
        >
          ✓
        </div>
        <h3
          className="text-xl font-black"
          style={{ fontFamily: "'Fraunces', Georgia, serif", color: '#16181D', letterSpacing: '-.02em' }}
        >
          Enter your verification code
        </h3>
        <p className="mt-2 text-sm leading-6" style={{ color: 'rgba(22,24,29,.60)' }}>
          We emailed a code to{' '}
          <span className="font-semibold" style={{ color: '#16181D' }}>{email}</span>.
          {' '}Enter it below to sign in.
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
          className="mt-5 h-14 w-full rounded-xl border bg-white px-3 text-center text-2xl font-bold tracking-[0.5em] outline-none transition disabled:opacity-60"
          style={{
            border: '1.5px solid rgba(22,24,29,.14)',
            color: '#16181D',
            fontFamily: "'Fraunces', Georgia, serif",
          }}
          onFocus={e => { e.currentTarget.style.borderColor = '#BE8A2E'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(190,138,46,.12)' }}
          onBlur={e  => { e.currentTarget.style.borderColor = 'rgba(22,24,29,.14)'; e.currentTarget.style.boxShadow = 'none' }}
        />

        {verifyError && (
          <p
            className="mt-3 rounded-xl border px-3 py-2 text-sm font-semibold"
            style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C' }}
          >
            {verifyError}
          </p>
        )}

        {resendNotice && !verifyError && (
          <p className="mt-3 text-sm font-medium" style={{ color: '#1F7A55' }}>{resendNotice}</p>
        )}

        <button
          type="button"
          onClick={() => { if (code.length >= 6 && !verifying) void submitCode(code) }}
          disabled={code.length < 6 || verifying}
          className="mt-5 flex h-12 w-full items-center justify-center rounded-xl text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-60"
          style={{
            background: '#BE8A2E',
            color: '#fff',
            cursor: verifying || code.length < 6 ? 'not-allowed' : 'pointer',
          }}
        >
          {verifying ? 'Verifying…' : 'Verify & continue →'}
        </button>

        <div className="mt-4 flex items-center justify-between text-sm">
          <button
            type="button"
            onClick={handleResend}
            // Block resend while a verify is in flight — submitCode briefly
            // clears `code` on error, racing with a concurrent resend would
            // overwrite the new cooldown timer with confusing state. (魏征 HC-1)
            disabled={resendCooldown > 0 || resending || verifying}
            className="font-semibold transition disabled:cursor-not-allowed"
            style={{ color: (resendCooldown > 0 || resending || verifying) ? 'rgba(22,24,29,.35)' : '#BE8A2E' }}
          >
            {resendCooldown > 0
              ? `Resend code in ${resendCooldown}s`
              : resending
                ? 'Sending…'
                : 'Resend code'}
          </button>
          <button
            type="button"
            onClick={() => {
              // Reset every state the verify step owns. Forgetting cooldown
              // means the new email arrives with a stale "Resend in 40s" lock. (魏征 MC-2)
              setStep('form')
              setCode('')
              setVerifyError('')
              setResendNotice('')
              setResendCooldown(0)
            }}
            disabled={verifying}
            className="font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            style={{ color: 'rgba(22,24,29,.55)' }}
          >
            Use a different email
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Google */}
      <button
        type="button"
        onClick={handleGoogleLogin}
        disabled={googleLoading}
        className="flex h-12 w-full items-center justify-center gap-3 rounded-xl border text-sm font-semibold transition"
        style={{
          background: '#fff',
          border: '1.5px solid rgba(22,24,29,.15)',
          color: '#16181D',
        }}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
          <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
          <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.859-3.048.859-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
          <path d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z" fill="#FBBC05"/>
          <path d="M9 3.583c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.163 6.656 3.583 9 3.583z" fill="#EA4335"/>
        </svg>
        {googleLoading ? 'Redirecting…' : 'Continue with Google'}
      </button>

      {/* Divider */}
      <div className="flex items-center gap-3 my-1">
        <div className="h-px flex-1" style={{ background: 'rgba(22,24,29,.12)' }} />
        <span className="text-xs font-bold uppercase tracking-[0.12em]" style={{ color: 'rgba(22,24,29,.35)' }}>or</span>
        <div className="h-px flex-1" style={{ background: 'rgba(22,24,29,.12)' }} />
      </div>

      {/* Email form */}
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div>
          <label
            htmlFor="email"
            className="block text-xs font-bold uppercase tracking-[0.12em] mb-1.5"
            style={{ color: 'rgba(22,24,29,.55)' }}
          >
            Email address
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="h-12 w-full rounded-xl border bg-white px-3 text-sm outline-none transition"
            style={{
              border: '1.5px solid rgba(22,24,29,.14)',
              color: '#16181D',
            }}
            onFocus={e => { e.currentTarget.style.borderColor = '#BE8A2E'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(190,138,46,.12)' }}
            onBlur={e  => { e.currentTarget.style.borderColor = 'rgba(22,24,29,.14)'; e.currentTarget.style.boxShadow = 'none' }}
          />
        </div>

        {(error || authFailed) && (
          <p
            className="rounded-xl border px-3 py-2 text-sm font-semibold"
            style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C' }}
          >
            {error || 'Authentication failed. Please try again.'}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="flex h-12 w-full items-center justify-center rounded-xl text-sm font-bold transition"
          style={{
            background: loading ? 'rgba(190,138,46,.5)' : '#BE8A2E',
            color: '#fff',
            cursor: loading ? 'wait' : 'pointer',
          }}
        >
          {loading ? 'Sending…' : 'Email me a code →'}
        </button>
      </form>
    </div>
  )
}
