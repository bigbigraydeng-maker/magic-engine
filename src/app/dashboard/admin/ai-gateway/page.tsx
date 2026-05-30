'use client'

import { useState, useEffect, useCallback } from 'react'

interface GatewayLog {
  id: string
  provider: string
  model: string | null
  request_type: string | null
  status: number | null
  cached: boolean
  tokens_in: number | null
  tokens_out: number | null
  cost: number | null
  latency: number | null
  created_at: string
}

interface ResultInfo {
  page: number
  per_page: number
  count: number
  total_count: number
}

interface GatewayResponse {
  result: GatewayLog[]
  result_info: ResultInfo
  success: boolean
}

// ─── helpers ──────────────────────────────────────────────────────────────────

const PROVIDERS: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  openai:      { label: 'OpenAI',      color: 'text-emerald-700', bg: 'bg-emerald-50',  dot: 'bg-emerald-500' },
  anthropic:   { label: 'Anthropic',   color: 'text-amber-700',   bg: 'bg-amber-50',    dot: 'bg-amber-500'   },
  perplexity:  { label: 'Perplexity',  color: 'text-blue-700',    bg: 'bg-blue-50',     dot: 'bg-blue-500'    },
  'workers-ai':{ label: 'Workers AI',  color: 'text-violet-700',  bg: 'bg-violet-50',   dot: 'bg-violet-500'  },
}

function providerInfo(p: string) {
  return PROVIDERS[p] ?? { label: p, color: 'text-gray-700', bg: 'bg-gray-100', dot: 'bg-gray-400' }
}

