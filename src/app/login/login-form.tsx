'use client'

import { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { normalizeChinaPhone } from '@/lib/auth/china-phone'

type Locale = 'en' | 'zh-CN'

const loginCopy = {
  en: {
    authFailed: 'Authentication failed. Please try again.',
    invalidCredentials: 'Email or password is incorrect.', signInFailed: 'Sign in failed. Please try again.',
    redirecting: 'Redirecting…', google: 'Continue with Google',
    or: 'or', email: 'Email address', password: 'Password', signingIn: 'Signing in…', signIn: 'Sign in →',
    resetHelp: 'Need a password? Ask your Magic Engine administrator to set or reset it.',
    phone: 'China mobile number', phonePlaceholder: '+86 138 0000 0000', code: 'SMS code', codePlaceholder: 'Enter the code',
    sendCode: 'Send SMS code', sendingCode: 'Sending…', phoneSignIn: 'Sign in with code', phoneSigningIn: 'Signing in…',
    resendCode: 'Resend code', usePhone: 'Use phone code instead', useEmail: 'Use email and password instead',
    invalidPhone: 'Enter a valid mainland China mobile number.',
    invalidPhoneCode: 'The phone or code is incorrect. Try again or use your original sign-in method.',
    phoneError: 'Phone sign-in failed. Please try again.',
  },
  'zh-CN': {
    authFailed: '身份验证失败，请重试。',
    invalidCredentials: '邮箱或密码不正确。', signInFailed: '登录失败，请重试。',
    redirecting: '正在跳转…', google: '使用 Google 账号继续',
    or: '或', email: '邮箱地址', password: '密码', signingIn: '正在登录…', signIn: '登录 →',
    resetHelp: '还没有密码？请联系 Magic Engine 管理员设置或重置。',
    phone: '中国大陆手机号', phonePlaceholder: '+86 138 0000 0000', code: '短信验证码', codePlaceholder: '输入验证码',
    sendCode: '发送验证码', sendingCode: '正在发送…', phoneSignIn: '验证码登录', phoneSigningIn: '正在登录…',
    resendCode: '重新发送验证码', usePhone: '改用手机验证码登录', useEmail: '改用邮箱和密码登录',
    invalidPhone: '请输入有效的中国大陆手机号。',
    invalidPhoneCode: '手机号或验证码不正确，请重试或改用原登录方式。',
    phoneError: '登录失败，请稍后重试。',
  },
} as const

export default function LoginForm({ next, authFailed, locale = 'en', phoneFirst = true, phoneEnabled = true }: { next: string; authFailed?: boolean; locale?: Locale; phoneFirst?: boolean; phoneEnabled?: boolean }) {
  const copy = loginCopy[locale]
  const canUsePhone = phoneFirst && phoneEnabled
  const [mode, setMode]           = useState<'phone' | 'email'>(canUsePhone ? 'phone' : 'email')
  const [phone, setPhone]         = useState('')
  const [code, setCode]           = useState('')
  const [codeSent, setCodeSent]   = useState(false)
  const [email, setEmail]           = useState('')
  const [password, setPassword]     = useState('')
  const [error, setError]           = useState('')
  const [sendNotice, setSendNotice] = useState('')
  const [loading, setLoading]       = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)

  useEffect(() => {
    if (resendCooldown <= 0) return
    const timer = window.setTimeout(() => setResendCooldown(value => value - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [resendCooldown])

  useEffect(() => {
    const hash = window.location.hash
    if (!hash) return
    const params = new URLSearchParams(hash.slice(1))
    if (params.has('error') || params.has('error_code')) {
      setError(copy.authFailed)
    }
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  }, [copy.authFailed])

  function handleGoogleLogin() {
    setGoogleLoading(true)
    setError('')
    window.location.href = `/api/auth/google-login?next=${encodeURIComponent(next)}`
  }

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
      setError(copy.invalidPhone)
      return
    }

    setLoading(true)
    setError('')
    setSendNotice(locale === 'zh-CN'
      ? '如果手机号已注册，验证码会发送到手机。已有邮箱账号也可以切换原登录方式。'
      : 'If your phone is registered, a code will be sent. Existing email accounts can use their original sign-in method.')
    setResendCooldown(60)
    if (!codeSent) {
      setPhone(normalized)
      setCodeSent(true)
      setResendCooldown(60)
    }
    try {
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      )
      const { error: sendError } = await supabase.auth.signInWithOtp({
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

  async function handlePhoneLogin(event: React.FormEvent) {
    event.preventDefault()
    const normalized = normalizeChinaPhone(phone)
    const token = code.trim()
    if (!normalized || !/^\d{4,8}$/.test(token)) {
      setError(copy.invalidPhoneCode)
      return
    }

    setLoading(true)
    setError('')
    try {
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      )
      const { error: verifyError } = await supabase.auth.verifyOtp({
        phone: normalized,
        token,
        type: 'sms',
      })
      if (verifyError) {
        setError(copy.invalidPhoneCode)
        return
      }
      await completeSignIn()
    } catch {
      setError(copy.phoneError)
    } finally {
      setLoading(false)
    }
  }

  /**
   * 密码登录。走浏览器端 signInWithPassword 建立会话，再打 session-route
   * 把 cookie 同步到服务端 —— 与 implicit-callback 完全一致的既有链路，
   * 不新增 API，也不让密码经过我们自己的服务器。
   */
  async function handlePasswordLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const supabase = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      )
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      })

      if (signInError) {
        // 不区分「账号不存在」和「密码错误」，避免暴露哪些邮箱已注册
        setError(copy.invalidCredentials)
        return
      }

      await completeSignIn()
    } catch {
      setError(copy.signInFailed)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {mode === 'phone' && (
        <form onSubmit={handlePhoneLogin} className="flex flex-col gap-3">
          <div>
            <label htmlFor="phone" className="block text-xs font-bold uppercase tracking-[0.12em] mb-1.5" style={{ color: 'rgba(22,24,29,.55)' }}>
              {copy.phone}
            </label>
            <input
              id="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              required
              disabled={codeSent || loading}
              value={phone}
              onChange={event => setPhone(event.target.value)}
              placeholder={copy.phonePlaceholder}
              className="h-12 w-full rounded-xl border bg-white px-3 text-sm outline-none transition disabled:bg-[#FBFAF7]"
              style={{ border: '1.5px solid rgba(22,24,29,.14)', color: '#16181D' }}
            />
          </div>

          {codeSent && (
            <div>
              <label htmlFor="phone-code" className="block text-xs font-bold uppercase tracking-[0.12em] mb-1.5" style={{ color: 'rgba(22,24,29,.55)' }}>
                {copy.code}
              </label>
              <input
                id="phone-code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{4,8}"
                minLength={4}
                maxLength={8}
                required
                value={code}
                onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 8))}
                placeholder={copy.codePlaceholder}
                className="h-12 w-full rounded-xl border bg-white px-3 text-sm outline-none transition"
                style={{ border: '1.5px solid rgba(22,24,29,.14)', color: '#16181D' }}
              />
            </div>
          )}

          {(error || authFailed) && (
            <p role="alert" className="rounded-xl border px-3 py-2 text-sm font-semibold" style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C' }}>
              {error || copy.authFailed}
            </p>
          )}

          {!codeSent ? (
            <button type="button" onClick={handleSendCode} disabled={loading} className="flex h-12 w-full items-center justify-center rounded-xl text-sm font-bold transition disabled:cursor-wait disabled:opacity-60" style={{ background: '#BE8A2E', color: '#fff' }}>
              {loading ? copy.sendingCode : copy.sendCode}
            </button>
          ) : (
            <div className="flex flex-col gap-3">
              <button type="submit" disabled={loading} className="flex h-12 w-full items-center justify-center rounded-xl text-sm font-bold transition disabled:cursor-wait disabled:opacity-60" style={{ background: '#BE8A2E', color: '#fff' }}>
                {loading ? copy.phoneSigningIn : copy.phoneSignIn}
              </button>
              <button type="button" onClick={handleSendCode} disabled={loading || resendCooldown > 0} className="text-xs font-semibold disabled:opacity-60" style={{ color: '#9A6F1E' }}>
                {resendCooldown > 0 ? `${resendCooldown} 秒后可重新发送` : copy.resendCode}
              </button>
              <button type="button" onClick={() => { setCodeSent(false); setCode(''); setResendCooldown(0); setError(''); setSendNotice('') }} disabled={loading} className="text-xs font-semibold disabled:opacity-60" style={{ color: '#6B7280' }}>
                修改手机号
              </button>
            </div>
          )}
        </form>
      )}

      {canUsePhone && (
        <button type="button" onClick={() => { setMode(mode === 'phone' ? 'email' : 'phone'); setError('') }} className="self-center text-xs font-semibold" style={{ color: '#9A6F1E' }}>
          {mode === 'phone' ? copy.useEmail : copy.usePhone}
        </button>
      )}

      {/* Divider */}
      <div className="flex items-center gap-3 my-1">
        <div className="h-px flex-1" style={{ background: 'rgba(22,24,29,.12)' }} />
        <span className="text-xs font-bold uppercase tracking-[0.12em]" style={{ color: 'rgba(22,24,29,.35)' }}>{copy.or}</span>
        <div className="h-px flex-1" style={{ background: 'rgba(22,24,29,.12)' }} />
      </div>

      {/* Google */}
      <button
        type="button"
        onClick={handleGoogleLogin}
        disabled={googleLoading}
        className="flex h-12 w-full items-center justify-center gap-3 rounded-xl border text-sm font-semibold transition"
        style={{ background: '#fff', border: '1.5px solid rgba(22,24,29,.15)', color: '#16181D' }}
      >
        <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
          <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.859-3.048.859-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
          <path d="M3.964 10.706A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.706V4.962H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.038l3.007-2.332z" fill="#FBBC05"/>
          <path d="M9 3.583c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.962L3.964 7.294C4.672 5.163 6.656 3.583 9 3.583z" fill="#EA4335"/>
        </svg>
        {googleLoading ? copy.redirecting : copy.google}
      </button>

      {mode === 'email' && (
      <form onSubmit={handlePasswordLogin} className="flex flex-col gap-3">
        <div>
          <label
            htmlFor="email"
            className="block text-xs font-bold uppercase tracking-[0.12em] mb-1.5"
            style={{ color: 'rgba(22,24,29,.55)' }}
          >
            {copy.email}
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

        <div>
            <label
              htmlFor="password"
              className="block text-xs font-bold uppercase tracking-[0.12em] mb-1.5"
              style={{ color: 'rgba(22,24,29,.55)' }}
            >
              {copy.password}
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="h-12 w-full rounded-xl border bg-white px-3 text-sm outline-none transition"
              style={{ border: '1.5px solid rgba(22,24,29,.14)', color: '#16181D' }}
              onFocus={e => { e.currentTarget.style.borderColor = '#BE8A2E'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(190,138,46,.12)' }}
              onBlur={e  => { e.currentTarget.style.borderColor = 'rgba(22,24,29,.14)'; e.currentTarget.style.boxShadow = 'none' }}
            />
        </div>

          {(error || authFailed) && (
          <p
            className="rounded-xl border px-3 py-2 text-sm font-semibold"
            style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C' }}
          >
            {error || copy.authFailed}
          </p>
          )}

          {sendNotice && <p role="status" className="text-xs leading-5" style={{ color: 'rgba(22,24,29,.55)' }}>{sendNotice}</p>}

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
          {loading ? copy.signingIn : copy.signIn}
        </button>

        <p className="pt-1 text-xs leading-5" style={{ color: 'rgba(22,24,29,.55)' }}>
          {copy.resetHelp}
        </p>
      </form>
      )}
    </div>
  )
}
