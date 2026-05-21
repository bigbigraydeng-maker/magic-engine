'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'

interface SeoMetrics {
  organic_keywords: number | null
  organic_traffic:  number | null
  authority_score:  number | null
  published_posts:  number | null
  last_updated:     string | null
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({
  icon,
  label,
  value,
  sub,
  trend,
}: {
  icon: string
  label: string
  value: string
  sub?: string
  trend?: 'up' | 'down' | 'neutral'
}) {
  const trendIcon = trend === 'up' ? '↑' : trend === 'down' ? '↓' : null
  const trendCls  = trend === 'up' ? 'text-green-500' : trend === 'down' ? 'text-red-500' : ''
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4 flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-gray-400 text-xs">
        <span>{icon}</span>
        <span>{label}</span>
      </div>
      <div className="flex items-end gap-2">
        <p className="text-2xl font-bold text-gray-900 tabular-nums">{value}</p>
        {trendIcon && (
          <span className={`text-sm font-semibold mb-0.5 ${trendCls}`}>{trendIcon}</span>
        )}
      </div>
      {sub && <p className="text-xs text-gray-400">{sub}</p>}
    </div>
  )
}

// ─── Panel placeholder ────────────────────────────────────────────────────────

function PanelPlaceholder({
  icon,
  title,
  desc,
  eta,
}: {
  icon: string
  title: string
  desc: string
  eta: string
}) {
  return (
    <div className="bg-white rounded-xl border border-dashed border-gray-200 p-6 flex items-start gap-4">
      <span className="text-3xl flex-shrink-0">{icon}</span>
      <div>
        <p className="text-sm font-semibold text-gray-700">{title}</p>
        <p className="text-xs text-gray-400 mt-1">{desc}</p>
        <p className="text-xs text-indigo-500 mt-2 font-medium">{eta}</p>
      </div>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(v: number | null, decimals = 0): string {
  if (v == null) return '—'
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000)     return `${(v / 1_000).toFixed(decimals > 0 ? decimals : 1)}K`
  return v.toFixed(decimals)
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SeoIntelligencePage() {
  const { id: clientId } = useParams() as { id: string }
  const router = useRouter()

  const [metrics, setMetrics] = useState<SeoMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/seo-intelligence/metrics`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        setMetrics(await res.json())
      } catch (e) {
        setError(e instanceof Error ? e.message : '加载失败')
      } finally {
        setLoading(false)
      }
    })()
  }, [clientId])

  const lastUpdatedLabel = metrics?.last_updated
    ? new Date(metrics.last_updated).toLocaleDateString('zh-CN', {
        timeZone: 'Pacific/Auckland',
        year: 'numeric', month: 'short', day: 'numeric',
      })
    : null

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.back()}
              className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
            >
              ← 返回
            </button>
            <span className="text-gray-300">|</span>
            <h1 className="text-base font-semibold text-gray-900">SEO Intelligence</h1>
          </div>
          {lastUpdatedLabel && (
            <p className="text-xs text-gray-400">数据更新：{lastUpdatedLabel}</p>
          )}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">
        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* ── 顶部指标栏 ─────────────────────────────────────────────────────── */}
        <section>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
            SEO 域名快照
          </p>
          {loading ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-20 bg-white rounded-xl border border-gray-200 animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <StatCard
                icon="🔑"
                label="收录关键词"
                value={fmt(metrics?.organic_keywords ?? null)}
                sub="自然搜索关键词总数"
              />
              <StatCard
                icon="📈"
                label="月均流量"
                value={fmt(metrics?.organic_traffic ?? null)}
                sub="估算自然搜索月访量"
              />
              <StatCard
                icon="⭐"
                label="权威分"
                value={metrics?.authority_score != null ? String(Math.round(metrics.authority_score)) : '—'}
                sub="0–100，越高越强"
              />
              <StatCard
                icon="📝"
                label="已发布博客"
                value={fmt(metrics?.published_posts ?? null, 0)}
                sub="ME 内已发布文章数"
              />
            </div>
          )}

          {/* No data hint */}
          {!loading && !error && metrics?.last_updated == null && (
            <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
              尚无 SEO 指标快照。周 Cron 任务将自动拉取数据，或联系 FDE 手动触发一次 SEMrush 同步。
            </div>
          )}
        </section>

        {/* ── Panel A 占位 ───────────────────────────────────────────────────── */}
        <section>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
            了解自己
          </p>
          <PanelPlaceholder
            icon="🔍"
            title="Organic Rankings — 关键词排名表 + Intent 分布"
            desc="展示网站自然排名的前 200 词，按搜索意图（Transactional / Informational / Navigational）分类，可筛选 Intent、排名段位、品牌/非品牌词。"
            eta="P12.I.2 实施"
          />
        </section>

        {/* ── Panel B 占位 ───────────────────────────────────────────────────── */}
        <section>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
            了解对手
          </p>
          <PanelPlaceholder
            icon="🥊"
            title="竞品并排对比 + 关键词缺口 Venn 图"
            desc="从 DataForSEO 自动拉取竞品关键词，计算「只有竞品有、客户没有」的 Untapped 词集合，一键生成博客 → 写入飞轮执行看板。"
            eta="P12.I.3 实施"
          />
        </section>

        {/* ── SEO Gap 快捷入口 ───────────────────────────────────────────────── */}
        <section>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
            工具
          </p>
          <Link
            href={`/dashboard/clients/${clientId}/seo-gap`}
            className="flex items-center gap-3 bg-white rounded-xl border border-gray-200 hover:border-indigo-300 hover:shadow-sm p-4 transition-all group"
          >
            <span className="text-2xl">📊</span>
            <div className="flex-1">
              <p className="text-sm font-semibold text-gray-900">SEO Gap 分析</p>
              <p className="text-xs text-gray-400 mt-0.5">对比竞品，找出高机会关键词缺口</p>
            </div>
            <span className="text-gray-300 group-hover:text-indigo-400 transition-colors">→</span>
          </Link>
        </section>
      </div>
    </div>
  )
}
