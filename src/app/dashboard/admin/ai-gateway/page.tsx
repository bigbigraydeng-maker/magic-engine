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
  openai:      { label: 'OpenAI',      color: 'text-[#5C8A4A]', bg: 'bg-[#5C8A4A]/10',  dot: 'bg-[#5C8A4A]' },
  anthropic:   { label: 'Anthropic',   color: 'text-me-ochre',   bg: 'bg-me-ochre/10',    dot: 'bg-me-ochre'   },
  perplexity:  { label: 'Perplexity',  color: 'text-me-ochre',    bg: 'bg-me-ochre/10',     dot: 'bg-me-ochre'    },
  'workers-ai':{ label: 'Workers AI',  color: 'text-me-ochre',  bg: 'bg-me-ochre/10',   dot: 'bg-me-ochre'  },
}

function providerInfo(p: string) {
  return PROVIDERS[p] ?? { label: p, color: 'text-me-charcoal/75', bg: 'bg-me-ivory', dot: 'bg-me-charcoal/25' }
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
    <div className="rounded-lg border border-black/10 bg-white px-5 py-4">
      <p className="text-xs font-medium uppercase tracking-wide text-me-charcoal/45">{label}</p>
      <p className={`mt-1.5 text-2xl font-bold ${accent ?? 'text-me-charcoal/90'}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-me-charcoal/45">{sub}</p>}
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
  if (status == null) return <span className="text-xs text-me-charcoal/35">—</span>
  const ok = status >= 200 && status < 300
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-bold tabular-nums ${
      ok ? 'bg-[#5C8A4A]/12 text-[#5C8A4A]' : 'bg-[#C2453A]/10 text-[#C2453A]'
    }`}>
      {status}
    </span>
  )
}

