'use client'

/**
 * PlatformConnectionPanel — generic OAuth connection status card.
 *
 * Extracted from GbpPanel (Phase 24.A.7) so GSC / GA4 / GTM can reuse the
 * same loading/error/disconnected/needs_reconnect/connected states instead
 * of each hand-rolling a near-identical panel (see docs/specs/
 * 2026-08-11-onboarding-integrations-unify-v1.md §2.4).
 *
 * Talks to /api/clients/[id]/platform/{apiPath} — that route must already
 * filter by provider on both GET and DELETE (see platform/gbp/route.ts
 * header comment for why: a missing provider filter let one connection's
 * disconnect button delete a different platform's connection, 2026-08-03).
 */

import { useState, useEffect, useCallback } from 'react'
import type { PlatformConnectionSummary } from '@/lib/platform-oauth/vocabulary'

interface Props {
  clientId: string
  /** Path segment under /api/clients/[id]/platform/{apiPath} — e.g. 'gbp', 'gsc'. */
  apiPath: string
  icon: string
  title: string
  /** Shown in the disconnected state. */
  description: string
  /** Where "connect" / "reconnect" links to. */
  connectHref: string
  connectLabel: string
  disconnectConfirmMessage: string
  /** Shown when a connection errors out with no server-provided error_message. */
  errorFallbackMessage: string
  /** GBP additionally shows location_name; other providers can leave this off. */
  showLocation?: boolean
}

type PanelState =
  | { phase: 'loading' }
  | { phase: 'error';            message: string }
  | { phase: 'disconnected' }
  | { phase: 'needs_reconnect'; connection: PlatformConnectionSummary }
  | { phase: 'connected';       connection: PlatformConnectionSummary }

export function PlatformConnectionPanel({
  clientId,
  apiPath,
  icon,
  title,
  description,
  connectHref,
  connectLabel,
  disconnectConfirmMessage,
  errorFallbackMessage,
  showLocation = false,
}: Props) {
  const [state,    setState]    = useState<PanelState>({ phase: 'loading' })
  const [deleting, setDeleting] = useState(false)

  const loadConnections = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const res = await fetch(`/api/clients/${clientId}/platform/${apiPath}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const { connections } = (await res.json()) as { connections: PlatformConnectionSummary[] }
      const active   = connections.find(c => c.status === 'active') ?? null
      const errored  = connections.find(c => c.status === 'error')  ?? null
      if (active)        setState({ phase: 'connected',       connection: active })
      else if (errored)  setState({ phase: 'needs_reconnect', connection: errored })
      else               setState({ phase: 'disconnected' })
    } catch (err) {
      setState({ phase: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }, [clientId, apiPath])

  useEffect(() => { loadConnections() }, [loadConnections])

  const handleDisconnect = async (connectionId: string) => {
    if (!confirm(disconnectConfirmMessage)) return
    setDeleting(true)
    try {
      const res = await fetch(
        `/api/clients/${clientId}/platform/${apiPath}?connectionId=${encodeURIComponent(connectionId)}`,
        { method: 'DELETE' },
      )
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setState({ phase: 'disconnected' })
    } catch {
      alert('断开失败，请稍后再试')
    } finally {
      setDeleting(false)
    }
  }

  // ── Loading ─────────────────────────────────────────────────────────────
  if (state.phase === 'loading') {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-cyan-600" />
        正在加载连接状态…
      </div>
    )
  }

  // ── Error ────────────────────────────────────────────────────────────────
  if (state.phase === 'error') {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        <p className="font-bold">加载失败</p>
        <p>{state.message}</p>
        <button onClick={loadConnections} className="mt-2 font-medium underline">
          重试
        </button>
      </div>
    )
  }

  // ── Needs reconnect ─────────────────────────────────────────────────────
  if (state.phase === 'needs_reconnect') {
    const { connection } = state
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-amber-100 text-xl">
            ⚠️
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-black text-slate-900">连接中断 — {connection.display_name}</h3>
            <p className="mt-1 text-sm text-amber-700">
              {connection.error_message ?? errorFallbackMessage}
            </p>
            {connection.last_synced_at && (
              <p className="mt-1 text-xs text-slate-400">
                上次同步：{new Date(connection.last_synced_at).toLocaleString('zh-CN')}
              </p>
            )}
            <a
              href={connectHref}
              className="mt-3 inline-flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-black text-white transition hover:bg-amber-700 active:bg-amber-800"
            >
              <span>🔄</span>
              重新授权
            </a>
          </div>
        </div>
      </div>
    )
  }

  // ── Disconnected ─────────────────────────────────────────────────────────
  if (state.phase === 'disconnected') {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xl">
            {icon}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-black text-slate-900">{title}</h3>
            <p className="mt-1 text-sm text-slate-500">{description}</p>
            <a
              href={connectHref}
              className="mt-3 inline-flex items-center gap-2 rounded-lg bg-cyan-700 px-4 py-2 text-sm font-black text-white transition hover:bg-cyan-800 active:bg-cyan-900"
            >
              <span>🔗</span>
              {connectLabel}
            </a>
          </div>
        </div>
      </div>
    )
  }

  // ── Connected ────────────────────────────────────────────────────────────
  const { connection } = state

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white text-sm font-black">
            ✓
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-black uppercase tracking-wide text-emerald-700">已连接</p>
            <h3 className="mt-0.5 truncate font-black text-slate-900">{connection.display_name}</h3>
            <p className="mt-0.5 truncate text-xs text-slate-500">{connection.account_id}</p>
            {showLocation && connection.location_name && (
              <p className="mt-0.5 truncate text-xs text-slate-500">📍 {connection.location_name}</p>
            )}
            {connection.last_synced_at && (
              <p className="mt-1 text-xs text-slate-400">
                最后同步：{new Date(connection.last_synced_at).toLocaleString('zh-CN')}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-shrink-0 gap-2">
          <a
            href={connectHref}
            className="rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-bold text-emerald-700 transition hover:bg-emerald-50"
          >
            重新授权
          </a>
          <button
            onClick={() => handleDisconnect(connection.id)}
            disabled={deleting}
            className="rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-bold text-red-600 transition hover:bg-red-50 disabled:opacity-50"
          >
            {deleting ? '断开中…' : '断开连接'}
          </button>
        </div>
      </div>

      {connection.status === 'error' && connection.error_message && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          <strong>连接错误：</strong>{connection.error_message}
        </div>
      )}
    </div>
  )
}
