'use client'

import { useState, useEffect, useRef } from 'react'
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

interface ReportResponse {
  job_id: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  progress_log: LogEntry[]
  domain: string
  error: string | null
  result: DiscoveryReport | null
}

// ─── Section helpers ──────────────────────────────────────────────────────────

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

// ─── Loading view ─────────────────────────────────────────────────────────────

function LoadingView({ domain, log }: { domain: string; log: LogEntry[] }) {
  const bottomRef = useRef<HTMLDivElement>(null)
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [log.length])

  const [elapsed, setElapsed] = useState(0)
  const startRef = useRef(Date.now())
  useEffect(() => {
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startRef.current) / 1000)), 1000)
    return () => clearInterval(t)
  }, [])

  const mins = Math.floor(elapsed / 60)
  const secs = elapsed % 60
  const elapsedStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
  const progressPct = Math.min(90, Math.round((elapsed / 300) * 90))
  const latestStep = log.length > 0 ? log[log.length - 1].message : 'Starting…'

  const phase =
    elapsed < 60  ? 'Reading your website…' :
    elapsed < 150 ? 'Checking keyword rankings & search visibility…' :
    elapsed < 240 ? 'Mapping competitors & social signals…' :
                    'Diagnosing brand health across 6 dimensions…'

  return (
    <div className="max-w-xl mx-auto px-5 py-12">
      <div className="text-center mb-6">
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
        <p className="text-[13px] mb-1 transition-opacity duration-500" style={{ color: 'rgba(160,200,255,0.7)' }}>
          {phase}
        </p>
        <p className="text-[12px] mb-4" style={{ color: 'rgba(120,170,230,0.4)' }}>
          {elapsedStr} elapsed · Usually 3–5 minutes total
        </p>
        <div className="max-w-xs mx-auto">
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <div className="h-1.5 rounded-full transition-all duration-1000"
                 style={{ width: `${progressPct}%`, background: 'linear-gradient(90deg, #2855A4, #5B9EFF)' }} />
          </div>
        </div>
        <div className="mt-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-[11px]"
             style={{ background: 'rgba(10,20,40,0.5)', border: '1px solid rgba(70,125,215,0.1)' }}>
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse flex-shrink-0" />
          <span style={{ color: 'rgba(160,200,255,0.6)' }}>{latestStep}</span>
        </div>
      </div>

      <div className="rounded-2xl overflow-hidden"
           style={{ background: 'rgba(10,20,40,0.6)', border: '1px solid rgba(70,125,215,0.15)' }}>
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
              className="flex items-start gap-3"
              style={{
                background: entry.type === 'discovery' ? 'rgba(22,45,90,0.4)' : 'transparent',
                borderRadius: entry.type === 'discovery' ? '10px' : undefined,
                padding: entry.type === 'discovery' ? '8px 10px' : '2px 0',
                border: entry.type === 'discovery' ? '1px solid rgba(70,125,215,0.15)' : 'none',
              }}
            >
              <span className="text-[16px] flex-shrink-0 mt-0.5">{entry.icon}</span>
              <div>
                <p className="text-[12px] leading-snug"
                   style={{ color: entry.type === 'discovery' ? '#A5C8FF' : 'rgba(120,170,230,0.55)' }}>
                  {entry.message}
                </p>
                {entry.detail && (
                  <p className="text-[11px] mt-0.5" style={{ color: 'rgba(120,170,230,0.4)' }}>{entry.detail}</p>
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
    </div>
  )
}

// ─── Prescription gate CTA ────────────────────────────────────────────────────

function PrescriptionGate() {
  return (
    <SectionCard>
      <SectionLabel icon="💊" label="Action Plan & Prescriptions" />
      <div className="rounded-xl p-6 text-center"
           style={{ background: 'rgba(22,45,90,0.3)', border: '1px dashed rgba(70,125,215,0.3)' }}>
        <div className="text-[28px] mb-3">🔒</div>
        <h3 className="text-[15px] font-black mb-2" style={{ color: '#ECF3FF' }}>
          Your Personalised Action Plan
        </h3>
        <p className="text-[12px] mb-5 max-w-xs mx-auto" style={{ color: 'rgba(120,170,230,0.55)' }}>
          Based on your Discovery Report, our strategists have identified quick wins and a 90-day roadmap tailored to your brand.
        </p>
        <a
          href="mailto:hello@magiclab.com.au?subject=Action Plan — Discovery Report"
          className="inline-flex items-center gap-2 px-5 py-3 rounded-xl text-[13px] font-bold transition-all"
          style={{
            background: 'linear-gradient(135deg,#2855A4 0%,#183572 100%)',
            border: '1px solid rgba(75,135,225,0.32)',
            color: '#EEF4FF',
          }}
        >
          Talk to Us — Get My Action Plan →
        </a>
        <p className="text-[10px] mt-3" style={{ color: 'rgba(255,255,255,0.2)' }}>
          Free 30-minute strategy call · No commitment required
        </p>
      </div>
    </SectionCard>
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
  const dimensionScores = diagnosis?.scores
    ? Object.entries(diagnosis.scores).filter(([k]) => k !== 'overall') as [string, number][]
    : []

  const yourTraffic = snap?.monthly_traffic ?? null
  const maxTraffic = Math.max(yourTraffic ?? 0, ...competitors.map(c => c.monthly_traffic ?? 0)) || 1

  return (
    <div className="max-w-2xl mx-auto px-5 py-10 space-y-5">

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <SectionCard>
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex-1">
            {crisisType && (
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider mb-3"
                   style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171' }}>
                🔴 {crisisType}
              </div>
            )}
            <h2 className="text-[18px] font-black mb-0.5" style={{ color: '#ECF3FF' }}>
              {report.business?.name ?? report.domain}
            </h2>
            <p className="text-[11px] mb-1" style={{ color: 'rgba(120,170,230,0.4)' }}>
              {report.business?.industry?.join(' · ')}
              {report.business?.location?.city ? ` · ${report.business.location.city}` : ''}
              {report.business?.location?.region ? `, ${report.business.location.region}` : ''}
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

      {/* ── 6-Dimension scores ─────────────────────────────────────────── */}
      {dimensionScores.length > 0 && (
        <SectionCard>
          <SectionLabel icon="🩺" label="Brand Health Scores" />
          <div className="space-y-4">
            {dimensionScores.map(([dim, score]) => (
              <ScoreBar
                key={dim}
                label={dim.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                value={score}
                showScores={showScores}
              />
            ))}
          </div>
          {diagnosis?.quick_fixes && diagnosis.quick_fixes.length > 0 && (
            <div className="mt-5 pt-4" style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
              <p className="text-[10px] uppercase tracking-wider font-semibold mb-3"
                 style={{ color: 'rgba(120,170,230,0.4)' }}>⚡ Quick Wins</p>
              <div className="space-y-2">
                {diagnosis.quick_fixes.slice(0, 4).map((fix, i) => (
                  <div key={i} className="flex items-start gap-2 text-[12px]"
                       style={{ color: 'rgba(160,200,255,0.65)' }}>
                    <span className="flex-shrink-0 text-[10px] mt-0.5 font-bold"
                          style={{ color: '#4ade80' }}>#{i + 1}</span>
                    {fix}
                  </div>
                ))}
              </div>
            </div>
          )}
        </SectionCard>
      )}

      {/* ── Competitors ────────────────────────────────────────────────── */}
      {competitors.length > 0 && (
        <SectionCard>
          <SectionLabel icon="🏆" label="Competitor Landscape" />
          <div className="space-y-3">
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

      {/* ── Social & Reviews ───────────────────────────────────────────── */}
      {(socials.length > 0 || reviewPlatforms.length > 0 || report.gbp) && (
        <SectionCard>
          <SectionLabel icon="📱" label="Social & Reputation" />
          <div className="space-y-4">
            {socials.length > 0 && (
              <div className="space-y-2">
                {socials.map(s => (
                  <div key={s.platform} className="flex items-center justify-between py-2"
                       style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <div className="flex items-center gap-2">
                      <span className="text-[14px]">{
                        s.platform === 'instagram' ? '📸' :
                        s.platform === 'tiktok' ? '🎵' :
                        s.platform === 'facebook' ? '👥' :
                        s.platform === 'linkedin' ? '💼' :
                        s.platform === 'youtube' ? '▶️' : '🔗'
                      }</span>
                      <span className="text-[12px] capitalize" style={{ color: 'rgba(200,225,255,0.6)' }}>
                        {s.platform}
                      </span>
                    </div>
                    <span className="text-[12px] font-semibold tabular-nums" style={{ color: '#A5C8FF' }}>
                      {s.followers_count ? `${fmt(s.followers_count)} followers` : s.handle ?? '—'}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {report.gbp && (
              <div className="flex items-center justify-between">
                <span className="text-[12px]" style={{ color: 'rgba(200,225,255,0.6)' }}>⭐ Google Business</span>
                <span className="text-[12px] font-semibold" style={{ color: '#A5C8FF' }}>
                  {report.gbp.rating ? `${report.gbp.rating}/5` : '—'}
                  {report.gbp.review_count ? ` · ${report.gbp.review_count} reviews` : ''}
                </span>
              </div>
            )}
            {reviewPlatforms.map(rp => (
              <div key={rp.platform} className="flex items-center justify-between">
                <span className="text-[12px] capitalize" style={{ color: 'rgba(200,225,255,0.6)' }}>
                  📋 {rp.platform}
                </span>
                <span className="text-[12px] font-semibold" style={{ color: '#A5C8FF' }}>
                  {rp.rating ? `${rp.rating}/5` : '—'}
                  {rp.review_count ? ` · ${rp.review_count} reviews` : ''}
                </span>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* ── Prescription gate ──────────────────────────────────────────── */}
      <PrescriptionGate />
    </div>
  )
}

// ─── Failed view ──────────────────────────────────────────────────────────────

function FailedView({ domain }: { domain: string }) {
  return (
    <div className="max-w-xl mx-auto px-5 py-20 text-center">
      <div className="text-[32px] mb-4">⚠️</div>
      <h2 className="text-[18px] font-black mb-2" style={{ color: '#ECF3FF' }}>
        Scan couldn&apos;t complete
      </h2>
      <p className="text-[12px] mb-6" style={{ color: 'rgba(120,170,230,0.5)' }}>
        Something went wrong while scanning {domain}. This can happen with very new domains or sites that block automated requests.
      </p>
      <a
        href="/discover"
        className="inline-flex items-center gap-2 px-5 py-3 rounded-xl text-[13px] font-bold"
        style={{
          background: 'linear-gradient(135deg,#2855A4 0%,#183572 100%)',
          border: '1px solid rgba(75,135,225,0.32)',
          color: '#EEF4FF',
        }}
      >
        Try Again
      </a>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProspectPage() {
  const [data, setData] = useState<ReportResponse | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [showReadyToast, setShowReadyToast] = useState(false)
  const prevStatusRef = useRef<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const prev = prevStatusRef.current
    const curr = data?.status ?? null
    prevStatusRef.current = curr
    if (curr === 'completed' && (prev === 'queued' || prev === 'running')) {
      setShowReadyToast(true)
      const t = setTimeout(() => setShowReadyToast(false), 2000)
      return () => clearTimeout(t)
    }
  }, [data?.status])

  useEffect(() => {
    async function poll() {
      try {
        const res = await fetch('/api/prospect/report', { cache: 'no-store' })
        if (res.status === 404) {
          setNotFound(true)
          return
        }
        if (!res.ok) return
        const json = await res.json() as ReportResponse
        setData(json)

        if (json.status === 'completed' || json.status === 'failed') {
          if (pollRef.current) clearInterval(pollRef.current)
        }
      } catch {
        // Network error — keep polling
      }
    }

    void poll()
    pollRef.current = setInterval(poll, 3000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [])

  return (
    <div
      className="min-h-screen bg-[#060E1A] flex flex-col"
      style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif" }}
    >
      <nav
        className="flex items-center justify-between px-5 py-4 sticky top-0 z-10"
        style={{
          borderBottom: '1px solid rgba(70,125,215,0.08)',
          background: 'rgba(6,14,26,0.9)',
          backdropFilter: 'blur(12px)',
        }}
      >
        <Link href="/" className="flex items-center gap-2.5">
          <MagicLogo />
          <span className="text-[15px] font-bold text-white tracking-tight">Magic Engine</span>
        </Link>
        {data?.status === 'completed' && (
          <div
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold"
            style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.25)', color: '#4ade80' }}
          >
            ✓ Report ready
          </div>
        )}
      </nav>

      {showReadyToast && (
        <div
          className="fixed top-20 left-1/2 -translate-x-1/2 z-20 px-4 py-2.5 rounded-full text-[13px] font-semibold pointer-events-none"
          style={{
            background: 'rgba(34,197,94,0.18)',
            border: '1px solid rgba(34,197,94,0.4)',
            color: '#4ade80',
            backdropFilter: 'blur(12px)',
            boxShadow: '0 8px 32px rgba(34,197,94,0.25)',
          }}
        >
          Your Discovery Report is ready ✨
        </div>
      )}

      <main className="flex-1">
        {notFound && (
          <div className="max-w-xl mx-auto px-5 py-20 text-center">
            <div className="text-[32px] mb-4">🔍</div>
            <h2 className="text-[18px] font-black mb-2" style={{ color: '#ECF3FF' }}>
              No report found
            </h2>
            <p className="text-[12px] mb-6" style={{ color: 'rgba(120,170,230,0.5)' }}>
              We couldn&apos;t find a Discovery Report linked to your account. Start a free scan to get yours.
            </p>
            <Link
              href="/discover"
              className="inline-flex items-center gap-2 px-5 py-3 rounded-xl text-[13px] font-bold"
              style={{
                background: 'linear-gradient(135deg,#2855A4 0%,#183572 100%)',
                border: '1px solid rgba(75,135,225,0.32)',
                color: '#EEF4FF',
              }}
            >
              Start Free Discovery Report →
            </Link>
          </div>
        )}

        {!notFound && !data && (
          <div className="flex items-center justify-center py-32">
            <div className="text-center">
              <div className="w-8 h-8 rounded-full border-2 border-blue-500 border-t-transparent animate-spin mx-auto mb-4" />
              <p className="text-[12px]" style={{ color: 'rgba(120,170,230,0.4)' }}>Loading your report…</p>
            </div>
          </div>
        )}

        {data && (data.status === 'queued' || data.status === 'running') && (
          <LoadingView domain={data.domain} log={data.progress_log} />
        )}

        {data?.status === 'completed' && data.result && (
          <ReportView report={data.result} />
        )}

        {data?.status === 'failed' && (
          <FailedView domain={data.domain} />
        )}
      </main>

      <footer className="px-5 py-4 text-center">
        <p className="text-[10px]" style={{ color: 'rgba(70,115,185,0.25)', letterSpacing: '2px' }}>
          MAGIC LAB &copy; 2026
        </p>
      </footer>
    </div>
  )
}