function CachePill({ cached }: { cached: boolean }) {
  return cached
    ? <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-bold bg-me-ochre/10 text-me-ochre">HIT</span>
    : <span className="text-xs text-me-charcoal/35">MISS</span>
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
    <div className="rounded-lg border border-black/10 bg-white p-5">
      <h2 className="mb-4 text-sm font-semibold text-me-charcoal/75">Provider 分布</h2>
      <div className="space-y-3">
        {entries.map(([prov, stats]) => {
          const info = providerInfo(prov)
          const pct = Math.round((stats.count / maxCount) * 100)
          return (
            <div key={prov} className="flex items-center gap-3">
              <span className={`w-24 shrink-0 text-xs font-semibold ${info.color}`}>{info.label}</span>
              <div className="flex-1 h-2 rounded-full bg-me-ivory overflow-hidden">
                <div className={`h-full rounded-full ${info.dot}`} style={{ width: `${pct}%` }} />
              </div>
              <span className="w-8 text-right text-xs tabular-nums text-me-charcoal/55">{stats.count}</span>
              <span className="w-20 text-right text-xs tabular-nums text-me-charcoal/45">{fmtCost(stats.cost)}</span>
              <span className="w-24 text-right text-xs tabular-nums text-me-charcoal/45">{fmt(stats.tokens)} tok</span>
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
    <div className="min-h-screen bg-me-ivory p-6">
      <div className="mx-auto max-w-7xl space-y-6">

        {/* ── Header ── */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h1 className="font-display text-2xl font-bold tracking-tight text-me-charcoal/90">AI Gateway 监控</h1>
              <span className="flex items-center gap-1.5 rounded-full bg-[#5C8A4A]/10 px-2.5 py-0.5 text-xs font-medium text-[#5C8A4A]">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#5C8A4A]/70 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-[#5C8A4A]" />
                </span>
                Live
              </span>
            </div>
            <p className="text-sm text-me-charcoal/45">
              Cloudflare AI Gateway · <span className="font-mono">magic-engine</span>
              {lastRefresh && (
                <> · 上次刷新 {lastRefresh.toLocaleTimeString('zh-CN')}</>
              )}
            </p>
          </div>
          <button
            onClick={() => { setPage(1); fetchLogs(1) }}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg border border-black/10 bg-white px-4 py-2 text-sm font-medium text-me-charcoal/75 shadow-sm hover:bg-me-ivory disabled:opacity-50 transition"
          >
            {loading
              ? <><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-black/15 border-t-me-ochre" /> 刷新中</>
              : '刷新'}
          </button>
        </div>

        {/* ── Error ── */}
        {error && (
          <div className="rounded-lg border border-[#C2453A]/30 bg-[#C2453A]/10 px-4 py-3 text-sm text-[#C2453A]">
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
            accent={hitRate != null && hitRate >= 20 ? 'text-me-ochre' : 'text-me-charcoal/90'}
          />
          <MetricCard label="输入 Token" value={fmt(totalTokIn)} sub="prompt" />
          <MetricCard label="输出 Token" value={fmt(totalTokOut)} sub="completion" />
          <MetricCard
            label="总费用"
            value={fmtCost(totalCost)}
            sub="USD · 本页"
            accent="text-me-charcoal/90"
          />
          <MetricCard
            label="平均延迟"
            value={fmtMs(avgLatency)}
            accent={avgLatency != null && avgLatency > 5000 ? 'text-me-ochre' : 'text-me-charcoal/90'}
          />
        </div>

        {/* ── Provider breakdown ── */}
        {logs.length > 0 && <ProviderSummaryRow logs={logs} />}

        {/* ── Logs table ── */}
        <div className="rounded-lg border border-black/10 bg-white overflow-hidden">

          {/* table header */}
          <div className="flex items-center justify-between border-b border-black/[.06] px-5 py-3 gap-4">
            {/* provider filter tabs */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => setFilterProvider('all')}
                className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                  filterProvider === 'all'
                    ? 'bg-me-charcoal/90 text-white'
                    : 'text-me-charcoal/55 hover:bg-me-ivory'
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
                        : 'text-me-charcoal/55 hover:bg-me-ivory'
                    }`}
                  >
                    {info.label} <span className="ml-1 opacity-60">{count}</span>
                  </button>
                )
              })}
            </div>

            {/* pagination */}
            {totalPages > 1 && (
              <div className="flex shrink-0 items-center gap-2 text-xs text-me-charcoal/55">
                <button
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="rounded border border-black/10 px-2 py-1 hover:bg-me-ivory disabled:opacity-40"
                >
                  ← 上页
                </button>
                <span className="tabular-nums">{page} / {totalPages}</span>
                <button
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="rounded border border-black/10 px-2 py-1 hover:bg-me-ivory disabled:opacity-40"
                >
                  下页 →
                </button>
              </div>
            )}
          </div>

          {/* loading */}
          {loading && logs.length === 0 && (
            <div className="flex items-center justify-center gap-2 py-20 text-sm text-me-charcoal/45">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-black/10 border-t-me-ochre" />
              加载中…
            </div>
          )}

          {/* empty */}
          {!loading && logs.length === 0 && !error && (
            <div className="py-20 text-center">
              <p className="text-4xl mb-3">📡</p>
              <p className="text-sm font-medium text-me-charcoal/55">暂无日志记录</p>
              <p className="mt-1 text-xs text-me-charcoal/45">
                OpenAI / Anthropic 请求经 AI Gateway 后会自动出现在这里
              </p>
            </div>
          )}

          {/* table */}
          {visible.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-black/[.06] bg-me-ivory/60 text-xs font-semibold uppercase tracking-wide text-me-charcoal/45">
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
                      className={`border-b border-black/[.04] transition hover:bg-me-ivory/80 ${
                        idx % 2 === 0 ? '' : 'bg-me-ivory/30'
                      }`}
                    >
                      <td className="px-4 py-3 font-mono text-xs text-me-charcoal/45 whitespace-nowrap">
                        {fmtTime(log.created_at)}
                      </td>
                      <td className="px-4 py-3">
                        <ProviderBadge provider={log.provider} />
                      </td>
                      <td className="px-4 py-3 max-w-[160px]">
                        <span className="font-mono text-xs text-me-charcoal/75 truncate block" title={log.model ?? ''}>
                          {modelShort(log.model)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <StatusPill status={log.status} />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <CachePill cached={log.cached} />
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-me-charcoal/60">
                        {fmt(log.tokens_in)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-me-charcoal/60">
                        {fmt(log.tokens_out)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-me-charcoal/75">
                        {fmtCost(log.cost)}
                      </td>
                      <td className={`px-4 py-3 text-right font-mono text-xs ${
                        log.latency != null && log.latency > 8000
                          ? 'text-me-ochre font-semibold'
                          : 'text-me-charcoal/60'
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
            <div className="border-t border-black/[.06] px-5 py-2.5 text-xs text-me-charcoal/45 flex justify-between">
              <span>显示 {visible.length} 条 / 共 {resultInfo?.total_count ?? logs.length} 条</span>
              <span>每 30 秒自动刷新</span>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
