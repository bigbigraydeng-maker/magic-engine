'use client'

/**
 * 「用 CTS 号码拨打」：先打到你自己登记过的手机，你接起后系统再接通客人，通话自动录音并记进时间线。
 * 点一次只发一次请求；结果用人话写在按钮旁边。
 */

import { useState } from 'react'

export function CallButton({ clientId, contactId }: { clientId: string; contactId: string }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function dial() {
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/crm/contacts/${contactId}/call`, { method: 'POST' })
      const j = (await res.json().catch(() => ({}))) as { message?: string; error?: string }
      setMsg(res.ok ? { ok: true, text: j.message ?? '正在拨打' } : { ok: false, text: j.error ?? '拨打没成功，请重试' })
    } catch {
      setMsg({ ok: false, text: '拨打没成功，请重试' })
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
      {msg && <span className={`text-xs font-semibold ${msg.ok ? 'text-me-charcoal/70' : 'text-[#C2453A]'}`}>{msg.text}</span>}
    </div>
  )
}
