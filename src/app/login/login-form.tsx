'use client'

import { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'

/**
 * 登录方式说明（见 issue #674）
 *
 * magic link 在 Microsoft 365 租户上不可靠：信被 EOP 收下后在内部过滤/改道，
 * Resend 显示「已投递」但用户收不到，隔离区也查不到。ME 五个客户域名里四个在
 * M365，所以这不是个例而是结构性问题。
 *
 * 因此默认登录方式改为**密码** —— 把邮件从「每次登录」的路径上彻底移除。
 * magic link 保留为兜底，Google OAuth 保留（只有 workvisas.work 一家在用）。
 */

type Mode = 'password' | 'magic'
type Locale = 'en' | 'zh-CN'

const loginCopy = {
  en: {
    magicExpired: 'Magic link has expired. Please request a new one.', authFailed: 'Authentication failed. Please try again.',
    invalidCredentials: 'Email or password is incorrect.', signInFailed: 'Sign in failed. Please try again.', sendFailed: 'Unable to send link. Please try again.',
    checkEmail: 'Check your email', linkSent: 'Magic link sent to', expires: 'Expires in 15 minutes.', redirecting: 'Redirecting…', google: 'Continue with Google',
    or: 'or', email: 'Email address', password: 'Password', signingIn: 'Signing in…', sending: 'Sending…', signIn: 'Sign in →', sendLink: 'Send magic link →',
    emailLink: 'Email me a link instead', passwordLogin: 'Sign in with password',
  },
  'zh-CN': {
    magicExpired: '登录链接已过期，请重新申请。', authFailed: '身份验证失败，请重试。',
    invalidCredentials: '邮箱或密码不正确。', signInFailed: '登录失败，请重试。', sendFailed: '无法发送登录链接，请重试。',
    checkEmail: '请检查邮箱', linkSent: '登录链接已发送至', expires: '链接将在 15 分钟后失效。', redirecting: '正在跳转…', google: '使用 Google 账号继续',
    or: '或', email: '邮箱地址', password: '密码', signingIn: '正在登录…', sending: '正在发送…', signIn: '登录 →', sendLink: '发送登录链接 →',
    emailLink: '改用邮箱登录链接', passwordLogin: '改用密码登录',
  },
} as const

export default function LoginForm({ next, authFailed, locale = 'en' }: { next: string; authFailed?: boolean; locale?: Locale }) {
  const copy = loginCopy[locale]
  const [mode, setMode]             = useState<Mode>('password')
  const [email, setEmail]           = useState('')
  const [password, setPassword]     = useState('')
  const [sent, setSent]             = useState(false)
  const [error, setError]           = useState('')
  const [loading, setLoading]       = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)

  useEffect(() => {
    const hash = window.location.hash
    if (!hash) return
    const params = new URLSearchParams(hash.slice(1))
    const code = params.get('error_code')
    if (code === 'otp_expired') {
      setError(copy.magicExpired)
    } else if (code) {
      setError(copy.authFailed)
    }
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  }, [copy.authFailed, copy.magicExpired])

  function handleGoogleLogin() {
    setGoogleLoading(true)
    setError('')
    window.location.href = `/api/auth/google-login?next=${encodeURIComponent(next)}`
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

      const res = await fetch(`/api/auth/session-route?next=${encodeURIComponent(next)}`, {
        credentials: 'include',
      })
      window.location.href = res.redirected ? res.url : next
    } catch {
      setError(copy.signInFailed)
    } finally {
      setLoading(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const redirectTo = `${window.location.origin}/auth/implicit-callback?next=${encodeURIComponent(next)}`
      const res = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), redirectTo }),
      })
      if (!res.ok) {
        setError(copy.sendFailed)
      } else {
        setSent(true)
      }
    } catch {
      setError(copy.sendFailed)
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
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
          {copy.checkEmail}
        </h3>
        <p className="mt-2 text-sm leading-6" style={{ color: 'rgba(22,24,29,.60)' }}>
          {copy.linkSent}{' '}
          <span className="font-semibold" style={{ color: '#16181D' }}>{email}</span>{locale === 'zh-CN' ? '。' : '.'}
          {' '}{copy.expires}
        </p>
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
        {googleLoading ? copy.redirecting : copy.google}
      </button>

      {/* Divider */}
      <div className="flex items-center gap-3 my-1">
        <div className="h-px flex-1" style={{ background: 'rgba(22,24,29,.12)' }} />
        <span className="text-xs font-bold uppercase tracking-[0.12em]" style={{ color: 'rgba(22,24,29,.35)' }}>{copy.or}</span>
        <div className="h-px flex-1" style={{ background: 'rgba(22,24,29,.12)' }} />
      </div>

      {/* Email form */}
      <form onSubmit={mode === 'password' ? handlePasswordLogin : handleSubmit} className="flex flex-col gap-3">
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

        {mode === 'password' && (
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
        )}

        {(error || authFailed) && (
          <p
            className="rounded-xl border px-3 py-2 text-sm font-semibold"
            style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C' }}
          >
            {error || copy.authFailed}
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
          {loading
            ? (mode === 'password' ? copy.signingIn : copy.sending)
            : (mode === 'password' ? copy.signIn : copy.sendLink)}
        </button>

        <div className="flex items-center justify-between pt-1 text-xs font-semibold">
          <button
            type="button"
            onClick={() => { setMode(mode === 'password' ? 'magic' : 'password'); setError('') }}
            style={{ color: 'rgba(22,24,29,.55)' }}
            className="underline underline-offset-2 hover:opacity-70"
          >
            {mode === 'password' ? copy.emailLink : copy.passwordLogin}
          </button>
          {/*
            暂不放「忘记密码」入口：/api/auth/forgot-password 有接口但没有页面，
            链过去是 404。而且重置链接同样走邮件，在 M365 上有一样的投递问题
            （issue #674）。初始密码由管理员在 Supabase 后台设置并直接交给本人。
          */}
        </div>
      </form>
    </div>
  )
}
