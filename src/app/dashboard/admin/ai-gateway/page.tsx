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
  metadata?: Record<string, unknown>
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

interface Summary {
  totalRequests: number
  cacheHits: number
  totalTokensIn: number
  totalTokensOut: number
  totalCostUsd: number
  avgLatencyMs: number
}

function computeSummary(logs: GatewayLog[]): Summary {
  let cacheHits = 0
  let totalTokensIn = 0
  let totalTokensOut = 0
  let totalCostUsd = 0
  let latencySum = 0
  let latencyCount = 0

  for (const log of logs) {
    if (log.cached) cacheHits++
    if (log.tokens_in) totalTokensIn += log.tokens_in
    if (log.tokens_out) totalTokensOut += log.tokens_out
    if (log.cost) totalCostUsd += log.cost
    if (log.latency != null) {
      latencySum += log.latency
      latencyCount++
    }
  }

  return {
    totalRequests: logs.length,
    cacheHits,
    totalTokensIn,
    totalTokensOut,
    totalCostUsd,
    avgLatencyMs: latencyCount > 0 ? Math.round(latencySum / latencyCount) : 0,
  }
}

function providerLabel(provider: string) {
  const map: Record<string, string> = {
    openai: 'OpenAI',
    anthropic: 'Anthropic',
    perplexity: 'Perplexity',
    'workers-ai': 'Workers AI',
  }
  return map[provider] ?? provider
}

function statusBadge(status: number | null) {
  if (status == null) return <span className="text-gray-400">—</span>
  const ok = status >= 200 && status < 300
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        ok ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
      }`}
    >
      {status}
    </span>
  )
}

export default function AIGatewayPage() {
  const [logs, setLogs] = useState<GatewayLog[]>([])
  const [resultInfo, setResultInfo] = useState<ResultInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
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
    } catch {
      setError('Network error — could not reach AI Gateway API')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchLogs(page)
    const interval = setInterval(() => fetchLogs(page), 30_000)
    return () => clearInterval(interval)
  }, [fetchLogs, page])

  const summary = computeSummary(logs)
  const totalPages = resultInfo ? Math.ceil(resultInfo.total_count / perPage) : 1

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">

        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">AI Gateway 监控</h1>
            <p className="mt-1 text-gray-500">
              Cloudflare AI Gateway · magic-engine · 每 30 秒自动刷新
            </p>
          </div>
          <button
            onClick={() => fetchLogs(page)}
            disabled={loading}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? '刷新中...' : '立即刷新'}
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-6 rounded-md bg-red-50 border border-red-200 p-4 text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* Summary Cards */}
        {!error && (
          <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <SummaryCard label="请求数" value={summary.totalRequests.toLocaleString()} />
            <SummaryCard
              label="缓存命中"
              value={
                summary.totalRequests > 0
                  ? `${Math.round((summary.cacheHits / summary.totalRequests) * 100)}%`
                  : '—'
              }
              sub={`${summary.cacheHits} 次`}
            />
            <SummaryCard
              label="输入 Token"
              value={summary.totalTokensIn.toLocaleString()}
            />
            <SummaryCard
              label="输出 Token"
              value={summary.totalTokensOut.toLocaleString()}
            />
            <SummaryCard
              label="总费用"
              value={`$${summary.totalCostUsd.toFixed(4)}`}
              sub="USD"
            />
            <SummaryCard
              label="平均延迟"
              value={summary.avgLatencyMs > 0 ? `${summary.avgLatencyMs} ms` : '—'}
            />
          </div>
        )}

        {/* Logs Table */}
        <div className="rounded-lg bg-white shadow overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">
              请求日志
              {resultInfo && (
                <span className="ml-2 text-sm font-normal text-gray-500">
                  共 {resultInfo.total_count.toLocaleString()} 条
                </span>
              )}
            </h2>
            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center gap-2 text-sm">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="rounded border px-2 py-1 disabled:opacity-40 hover:bg-gray-50"
                >
                  上一页
                </button>
                <span className="text-gray-600">
                  {page} / {totalPages}
                </span>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="rounded border px-2 py-1 disabled:opacity-40 hover:bg-gray-50"
                >
                  下一页
                </button>
              </div>
            )}
          </div>

          {loading && logs.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-gray-500">
              <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600 mr-2" />
              加载中...
            </div>
          ) : logs.length === 0 ? (
            <div className="py-16 text-center text-gray-400 text-sm">
              暂无日志记录。AI Gateway 流量开始后会显示在这里。
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left">
                  <tr>
                    <th className="px-4 py-3 font-semibold text-gray-600">时间</th>
                    <th className="px-4 py-3 font-semibold text-gray-600">Provider</th>
                    <th className="px-4 py-3 font-semibold text-gray-600">模型</th>
                    <th className="px-4 py-3 font-semibold text-gray-600 text-center">状态</th>
                    <th className="px-4 py-3 font-semibold text-gray-600 text-center">缓存</th>
                    <th className="px-4 py-3 font-semibold text-gray-600 text-right">Token 入</th>
                    <th className="px-4 py-3 font-semibold text-gray-600 text-right">Token 出</th>
                    <th className="px-4 py-3 font-semibold text-gray-600 text-right">费用</th>
                    <th className="px-4 py-3 font-semibold text-gray-600 text-right">延迟</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {logs.map((log) => (
                    <tr key={log.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                        {new Date(log.created_at).toLocaleString('zh-CN', {
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit',
                        })}
                      </td>
                      <td className="px-4 py-3 font-medium text-gray-900">
                        {providerLabel(log.provider)}
                      </td>
                      <td className="px-4 py-3 text-gray-600 max-w-[180px] truncate">
                        {log.model ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {statusBadge(log.status)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {log.cached ? (
                          <span className="text-xs font-medium text-emerald-600">HIT</span>
                        ) : (
                          <span className="text-xs text-gray-400">MISS</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700">
                        {log.tokens_in?.toLocaleString() ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700">
                        {log.tokens_out?.toLocaleString() ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700">
                        {log.cost != null ? `$${log.cost.toFixed(6)}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700">
                        {log.latency != null ? `${log.latency} ms` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function SummaryCard({
  label,
  value,
  sub,
}: {
  label: string
  value: string
  sub?: string
}) {
  return (
    <div className="rounded-lg bg-white shadow p-4">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      <p className="mt-1 text-2xl font-bold text-gray-900">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
  )
}
