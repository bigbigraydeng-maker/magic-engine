'use client'

import { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { normalizeChinaPhone } from '@/lib/auth/china-phone'

const INPUT_CLS = 'mt-1.5 h-12 w-full rounded-xl border-[1.5px] border-me-charcoal/14 bg-white px-3 text-sm text-me-charcoal outline-none transition focus:border-me-ochre focus:shadow-[0_0_0_3px_rgba(196,145,46,.12)]'
const LABEL_CLS = 'text-xs font-bold uppercase tracking-[0.12em] text-me-charcoal/55'

function browserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}

export default function PhoneRegisterForm({ next, zh }: { next: string; zh: boolean }) {
  const [phase, setPhase] = useState<'phone' | 'code' | 'workspace'>('phone')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [cooldown, setCooldown] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [reauthRequired, setReauthRequired] = useState(false)

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = window.setTimeout(() => setCooldown(value => value - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [cooldown])

  useEffect(() => {
    let active = true
    void browserClient().auth.getUser().then(({ data }) => {
      const user = data.user
      if (active && user?.phone_confirmed_at) {
        setPhone(user.phone ?? '')
        setPhase('workspace')
      }
    })
    return () => { active = false }
  }, [])

  async function sendCode() {
    const normalized = normalizeChinaPhone(phone)
    if (!normalized) {
      setError(zh ? '请输入有效的中国大陆手机号。' : 'Enter a valid mainland China mobile number.')
      return
    }
    if (cooldown > 0 || loading) return

    setLoading(true)
    setError('')
    setNotice('')
    try {
      const { error: sendError } = await browserClient().auth.signInWithOtp({
        phone: normalized,
        options: { shouldCreateUser: true },
      })
      if (sendError) {
        setError(zh ? '暂时无法发送验证码，请稍后再试。' : 'We could not send a code. Please try again later.')
        return
      }
      setPhone(normalized)
      setPhase('code')
      setCooldown(60)
      setNotice(zh ? `如果该手机号可以注册，验证码会发送到 ${normalized}。` : `If this number can register, a code will be sent to ${normalized}.`)
    } catch {
      setError(zh ? '网络不稳定，请稍后重试。' : 'Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  async function verifyCode(event: React.FormEvent) {
    event.preventDefault()
    const normalized = normalizeChinaPhone(phone)
    const token = code.trim()
    if (!normalized || !/^\d{4,8}$/.test(token)) {
      setError(zh ? '请输入短信中的验证码。' : 'Enter the SMS verification code.')
      return
    }
    setLoading(true)
    setError('')
    try {
      const { error: verifyError } = await browserClient().auth.verifyOtp({ phone: normalized, token, type: 'sms' })
      if (verifyError) {
        setError(zh ? '验证码不正确或已过期，请重试。' : 'The code is incorrect or expired. Please try again.')
        setCode('')
        return
      }
      setPhase('workspace')
    } catch {
      setError(zh ? '暂时无法验证，请重试。' : 'We could not verify the code. Please retry.')
    } finally {
      setLoading(false)
    }
  }

  async function createWorkspace(event: React.FormEvent) {
    event.preventDefault()
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/auth/phone-register/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessName, websiteUrl, next }),
      })
      const result = await response.json().catch(() => ({})) as { redirect?: string; code?: string }
      if (!response.ok) {
        if (result.code === 'phone_verification_required') setReauthRequired(true)
        const messages: Record<string, string> = {
          business_exists: zh ? '这个工作区名称已经被使用，请换一个名称。' : 'That workspace name is already in use. Choose another.',
          phone_verification_required: zh ? '请先完成手机验证。' : 'Verify your phone first.',
          lookup_failed: zh ? '暂时无法检查账号，请重试。' : 'We could not check your account. Please retry.',
        }
        setError(messages[result.code ?? ''] ?? (zh ? '工作区设置失败，请保持登录后重试。' : 'Workspace setup failed. Stay signed in and retry.'))
        return
      }
      if (!result.redirect || !result.redirect.startsWith('/') || result.redirect.startsWith('//')) {
        setError(zh ? '工作区已创建，请重新登录进入。' : 'Workspace created. Sign in again to continue.')
        return
      }
      window.location.href = result.redirect
    } catch {
      setError(zh ? '网络不稳定，请保持登录后重试。' : 'Network error. Stay signed in and retry.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section aria-label={zh ? '手机号注册' : 'Phone registration'} className="rounded-2xl border border-me-charcoal/10 bg-white p-5 shadow-sm">
      <h3 className="font-display text-lg font-bold text-me-charcoal">
        {phase === 'workspace' ? (zh ? '设置工作区' : 'Set up your workspace') : (zh ? '用手机号注册' : 'Register with your phone')}
      </h3>
      {phase === 'phone' && (
        <form className="mt-4 space-y-4" onSubmit={event => { event.preventDefault(); void sendCode() }}>
          <label className="block">
            <span className={LABEL_CLS}>{zh ? '中国大陆手机号' : 'Mainland China mobile number'}</span>
            <input className={INPUT_CLS} type="tel" autoComplete="tel-national" inputMode="tel" value={phone} onChange={event => setPhone(event.target.value)} placeholder="+86 138 0000 0000" />
          </label>
          <button className="h-12 w-full rounded-xl text-sm font-bold text-[#2A2008] disabled:opacity-60" style={{ background: 'linear-gradient(135deg,#EBCB8B,#C4912E 55%,#A6781F)' }} disabled={loading || cooldown > 0}>
            {loading ? (zh ? '正在发送…' : 'Sending…') : cooldown > 0 ? (zh ? `${cooldown} 秒后可重发` : `Resend in ${cooldown}s`) : (zh ? '发送验证码' : 'Send code')}
          </button>
        </form>
      )}
      {phase === 'code' && (
        <form className="mt-4 space-y-4" onSubmit={event => void verifyCode(event)}>
          <p className="text-sm text-me-charcoal/65">{notice}</p>
          <label className="block">
            <span className={LABEL_CLS}>{zh ? '短信验证码' : 'SMS verification code'}</span>
            <input className={INPUT_CLS} type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 8))} />
          </label>
          <div className="flex gap-3">
            <button type="button" className="h-12 rounded-xl border border-me-charcoal/15 px-4 text-sm font-semibold" onClick={() => { setPhase('phone'); setCode(''); setError(''); setNotice('') }}>{zh ? '改手机号' : 'Change number'}</button>
            <button className="h-12 flex-1 rounded-xl text-sm font-bold text-[#2A2008] disabled:opacity-60" style={{ background: 'linear-gradient(135deg,#EBCB8B,#C4912E 55%,#A6781F)' }} disabled={loading || code.length < 4}>{loading ? (zh ? '正在验证…' : 'Verifying…') : (zh ? '验证手机号' : 'Verify phone')}</button>
          </div>
          <button type="button" className="text-sm font-semibold text-me-ochre disabled:text-me-charcoal/35" disabled={loading || cooldown > 0} onClick={() => void sendCode()}>{cooldown > 0 ? (zh ? `${cooldown} 秒后可重发` : `Resend in ${cooldown}s`) : (zh ? '重新发送验证码' : 'Resend code')}</button>
        </form>
      )}
      {phase === 'workspace' && (
        <form className="mt-4 space-y-4" onSubmit={event => void createWorkspace(event)}>
          <p className="text-sm text-me-charcoal/65">{zh ? '手机号已验证。填写公司或工作区名称即可继续。' : 'Your phone is verified. Add a business or workspace name to continue.'}</p>
          <label className="block">
            <span className={LABEL_CLS}>{zh ? '公司或工作区名称' : 'Business or workspace name'}</span>
            <input className={INPUT_CLS} required minLength={2} maxLength={120} value={businessName} onChange={event => setBusinessName(event.target.value)} />
          </label>
          <label className="block">
            <span className={LABEL_CLS}>{zh ? '网站（选填）' : 'Website (optional)'}</span>
            <input className={INPUT_CLS} type="url" value={websiteUrl} onChange={event => setWebsiteUrl(event.target.value)} placeholder="https://" />
          </label>
          <button className="h-12 w-full rounded-xl text-sm font-bold text-[#2A2008] disabled:opacity-60" style={{ background: 'linear-gradient(135deg,#EBCB8B,#C4912E 55%,#A6781F)' }} disabled={loading || businessName.trim().length < 2}>
            {loading ? (zh ? '正在创建…' : 'Creating…') : (zh ? '创建工作区' : 'Create workspace')}
          </button>
        </form>
      )}
      {error && <p role="alert" className="mt-3 rounded-xl border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-sm font-semibold text-[#B91C1C]">{error}</p>}
      {reauthRequired && phase === 'workspace' && (
        <button type="button" className="mt-3 text-sm font-semibold text-me-ochre hover:underline" onClick={() => { setPhase('phone'); setCode(''); setReauthRequired(false); setError('') }}>
          {zh ? '重新验证手机号' : 'Verify your phone again'}
        </button>
      )}
      {phase === 'workspace' && <p className="mt-3 text-xs text-me-charcoal/45">{zh ? '手机号是当前登录方式。请妥善保管号码；号码回收可能影响账号访问。' : 'Your phone is your sign-in method. Keep control of this number to retain account access.'}</p>}
    </section>
  )
}
