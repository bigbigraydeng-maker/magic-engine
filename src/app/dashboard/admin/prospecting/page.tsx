'use client'

/**
 * Admin Prospecting console — Phase 35 outbound pipeline (P35.6a minimal UI).
 *
 * Internal sales tool: pull a business-listings seed (industry × city),
 * run rule-based audit batches, and review scored prospects. This page is
 * the PM-facing way to exercise the pipeline end-to-end without curl.
 */

import { useState, useEffect, useCallback } from 'react'
import { INDUSTRY_CATEGORIES, CITY_COORDS } from '@/lib/dataforseo/business-listings'

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
}

const FILTERS = ['all', 'discovered', 'qualified', 'audited'] as const

export default function ProspectingPage() {
  const [industry, setIndustry] = useState('flooring')
  const [city, setCity] = useState('brisbane')
  const [rows, setRows] = useState<ProspectRow[]>([])
  const [total, setTotal] = useState(0)
  const [filter, setFilter] = useState<string>('all')
  const [busy, setBusy] = useState<'' | 'discover' | 'audit'>('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

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
      const data = await res.json() as { discovered?: number; inserted?: number; skipped?: number; error?: string }
      if (!res.ok) throw new Error(data.error ?? '拉取失败')
      setMessage(`发现 ${data.discovered} 家，新入库 ${data.inserted}，去重跳过 ${data.skipped}`)
      await fetchList()
    } catch (e) {
      setError(e instanceof Error ? e.message : '拉取失败')
    } finally {
      setBusy('')
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
      <div>
        <h1 className="text-xl font-semibold text-me-charcoal">Prospecting 获客管线</h1>
        <p className="text-sm text-me-charcoal/50 mt-1">
          内部销售工具 · 批量发现 → 规则审计 → 机会分 ≥55 合格（共 {total} 条）
        </p>
      </div>

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
              return (
                <tr key={r.id} className="border-b border-me-charcoal/5">
                  <td className="px-4 py-3 font-medium text-me-charcoal">{r.business_name}</td>
                  <td className="px-4 py-3 text-me-charcoal/60">{r.industry} · {r.city}</td>
                  <td className="px-4 py-3 text-me-charcoal/60">
                    {r.domain
                      ? <a href={`https://${r.domain}`} target="_blank" rel="noreferrer" className="underline">{r.domain}</a>
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
                  <td className="px-4 py-3 text-me-charcoal/60">{r.email ?? r.phone ?? '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
