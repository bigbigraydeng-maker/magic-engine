'use client'

/**
 * 「用 CTS 号码拨打」：先打到你自己登记过的手机，你接起后系统再接通客人，通话自动录音并记进时间线。
 * 点一次只发一次请求；结果用人话写在按钮旁边。
 */

import { useState } from 'react'

export function CallButton({ clientId, contactId, onDialed }: { clientId: string; contactId: string; onDialed?: () => void }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  // 员工还没登记接电话的手机时，就地填一次（以前要「请管理员登记」，可后台根本没有地方填）。
  const [needPhone, setNeedPhone] = useState(false)
  const [phone, setPhone] = useState('')

  async function dial() {
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/crm/contacts/${contactId}/call`, { method: 'POST' })
      const j = (await res.json().catch(() => ({}))) as { message?: string; error?: string; code?: string }
      setNeedPhone(!res.ok && j.code === 'staff_phone_missing')
      setMsg(res.ok ? { ok: true, text: '已发起：先响你登记的手机，接起后自动接通客人。挂断后这里会显示「整理中」，约 2 分钟变成正式记录，不用等，可以直接去下一位。' } : { ok: false, text: j.error ?? '拨打没成功，请重试' })
      if (res.ok) onDialed?.()
    } catch {
      setMsg({ ok: false, text: '拨打没成功，请重试' })
    } finally {
      setBusy(false)
    }
  }

  async function savePhone() {
    setBusy(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/crm/my-phone`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone }),
      })
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      if (res.ok) {
        setNeedPhone(false)
        setMsg({ ok: true, text: '手机号已登记，现在可以点上面的按钮拨打了' })
      } else {
        setMsg({ ok: false, text: j.error ?? '登记没成功，请重试' })
      }
    } catch {
      setMsg({ ok: false, text: '登记没成功，请重试' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={dial}
        className="rounded-lg bg-me-charcoal px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {busy ? '正在发起…' : '📞 用 CTS 号码拨打（自动录音）'}
      </button>
      {needPhone && (
        <div className="flex w-full items-center gap-2" data-testid="staff-phone-form">
          <input
            type="tel"
            inputMode="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="你的手机号，如 021 234 5678"
            aria-label="你接电话的手机号"
            className="min-w-0 flex-1 rounded-lg border border-me-charcoal/20 px-3 py-2 text-sm"
          />
          <button
            type="button"
            disabled={busy || phone.trim() === ''}
            onClick={savePhone}
            className="rounded-lg border border-me-charcoal px-3 py-2 text-sm font-semibold text-me-charcoal disabled:opacity-50"
          >
            登记我的手机
          </button>
        </div>
      )}
      {msg && <span className={`w-full text-xs font-semibold ${msg.ok ? 'text-me-charcoal/70' : 'text-[#C2453A]'}`}>{msg.ok ? '✓ ' : ''}{msg.text}</span>}
    </div>
  )
}
