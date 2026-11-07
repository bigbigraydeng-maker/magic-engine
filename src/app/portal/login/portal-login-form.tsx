'use client'

import { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { normalizeChinaPhone } from '@/lib/auth/china-phone'
import { GoogleSelfServeButton } from '@/components/auth/GoogleSelfServeButton'

interface Props {
  next: string
  authFailed?: boolean
  phoneEnabled?: boolean
  emailCodeFirst?: boolean
}

type LoginMode = 'phone' | 'email' | 'email-code'

export default function PortalLoginForm({ next, authFailed, phoneEnabled = true, emailCodeFirst = false }: Props) {
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [emailCode, setEmailCode] = useState('')
  const [emailCodeSent, setEmailCodeSent] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)
  const [mode, setMode] = useState<LoginMode>(() =>
    phoneEnabled && !emailCodeFirst ? 'phone' : 'email-code',
  )
  const [error, setError] = useState('')
  const [sendNotice, setSendNotice] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (resendCooldown <= 0) return
    const timer = window.setTimeout(() => setResendCooldown(value => value - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [resendCooldown])

  function browserClient() {
    return createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )
  }

  /** Hand the freshly-created browser session to the server so cookies sync. */
  async function completeSignIn() {
    const res = await fetch(`/api/auth/session-route?next=${encodeURIComponent(next)}`, {
      credentials: 'include',
      cache: 'no-store',
    })
    if (!res.ok) throw new Error('Session could not be started')
    const data = await res.json() as { redirect?: unknown }
    if (typeof data.redirect !== 'string' || !data.redirect.startsWith('/') || data.redirect.startsWith('//')) {
      throw new Error('Invalid sign-in destination')
    }
    window.location.href = data.redirect
  }

  async function handleSendCode() {
    const normalized = normalizeChinaPhone(phone)
    if (!normalized) {
      setError('请输入有效的中国大陆手机号。')
      return
    }

    setLoading(true)
    setError('')
    setSendNotice('如果手机号已注册，验证码会发送到手机。已有邮箱账号也可以切换邮箱登录。')
    setResendCooldown(60)
    if (!codeSent) {
      setPhone(normalized)
      setCodeSent(true)
      setResendCooldown(60)
    }
    try {
      const { error: sendError } = await browserClient().auth.signInWithOtp({
        phone: normalized,
        options: { shouldCreateUser: false },
      })
      if (sendError) return
    } catch {
      // Keep the same visible result for unknown numbers and transient failures.
    } finally {
      setLoading(false)
    }
  }

  async function handlePhoneSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!codeSent) {
      await handleSendCode()
      return
    }

    const normalized = normalizeChinaPhone(phone)
    const token = code.trim()
    if (!normalized || !/^\d{4,8}$/.test(token)) {
      setError('请输入收到的短信验证码。')
      return
    }

    setLoading(true)
    setError('')
    try {
      const { error: verifyError } = await browserClient().auth.verifyOtp({
        phone: normalized,
        token,
        type: 'sms',
      })
      if (verifyError) {
        setError('手机号或验证码不正确，或手机号尚未注册。请检查号码后重试；已有邮箱账号可以切换邮箱登录。')
        return
      }
      await completeSignIn()
    } catch {
      setError('登录失败，请稍后重试。')
    } finally {
      setLoading(false)
    }
  }

  async function handleEmailSubmit(event: React.FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError('')
    try {
      const { error: signInError } = await browserClient().auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      })
      if (signInError) {
        setError('邮箱或密码不正确。')
        return
      }

      await completeSignIn()
    } catch {
      setError('登录失败，请稍后重试。')
    } finally {
      setLoading(false)
    }
  }

  async function sendEmailCode() {
    const normalized = email.trim().toLowerCase()
    if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      setError('请输入有效邮箱地址。')
      return
    }
    if (resendCooldown > 0 || loading) return

    setLoading(true)
    setError('')
    try {
      const { error: sendError } = await browserClient().auth.signInWithOtp({
        email: normalized,
        options: { shouldCreateUser: false },
      })
      setEmail(normalized)
      setEmailCodeSent(true)
      setEmailCode('')
      setResendCooldown(60)
      if (sendError) {
        // Keep the message identical for existing and unknown email addresses.
        setError('如果邮箱已关联客户账号，验证码会发送到邮箱。请查看收件箱和垃圾邮件。')
      }
    } catch {
      setError('暂时无法发送邮箱验证码，请稍后重试。')
    } finally {
      setLoading(false)
    }
  }

  async function handleEmailCodeSubmit(event: React.FormEvent) {
    event.preventDefault()
    const token = emailCode.trim()
    if (!emailCodeSent || !/^\d{6,10}$/.test(token)) {
      setError('请输入邮箱收到的验证码。')
      return
    }
    setLoading(true)
    setError('')
    try {
      const { error: verifyError } = await browserClient().auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token,
        type: 'email',
      })
      if (verifyError) {
        setError('邮箱或验证码不正确，或验证码已过期。')
        return
      }
      await completeSignIn()
    } catch {
      setError('登录失败，请稍后重试。')
    } finally {
      setLoading(false)
    }
  }

  function changePhone() {
    setCodeSent(false)
    setCode('')
    setResendCooldown(0)
    setError('')
    setSendNotice('')
  }

  function changeEmail() {
    setEmailCodeSent(false)
    setEmailCode('')
    setResendCooldown(0)
    setError('')
  }

  return (
    <div className="flex flex-col gap-3">
      {mode === 'phone' ? (
        <form onSubmit={handlePhoneSubmit} className="flex flex-col gap-3">
          <div>
            <label
              htmlFor="portal-phone"
              className="mb-1.5 block text-xs font-bold uppercase tracking-[0.12em] text-me-charcoal/55"
            >
              中国大陆手机号
            </label>
            <input
              id="portal-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              required
              disabled={codeSent || loading}
              value={phone}
              onChange={event => setPhone(event.target.value)}
              placeholder="+86 138 0000 0000"
              className="h-12 w-full rounded-xl border-[1.5px] border-me-charcoal/14 bg-white px-3 text-sm text-me-charcoal outline-none transition focus:border-me-ochre focus:shadow-[0_0_0_3px_rgba(196,145,46,.12)] disabled:bg-me-ivory"
            />
          </div>

          {codeSent && (
            <div>
              <label
                htmlFor="portal-phone-code"
                className="mb-1.5 block text-xs font-bold uppercase tracking-[0.12em] text-me-charcoal/55"
              >
                短信验证码
              </label>
              <input
                id="portal-phone-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{4,8}"
                minLength={4}
                maxLength={8}
                required
                value={code}
                onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 8))}
                placeholder="输入验证码"
                className="h-12 w-full rounded-xl border-[1.5px] border-me-charcoal/14 bg-white px-3 text-sm text-me-charcoal outline-none transition focus:border-me-ochre focus:shadow-[0_0_0_3px_rgba(196,145,46,.12)]"
              />
            </div>
          )}

          {sendNotice && <p role="status" className="text-xs leading-5 text-me-charcoal/55">{sendNotice}</p>}

          {(error || authFailed) && (
            <p role="alert" className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-sm font-semibold text-[#B91C1C]">
              {error || '登录失败，请重试。'}
            </p>
          )}

          {!codeSent ? (
            <button
              type="button"
              onClick={handleSendCode}
              disabled={loading}
              className="flex h-12 w-full items-center justify-center rounded-xl text-sm font-bold text-[#2A2008] shadow-[0_18px_50px_rgba(196,145,46,.22)] transition active:translate-y-px disabled:cursor-wait disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg,#EBCB8B,#C4912E 55%,#A6781F)' }}
            >
              {loading ? '正在发送…' : '发送验证码'}
            </button>
          ) : (
            <div className="flex flex-col gap-3">
              <button
                type="submit"
                disabled={loading}
                className="flex h-12 w-full items-center justify-center rounded-xl text-sm font-bold text-[#2A2008] shadow-[0_18px_50px_rgba(196,145,46,.22)] transition active:translate-y-px disabled:cursor-wait disabled:opacity-60"
                style={{ background: 'linear-gradient(135deg,#EBCB8B,#C4912E 55%,#A6781F)' }}
              >
                {loading ? '正在登录…' : '验证码登录'}
              </button>
              <button
                type="button"
                onClick={handleSendCode}
                disabled={loading || resendCooldown > 0}
                className="text-xs font-semibold text-me-ochre disabled:opacity-60"
              >
                {resendCooldown > 0 ? `${resendCooldown} 秒后可重新发送` : '重新发送验证码'}
              </button>
              <button
                type="button"
                onClick={changePhone}
                disabled={loading}
                className="text-xs font-semibold text-me-charcoal/55 disabled:opacity-60"
              >
                修改手机号
              </button>
            </div>
          )}
        </form>
      ) : mode === 'email-code' ? (
        <form onSubmit={handleEmailCodeSubmit} className="flex flex-col gap-3">
          <div>
            <label htmlFor="portal-email-code-address" className="mb-1.5 block text-xs font-bold uppercase tracking-[0.12em] text-me-charcoal/55">
              原账号邮箱
            </label>
            <input
              id="portal-email-code-address"
              type="email"
              required
              disabled={emailCodeSent || loading}
              value={email}
              onChange={event => setEmail(event.target.value)}
              placeholder="you@company.com"
              className="h-12 w-full rounded-xl border-[1.5px] border-me-charcoal/14 bg-white px-3 text-sm text-me-charcoal outline-none transition focus:border-me-ochre focus:shadow-[0_0_0_3px_rgba(196,145,46,.12)] disabled:bg-me-ivory"
            />
          </div>
          {emailCodeSent && (
            <div>
              <label htmlFor="portal-email-code" className="mb-1.5 block text-xs font-bold uppercase tracking-[0.12em] text-me-charcoal/55">
                邮箱验证码
              </label>
              <input
                id="portal-email-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6,10}"
                maxLength={10}
                required
                value={emailCode}
                onChange={event => setEmailCode(event.target.value.replace(/\D/g, '').slice(0, 10))}
                placeholder="输入验证码"
                className="h-12 w-full rounded-xl border-[1.5px] border-me-charcoal/14 bg-white px-3 text-sm text-me-charcoal outline-none transition focus:border-me-ochre focus:shadow-[0_0_0_3px_rgba(196,145,46,.12)]"
              />
            </div>
          )}
          {(error || authFailed) && (
            <p role="alert" className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-sm font-semibold text-[#B91C1C]">
              {error || '登录失败，请重试。'}
            </p>
          )}
          {!emailCodeSent ? (
            <button
              type="button"
              onClick={() => void sendEmailCode()}
              disabled={loading || resendCooldown > 0}
              className="flex h-12 w-full items-center justify-center rounded-xl text-sm font-bold text-[#2A2008] shadow-[0_18px_50px_rgba(196,145,46,.22)] transition active:translate-y-px disabled:cursor-wait disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg,#EBCB8B,#C4912E 55%,#A6781F)' }}
            >
              {loading ? '正在发送…' : '发送邮箱验证码'}
            </button>
          ) : (
            <div className="flex flex-col gap-3">
              <button
                type="submit"
                disabled={loading}
                className="flex h-12 w-full items-center justify-center rounded-xl text-sm font-bold text-[#2A2008] shadow-[0_18px_50px_rgba(196,145,46,.22)] transition active:translate-y-px disabled:cursor-wait disabled:opacity-60"
                style={{ background: 'linear-gradient(135deg,#EBCB8B,#C4912E 55%,#A6781F)' }}
              >
                {loading ? '正在登录…' : '邮箱验证码登录'}
              </button>
              <button
                type="button"
                onClick={() => void sendEmailCode()}
                disabled={loading || resendCooldown > 0}
                className="text-xs font-semibold text-me-ochre disabled:opacity-60"
              >
                {resendCooldown > 0 ? `${resendCooldown} 秒后可重新发送` : '重新发送邮箱验证码'}
              </button>
              <button
                type="button"
                onClick={changeEmail}
                disabled={loading}
                className="text-xs font-semibold text-me-charcoal/55 disabled:opacity-60"
              >
                修改邮箱
              </button>
            </div>
          )}
        </form>
      ) : (
        <form onSubmit={handleEmailSubmit} className="flex flex-col gap-3">
          <div>
            <label htmlFor="portal-email" className="mb-1.5 block text-xs font-bold uppercase tracking-[0.12em] text-me-charcoal/55">
              邮箱地址
            </label>
            <input
              id="portal-email"
              type="email"
              required
              value={email}
              onChange={event => setEmail(event.target.value)}
              placeholder="you@company.com"
              className="h-12 w-full rounded-xl border-[1.5px] border-me-charcoal/14 bg-white px-3 text-sm text-me-charcoal outline-none transition focus:border-me-ochre focus:shadow-[0_0_0_3px_rgba(196,145,46,.12)]"
            />
          </div>
          <div>
            <label htmlFor="portal-password" className="mb-1.5 block text-xs font-bold uppercase tracking-[0.12em] text-me-charcoal/55">
              密码
            </label>
            <input
              id="portal-password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={event => setPassword(event.target.value)}
              placeholder="••••••••"
              className="h-12 w-full rounded-xl border-[1.5px] border-me-charcoal/14 bg-white px-3 text-sm text-me-charcoal outline-none transition focus:border-me-ochre focus:shadow-[0_0_0_3px_rgba(196,145,46,.12)]"
            />
          </div>
          {(error || authFailed) && (
            <p role="alert" className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-sm font-semibold text-[#B91C1C]">
              {error || '登录失败，请重试。'}
            </p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="flex h-12 w-full items-center justify-center rounded-xl text-sm font-bold text-[#2A2008] shadow-[0_18px_50px_rgba(196,145,46,.22)] transition active:translate-y-px disabled:cursor-wait disabled:opacity-60"
            style={{ background: 'linear-gradient(135deg,#EBCB8B,#C4912E 55%,#A6781F)' }}
          >
            {loading ? '正在登录…' : '邮箱和密码登录 →'}
          </button>
        </form>
      )}

      <div className="flex items-center gap-3 py-1">
        <div className="h-px flex-1 bg-me-charcoal/10" />
        <span className="text-xs font-bold uppercase tracking-[0.12em] text-me-charcoal/35">或</span>
        <div className="h-px flex-1 bg-me-charcoal/10" />
      </div>

      <GoogleSelfServeButton next={next} label="用 Google 账号继续" />
      <button
        type="button"
        onClick={() => {
          setMode(mode === 'phone' ? 'email-code' : mode === 'email-code' ? 'email' : phoneEnabled ? 'phone' : 'email-code')
          setError('')
        }}
        className="self-center text-xs font-semibold text-me-ochre hover:underline"
      >
        {mode === 'phone'
          ? '改用原邮箱验证码登录'
          : mode === 'email-code'
            ? '改用邮箱和密码登录'
            : phoneEnabled ? '改用手机验证码登录' : '改用邮箱验证码登录'}
      </button>
    </div>
  )
}
