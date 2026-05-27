'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

// ─── Types ────────────────────────────────────────────────────────────────────

interface GscTopQuery {
  query: string
  clicks: number
  impressions: number
  ctr: number
  position: number
}

interface GscTopPage {
  page: string
  clicks: number
  impressions: number
  ctr: number
  position: number
}

interface GscSnapshot {
  total_clicks: number
  total_impressions: number
  avg_ctr: number
  avg_position: number
  top_queries: GscTopQuery[]
  top_pages: GscTopPage[]
  period_start: string
  period_end: string
  synced_at: string
}

interface Ga4TopPage {
  page: string
  pageviews: number
  sessions: number
}

interface Ga4TopSource {
  source: string
  medium: string
  sessions: number
}

interface Ga4Snapshot {
  total_sessions: number
  total_users: number
  total_pageviews: number
  bounce_rate: number
  top_pages: Ga4TopPage[]
  top_sources: Ga4TopSource[]
  period_start: string
  period_end: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`
}

// ─── Shared primitives ────────────────────────────────────────────────────────

function MetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-100 bg-white px-2 py-1.5">
      <p className="text-[9px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-sm font-bold leading-tight text-slate-800">{value}</p>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-3 text-[10px] font-black uppercase tracking-[0.14em] text-cyan-800">
      {children}
    </p>
  )
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={`text-[10px] font-semibold uppercase tracking-wide text-slate-400 pb-1.5 ${right ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  )
}

function Td({ children, right, mono }: { children: React.ReactNode; right?: boolean; mono?: boolean }) {
  return (
    <td className={`py-1 text-[11px] text-slate-700 ${right ? 'text-right tabular-nums' : ''} ${mono ? 'font-mono' : ''}`}>
      {children}
    </td>
  )
}

// ─── Section A: GSC 概览 ──────────────────────────────────────────────────────

