'use client'

/**
 * GoogleAdsPanel — Google Ads connection status tile.
 *
 * Mirrors GbpPanel (Phase 24.A.7) for visual + interaction parity:
 *   - loading / error / disconnected / needs_reconnect / connected states
 *   - shows account_id (Google Ads customer_id) + last_synced_at on connect
 *   - connect/reconnect routes to the legacy connectors page (the OAuth
 *     callback there already wires through to platform_oauth_connections).
 *   - disconnect is intentionally absent from this panel; users wanting to
 *     revoke today go through the legacy /connectors/google-ads page.
 *     (When the OAuth flow becomes first-class here, we add it.)
 *
 * Phase 18.B.3
 */

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import type { PlatformConnectionSummary } from '@/lib/platform-oauth/vocabulary'

interface Props {
  clientId: string
}

type PanelState =
  | { phase: 'loading' }
  | { phase: 'error';            message: string }
  | { phase: 'disconnected' }
  | { phase: 'needs_reconnect'; connection: PlatformConnectionSummary }
  | { phase: 'connected';       connection: PlatformConnectionSummary }

function formatRelative(iso: string | null): string {
  if (!iso) return '从未同步'
  const ms = Date.now() - new Date(iso).getTime()
  if (Number.isNaN(ms) || ms < 0) return iso
  const mins = Math.floor(ms / 60_000)
  if (mins < 1) return '刚刚'
  if (mins < 60) return `${mins} 分钟前`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  return `${days} 天前`
}

export function GoogleAdsPanel({ clientId }: Props) {
  const [state, setState] = useState<PanelState>({ phase: 'loading' })

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const res = await fetch(`/api/clients/${clientId}/platform/google-ads`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const { connection } = (await res.json()) as { connection: PlatformConnectionSummary | null }
      if (!connection) {
        setState({ phase: 'disconnected' })
      } else if (connection.status === 'active') {
        setState({ phase: 'connected', connection })
      } else {
        // 'revoked' | 'expired' | 'error' — all need a fresh OAuth round-trip.
        setState({ phase: 'needs_reconnect', connection })
      }
    } catch (err) {
      setState({ phase: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }, [clientId])

  useEffect(() => { load() }, [load])

  // ── Loading ─────────────────────────────────────────────────────────────
  if (state.phase === 'loading') {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500" data-testid="google-ads-panel-loading">
        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-cyan-600" />
        正在加载连接状态…
      </div>
    )
  }

  // ── Error ────────────────────────────────────────────────────────────────
  if (state.phase === 'error') {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700" data-testid="google-ads-panel-error">
        <p className="font-bold">加载失败</p>
        <p className="mt-1 text-xs text-red-600">{state.message}</p>
        <button
          onClick={load}
          className="mt-2 inline-flex items-center rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
        >
          重试
        </button>
      </div>
    )
  }

  // ── Disconnected ─────────────────────────────────────────────────────────
  if (state.phase === 'disconnected') {
    return (
      <div
        className="rounded-xl border border-slate-200 bg-white p-5"
        data-testid="google-ads-panel-disconnected"
        data-status="disconnected"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-bold text-slate-800">未连接</p>
            <p className="mt-1 text-xs text-slate-500">
              连接后每日 3am UTC 自动拉取过去 30 天的花费 / 展示 / 点击 / 转化数据
              写入 flywheel_metrics，供诊断引擎使用。
            </p>
          </div>
          <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 whitespace-nowrap">
            未连接
          </span>
        </div>
        <Link
          href={`/dashboard/clients/${clientId}/connectors/google-ads`}
          className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-cyan-600 px-4 py-2 text-sm font-bold text-white hover:bg-cyan-700"
        >
          连接 Google Ads →
        </Link>
      </div>
    )
  }

  // ── Needs reconnect (revoked / expired / error) ──────────────────────────
  if (state.phase === 'needs_reconnect') {
    return (
      <div
        className="rounded-xl border border-amber-200 bg-amber-50 p-5"
        data-testid="google-ads-panel-needs-reconnect"
        data-status={state.connection.status}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-bold text-amber-900">连接需要更新</p>
            <p className="mt-1 text-xs text-amber-800">
              当前状态: <code className="font-mono">{state.connection.status}</code>
              {state.connection.error_message && (
                <> · {state.connection.error_message}</>
              )}
            </p>
            <p className="mt-2 text-xs text-amber-700">
              账号 ID: <code className="font-mono">{state.connection.account_id}</code>
            </p>
          </div>
          <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800 whitespace-nowrap">
            需要重连
          </span>
        </div>
        <Link
          href={`/dashboard/clients/${clientId}/connectors/google-ads`}
          className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-700"
        >
          重新连接 →
        </Link>
      </div>
    )
  }

  // ── Connected ────────────────────────────────────────────────────────────
  const c = state.connection
  return (
    <div
      className="rounded-xl border border-emerald-200 bg-emerald-50 p-5"
      data-testid="google-ads-panel-connected"
      data-status="active"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-bold text-emerald-900">{c.display_name || 'Google Ads 账号'}</p>
          <p className="mt-1 text-xs text-emerald-800">
            账号 ID: <code className="font-mono">{c.account_id}</code>
          </p>
          <p className="mt-1 text-xs text-emerald-700">
            上次同步: {formatRelative(c.last_synced_at)}
          </p>
        </div>
        <span className="inline-flex items-center rounded-full border border-emerald-300 bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-800 whitespace-nowrap">
          ✓ 已连接
        </span>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Link
          href={`/dashboard/clients/${clientId}/connectors/google-ads`}
          className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300 bg-white px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100"
        >
          管理连接
        </Link>
        <button
          onClick={load}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          ↻ 刷新
        </button>
      </div>
    </div>
  )
}
