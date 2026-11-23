'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { GoogleSelfServeButton } from '@/components/auth/GoogleSelfServeButton'
import { safeInternalPath } from '@/lib/auth/safe-internal-path'

const INPUT_CLS = 'mt-1.5 h-12 w-full rounded-xl border-[1.5px] border-me-charcoal/14 bg-white px-3 text-sm text-me-charcoal outline-none transition focus:border-me-ochre focus:shadow-[0_0_0_3px_rgba(196,145,46,.12)]'
const LABEL_CLS = 'text-xs font-bold uppercase tracking-[0.12em] text-me-charcoal/55'
const RESEND_COOLDOWN_SEC = 60

interface RegisterFormProps {
  next: string
  fromProspect: boolean
  zh?: boolean
  authFailed?: boolean
}

interface RegisterResponse {
  error?: string
  code?: string
  email?: string
  next?: string
  signIn?: boolean
}

interface VerifyResponse {
  error?: string
  redirect?: string
}

export default function RegisterForm({ next, fromProspect, zh = false, authFailed = false }: RegisterFormProps) {
  const [form, setForm] = useState({
    businessName: '',
    email: '',
    websiteUrl: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [errorCode, setErrorCode] = useState('')

  // OTP verification step (P0-B): after self-register succeeds we ask the user
  // for the 6-digit code we emailed, instead of telling them to click a link.
  const [step, setStep] = useState<'form' | 'verify'>('form')
  const [pending, setPending] = useState<{ email: string; next: string }>({ email: '', next })
  const [signIn, setSignIn] = useState(false)
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

  function zhRegisterError(code: string | undefined): string {
    switch (code) {
      case 'missing_fields':
        return '请填写公司名称和邮箱。'
      case 'invalid_email':
        return '邮箱格式不对，请检查一下。'
      case 'rate_limited':
        return '尝试次数太多，请过一会儿再试。'
      case 'code_cooldown':
        return '验证码刚发过，请一分钟后再试。'
      case 'account_exists':
        return '这个邮箱已经注册过。请用注册时的邮箱收验证码登录，或写信给 hello@magicengine.cloud。'
      case 'business_exists':
        return '这个公司名称已经被注册过，请换一个写法（比如加上城市）。'
      case 'staff_account':
        return 'staff_account'
      case 'registration_failed':
        return '注册暂时失败，请稍后再试。'
      default:
        return '注册暂时失败，请稍后再试。'
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setErrorCode('')

    try {
      const res = await fetch('/api/auth/self-register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(registerPayload()),
      })

      const data: RegisterResponse = await res.json()
      if (!res.ok) {
        if (zh) {
          setErrorCode(data.code ?? '')
          setError(zhRegisterError(data.code))
        } else {
          setError(data.error ?? 'Registration failed. Please try again.')
        }
        return
      }
      setPending({ email: data.email ?? form.email.trim().toLowerCase(), next: data.next ?? next })
      setSignIn(data.signIn === true)
      setResendCooldown(RESEND_COOLDOWN_SEC)
      setStep('verify')
    } catch {
      setError(zh
        ? '网络不稳定，请再试一次。'
        : 'Unable to register. Please check your connection and try again.')
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
      const data: VerifyResponse = await res.json()
      if (!res.ok) {
        setVerifyError(zh
          ? '验证码不对或已过期，请重新输入或重新发送。'
          : (data.error ?? 'Verification failed. Please try again.'))
        setCode('')
        return
      }
      // Session cookie is set server-side; go straight to the resolved landing.
      window.location.href = safeInternalPath(data.redirect, '/dashboard')
    } catch {
      setVerifyError(zh
        ? '网络不稳定，请再试一次。'
        : 'Unable to verify right now. Please try again.')
    } finally {
      setVerifying(false)
    }
  }

  function handleCodeChange(e: React.ChangeEvent<HTMLInputElement>) {
    // Supabase Email OTP length varies by project setting (6-10). Accept up to 10.
    const digits = e.target.value.replace(/\D/g, '').slice(0, 10)
    setCode(digits)
    setVerifyError('')
    // P0-G/P0-I: previously we auto-submitted at length===6, which truncated
    // 8-digit OTPs from older Supabase project settings. Do not auto-submit
    // any more — user clicks Verify when ready. Length is validated server-side.
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
      const data: RegisterResponse = await res.json().catch(() => ({}))
      if (res.ok) {
        // Unverified repeat POST now genuinely re-sends a fresh code (resent: true).
        setResendNotice(zh ? '新的验证码已发出。' : 'A new code is on its way.')
        setResendCooldown(RESEND_COOLDOWN_SEC)
      } else if (res.status === 429) {
        // Supabase email cooldown — the previous code is still the live one.
        setResendNotice(zh
          ? '上一个验证码仍然有效，请查看邮箱。'
          : 'Your previous code is still valid — check your inbox.')
        setResendCooldown(RESEND_COOLDOWN_SEC)
      } else {
        // 409 now only means "already verified — log in instead" (or a name clash).
        setVerifyError(zh
          ? zhRegisterError(data.code)
          : (data.error ?? 'Could not resend the code. Please try again.'))
      }
    } catch {
      setVerifyError(zh
        ? '网络不稳定，请再试一次。'
        : 'Could not resend the code. Please try again.')
    } finally {
      setResending(false)
    }
  }

  function handleBackToForm() {
    setStep('form')
    setCode('')
    setVerifyError('')
    setResendNotice('')
    setResendCooldown(0)
  }

  if (step === 'verify') {
    return (
      <div className="py-2">
        <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-[#EAF3EE] text-sm font-black text-[#1F7A55]">
          ✓
        </div>
        <h3 className="font-display text-xl font-bold tracking-tight text-me-charcoal">
          {zh ? '查收邮箱验证码' : 'Enter your verification code'}
        </h3>
        <p className="mt-2 text-sm leading-6 text-me-charcoal/60">
          {zh ? (
            signIn ? (
              <>这个邮箱已经注册过，登录验证码已发到{' '}
                <span className="font-semibold text-me-charcoal">{pending.email}</span>。没收到的话看看垃圾邮件箱。</>
            ) : (
              <>验证码已发到{' '}
                <span className="font-semibold text-me-charcoal">{pending.email}</span>。
                没收到的话看看垃圾邮件箱，QQ 和 163 邮箱最容易被拦。</>
            )
          ) : (
            <>We emailed a verification code to{' '}
              <span className="font-semibold text-me-charcoal">{pending.email}</span>.
              {' '}Enter it below to activate your account and receive your{' '}
              <strong>500 MTC</strong> welcome bonus.</>
          )}
        </p>

        <label htmlFor="code" className={`mt-5 block ${LABEL_CLS}`}>
          {zh ? '验证码' : 'Verification code'}
        </label>
        <input
          ref={codeInputRef}
          id="code"
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
          aria-label={zh ? '验证码' : 'Verification code'}
          className="mt-1.5 h-14 w-full rounded-xl border-[1.5px] border-me-charcoal/14 bg-white px-3 text-center font-display text-2xl font-bold tracking-[0.5em] text-me-charcoal outline-none transition focus:border-me-ochre focus:shadow-[0_0_0_3px_rgba(196,145,46,.12)] disabled:opacity-60"
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
          {verifying
            ? (zh ? '正在验证…' : 'Verifying…')
            : (zh ? '验证并进入' : 'Verify & continue →')}
        </button>

        <div className="mt-4 flex items-center justify-between text-sm">
          <button
            type="button"
            onClick={handleResend}
            disabled={resendCooldown > 0 || resending}
            className="font-semibold text-me-ochre transition disabled:cursor-not-allowed disabled:text-me-charcoal/35"
          >
            {resendCooldown > 0
              ? (zh ? `${resendCooldown} 秒后可重新发送` : `Resend code in ${resendCooldown}s`)
              : resending
                ? (zh ? '正在发送…' : 'Sending…')
                : (zh ? '重新发送验证码' : 'Resend code')}
          </button>
          <button
            type="button"
            onClick={handleBackToForm}
            disabled={verifying}
            className="font-semibold text-me-charcoal/45 transition hover:text-me-charcoal/70 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {zh ? '换一个邮箱' : 'Use a different email'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {authFailed && (
        <p className="rounded-xl border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2 text-sm font-semibold text-[#92400E]">
          {zh
            ? 'Google 登录没有完成，请再试一次，或改用邮箱验证码。'
            : 'Google sign-in did not complete. Please try again or use your email.'}
        </p>
      )}

      <GoogleSelfServeButton
        next={next}
        label={zh ? '用 Google 账号继续' : 'Continue with Google'}
      />
      {zh && (
        <p className="text-center text-xs text-me-charcoal/45">国内网络打不开 Google 的话，用下面的邮箱验证码注册。</p>
      )}

      <div className="flex items-center gap-3">
        <div className="h-px flex-1 bg-me-charcoal/10" />
        <span className="text-xs font-bold uppercase tracking-[0.12em] text-me-charcoal/35">
          {zh ? '或者' : 'or'}
        </span>
        <div className="h-px flex-1 bg-me-charcoal/10" />
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="businessName" className={LABEL_CLS}>
          {zh ? '公司或店铺名称' : 'Business name'}
        </label>
        <input
          id="businessName"
          name="businessName"
          type="text"
          required
          value={form.businessName}
          onChange={handleChange}
          placeholder={zh ? '例如：奥克兰美容坊' : 'Acme Co'}
          className={INPUT_CLS}
        />
      </div>

      <div>
        <label htmlFor="email" className={LABEL_CLS}>
          {zh ? '常用邮箱' : 'Email address'}
        </label>
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
          {zh ? (
            '公司网站（没有可以不填）'
          ) : (
            <>Website URL <span className="font-medium text-me-charcoal/40">(optional)</span></>
          )}
        </label>
        <input
          id="websiteUrl"
          name="websiteUrl"
          type="url"
          value={form.websiteUrl}
          onChange={handleChange}
          placeholder={zh ? 'https://' : 'https://yoursite.com.au'}
          className={INPUT_CLS}
        />
      </div>

      {error && (
        <p className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-sm font-semibold text-[#B91C1C]">
          {zh && errorCode === 'staff_account' ? (
            <>
              这个邮箱请从登录页登录：
              <Link
                href={`/login?next=${encodeURIComponent(next)}`}
                className="font-semibold text-me-ochre no-underline hover:underline"
              >
                员工登录
              </Link>
            </>
          ) : (
            error
          )}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="flex h-12 w-full items-center justify-center rounded-xl text-sm font-bold text-[#2A2008] shadow-[0_18px_50px_rgba(196,145,46,.22)] transition active:translate-y-px disabled:cursor-wait disabled:opacity-60"
        style={{ background: 'linear-gradient(135deg,#EBCB8B,#C4912E 55%,#A6781F)' }}
      >
        {loading
          ? (zh ? '正在发送验证码…' : 'Creating account…')
          : (zh ? '免费注册，开始体检' : 'Create account — free')}
      </button>
      </form>
    </div>
  )
}
