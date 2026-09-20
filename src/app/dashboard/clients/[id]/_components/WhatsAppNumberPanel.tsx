'use client'

/**
 * WhatsAppNumberPanel — FDE-managed binding for clients.whatsapp_phone_number_id.
 *
 * Setting this switches the WhatsApp pipeline on for a client. It says that in
 * those words rather than naming a database column.
 *
 * Two things make this panel worth more than a plain text box:
 *
 * 1. The value is NOT the phone number a customer dials. Meta shows both on the
 *    same screen, and pasting "+64 21 …" instead of the numeric Phone Number ID
 *    leaves inbound silently unrouted while the settings page looks correct.
 * 2. The binding must agree with the number this deployment holds a token for.
 *    When it does not, lib/whatsapp/send.ts refuses to send — deliberately, so
 *    one client can never message from another client's number. That refusal is
 *    invisible unless this panel shows the mismatch up front, which is exactly
 *    the "bound but dead" state FacebookPagePanel had to learn to report.
 *
 * Mirrors FacebookPagePanel.tsx, which sits next to it in the same drawer.
 */

import React, { useCallback, useEffect, useState } from 'react'

interface Props {
  clientId: string
}

interface Payload {
  phone_number_id: string | null
  /** 这套部署实际拿着令牌的那个号码 ID（来自环境变量）。 */
  configured_number_id: string | null
  /** 绑定的号码跟令牌对不对得上。null = 还没绑 / 环境没配，无从比较。 */
  matches_configured: boolean | null
}

type PanelState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; data: Payload }

/** 一句话说清现在这条线到底通没通 —— 「绑了」和「能用」是两件事。 */
function LiveStatus({ phone_number_id, configured_number_id, matches_configured }: Payload) {
  if (!phone_number_id) {
    return null
  }
  if (matches_configured === true) {
    return (
      <div className="mb-4 flex items-center gap-2 rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
        <span className="text-base">✓</span>
        <span className="font-semibold">已绑定，收发都能用</span>
      </div>
    )
  }
  if (configured_number_id === null) {
    return (
      <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        <p className="font-semibold">已绑定，但发不出去</p>
        <p className="mt-1 text-xs text-amber-700">服务器还没配 WhatsApp 凭据，消息进得来，回不出去。凭据配好前请先用电话或邮件回复。</p>
      </div>
    )
  }
  return (
    <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      <p className="font-semibold">号码对不上，发送已暂停</p>
      <p className="mt-1 text-xs text-red-700">
        绑定号码（{phone_number_id}）和服务器配置（{configured_number_id}）不一致，为避免用错号码发消息已挡住所有发送。改成一致才能恢复。
      </p>
    </div>
  )
}

export function WhatsAppNumberPanel({ clientId }: Props) {
  const [state, setState] = useState<PanelState>({ phase: 'loading' })
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const res = await fetch(`/api/clients/${clientId}/whatsapp-number`)
      // 404 = this client has no WhatsApp endpoint configured — treat as empty, not an error
      if (res.status === 404) {
        const empty: Payload = { phone_number_id: null, configured_number_id: null, matches_configured: null }
        setState({ phase: 'ready', data: empty })
        setDraft('')
        return
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as Payload
      setState({ phase: 'ready', data })
      setDraft(data.phone_number_id ?? '')
    } catch (err) {
      setState({ phase: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }, [clientId])

  useEffect(() => {
    void load()
  }, [load])

  const save = async (value: string | null) => {
    setSaving(true)
    setErrMsg(null)
    setResult(null)
    try {
      const res = await fetch(`/api/clients/${clientId}/whatsapp-number`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone_number_id: value }),
      })
      const json = (await res.json()) as Payload & { error?: string }
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)

      const data: Payload = {
        phone_number_id: json.phone_number_id ?? null,
        configured_number_id: json.configured_number_id ?? null,
        matches_configured: json.matches_configured ?? null,
      }
      setState({ phase: 'ready', data })
      setDraft(data.phone_number_id ?? '')
      setResult(
        data.phone_number_id === null
          ? { ok: true, text: '已解绑 —— 这个客户的 WhatsApp 消息不再进来。' }
          : data.matches_configured === true
            ? { ok: true, text: '保存成功，收发都能用了。' }
            : { ok: false, text: '保存成功，但现在还发不出去 —— 看上面那条提示。' },
      )
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  if (state.phase === 'loading') {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <p className="text-sm text-slate-400">加载中...</p>
      </div>
    )
  }

  if (state.phase === 'error') {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4">
        <p className="text-sm font-bold text-red-700">加载失败</p>
        <p className="mt-1 text-xs text-red-600">{state.message}</p>
        <button
          onClick={() => void load()}
          className="mt-2 rounded-lg border border-red-300 bg-white px-3 py-1 text-xs font-bold text-red-700 hover:bg-red-100"
        >
          重试
        </button>
      </div>
    )
  }

  const { phone_number_id } = state.data
  const dirty = draft.trim() !== (phone_number_id ?? '').trim()

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <LiveStatus {...state.data} />

      <p className="mb-4 text-sm text-slate-500">
        客人 WhatsApp 消息自动进来，显示在「今天该联系谁」。
      </p>

      <input
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="109876543210987"
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-200"
      />

      {errMsg && <p className="mt-2 text-xs leading-relaxed text-red-600">⚠ {errMsg}</p>}
      {result && (
        <p className={`mt-2 text-xs leading-relaxed ${result.ok ? 'text-emerald-600' : 'text-amber-700'}`}>
          {result.text}
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <button
          onClick={() => void save(draft.trim() || null)}
          disabled={saving || !dirty}
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
        >
          {saving ? '保存中...' : '保存'}
        </button>
        {phone_number_id && (
          <button
            onClick={() => void save(null)}
            disabled={saving}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed"
          >
            解绑
          </button>
        )}
      </div>

      <details className="mt-4 border-t border-slate-100 pt-3">
        <summary className="cursor-pointer text-xs text-slate-400 hover:text-slate-600">
          怎么找电话号码 ID？
        </summary>
        <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
          不是客人拨打的手机号。在 Meta 商务管理平台 → WhatsApp 账户 → 电话号码里，每个号码下方标着的那串数字才是。
        </p>
      </details>
    </div>
  )
}
