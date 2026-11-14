'use client'

import { useEffect, useState } from 'react'
import { normalizeChinaPhone } from '@/lib/auth/china-phone'

interface Props {
  isLinked: boolean
  maskedPhone: string | null
}

async function postJson(path: string, body: Record<string, string>) {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data: unknown = await response.json().catch(() => null)
  const payload = typeof data === 'object' && data !== null && !Array.isArray(data)
    ? data as Record<string, unknown>
    : {}
  return { response, payload }
}

export default function PhoneLinkForm({ isLinked, maskedPhone }: Props) {
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [sent, setSent] = useState(false)
  const [linked, setLinked] = useState(isLinked)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [resendCooldown, setResendCooldown] = useState(0)

  useEffect(() => {
    if (resendCooldown <= 0) return
    const timer = window.setTimeout(() => setResendCooldown(value => value - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [resendCooldown])

  async function sendCode() {
    const normalized = normalizeChinaPhone(phone)
    if (!normalized) {
      setError('请输入有效的中国大陆手机号。')
      return
    }

    setBusy(true)
    setError('')
    setResendCooldown(60)
    try {
      const { response, payload } = await postJson('/api/auth/phone-link/send', { phone: normalized })
      if (!response.ok) {
        setError(typeof payload.error === 'string' ? payload.error : '验证码发送失败，请稍后重试。')
        return
      }
      if (payload.alreadyLinked === true) {
        setLinked(true)
        return
      }
      setPhone(normalized)
      setSent(true)
    } catch {
      setError('验证码发送失败，请稍后重试。')
    } finally {
      setBusy(false)
    }
  }

  function changePhone() {
    setSent(false)
    setCode('')
    setResendCooldown(0)
    setError('')
  }

  async function verifyCode(event: React.FormEvent) {
    event.preventDefault()
    const normalized = normalizeChinaPhone(phone)
    if (!normalized || !/^\d{4,8}$/.test(code.trim())) {
      setError('请检查手机号和验证码。')
      return
    }

    setBusy(true)
    setError('')
    try {
      const { response, payload } = await postJson('/api/auth/phone-link/verify', {
        phone: normalized,
        code: code.trim(),
      })
      if (!response.ok) {
        setError(typeof payload.error === 'string' ? payload.error : '手机号绑定失败，请稍后重试。')
        return
      }
      setLinked(true)
      setSent(false)
      setCode('')
    } catch {
      setError('手机号绑定失败，请稍后重试。')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="w-full max-w-lg rounded-2xl border border-me-charcoal/10 bg-white p-6 shadow-sm">
      {linked ? (
        <div>
          <p className="text-sm font-semibold text-emerald-700">手机号已绑定</p>
          <p className="mt-2 text-sm text-me-charcoal/65">以后可以用 {maskedPhone ?? '已验证手机号'} 接收验证码登录。</p>
        </div>
      ) : (
        <form onSubmit={verifyCode} className="space-y-4">
          <div>
            <label htmlFor="phone-link-phone" className="mb-1.5 block text-sm font-semibold text-me-charcoal">
              中国大陆手机号
            </label>
            <input
              id="phone-link-phone"
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              required
              disabled={sent || busy}
              value={phone}
              onChange={event => setPhone(event.target.value)}
              placeholder="+86 138 0000 0000"
              className="h-12 w-full rounded-xl border border-me-charcoal/15 px-3 text-sm outline-none focus:border-me-ochre disabled:bg-me-ivory"
            />
          </div>

          {sent && (
            <div>
              <label htmlFor="phone-link-code" className="mb-1.5 block text-sm font-semibold text-me-charcoal">
                短信验证码
              </label>
              <input
                id="phone-link-code"
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
                className="h-12 w-full rounded-xl border border-me-charcoal/15 px-3 text-sm outline-none focus:border-me-ochre"
              />
            </div>
          )}

          {error && <p role="alert" className="text-sm font-medium text-red-700">{error}</p>}

          {!sent ? (
            <button
              type="button"
              onClick={sendCode}
              disabled={busy || resendCooldown > 0}
              className="h-12 w-full rounded-xl bg-me-charcoal text-sm font-bold text-white disabled:opacity-60"
            >
              {busy ? '正在发送…' : resendCooldown > 0 ? `${resendCooldown} 秒后可重新发送` : '发送验证码'}
            </button>
          ) : (
            <div className="space-y-3">
              <button
                type="submit"
                disabled={busy}
                className="h-12 w-full rounded-xl bg-me-charcoal text-sm font-bold text-white disabled:opacity-60"
              >
                {busy ? '正在验证…' : '验证并绑定手机号'}
              </button>
              <button
                type="button"
                onClick={sendCode}
                disabled={busy || resendCooldown > 0}
                className="w-full text-sm font-semibold text-me-ochre disabled:opacity-60"
              >
                {resendCooldown > 0 ? `${resendCooldown} 秒后可重新发送` : '重新发送验证码'}
              </button>
              <button
                type="button"
                onClick={changePhone}
                disabled={busy}
                className="w-full text-sm font-semibold text-me-charcoal/55 disabled:opacity-60"
              >
                修改手机号
              </button>
            </div>
          )}
          <p className="text-xs leading-5 text-me-charcoal/50">
            手机号会绑定到当前客户账号，不能自行更换。若号码停用或被回收，请联系管理员核实身份处理。
          </p>
        </form>
      )}
    </section>
  )
}
