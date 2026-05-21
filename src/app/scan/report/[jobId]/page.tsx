'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import type { DiscoveryReport, DiagnosisBlock } from '@/lib/zhangqian/types'

// ─── Logo ─────────────────────────────────────────────────────────────────────

const MagicLogo = () => (
  <svg width="26" height="24" viewBox="0 0 68 64" fill="none" aria-hidden="true">
    <path d="M53 3 L54.3 7.2 L58.5 8.5 L54.3 9.8 L53 14 L51.7 9.8 L47.5 8.5 L51.7 7.2 Z" fill="rgba(240,248,255,0.9)"/>
    <polygon points="3,60 13,6 22,6 12,60" fill="#9ABDE0"/>
    <polygon points="13,6 22,6 33,38 24,38" fill="#789EC8"/>
    <polygon points="46,6 55,6 44,38 35,38" fill="#789EC8"/>
    <polygon points="46,6 55,6 65,60 55,60" fill="#9ABDE0"/>
    <polygon points="24,38 33,38 34,48 35,38 44,38 34,60" fill="#587FAF"/>
  </svg>
)

// ─── Helpers ──────────────────────────────────────────────────────────────────

function scoreColor(v: number) { return v < 40 ? '#ef4444' : v < 65 ? '#eab308' : '#22c55e' }
function scoreLabel(v: number) { return v < 40 ? 'Critical' : v < 65 ? 'Needs Work' : 'Good' }

