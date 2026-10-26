'use client'

import { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { isSafeInternalPath } from '@/lib/auth/safe-internal-path'

type Locale = 'en' | 'zh-CN'

const loginCopy = {
  en: {
    authFailed: 'Authentication failed. Please try again.',
    invalidCredentials: 'Email or password is incorrect.', signInFailed: 'Sign in failed. Please try again.',
    redirecting: 'Redirecting…', google: 'Continue with Google',
    or: 'or', email: 'Email address', password: 'Password', signingIn: 'Signing in…', signIn: 'Sign in →',
    resetHelp: 'Need a password? Ask your Magic Engine administrator to set or reset it.',
  },
  'zh-CN': {
    authFailed: '身份验证失败，请重试。',
    invalidCredentials: '邮箱或密码不正确。', signInFailed: '登录失败，请重试。',
    redirecting: '正在跳转…', google: '使用 Google 账号继续',
    or: '或', email: '邮箱地址', password: '密码', signingIn: '正在登录…', signIn: '登录 →',
    resetHelp: '还没有密码？请联系 Magic Engine 管理员设置或重置。',
  },
} as const

export default function LoginForm({ next, authFailed, locale = 'en' }: { next: string; authFailed?: boolean; locale?: Locale }) {
  const copy = loginCopy[locale]
  const [email, setEmail]           = useState('')
  const [password, setPassword]     = useState('')
  const [error, setError]           = useState('')
  const [loading, setLoading]       = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)

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
        cache: 'no-store',
      })
      if (!res.ok) throw new Error('Session could not be started')
      const data = await res.json() as { redirect?: unknown }
      if (!isSafeInternalPath(data.redirect)) {
        throw new Error('Invalid sign-in destination')
      }
      window.location.href = data.redirect
    } catch {
      setError(copy.signInFailed)
    } finally {
      setLoading(false)
    }
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
    </div>
  )
}
