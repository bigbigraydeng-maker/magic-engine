'use client'

/**
 * Admin Prospecting console — Phase 35 outbound pipeline (P35.6a minimal UI).
 *
 * Internal sales tool: pull a business-listings seed (industry × city),
 * run rule-based audit batches, and review scored prospects. This page is
 * the PM-facing way to exercise the pipeline end-to-end without curl.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { INDUSTRY_CATEGORIES, CITY_COORDS } from '@/lib/dataforseo/business-listings'
import OutreachQueue from './_components/OutreachQueue'

interface ProspectRow {
  id: string
  business_name: string
  industry: string
  city: string
  country: string
  domain: string | null
  phone: string | null
  email: string | null
  rating: number | null
  review_count: number | null
  prospect_score: number | null
  status: string
  created_at: string
  audited_at: string | null
}

const INDUSTRIES = Object.keys(INDUSTRY_CATEGORIES)
const CITIES = Object.keys(CITY_COORDS)

const STATUS_META: Record<string, { label: string; cls: string }> = {
  discovered:     { label: '已发现',   cls: 'bg-me-ivory text-me-charcoal/60' },
  audited:        { label: '未达标',   cls: 'bg-me-charcoal/5 text-me-charcoal/50' },
  qualified:      { label: '✦ 合格',  cls: 'bg-[#5C8A4A]/12 text-[#5C8A4A]' },
  analyzed:       { label: 'AI 已析',  cls: 'bg-me-ochre/10 text-me-ochre' },
  outreach_ready: { label: '待人审',   cls: 'bg-me-ochre/10 text-me-ochre' },
  contacted:      { label: '已联系',   cls: 'bg-me-ivory text-me-charcoal/60' },
  replied:        { label: '已回复',   cls: 'bg-[#5C8A4A]/12 text-[#5C8A4A]' },
  converted:      { label: '已转化',   cls: 'bg-[#5C8A4A]/20 text-[#5C8A4A]' },
  archived:       { label: '已归档',   cls: 'bg-me-charcoal/5 text-me-charcoal/40' },
  opted_out:      { label: '🚫 拒收',  cls: 'bg-[#C2453A]/10 text-[#C2453A]/70' },
}

const FILTERS = ['all', 'discovered', 'qualified', 'analyzed', 'audited'] as const

const SEGMENT_LABELS: Record<string, string> = {
  core_target: '核心靶', blind_flyer: '盲飞型', social_gap: '社媒空窗', general: '通用',
}

interface PillarScore { score: number; summary: string }
interface AiReport {
  segment?: string
  owner_name?: string | null
  top_problems?: string[]
  email_hook?: string
  pillars?: { seo: PillarScore; geo: PillarScore; social: PillarScore; gbp: PillarScore }
  geo_probe?: { question: string; mentioned: boolean; competitors_mentioned: string[] } | null
  social_activity?: { platform: string; followers: number; posts_last_30d: number } | null
  error?: string
}

export default function ProspectingPage() {
  const [tab, setTab] = useState<'pipeline' | 'outreach'>('pipeline')
  const [industry, setIndustry] = useState('flooring')
  const [city, setCity] = useState('brisbane')
  const [rows, setRows] = useState<ProspectRow[]>([])
  const [total, setTotal] = useState(0)
  const [filter, setFilter] = useState<string>('all')
  const [busy, setBusy] = useState<'' | 'discover' | 'audit' | 'analyze'>('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<AiReport | null>(null)
  // Latest requested detail id — guards against out-of-order responses
  // showing prospect A's scorecard under prospect B's row.
  const detailRequestRef = useRef<string | null>(null)

  const fetchList = useCallback(async () => {
    const qs = new URLSearchParams({ limit: '50' })
    if (filter !== 'all') qs.set('status', filter)
    const res = await fetch(`/api/admin/prospecting?${qs}`)
    const data = await res.json() as { prospects?: ProspectRow[]; total?: number; error?: string }
    if (!res.ok) { setError(data.error ?? '加载失败'); return }
    setRows(data.prospects ?? [])
    setTotal(data.total ?? 0)
  }, [filter])

  useEffect(() => { void fetchList() }, [fetchList])

  async function runDiscover() {
    setBusy('discover'); setError(''); setMessage('')
    try {
      const res = await fetch('/api/admin/prospecting/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ industry, city }),
      })
      // Read text first so a platform HTML error page (timeout / crash) shows
      // its real status code instead of an opaque "Unexpected token '<'".
      const raw = await res.text()
      let data: { discovered?: number; inserted?: number; skipped?: number; error?: string }
      try {
        data = raw ? JSON.parse(raw) : {}
      } catch {
        throw new Error(`服务器返回非 JSON（HTTP ${res.status}${res.status >= 502 ? '，疑似请求超时' : ''}）：${raw.replace(/\s+/g, ' ').trim().slice(0, 140)}`)
      }
      if (!res.ok) throw new Error(data.error ?? `拉取失败（HTTP ${res.status}）`)
      setMessage(`发现 ${data.discovered} 家，新入库 ${data.inserted}，去重跳过 ${data.skipped}`)
      await fetchList()
    } catch (e) {
      setError(e instanceof Error ? e.message : '拉取失败')
    } finally {
      setBusy('')
    }
  }

  // Sequential single-prospect requests: one analysis can take ~2 minutes,
  // so a 3-prospect batch in one HTTP call would outlive the proxy timeout.
  async function runAnalyze() {
    setBusy('analyze'); setError(''); setMessage('')
    try {
      let done = 0, remaining: number | null = null
      for (let i = 0; i < 3; i++) {
        setMessage(`AI 分析第 ${i + 1}/3 家…`)
        const res = await fetch('/api/admin/prospecting/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ limit: 1 }),
        })
        const data = await res.json() as { analyzed?: number; retrying?: number; remaining?: number; error?: string }
        if (!res.ok) throw new Error(data.error ?? 'AI 分析失败')
        done += data.analyzed ?? 0
        remaining = data.remaining ?? null
        if ((data.analyzed ?? 0) === 0 && (data.retrying ?? 0) === 0) break  // queue empty
        await fetchList()
      }
      setMessage(`本轮 AI 分析完成 ${done} 家，剩余合格待析 ${remaining ?? '—'}`)
      await fetchList()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AI 分析失败')
    } finally {
      setBusy('')
    }
  }

  async function toggleDetail(id: string, status: string) {
    if (expandedId === id) {
      setExpandedId(null); setDetail(null); detailRequestRef.current = null
      return
    }
    if (!['analyzed', 'outreach_ready', 'contacted', 'replied', 'converted'].includes(status)) return
    setExpandedId(id); setDetail(null)
    detailRequestRef.current = id
    try {
      const res = await fetch(`/api/admin/prospecting/${id}`)
      const data = await res.json() as { prospect?: { ai_report?: AiReport | null }; error?: string }
      if (detailRequestRef.current !== id) return
      setDetail(res.ok ? (data.prospect?.ai_report ?? null) : { error: '加载失败' })
    } catch {
      if (detailRequestRef.current === id) setDetail({ error: '加载失败' })
    }
  }

  // Honour an unsubscribe reply: permanent do-not-contact (footer promise).
  async function markOptOut(id: string) {
    setError('')
    try {
      const res = await fetch(`/api/admin/prospecting/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'opt_out' }),
      })
      const data = await res.json() as { error?: string }
      if (!res.ok) throw new Error(data.error ?? '操作失败')
      setMessage('已标记拒收，该商家永不再进入外呼名单')
      await fetchList()
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败')
    }
  }

  async function runAudit() {
    setBusy('audit'); setError(''); setMessage('')
    try {
      const res = await fetch('/api/admin/prospecting/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 5 }),
      })
      const data = await res.json() as { audited?: number; qualified?: number; remaining?: number; error?: string }
      if (!res.ok) throw new Error(data.error ?? '审计失败')
      setMessage(`本批审计 ${data.audited} 家，合格 ${data.qualified}，剩余待审 ${data.remaining}`)
      await fetchList()
    } catch (e) {
      setError(e instanceof Error ? e.message : '审计失败')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-me-charcoal">Prospecting 获客管线</h1>
          <p className="text-sm text-me-charcoal/50 mt-1">
            内部销售工具 · 批量发现 → 规则审计 → AI 分析 → 人审外呼（共 {total} 条）
          </p>
        </div>
        <div className="flex rounded-lg border border-me-charcoal/15 p-0.5 text-sm">
          <button onClick={() => setTab('pipeline')}
            className={`rounded-md px-4 py-1.5 ${tab === 'pipeline' ? 'bg-me-charcoal text-white' : 'text-me-charcoal/60'}`}>
            管线
          </button>
          <button onClick={() => setTab('outreach')}
            className={`rounded-md px-4 py-1.5 ${tab === 'outreach' ? 'bg-me-charcoal text-white' : 'text-me-charcoal/60'}`}>
            📮 外呼审核
          </button>
        </div>
      </div>

      {tab === 'outreach' && <OutreachQueue />}

      {tab === 'pipeline' && <>
      {/* Seed controls */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-me-charcoal/10 bg-white p-4">
        <label className="text-sm text-me-charcoal/70">
          行业
          <select value={industry} onChange={e => setIndustry(e.target.value)}
            className="block mt-1 rounded-lg border border-me-charcoal/15 px-3 py-2 text-sm">
            {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
          </select>
        </label>
        <label className="text-sm text-me-charcoal/70">
          城市
          <select value={city} onChange={e => setCity(e.target.value)}
            className="block mt-1 rounded-lg border border-me-charcoal/15 px-3 py-2 text-sm">
            {CITIES.map(c => <option key={c} value={c}>{c} ({CITY_COORDS[c].country})</option>)}
          </select>
        </label>
        <button onClick={() => void runDiscover()} disabled={busy !== ''}
          className="rounded-lg bg-me-charcoal px-4 py-2 text-sm text-white disabled:opacity-40">
          {busy === 'discover' ? '拉取中…' : '① 拉取商家'}
        </button>
        <button onClick={() => void runAudit()} disabled={busy !== ''}
          className="rounded-lg bg-me-ochre px-4 py-2 text-sm text-white disabled:opacity-40">
          {busy === 'audit' ? '审计中（约 1 分钟）…' : '② 审计下一批 (5)'}
        </button>
        <button onClick={() => void runAnalyze()} disabled={busy !== ''}
          className="rounded-lg bg-[#5C8A4A] px-4 py-2 text-sm text-white disabled:opacity-40">
          {busy === 'analyze' ? 'AI 分析中（1-3 分钟）…' : '③ AI 分析合格者 (3)'}
        </button>
        {message && <span className="text-sm text-[#5C8A4A]">{message}</span>}
        {error && <span className="text-sm text-[#C2453A]">{error}</span>}
      </div>

      {/* Status filter */}
      <div className="flex gap-2">
        {FILTERS.map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1 text-xs ${filter === f
              ? 'bg-me-charcoal text-white'
              : 'bg-me-ivory text-me-charcoal/60'}`}>
            {f === 'all' ? '全部' : STATUS_META[f]?.label ?? f}
          </button>
        ))}
      </div>

      {/* Prospect table */}
      <div className="overflow-x-auto rounded-xl border border-me-charcoal/10 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-me-charcoal/10 text-left text-xs text-me-charcoal/50">
              <th className="px-4 py-3">商家</th>
              <th className="px-4 py-3">行业 / 城市</th>
              <th className="px-4 py-3">网站</th>
              <th className="px-4 py-3">GBP</th>
              <th className="px-4 py-3">机会分</th>
              <th className="px-4 py-3">状态</th>
              <th className="px-4 py-3">联系</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-me-charcoal/40">
                暂无数据 — 选行业和城市后点「① 拉取商家」
              </td></tr>
            )}
            {rows.map(r => {
              const meta = STATUS_META[r.status] ?? { label: r.status, cls: 'bg-me-ivory text-me-charcoal/60' }
              const expandable = ['analyzed', 'outreach_ready', 'contacted', 'replied', 'converted'].includes(r.status)
              return [
                <tr key={r.id} onClick={() => void toggleDetail(r.id, r.status)}
                  className={`border-b border-me-charcoal/5 ${expandable ? 'cursor-pointer hover:bg-me-ivory/40' : ''}`}>
                  <td className="px-4 py-3 font-medium text-me-charcoal">{r.business_name}</td>
                  <td className="px-4 py-3 text-me-charcoal/60">{r.industry} · {r.city}</td>
                  <td className="px-4 py-3 text-me-charcoal/60">
                    {r.domain
                      ? <a href={`https://${r.domain}`} target="_blank" rel="noreferrer" className="underline"
                          onClick={e => e.stopPropagation()}>{r.domain}</a>
                      : <span className="text-me-charcoal/30">无网站</span>}
                  </td>
                  <td className="px-4 py-3 text-me-charcoal/60">
                    {r.rating != null ? `★${r.rating} (${r.review_count ?? 0})` : '—'}
                  </td>
                  <td className="px-4 py-3 font-semibold text-me-charcoal">
                    {r.prospect_score ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${meta.cls}`}>{meta.label}</span>
                  </td>
                  <td className="px-4 py-3 text-me-charcoal/60">
                    {r.email ?? r.phone ?? '—'}
                    {['contacted', 'replied'].includes(r.status) && (
                      <button
                        title="对方回复拒收 — 永不再联系"
                        onClick={e => { e.stopPropagation(); void markOptOut(r.id) }}
                        className="ml-2 rounded border border-[#C2453A]/20 px-1.5 py-0.5 text-[10px] text-[#C2453A]/70">
                        🚫 拒收
                      </button>
                    )}
                  </td>
                </tr>,
                expandedId === r.id && (
                  <tr key={`${r.id}-detail`} className="border-b border-me-charcoal/5 bg-me-ivory/30">
                    <td colSpan={7} className="px-6 py-4">
                      {!detail && <span className="text-sm text-me-charcoal/40">加载中…</span>}
                      {detail?.error && <span className="text-sm text-[#C2453A]">分析失败：{detail.error}</span>}
                      {detail && !detail.error && (
                        <div className="space-y-3 text-sm">
                          <div className="flex flex-wrap gap-4">
                            {detail.pillars && Object.entries(detail.pillars).map(([k, p]) => (
                              <div key={k} className="rounded-lg border border-me-charcoal/10 bg-white px-3 py-2 min-w-[180px] max-w-[260px]">
                                <div className="text-xs uppercase text-me-charcoal/40">{k}</div>
                                <div className="text-lg font-semibold text-me-charcoal">{p.score}</div>
                                <div className="text-xs text-me-charcoal/60">{p.summary}</div>
                              </div>
                            ))}
                          </div>
                          <div className="text-me-charcoal/70">
                            <span className="font-medium">Segment：</span>{SEGMENT_LABELS[detail.segment ?? ''] ?? detail.segment ?? '—'}
                            {detail.owner_name && <span className="ml-4"><span className="font-medium">老板：</span>{detail.owner_name}</span>}
                            {detail.geo_probe && (
                              <span className="ml-4"><span className="font-medium">AI 搜索：</span>
                                {detail.geo_probe.mentioned ? '✅ 出现' : '❌ 不出现'}
                                {detail.geo_probe.competitors_mentioned.length > 0 && `（竞品在场：${detail.geo_probe.competitors_mentioned.join('、')}）`}
                              </span>
                            )}
                          </div>
                          {(detail.top_problems?.length ?? 0) > 0 && (
                            <ul className="list-disc pl-5 text-me-charcoal/70">
                              {detail.top_problems!.map((p, i) => <li key={i}>{p}</li>)}
                            </ul>
                          )}
                          {detail.email_hook && (
                            <div className="rounded-lg bg-white border border-me-charcoal/10 px-3 py-2 text-me-charcoal/80">
                              ✉️ {detail.email_hook}
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                ),
              ]
            })}
          </tbody>
        </table>
      </div>
      </>}
    </div>
  )
}