function fmt(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}k`
  return String(n)
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface LogEntry {
  type: 'step' | 'discovery'
  icon: string
  message: string
  detail?: string | null
  ts: string
}

interface PollResponse {
  job_id: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  progress_log: LogEntry[]
  domain: string
  error: string | null
  result: DiscoveryReport | null
}

// ─── Loading View ─────────────────────────────────────────────────────────────

function LoadingView({ domain, log }: { domain: string; log: LogEntry[] }) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [log.length])

  const elapsedRef = useRef(Date.now())
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - elapsedRef.current) / 1000)), 1000)
    return () => clearInterval(t)
  }, [])

  const mins = Math.floor(elapsed / 60)
  const secs = elapsed % 60
  const elapsedStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`

  return (
    <div className="max-w-xl mx-auto px-5 py-12">
      {/* Header */}
      <div className="text-center mb-8">
        <div
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-semibold mb-4"
          style={{ background: 'rgba(22,45,90,0.7)', border: '1px solid rgba(70,125,215,0.2)', color: '#7ABFFF' }}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
          Scanning {domain}
        </div>
        <h2 className="text-[22px] font-black mb-1" style={{ color: '#ECF3FF' }}>
          AI is mapping your brand…
        </h2>
        <p className="text-[12px]" style={{ color: 'rgba(120,170,230,0.4)' }}>
          {elapsedStr} elapsed · Usually 3–5 minutes total
        </p>
      </div>

      {/* Live discovery feed */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{ background: 'rgba(10,20,40,0.6)', border: '1px solid rgba(70,125,215,0.15)' }}
      >
        <div className="px-5 pt-4 pb-2 flex items-center gap-2"
             style={{ borderBottom: '1px solid rgba(70,125,215,0.08)' }}>
          <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span className="text-[11px] font-semibold uppercase tracking-wider"
                style={{ color: 'rgba(120,170,230,0.5)' }}>Live Discovery Feed</span>
        </div>

        <div className="px-5 py-4 space-y-2.5 max-h-96 overflow-y-auto">
          {log.length === 0 && (
            <div className="text-[12px] py-4 text-center" style={{ color: 'rgba(120,170,230,0.3)' }}>
              Starting scan…
            </div>
          )}
          {log.map((entry, i) => (
            <div
              key={i}
              className="flex items-start gap-3 animate-fade-in"
              style={{
                background: entry.type === 'discovery' ? 'rgba(22,45,90,0.4)' : 'transparent',
                borderRadius: entry.type === 'discovery' ? '10px' : undefined,
                padding: entry.type === 'discovery' ? '8px 10px' : '2px 0',
                border: entry.type === 'discovery' ? '1px solid rgba(70,125,215,0.15)' : 'none',
              }}
            >
              <span className="text-[16px] flex-shrink-0 mt-0.5">{entry.icon}</span>
              <div>
                <p
                  className="text-[12px] leading-snug"
                  style={{ color: entry.type === 'discovery' ? '#A5C8FF' : 'rgba(120,170,230,0.55)' }}
                >
                  {entry.message}
                </p>
                {entry.detail && (
                  <p className="text-[11px] mt-0.5" style={{ color: 'rgba(120,170,230,0.4)' }}>
                    {entry.detail}
                  </p>
                )}
              </div>
              {entry.type === 'discovery' && (
                <span className="ml-auto text-green-400 text-[10px] flex-shrink-0 mt-0.5">✓</span>
              )}
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Note */}
      <p className="text-center text-[11px] mt-5" style={{ color: 'rgba(255,255,255,0.15)' }}>
        You can leave this page — we&apos;ll keep scanning. Come back to this URL to see your report.
      </p>
    </div>
  )
}

// ─── Report sections ──────────────────────────────────────────────────────────

function SectionCard({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl p-6 ${className}`}
      style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(70,125,215,0.12)' }}
    >
      {children}
    </div>
  )
}

function SectionLabel({ icon, label }: { icon: string; label: string }) {
  return (
    <p className="text-[10px] uppercase tracking-wider font-semibold mb-4 flex items-center gap-1.5"
       style={{ color: 'rgba(120,170,230,0.4)' }}>
      <span>{icon}</span> {label}
    </p>
  )
}

function ScoreBar({ label, value, showScores }: { label: string; value: number; showScores: boolean }) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between items-center">
        <span className="text-[12px]" style={{ color: 'rgba(200,225,255,0.6)' }}>{label}</span>
        <span className="text-[12px] font-bold tabular-nums" style={{ color: scoreColor(value) }}>
          {value} <span className="text-[9px] font-normal opacity-60">{scoreLabel(value)}</span>
        </span>
      </div>
      <div className="h-2 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
        <div
          className="h-2 rounded-full transition-all duration-700"
          style={{ width: showScores ? `${value}%` : '0%', background: scoreColor(value) }}
        />
      </div>
    </div>
  )
}

// ─── Full report view ─────────────────────────────────────────────────────────

function ReportView({ report }: { report: DiscoveryReport }) {
  const [showScores, setShowScores] = useState(false)
  useEffect(() => { setTimeout(() => setShowScores(true), 300) }, [])

  const diagnosis = report.diagnosis as DiagnosisBlock | null | undefined
  const snap = report.semrush_snapshot
  const keywords = report.seed_keywords ?? []
  const competitors = report.competitors ?? []
  const socials = report.social_profiles ?? []
  const reviewPlatforms = report.review_platforms ?? []

  const overallScore = diagnosis?.scores?.overall ?? null
  const crisisType = diagnosis?.crisis_type ?? null
  const keyFinding = diagnosis?.key_finding ?? null

  // Compute competitor traffic comparison
  const yourTraffic = snap?.monthly_traffic ?? null
  const topComp = competitors.find(c => c.monthly_traffic && c.monthly_traffic > 0)
  const maxTraffic = Math.max(
    yourTraffic ?? 0,
    ...competitors.map(c => c.monthly_traffic ?? 0),
  ) || 1

  return (
    <div className="max-w-2xl mx-auto px-5 py-10 space-y-5">

      {/* ── Hero summary ──────────────────────────────────────────────── */}
      <SectionCard>
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex-1">
            {crisisType && (
              <div
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider mb-3"
                style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171' }}
              >
                🔴 {crisisType}
              </div>
            )}
            <h2 className="text-[18px] font-black mb-0.5" style={{ color: '#ECF3FF' }}>
              {report.business?.name ?? report.domain}
            </h2>
            <p className="text-[11px] mb-1" style={{ color: 'rgba(120,170,230,0.4)' }}>
              {report.business?.industry?.join(' · ')} · {report.business?.location?.city ?? ''}{report.business?.location?.region ? `, ${report.business.location.region}` : ''}
            </p>
          </div>
          {overallScore !== null && (
            <div className="text-right flex-shrink-0">
              <div className="text-[44px] font-black leading-none tabular-nums"
                   style={{ color: scoreColor(overallScore) }}>
                {overallScore}
              </div>
              <div className="text-[10px]" style={{ color: 'rgba(255,255,255,0.25)' }}>/100</div>
              <div className="text-[10px] font-bold mt-0.5 uppercase tracking-wide"
                   style={{ color: scoreColor(overallScore) }}>
                {scoreLabel(overallScore)}
              </div>
            </div>
          )}
        </div>

        {keyFinding && (
          <div className="pt-4" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
            <p className="text-[12px] italic" style={{ color: 'rgba(160,200,255,0.5)' }}>
              &ldquo;{keyFinding}&rdquo;
            </p>
          </div>
        )}

        {/* Quick stats */}
        {(snap?.monthly_traffic || snap?.trust_score || report.gbp?.review_count || socials.length > 0) && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
            {snap?.trust_score != null && (
              <div className="rounded-xl p-3 text-center"
                   style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(70,125,215,0.1)' }}>
                <div className="text-[18px] font-black" style={{ color: '#A5C8FF' }}>{snap.trust_score}</div>
                <div className="text-[9px] uppercase tracking-wide mt-0.5" style={{ color: 'rgba(120,170,230,0.4)' }}>Authority</div>
              </div>
            )}
            {snap?.monthly_traffic != null && (
              <div className="rounded-xl p-3 text-center"
                   style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(70,125,215,0.1)' }}>
                <div className="text-[18px] font-black" style={{ color: '#A5C8FF' }}>{fmt(snap.monthly_traffic)}</div>
                <div className="text-[9px] uppercase tracking-wide mt-0.5" style={{ color: 'rgba(120,170,230,0.4)' }}>Monthly Traffic</div>
              </div>
            )}
            {report.gbp?.review_count != null && (
              <div className="rounded-xl p-3 text-center"
                   style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(70,125,215,0.1)' }}>
                <div className="text-[18px] font-black" style={{ color: '#A5C8FF' }}>{report.gbp.review_count}</div>
                <div className="text-[9px] uppercase tracking-wide mt-0.5" style={{ color: 'rgba(120,170,230,0.4)' }}>Reviews</div>
              </div>
            )}
            {socials.length > 0 && (
              <div className="rounded-xl p-3 text-center"
                   style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(70,125,215,0.1)' }}>
                <div className="text-[18px] font-black" style={{ color: '#A5C8FF' }}>
                  {fmt(socials.reduce((sum, s) => sum + (s.followers_count ?? 0), 0))}
                </div>
                <div className="text-[9px] uppercase tracking-wide mt-0.5" style={{ color: 'rgba(120,170,230,0.4)' }}>Social Reach</div>
              </div>
            )}
          </div>
        )}
      </SectionCard>

      {/* ── Competitors ────────────────────────────────────────────────── */}
      {competitors.length > 0 && (
        <SectionCard>
          <SectionLabel icon="🏆" label="Competitor Landscape" />
          <div className="space-y-3">
            {/* You */}
            {yourTraffic != null && (
              <div className="flex items-center gap-3">
                <div className="w-28 text-[11px] font-semibold truncate" style={{ color: '#A5C8FF' }}>
                  {report.domain} <span className="text-[9px] opacity-50">(you)</span>
                </div>
                <div className="flex-1 h-2 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
                  <div className="h-2 rounded-full transition-all duration-700"
                       style={{ width: showScores ? `${(yourTraffic / maxTraffic) * 100}%` : '0%', background: '#4ade80' }} />
                </div>
                <div className="text-[11px] tabular-nums w-14 text-right" style={{ color: '#4ade80' }}>
                  {fmt(yourTraffic)}/mo
                </div>
              </div>
            )}
            {competitors.slice(0, 5).map(comp => (
              <div key={comp.domain} className="flex items-center gap-3">
                <div className="w-28 text-[11px] truncate" style={{ color: 'rgba(200,225,255,0.55)' }}>
                  {comp.name ?? comp.domain}
                </div>
                <div className="flex-1 h-2 rounded-full" style={{ background: 'rgba(255,255,255,0.06)' }}>
                  <div className="h-2 rounded-full transition-all duration-700"
                       style={{ width: showScores ? `${((comp.monthly_traffic ?? 0) / maxTraffic) * 100}%` : '0%', background: '#ef4444' }} />
                </div>
                <div className="text-[11px] tabular-nums w-14 text-right" style={{ color: 'rgba(239,68,68,0.7)' }}>
                  {comp.monthly_traffic ? `${fmt(comp.monthly_traffic)}/mo` : '—'}
                </div>
              </div>
            ))}
          </div>
          {topComp?.monthly_traffic && yourTraffic && topComp.monthly_traffic > yourTraffic && (
            <div className="mt-4 pt-4 text-[11px]" style={{ borderTop: '1px solid rgba(255,255,255,0.04)', color: 'rgba(239,68,68,0.65)' }}>
              ⚠️ {topComp.name ?? topComp.domain} has{' '}
              <strong>{Math.round(topComp.monthly_traffic / Math.max(yourTraffic, 1))}×</strong> more organic traffic than you
            </div>
          )}
        </SectionCard>
      )}

      {/* ── Keywords ───────────────────────────────────────────────────── */}
      {keywords.length > 0 && (
        <SectionCard>
          <SectionLabel icon="🔑" label="Keyword Rankings" />
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr style={{ color: 'rgba(120,170,230,0.4)' }}>
                  <th className="text-left pb-2 font-semibold">Keyword</th>
                  <th className="text-right pb-2 font-semibold">Rank</th>
                  <th className="text-right pb-2 font-semibold">Volume/mo</th>
                  <th className="text-right pb-2 font-semibold">Difficulty</th>
                </tr>
              </thead>
              <tbody>
                {keywords.slice(0, 8).map((kw, i) => (
                  <tr key={i} style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
                    <td className="py-2 pr-4" style={{ color: 'rgba(200,225,255,0.7)' }}>{kw.keyword}</td>
                    <td className="py-2 text-right tabular-nums" style={{
                      color: kw.semrush_rank ? (kw.semrush_rank <= 10 ? '#4ade80' : kw.semrush_rank <= 30 ? '#eab308' : '#ef4444') : 'rgba(120,170,230,0.3)',
                    }}>
                      {kw.semrush_rank ? `#${kw.semrush_rank}` : '—'}
                    </td>
                    <td className="py-2 text-right tabular-nums" style={{ color: 'rgba(160,200,255,0.5)' }}>
                      {kw.semrush_volume ? fmt(kw.semrush_volume) : kw.estimated_volume ? `~${fmt(kw.estimated_volume)}` : '—'}
                    </td>
                    <td className="py-2 text-right tabular-nums" style={{
                      color: !kw.semrush_kd ? 'rgba(120,170,230,0.3)' : kw.semrush_kd < 30 ? '#4ade80' : kw.semrush_kd < 60 ? '#eab308' : '#ef4444',
                    }}>
                      {kw.semrush_kd ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {/* ── Social & Reviews ────────────────────────────────────────────── */}
      {(socials.length > 0 || reviewPlatforms.length > 0 || report.gbp) && (
        <SectionCard>
          <SectionLabel icon="📱" label="Social & Reputation" />
          <div className="space-y-4">
            {/* Social platforms */}
            {socials.length > 0 && (
              <div className="space-y-2">
                {socials.map(s => (
                  <div key={s.platform} className="flex items-center justify-between py-2"
                       style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] capitalize">{
                        s.platform === 'instagram' ? '📸' :
                        s.platform === 'tiktok' ? '🎵' :
                        s.platform === 'facebook' ? '👥' :
                        s.platform === 'linkedin' ? '💼' :
                        s.platform === 'youtube' ? '▶️' : '🌐'
                      }</span>
                      <div>
                        <p className="text-[12px] font-semibold" style={{ color: 'rgba(200,225,255,0.7)' }}>
                          {s.handle ?? s.platform}
                        </p>
                        <p className="text-[10px]" style={{ color: 'rgba(120,170,230,0.35)' }}>
                          {s.platform}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      {s.followers_count != null && (
                        <p className="text-[13px] font-bold" style={{ color: '#A5C8FF' }}>
                          {fmt(s.followers_count)}
                        </p>
                      )}
                      {s.engagement_rate != null && (
                        <p className="text-[10px]" style={{ color: 'rgba(120,170,230,0.4)' }}>
                          {(s.engagement_rate * 100).toFixed(1)}% engagement
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* GBP */}
            {report.gbp && (
              <div className="rounded-xl p-4"
                   style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(70,125,215,0.1)' }}>
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-[12px] font-semibold mb-0.5" style={{ color: 'rgba(200,225,255,0.8)' }}>
                      Google Business Profile
                    </p>
                    {report.gbp.address && (
                      <p className="text-[11px]" style={{ color: 'rgba(120,170,230,0.4)' }}>{report.gbp.address}</p>
                    )}
                  </div>
                  {report.gbp.rating && (
                    <div className="text-right">
                      <p className="text-[16px] font-black" style={{ color: '#eab308' }}>
                        ⭐ {report.gbp.rating}
                      </p>
                      {report.gbp.review_count && (
                        <p className="text-[10px]" style={{ color: 'rgba(120,170,230,0.4)' }}>
                          {report.gbp.review_count} reviews
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Other review platforms */}
            {reviewPlatforms.filter(r => r.platform !== 'google').length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                {reviewPlatforms.filter(r => r.platform !== 'google').map(p => (
                  <div key={p.platform} className="rounded-lg p-3 text-center"
                       style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(70,125,215,0.08)' }}>
                    <p className="text-[11px] font-semibold capitalize mb-1" style={{ color: 'rgba(160,200,255,0.6)' }}>
                      {p.platform}
                    </p>
                    {p.rating && <p className="text-[13px] font-bold" style={{ color: '#eab308' }}>⭐ {p.rating}</p>}
                    {p.review_count && <p className="text-[10px]" style={{ color: 'rgba(120,170,230,0.35)' }}>{p.review_count} reviews</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </SectionCard>
      )}

      {/* ── Health Scores ─────────────────────────────────────────────── */}
      {diagnosis?.scores && (
        <SectionCard>
          <SectionLabel icon="🩺" label="Brand Health Scores" />
          <div className="grid sm:grid-cols-2 gap-x-8 gap-y-4">
            {([
              ['seo', 'SEO'],
              ['ai_visibility', 'AI Visibility'],
              ['social', 'Social'],
              ['reputation', 'Reputation'],
            ] as const).map(([key, label]) => {
              const val = (diagnosis.scores as Record<string, number>)[key]
              if (val == null) return null
              return <ScoreBar key={key} label={label} value={val} showScores={showScores} />
            })}
          </div>
          {diagnosis.executive_summary && (
            <div className="mt-5 pt-4 text-[12px] leading-relaxed"
                 style={{ borderTop: '1px solid rgba(255,255,255,0.04)', color: 'rgba(160,200,255,0.5)' }}>
              {diagnosis.executive_summary}
            </div>
          )}
        </SectionCard>
      )}

      {/* ── Action Plan [partially locked] ──────────────────────────── */}
      <div className="rounded-2xl overflow-hidden"
           style={{ border: '1px solid rgba(70,125,215,0.15)' }}>

        {/* Visible quick wins (first 2) */}
        {diagnosis?.actions?.quick_fix && diagnosis.actions.quick_fix.length > 0 && (
          <div className="px-6 pt-5 pb-4"
               style={{ background: 'rgba(255,255,255,0.025)', borderBottom: '1px solid rgba(70,125,215,0.1)' }}>
            <p className="text-[10px] uppercase tracking-wider font-semibold mb-3 flex items-center gap-1.5"
               style={{ color: 'rgba(120,170,230,0.4)' }}>
              <span>💊</span> Quick Wins (do these first)
            </p>
            <div className="space-y-2">
              {diagnosis.actions.quick_fix.slice(0, 2).map((fix, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <span className="text-green-400 text-[12px] mt-0.5 flex-shrink-0">✓</span>
                  <span className="text-[12px]" style={{ color: 'rgba(200,225,255,0.7)' }}>{fix}</span>
                </div>
              ))}
              {diagnosis.actions.quick_fix.length > 2 && (
                <p className="text-[11px] pl-5" style={{ color: 'rgba(120,170,230,0.35)' }}>
                  + {diagnosis.actions.quick_fix.length - 2} more quick wins…
                </p>
              )}
            </div>
          </div>
        )}

        {/* Locked section */}
        <div className="relative">
          <div className="px-6 pt-5 pb-16 select-none"
               style={{ filter: 'blur(5px)', opacity: 0.18, background: 'rgba(6,14,26,0.9)' }}>
            <p className="text-[11px] font-semibold mb-3" style={{ color: 'rgba(160,200,255,0.6)' }}>
              ⚡ 90-Day Execution Roadmap
            </p>
            {['Fix AI visibility gap (7 priority actions)', 'Build competitor gap strategy', 'Social media growth plan', 'Review & reputation campaign'].map((t, i) => (
              <div key={i} className="flex items-start gap-2 mb-2">
                <span style={{ color: '#7ABFFF' }}>◼</span>
                <span className="text-[12px]" style={{ color: 'rgba(200,225,255,0.5)' }}>{t}</span>
              </div>
            ))}
          </div>
          <div className="absolute inset-x-0 bottom-0 top-0 flex flex-col items-center justify-end pb-6"
               style={{ background: 'linear-gradient(to bottom, transparent 0%, rgba(6,14,26,0.97) 50%)' }}>
            <p className="text-[12px] mb-4 text-center px-4" style={{ color: 'rgba(160,195,255,0.5)' }}>
              Your personalised execution roadmap is ready — talk to our specialists to unlock it
            </p>
            <a
              href="/discover"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-[14px] font-bold transition-all"
              style={{
                background: 'linear-gradient(135deg,#2855A4 0%,#183572 100%)',
                border: '1px solid rgba(75,135,225,0.35)',
                color: '#EEF4FF',
              }}
            >
              Talk to FDE — Get Free Consultation →
            </a>
            <p className="text-[10px] mt-2" style={{ color: 'rgba(255,255,255,0.2)' }}>
              Free · No credit card · Specialist responds within 24 hours
            </p>
          </div>
        </div>
      </div>

      {/* Scan another */}
      <div className="text-center py-4">
        <a href="/" className="text-[12px]" style={{ color: 'rgba(120,170,230,0.35)' }}>
          ← Scan a different website
        </a>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ScanReportPage() {
  const { jobId } = useParams<{ jobId: string }>()

  const [status, setStatus] = useState<'queued' | 'running' | 'completed' | 'failed' | 'notfound'>('queued')
  const [log, setLog] = useState<LogEntry[]>([])
  const [report, setReport] = useState<DiscoveryReport | null>(null)
  const [domain, setDomain] = useState('')
  const [errMsg, setErrMsg] = useState('')

  useEffect(() => {
    if (!jobId) return

    let active = true
    let timer: ReturnType<typeof setTimeout>

    async function poll() {
      try {
        const res = await fetch(`/api/public-scan/status/${jobId}`)
        if (!res.ok) { setStatus('notfound'); return }
        const data: PollResponse = await res.json()

        if (!active) return

        setDomain(data.domain)
        setLog(data.progress_log ?? [])

        if (data.status === 'completed' && data.result) {
          setReport(data.result)
          setStatus('completed')
          return // stop polling
        }
        if (data.status === 'failed') {
          setErrMsg(data.error ?? 'Scan failed.')
          setStatus('failed')
          return
        }
        setStatus(data.status)
        timer = setTimeout(poll, 3_000)
      } catch {
        if (active) timer = setTimeout(poll, 5_000)
      }
    }

    poll()
    return () => { active = false; clearTimeout(timer) }
  }, [jobId])

  return (
    <div
      className="min-h-screen bg-[#060E1A] text-white"
      style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif" }}
    >
      {/* Nav */}
      <nav className="flex items-center justify-between px-5 py-4"
           style={{ borderBottom: '1px solid rgba(70,125,215,0.08)' }}>
        <Link href="/" className="flex items-center gap-2.5">
          <MagicLogo />
          <span className="text-[15px] font-bold text-white tracking-tight">Magic Engine</span>
        </Link>
        <a
          href="/discover"
          className="text-[13px] font-bold px-4 py-2 rounded-lg"
          style={{ background: 'linear-gradient(135deg,#2855A4 0%,#183572 100%)', border: '1px solid rgba(75,135,225,0.32)', color: '#EEF4FF' }}
        >
          Talk to Us →
        </a>
      </nav>

      {/* Background glow */}
      <div className="fixed inset-0 pointer-events-none" aria-hidden="true">
        <div style={{ position: 'absolute', top: '20%', left: '50%', transform: 'translateX(-50%)', width: '600px', height: '400px', background: 'radial-gradient(ellipse 80% 50% at 50% 0%, rgba(38,82,162,0.1) 0%, transparent 70%)' }} />
      </div>

      <main className="relative z-10">
        {status === 'notfound' && (
          <div className="text-center py-24 px-5">
            <div className="text-[36px] mb-4">🔍</div>
            <h2 className="text-[18px] font-bold mb-3" style={{ color: '#ECF3FF' }}>Report not found</h2>
            <p className="text-[13px] mb-6" style={{ color: 'rgba(120,170,230,0.45)' }}>This scan link may have expired.</p>
            <a href="/" className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-bold"
               style={{ background: 'linear-gradient(135deg,#2855A4 0%,#183572 100%)', border: '1px solid rgba(75,135,225,0.32)', color: '#EEF4FF' }}>
              Start a New Scan →
            </a>
          </div>
        )}

        {status === 'failed' && (
          <div className="text-center py-24 px-5 max-w-md mx-auto">
            <div className="text-[36px] mb-4">⚠️</div>
            <h2 className="text-[18px] font-bold mb-3" style={{ color: '#ECF3FF' }}>Scan failed</h2>
            <p className="text-[13px] mb-6" style={{ color: 'rgba(120,170,230,0.45)' }}>
              {errMsg || 'Something went wrong. Please try again.'}
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <a href="/" className="px-5 py-2.5 rounded-xl text-[13px] font-semibold"
                 style={{ border: '1px solid rgba(70,125,215,0.2)', color: 'rgba(160,195,255,0.65)' }}>
                Try Again
              </a>
              <a href="/discover" className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-bold"
                 style={{ background: 'linear-gradient(135deg,#2855A4 0%,#183572 100%)', border: '1px solid rgba(75,135,225,0.32)', color: '#EEF4FF' }}>
                Talk to Us Instead →
              </a>
            </div>
          </div>
        )}

        {(status === 'queued' || status === 'running') && (
          <LoadingView domain={domain} log={log} />
        )}

        {status === 'completed' && report && (
          <ReportView report={report} />
        )}
      </main>

      <footer className="px-5 py-4 text-center">
        <p className="text-[10px]" style={{ color: 'rgba(70,115,185,0.25)', letterSpacing: '2px' }}>
          MAGIC LAB © 2026
        </p>
      </footer>
    </div>
  )
}