function GscSection({ snapshot }: { snapshot: GscSnapshot }) {
  const queries = snapshot.top_queries.slice(0, 10)
  const period = `${snapshot.period_start} – ${snapshot.period_end}`

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-4 flex items-center gap-2">
        <span className="text-base leading-none">🔎</span>
        <SectionTitle>搜索洞察 概览</SectionTitle>
        <span className="ml-auto text-[10px] text-slate-400">{period}</span>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MetricTile label="点击量" value={fmtNum(snapshot.total_clicks)} />
        <MetricTile label="展示量" value={fmtNum(snapshot.total_impressions)} />
        <MetricTile label="平均 CTR" value={pct(snapshot.avg_ctr)} />
        <MetricTile label="平均排名" value={snapshot.avg_position.toFixed(1)} />
      </div>

      {queries.length > 0 && (
        <>
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            热门关键词 (top 10)
          </p>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-slate-100">
                  <Th>关键词</Th>
                  <Th right>点击</Th>
                  <Th right>展示</Th>
                  <Th right>CTR</Th>
                  <Th right>排名</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {queries.map((q, i) => (
                  <tr key={i}>
                    <Td>
                      <span className="line-clamp-1 max-w-[240px] block">{q.query}</span>
                    </Td>
                    <Td right>{fmtNum(q.clicks)}</Td>
                    <Td right>{fmtNum(q.impressions)}</Td>
                    <Td right>{pct(q.ctr)}</Td>
                    <Td right>{q.position.toFixed(1)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Section B: GA4 概览 ──────────────────────────────────────────────────────

function Ga4Section({ snapshot }: { snapshot: Ga4Snapshot }) {
  const sources = snapshot.top_sources.slice(0, 10)
  const pages = snapshot.top_pages.slice(0, 10)
  const period = `${snapshot.period_start} – ${snapshot.period_end}`

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-4 flex items-center gap-2">
        <span className="text-base leading-none">📈</span>
        <SectionTitle>数据分析 概览</SectionTitle>
        <span className="ml-auto text-[10px] text-slate-400">{period}</span>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MetricTile label="会话数" value={fmtNum(snapshot.total_sessions)} />
        <MetricTile label="用户数" value={fmtNum(snapshot.total_users)} />
        <MetricTile label="页面浏览" value={fmtNum(snapshot.total_pageviews)} />
        <MetricTile label="跳出率" value={pct(snapshot.bounce_rate)} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {sources.length > 0 && (
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              流量来源 (top 10)
            </p>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-slate-100">
                    <Th>来源 / 媒介</Th>
                    <Th right>会话</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {sources.map((s, i) => (
                    <tr key={i}>
                      <Td>
                        <span className="line-clamp-1 max-w-[180px] block">
                          {s.source}{s.medium && s.medium !== '(none)' ? ` / ${s.medium}` : ''}
                        </span>
                      </Td>
                      <Td right>{fmtNum(s.sessions)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {pages.length > 0 && (
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              热门页面 (top 10)
            </p>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-slate-100">
                    <Th>页面</Th>
                    <Th right>浏览量</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {pages.map((p, i) => (
                    <tr key={i}>
                      <Td>
                        <span className="line-clamp-1 max-w-[180px] block font-mono text-[10px]">
                          {p.page}
                        </span>
                      </Td>
                      <Td right>{fmtNum(p.pageviews)}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Section C: 快速夺旗机会 ──────────────────────────────────────────────────

interface FlagOpportunity {
  query: string
  impressions: number
  position: number
  score: number
}

function computeOpportunities(queries: GscTopQuery[]): FlagOpportunity[] {
  return queries
    .filter(q => q.position > 10 && q.impressions > 50)
    .map(q => ({
      query: q.query,
      impressions: q.impressions,
      position: q.position,
      score: q.impressions * (1 - Math.min(q.ctr / 0.05, 1)),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
}

function FlagOpportunitiesSection({ queries }: { queries: GscTopQuery[] }) {
  const opportunities = computeOpportunities(queries)
  if (opportunities.length === 0) return null

  return (
    <div className="rounded-xl border border-amber-100 bg-amber-50 p-5">
      <div className="mb-4 flex items-center gap-2">
        <span className="text-base leading-none">🚩</span>
        <SectionTitle>快速夺旗机会</SectionTitle>
      </div>

      <p className="mb-3 text-[11px] text-slate-500">
        排名靠后、但曝光充足的关键词——优化 title/meta 可快速提升点击率。
        筛选条件：排名 &gt; 10，展示量 &gt; 50。
      </p>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-amber-200">
              <Th>关键词</Th>
              <Th right>展示量</Th>
              <Th right>当前排名</Th>
              <th className="text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400 pb-1.5 pl-4">
                建议
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-amber-50">
            {opportunities.map((opp, i) => (
              <tr key={i}>
                <Td>
                  <span className="line-clamp-1 max-w-[200px] block">{opp.query}</span>
                </Td>
                <Td right>{fmtNum(opp.impressions)}</Td>
                <Td right>{opp.position.toFixed(1)}</Td>
                <td className="py-1 pl-4 text-[11px] text-slate-500">
                  排名靠后、曝光充足——优化 title/meta 可快速提升点击
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Skeleton loader ──────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="space-y-6">
      {[1, 2, 3].map(i => (
        <div key={i} className="animate-pulse rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-4 h-4 w-40 rounded bg-slate-100" />
          <div className="grid grid-cols-4 gap-2">
            {[1, 2, 3, 4].map(j => (
              <div key={j} className="h-12 rounded-md bg-slate-100" />
            ))}
          </div>
          <div className="mt-4 space-y-2">
            {[1, 2, 3, 4, 5].map(k => (
              <div key={k} className="h-6 rounded bg-slate-50" />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

type LoadState = 'loading' | 'empty' | 'ready'

export function ClientDataTab({ clientId }: { clientId: string }) {
  const [gsc, setGsc] = useState<GscSnapshot | null>(null)
  const [ga4, setGa4] = useState<Ga4Snapshot | null>(null)
  const [state, setState] = useState<LoadState>('loading')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [gscRes, ga4Res] = await Promise.allSettled([
        fetch(`/api/clients/${clientId}/gsc/snapshots?limit=1`),
        fetch(`/api/clients/${clientId}/ga4/snapshots?limit=1`),
      ])

      if (cancelled) return

      let gscData: GscSnapshot | null = null
      let ga4Data: Ga4Snapshot | null = null

      if (gscRes.status === 'fulfilled' && gscRes.value.ok) {
        const body = await gscRes.value.json() as { latest: GscSnapshot | null }
        gscData = body.latest ?? null
      }
      if (ga4Res.status === 'fulfilled' && ga4Res.value.ok) {
        const body = await ga4Res.value.json() as { latest: Ga4Snapshot | null }
        ga4Data = body.latest ?? null
      }

      setGsc(gscData)
      setGa4(ga4Data)
      setState(gscData || ga4Data ? 'ready' : 'empty')
    })()
    return () => { cancelled = true }
  }, [clientId])

  if (state === 'loading') return <Skeleton />

  if (state === 'empty') {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-slate-200 bg-white py-12 text-center">
        <span className="text-3xl">📡</span>
        <p className="text-sm font-black text-slate-700">暂无数据</p>
        <p className="max-w-xs text-xs font-semibold text-slate-400">
          请先在连接页面完成平台授权并同步，数据同步后将在此展示。
        </p>
        <Link
          href={`/dashboard/clients/${clientId}/connectors`}
          className="mt-1 rounded-lg bg-slate-950 px-4 py-2 text-sm font-black text-white transition-colors hover:bg-slate-800"
        >
          前往连接页面 →
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {gsc && <GscSection snapshot={gsc} />}
      {ga4 && <Ga4Section snapshot={ga4} />}
      {gsc && gsc.top_queries.length > 0 && (
        <FlagOpportunitiesSection queries={gsc.top_queries} />
      )}
    </div>
  )
}