function fmt(n: number | null | undefined, digits = 0) {
  if (n == null) return '—'
  return n.toLocaleString('en-AU', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

function fmtCost(n: number | null | undefined) {
  if (n == null) return '—'
  if (n === 0) return '$0'
  if (n < 0.0001) return `$${n.toFixed(8)}`
  if (n < 0.01)   return `$${n.toFixed(6)}`
  return `$${n.toFixed(4)}`
}

function fmtMs(n: number | null | undefined) {
  if (n == null) return '—'
  if (n < 1000) return `${n} ms`
  return `${(n / 1000).toFixed(1)} s`
}

function fmtTime(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString('zh-CN', {
    month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function modelShort(m: string | null) {
  if (!m) return '—'
  return m.replace('claude-', '').replace('gpt-', 'gpt-').replace('-preview', '↗').replace('-latest', '')
}

// ─── sub-components ───────────────────────────────────────────────────────────

function MetricCard({ label, value, sub, accent }: {
  label: string; value: string; sub?: string; accent?: string
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-5 py-4">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</p>
      <p className={`mt-1.5 text-2xl font-bold ${accent ?? 'text-gray-900'}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-gray-400">{sub}</p>}
    </div>
  )
}

function ProviderBadge({ provider }: { provider: string }) {
  const info = providerInfo(provider)
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${info.bg} ${info.color}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${info.dot}`} />
      {info.label}
    </span>
  )
}

function StatusPill({ status }: { status: number | null }) {
  if (status == null) return <span className="text-xs text-gray-300">—</span>
  const ok = status >= 200 && status < 300
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-bold tabular-nums ${
      ok ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'
    }`}>
      {status}
    </span>
  )
}

function CachePill({ cached }: { cached: boolean }) {
  return cached
    ? <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-bold bg-sky-100 text-sky-700">HIT</span>
    : <span className="text-xs text-gray-300">MISS</span>
}

// ─── per-provider summary bar ─────────────────────────────────────────────────

function ProviderSummaryRow({ logs }: { logs: GatewayLog[] }) {
  const byProvider: Record<string, { count: number; cost: number; tokens: number }> = {}
  for (const log of logs) {
    if (!byProvider[log.provider]) byProvider[log.provider] = { count: 0, cost: 0, tokens: 0 }
    byProvider[log.provider].count++
    byProvider[log.provider].cost += log.cost ?? 0
    byProvider[log.provider].tokens += (log.tokens_in ?? 0) + (log.tokens_out ?? 0)
  }
  const entries = Object.entries(byProvider).sort((a, b) => b[1].count - a[1].count)
  if (entries.length === 0) return null
  const maxCount = Math.max(...entries.map(([, v]) => v.count), 1)

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="mb-4 text-sm font-semibold text-gray-700">Provider 分布</h2>
      <div className="space-y-3">
        {entries.map(([prov, stats]) => {
          const info = providerInfo(prov)
          const pct = Math.round((stats.count / maxCount) * 100)
          return (
            <div key={prov} className="flex items-center gap-3">
              <span className={`w-24 shrink-0 text-xs font-semibold ${info.color}`}>{info.label}</span>
              <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
                <div className={`h-full rounded-full ${info.dot}`} style={{ width: `${pct}%` }} />
              </div>
              <span className="w-8 text-right text-xs tabular-nums text-gray-500">{stats.count}</span>
              <span className="w-20 text-right text-xs tabular-nums text-gray-400">{fmtCost(stats.cost)}</span>
              <span className="w-24 text-right text-xs tabular-nums text-gray-400">{fmt(stats.tokens)} tok</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── main page ────────────────────────────────────────────────────────────────

export default function AIGatewayPage() {
  const [logs, setLogs] = useState<GatewayLog[]>([])
  const [resultInfo, setResultInfo] = useState<ResultInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [filterProvider, setFilterProvider] = useState<string>('all')
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)
  const perPage = 50

  const fetchLogs = useCallback(async (p: number) => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/admin/ai-gateway?page=${p}&per_page=${perPage}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }))
        setError(body.error ?? `HTTP ${res.status}`)
        return
      }
      const data: GatewayResponse = await res.json()
      setLogs(data.result ?? [])
      setResultInfo(data.result_info ?? null)
      setLastRefresh(new Date())
    } catch {
      setError('网络错误，无法连接 AI Gateway API')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchLogs(page)
    const interval = setInterval(() => fetchLogs(page), 30_000)
    return () => clearInterval(interval)
  }, [fetchLogs, page])

  // summary over ALL loaded logs
  const totalCost    = logs.reduce((s, l) => s + (l.cost ?? 0), 0)
  const totalTokIn   = logs.reduce((s, l) => s + (l.tokens_in ?? 0), 0)
  const totalTokOut  = logs.reduce((s, l) => s + (l.tokens_out ?? 0), 0)
  const cacheHits    = logs.filter(l => l.cached).length
  const latencies    = logs.map(l => l.latency).filter((n): n is number => n != null)
  const avgLatency   = latencies.length ? Math.round(latencies.reduce((s, n) => s + n, 0) / latencies.length) : null
  const hitRate      = logs.length ? Math.round((cacheHits / logs.length) * 100) : null

  // providers for filter tabs
  const providers = Array.from(new Set(logs.map(l => l.provider))).sort()

  // filtered view
  const visible = filterProvider === 'all' ? logs : logs.filter(l => l.provider === filterProvider)

  const totalPages = resultInfo ? Math.ceil(resultInfo.total_count / perPage) : 1

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mx-auto max-w-7xl space-y-6">

        {/* ── Header ── */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-2xl font-bold text-gray-900">AI Gateway 监控</h1>
              <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                Live
              </span>
            </div>
            <p className="text-sm text-gray-400">
              Cloudflare AI Gateway · <span className="font-mono">magic-engine</span>
              {lastRefresh && (
                <> · 上次刷新 {lastRefresh.toLocaleTimeString('zh-CN')}</>
              )}
            </p>
          </div>
          <button
            onClick={() => { setPage(1); fetchLogs(1) }}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50 transition"
          >
            {loading
              ? <><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-gray-300 border-t-blue-500" /> 刷新中</>
              : '刷新'}
          </button>
        </div>

        {/* ── Error ── */}
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <span className="font-semibold">错误：</span>{error}
          </div>
        )}

        {/* ── Summary metrics ── */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <MetricCard
            label="总请求数"
            value={resultInfo ? resultInfo.total_count.toLocaleString() : logs.length.toLocaleString()}
            sub={`本页 ${logs.length} 条`}
          />
          <MetricCard
            label="缓存命中率"
            value={hitRate != null ? `${hitRate}%` : '—'}
            sub={`${cacheHits} 次命中`}
            accent={hitRate != null && hitRate >= 20 ? 'text-sky-600' : 'text-gray-900'}
          />
          <MetricCard label="输入 Token" value={fmt(totalTokIn)} sub="prompt" />
          <MetricCard label="输出 Token" value={fmt(totalTokOut)} sub="completion" />
          <MetricCard
            label="总费用"
            value={fmtCost(totalCost)}
            sub="USD · 本页"
            accent="text-gray-900"
          />
          <MetricCard
            label="平均延迟"
            value={fmtMs(avgLatency)}
            accent={avgLatency != null && avgLatency > 5000 ? 'text-amber-600' : 'text-gray-900'}
          />
        </div>

        {/* ── Provider breakdown ── */}
        {logs.length > 0 && <ProviderSummaryRow logs={logs} />}

        {/* ── Logs table ── */}
        <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">

          {/* table header */}
          <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3 gap-4">
            {/* provider filter tabs */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => setFilterProvider('all')}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  filterProvider === 'all'
                    ? 'bg-gray-900 text-white'
                    : 'text-gray-500 hover:bg-gray-100'
                }`}
              >
                全部 {logs.length > 0 && <span className="ml-1 opacity-70">{logs.length}</span>}
              </button>
              {providers.map(p => {
                const info = providerInfo(p)
                const count = logs.filter(l => l.provider === p).length
                return (
                  <button
                    key={p}
                    onClick={() => setFilterProvider(p)}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                      filterProvider === p
                        ? `${info.bg} ${info.color}`
                        : 'text-gray-500 hover:bg-gray-100'
                    }`}
                  >
                    {info.label} <span className="ml-1 opacity-60">{count}</span>
                  </button>
                )
              })}
            </div>

            {/* pagination */}
            {totalPages > 1 && (
              <div className="flex shrink-0 items-center gap-2 text-xs text-gray-500">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="rounded border border-gray-200 px-2 py-1 hover:bg-gray-50 disabled:opacity-40"
                >
                  ← 上页
                </button>
                <span className="tabular-nums">{page} / {totalPages}</span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="rounded border border-gray-200 px-2 py-1 hover:bg-gray-50 disabled:opacity-40"
                >
                  下页 →
                </button>
              </div>
            )}
          </div>

          {/* loading */}
          {loading && logs.length === 0 && (
            <div className="flex items-center justify-center gap-2 py-20 text-sm text-gray-400">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-200 border-t-blue-500" />
              加载中…
            </div>
          )}

          {/* empty */}
          {!loading && logs.length === 0 && !error && (
            <div className="py-20 text-center">
              <p className="text-4xl mb-3">📡</p>
              <p className="text-sm font-medium text-gray-500">暂无日志记录</p>
              <p className="mt-1 text-xs text-gray-400">
                OpenAI / Anthropic 请求经 AI Gateway 后会自动出现在这里
              </p>
            </div>
          )}

          {/* table */}
          {visible.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/60 text-xs font-semibold uppercase tracking-wide text-gray-400">
                    <th className="px-4 py-3 text-left">时间</th>
                    <th className="px-4 py-3 text-left">Provider</th>
                    <th className="px-4 py-3 text-left">模型</th>
                    <th className="px-4 py-3 text-center">状态</th>
                    <th className="px-4 py-3 text-center">缓存</th>
                    <th className="px-4 py-3 text-right">Token 入</th>
                    <th className="px-4 py-3 text-right">Token 出</th>
                    <th className="px-4 py-3 text-right">费用</th>
                    <th className="px-4 py-3 text-right">延迟</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((log, idx) => (
                    <tr
                      key={log.id}
                      className={`border-b border-gray-50 transition hover:bg-gray-50/80 ${
                        idx % 2 === 0 ? '' : 'bg-gray-50/30'
                      }`}
                    >
                      <td className="px-4 py-3 font-mono text-xs text-gray-400 whitespace-nowrap">
                        {fmtTime(log.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        <ProviderBadge provider={log.provider} />
                      </td>
                      <td className="px-4 py-3 max-w-[160px]">
                        <span className="font-mono text-xs text-gray-700 truncate block" title={log.model ?? ''}>
                          {modelShort(log.model)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <StatusPill status={log.status} />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <CachePill cached={log.cached} />
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-gray-600">
                        {fmt(log.tokens_in)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-gray-600">
                        {fmt(log.tokens_out)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-gray-700">
                        {fmtCost(log.cost)}
                      </td>
                      <td className={`px-4 py-3 text-right font-mono text-xs ${
                        log.latency != null && log.latency > 8000
                          ? 'text-amber-600 font-semibold'
                          : 'text-gray-600'
                      }`}>
                        {fmtMs(log.latency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* footer */}
          {visible.length > 0 && (
            <div className="border-t border-gray-100 px-5 py-2.5 text-xs text-gray-400 flex justify-between">
              <span>显示 {visible.length} 条 / 共 {resultInfo?.total_count ?? logs.length} 条</span>
              <span>每 30 秒自动刷新</span>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
