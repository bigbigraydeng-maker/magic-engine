'use client'

/**
 * Prospecting CRM — the "see every prospect's progress at a glance" view
 * (Phase 35). Funnel counts + a needs-attention bar + a kanban board grouped
 * by pipeline stage, with a per-prospect detail drawer. Read-mostly: sending
 * still happens in the 外呼审核 (OutreachQueue) tab; here you triage.
 */

import { useState, useEffect, useCallback } from 'react'
import { INDUSTRY_CATEGORIES } from '@/lib/dataforseo/business-listings'

interface Card {
  id: string
  business_name: string
  industry: string
  city: string
  domain: string | null
  rating: number | null
  review_count: number | null
  prospect_score: number | null
  status: string
}

interface Summary {
  counts: Record<string, number>
  parked: number
}

// Forward funnel — the columns of the board, in order. (audited = screened out,
// archived / opted_out = terminal: not shown on the board.)
const COLUMNS: Array<{ status: string; label: string; dot: string; step: number }> = [
  { status: 'discovered',     label: 'Discovered',    dot: '#B7B1A5', step: 1 },
  { status: 'qualified',      label: 'Qualified',     dot: '#5C8A4A', step: 2 },
  { status: 'analyzed',       label: 'Analyzed',      dot: '#C4912E', step: 3 },
  { status: 'outreach_ready', label: 'Ready to send', dot: '#C4912E', step: 4 },
  { status: 'contacted',      label: 'Contacted',     dot: '#B7B1A5', step: 5 },
  { status: 'replied',        label: 'Replied 💬',    dot: '#5C8A4A', step: 6 },
  { status: 'converted',      label: 'Won ★',         dot: '#EBCB8B', step: 7 },
]
const STEP_BY_STATUS: Record<string, number> =
  Object.fromEntries(COLUMNS.map(c => [c.status, c.step]))
const CARDS_PER_COL = 12
const INDUSTRIES = Object.keys(INDUSTRY_CATEGORIES)

function scoreClass(v: number | null): string {
  if (v == null) return 'bg-me-charcoal/5 text-me-charcoal/40'
  if (v < 40) return 'bg-[#C2453A]/10 text-[#C2453A]'
  if (v < 70) return 'bg-me-ochre/15 text-me-ochre'
  return 'bg-[#5C8A4A]/15 text-[#5C8A4A]'
}

function Stepper({ status }: { status: string }) {
  const done = STEP_BY_STATUS[status] ?? 0
  return (
    <div className="flex gap-[3px]">
      {[1, 2, 3, 4, 5, 6, 7].map(i => (
        <span key={i} className="h-[3px] w-3 rounded-full"
          style={{ background: i <= done ? '#C4912E' : '#EAE6DF' }} />
      ))}
    </div>
  )
}

export default function PipelineCRM() {
  const [summary, setSummary] = useState<Summary | null>(null)
  const [columns, setColumns] = useState<Record<string, Card[]>>({})
  const [industry, setIndustry] = useState('')
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const q = industry ? `&industry=${industry}` : ''
    const [sumRes, ...colRes] = await Promise.all([
      fetch('/api/admin/prospecting/summary').then(r => r.json()).catch(() => null),
      ...COLUMNS.map(c =>
        fetch(`/api/admin/prospecting?status=${c.status}&limit=${CARDS_PER_COL}${q}`)
          .then(r => r.json()).catch(() => ({ prospects: [] }))),
    ])
    setSummary(sumRes)
    const byStatus: Record<string, Card[]> = {}
    COLUMNS.forEach((c, i) => { byStatus[c.status] = (colRes[i]?.prospects ?? []) as Card[] })
    setColumns(byStatus)
    setLoading(false)
  }, [industry])

  useEffect(() => { void load() }, [load])

  const counts = summary?.counts ?? {}
  const funnel = COLUMNS.map(c => ({ ...c, n: counts[c.status] ?? 0 }))

  return (
    <div className="space-y-5">
      {/* Funnel */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {funnel.map((s, i) => (
          <div key={s.status} className="min-w-[110px] flex-1 rounded-2xl border border-me-charcoal/10 bg-white px-3.5 py-3">
            <div className="font-display text-2xl font-bold"
              style={{ color: s.status === 'converted' ? '#5C8A4A' : s.status === 'outreach_ready' ? '#C4912E' : '#1A1A1A' }}>
              {s.n}
            </div>
            <div className="mt-0.5 text-[10px] uppercase tracking-wide text-me-charcoal/45">{s.label}</div>
            {i < funnel.length - 1 && funnel[i].n > 0 && (
              <div className="mt-1 text-[9px] text-me-charcoal/30">
                {Math.round((funnel[i + 1].n / funnel[i].n) * 100)}% →
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Needs-attention bar */}
      <div className="flex flex-wrap gap-3">
        <div className="flex items-center gap-2.5 rounded-2xl border border-me-ochre/40 bg-me-ochre/5 px-4 py-3">
          <span className="text-xl font-bold text-me-ochre">{counts.outreach_ready ?? 0}</span>
          <span className="text-xs leading-tight text-me-charcoal/60">📤 草稿待发<br/>去「外呼审核」审+发</span>
        </div>
        <div className="flex items-center gap-2.5 rounded-2xl border border-[#C2453A]/40 bg-[#C2453A]/5 px-4 py-3">
          <span className="text-xl font-bold text-[#C2453A]">{counts.replied ?? 0}</span>
          <span className="text-xs leading-tight text-me-charcoal/60">💬 有人回复<br/>赶紧跟进</span>
        </div>
        <div className="flex items-center gap-2.5 rounded-2xl border border-me-charcoal/10 bg-white px-4 py-3">
          <span className="text-xl font-bold text-me-charcoal/55">{summary?.parked ?? 0}</span>
          <span className="text-xs leading-tight text-me-charcoal/60">🅿️ 卡住的<br/>处理失败,需看</span>
        </div>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-me-charcoal/50">行业</span>
        <select value={industry} onChange={e => setIndustry(e.target.value)}
          className="rounded-lg border border-me-charcoal/15 px-3 py-1.5 text-sm">
          <option value="">全部</option>
          {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
        </select>
        {loading && <span className="text-xs text-me-charcoal/40">加载中…</span>}
      </div>

      {/* Kanban */}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {COLUMNS.map(col => {
          const cards = columns[col.status] ?? []
          const total = counts[col.status] ?? 0
          return (
            <div key={col.status} className="w-[190px] flex-none">
              <div className="flex items-center justify-between px-1 pb-2 text-[11px] font-semibold uppercase tracking-wide text-me-charcoal/50">
                <span><span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: col.dot }} />{col.label}</span>
                <span>{total}</span>
              </div>
              {cards.map(c => (
                <button key={c.id} onClick={() => setSelected(c.id)}
                  className="mb-2.5 block w-full rounded-2xl border border-me-charcoal/10 bg-white p-3 text-left shadow-sm hover:border-me-ochre/40">
                  <div className="text-[13px] font-semibold text-me-charcoal">{c.business_name}</div>
                  <div className="mt-0.5 text-[11px] text-me-charcoal/45">{c.industry} · {c.city}</div>
                  <div className="mt-2 flex items-center justify-between">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${scoreClass(c.prospect_score)}`}>
                      {c.prospect_score ?? '—'}
                    </span>
                    <Stepper status={c.status} />
                  </div>
                </button>
              ))}
              {total > cards.length && (
                <div className="py-1 text-center text-[11px] text-me-charcoal/40">+ {total - cards.length} more</div>
              )}
              {total === 0 && <div className="py-3 text-center text-[11px] text-me-charcoal/25">—</div>}
            </div>
          )
        })}
      </div>

      {selected && <DetailDrawer id={selected} onClose={() => setSelected(null)} onChanged={load} />}
    </div>
  )
}

// ─── Detail drawer ────────────────────────────────────────────────────────────

interface FullProspect {
  id: string
  business_name: string
  industry: string
  city: string
  status: string
  domain: string | null
  website_url: string | null
  phone: string | null
  email: string | null
  rating: number | null
  review_count: number | null
  prospect_score: number | null
  ai_report: {
    segment?: string
    owner_name?: string | null
    top_problems?: string[]
    email_hook?: string
    pillars?: Record<string, { score: number; summary: string }>
    geo_probe?: { mentioned: boolean; competitors_mentioned: string[] } | null
    error?: string
    draft_error?: string
  } | null
}

function DetailDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [p, setP] = useState<FullProspect | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    let active = true
    fetch(`/api/admin/prospecting/${id}`).then(r => r.json()).then(d => {
      if (active) setP((d.prospect ?? null) as FullProspect | null)
    }).catch(() => { if (active) setMsg('加载失败') })
    return () => { active = false }
  }, [id])

  async function act(action: 'archive' | 'opt_out') {
    setBusy(true); setMsg('')
    try {
      const res = await fetch(`/api/admin/prospecting/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
      })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error ?? '操作失败')
      onChanged(); onClose()
    } catch (e) {
      setMsg(e instanceof Error ? e.message : '操作失败'); setBusy(false)
    }
  }

  const r = p?.ai_report
  const reportBase = process.env.NEXT_PUBLIC_REPORT_BASE_URL || process.env.NEXT_PUBLIC_SITE_URL || ''

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-me-charcoal/30" />
      <div className="relative h-full w-full max-w-md overflow-y-auto bg-me-ivory p-6 shadow-xl" onClick={e => e.stopPropagation()}>
        <button onClick={onClose} className="mb-4 text-sm text-me-charcoal/50">✕ 关闭</button>
        {!p && <p className="text-sm text-me-charcoal/40">{msg || '加载中…'}</p>}
        {p && (
          <div className="space-y-4">
            <div>
              <h2 className="font-display text-xl font-semibold">{p.business_name}</h2>
              <p className="mt-0.5 text-xs text-me-charcoal/50">
                {p.industry} · {p.city} · {p.rating != null ? `★${p.rating} (${p.review_count ?? 0})` : '—'}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${scoreClass(p.prospect_score)}`}>机会分 {p.prospect_score ?? '—'}</span>
                <span className="rounded-full bg-me-charcoal/5 px-2 py-0.5 text-xs text-me-charcoal/60">{p.status}</span>
              </div>
            </div>

            {(r?.error || r?.draft_error) && (
              <div className="rounded-lg bg-[#C2453A]/8 px-3 py-2 text-xs text-[#C2453A]">
                🅿️ 卡住：{r.error || `草稿生成失败 (${r.draft_error})`}
              </div>
            )}

            {r?.pillars && (
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(r.pillars).map(([k, v]) => (
                  <div key={k} className="rounded-lg border border-me-charcoal/10 bg-white px-3 py-2">
                    <div className="text-[10px] uppercase text-me-charcoal/40">{k}</div>
                    <div className="text-lg font-semibold">{v.score}</div>
                    <div className="text-[11px] text-me-charcoal/55">{v.summary}</div>
                  </div>
                ))}
              </div>
            )}

            {r?.geo_probe && (
              <p className="text-xs text-me-charcoal/70">
                <span className="font-medium">AI 搜索：</span>
                {r.geo_probe.mentioned ? '✅ 出现' : '❌ 不出现'}
                {r.geo_probe.competitors_mentioned.length > 0 && `（竞品：${r.geo_probe.competitors_mentioned.join('、')}）`}
              </p>
            )}

            {(r?.top_problems?.length ?? 0) > 0 && (
              <ul className="list-disc space-y-1 pl-5 text-xs text-me-charcoal/70">
                {r!.top_problems!.map((t, i) => <li key={i}>{t}</li>)}
              </ul>
            )}

            {r?.email_hook && (
              <div className="rounded-lg border border-me-charcoal/10 bg-white px-3 py-2 text-xs text-me-charcoal/80">✉️ {r.email_hook}</div>
            )}

            <div className="flex flex-wrap gap-2 pt-2">
              {reportBase && (
                <a href={`${reportBase.replace(/\/$/, '')}/report/${p.id}`} target="_blank" rel="noreferrer"
                  className="rounded-lg bg-me-charcoal px-3 py-1.5 text-xs font-semibold text-white">看客户报告页 →</a>
              )}
              <button onClick={() => void act('archive')} disabled={busy}
                className="rounded-lg border border-me-charcoal/15 px-3 py-1.5 text-xs text-me-charcoal/70 disabled:opacity-40">归档</button>
              <button onClick={() => void act('opt_out')} disabled={busy}
                className="rounded-lg border border-[#C2453A]/25 px-3 py-1.5 text-xs text-[#C2453A]/80 disabled:opacity-40">🚫 拒收</button>
            </div>
            {p.status === 'outreach_ready' && (
              <p className="text-[11px] text-me-charcoal/45">这家草稿已就绪——去「📮 外呼审核」tab 审核+发送。</p>
            )}
            {msg && <p className="text-xs text-[#C2453A]">{msg}</p>}
          </div>
        )}
      </div>
    </div>
  )
}
