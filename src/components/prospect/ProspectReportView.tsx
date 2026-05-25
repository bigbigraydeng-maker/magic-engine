'use client'

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { DiagnosisBlock, DiscoveryReport } from '@/lib/zhangqian/types'

export function scoreColor(value: number) {
  if (value < 40) return '#dc2626'
  if (value < 65) return '#ca8a04'
  return '#059669'
}

export function scoreLabel(value: number) {
  if (value < 40) return 'Critical'
  if (value < 65) return 'Needs work'
  return 'Good'
}

export function fmt(value: number | null | undefined): string {
  if (value == null) return '-'
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`
  return String(value)
}

function SectionCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:p-6 ${className}`}>
      {children}
    </section>
  )
}

function SectionHeader({ eyebrow, title, body }: { eyebrow: string; title: string; body?: string }) {
  return (
    <div className="mb-5 border-b border-slate-200 pb-4">
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">{eyebrow}</p>
      <h2 className="mt-2 text-2xl font-black text-slate-950">{title}</h2>
      {body && <p className="mt-2 text-sm leading-6 text-slate-600">{body}</p>}
    </div>
  )
}

function ScoreBar({ label, value, showScores }: { label: string; value: number; showScores: boolean }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-4">
        <span className="text-sm font-bold text-slate-800">{label}</span>
        <span className="text-sm font-black tabular-nums" style={{ color: scoreColor(value) }}>
          {value} <span className="text-xs font-semibold">{scoreLabel(value)}</span>
        </span>
      </div>
      <div className="h-2 rounded-lg bg-slate-100">
        <div
          className="h-2 rounded-lg transition-all duration-700"
          style={{ width: showScores ? `${value}%` : '0%', background: scoreColor(value) }}
        />
      </div>
    </div>
  )
}

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs font-bold uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className="mt-5 text-2xl font-black text-slate-950">{value}</p>
    </div>
  )
}

export function PrescriptionGate() {
  return (
    <SectionCard>
      <SectionHeader
        eyebrow="Next step"
        title="Turn this report into execution."
        body="The public report shows the diagnosis. The next step is a prioritised action plan your team can approve and track."
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
        <div className="grid gap-3 sm:grid-cols-3">
          {['Prioritise', 'Execute', 'Prove'].map((step, index) => (
            <div key={step} className="rounded-lg bg-slate-950 p-4 text-white">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
                {String(index + 1).padStart(2, '0')}
              </p>
              <p className="mt-5 text-sm font-black">{step}</p>
            </div>
          ))}
        </div>
        <a
          href="mailto:hello@magiclab.com.au?subject=Action Plan - Discovery Report"
          className="flex h-12 items-center justify-center rounded-lg bg-slate-950 px-5 text-sm font-black text-white"
        >
          Talk to us
        </a>
      </div>
    </SectionCard>
  )
}

export function ReportView({ report }: { report: DiscoveryReport }) {
  const [showScores, setShowScores] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setShowScores(true), 300)
    return () => clearTimeout(timer)
  }, [])

  const diagnosis = report.diagnosis as DiagnosisBlock | null | undefined
  const snap = report.semrush_snapshot
  const keywords = report.seed_keywords ?? []
  const competitors = report.competitors ?? []
  const socials = report.social_profiles ?? []
  const reviewPlatforms = report.review_platforms ?? []

  const overallScore = diagnosis?.scores?.overall ?? null
  const crisisType = diagnosis?.crisis_type ?? null
  const keyFinding = diagnosis?.key_finding ?? null
  const quickFixes = diagnosis?.actions.quick_fix ?? []
  const dimensionScores = diagnosis?.scores
    ? (Object.entries(diagnosis.scores).filter(([key]) => key !== 'overall') as [string, number][])
    : []

  const yourTraffic = snap?.monthly_traffic ?? null
  const maxTraffic = Math.max(yourTraffic ?? 0, ...competitors.map(item => item.monthly_traffic ?? 0)) || 1
  const businessName = report.business?.name ?? report.domain
  const location = [
    report.business?.location?.city,
    report.business?.location?.region,
  ].filter(Boolean).join(', ')

  return (
    <div className="px-5 py-8 sm:px-8">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="rounded-lg bg-slate-950 p-6 text-white sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-200">
            Discovery report
          </p>
          <div className="mt-4 grid gap-6 md:grid-cols-[1fr_auto] md:items-start">
            <div>
              <h1 className="max-w-3xl text-4xl font-black leading-tight sm:text-5xl">
                {businessName}
              </h1>
              <p className="mt-3 text-sm leading-6 text-slate-300">
                {[report.business?.industry?.join(' / '), location].filter(Boolean).join(' - ') || report.domain}
              </p>
              {keyFinding && (
                <p className="mt-6 max-w-2xl border-l-2 border-cyan-300 pl-4 text-base leading-7 text-slate-200">
                  {keyFinding}
                </p>
              )}
            </div>

            {overallScore !== null && (
              <div className="rounded-lg border border-white/10 bg-white/[0.08] p-5 text-center">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">Overall</p>
                <p className="mt-3 text-6xl font-black tabular-nums" style={{ color: scoreColor(overallScore) }}>
                  {overallScore}
                </p>
                <p className="mt-1 text-xs font-bold uppercase tracking-[0.12em]" style={{ color: scoreColor(overallScore) }}>
                  {scoreLabel(overallScore)}
                </p>
              </div>
            )}
          </div>
        </section>

        <SectionCard>
          <SectionHeader eyebrow="Snapshot" title="Signal summary" />
          <div className="grid gap-3">
            {snap?.trust_score != null && <MetricCard label="Authority" value={snap.trust_score} />}
            {snap?.monthly_traffic != null && <MetricCard label="Monthly traffic" value={fmt(snap.monthly_traffic)} />}
            {report.gbp?.review_count != null && <MetricCard label="Reviews" value={report.gbp.review_count} />}
            {socials.length > 0 && (
              <MetricCard
                label="Social reach"
                value={fmt(socials.reduce((sum, item) => sum + (item.followers_count ?? 0), 0))}
              />
            )}
            {snap?.trust_score == null && snap?.monthly_traffic == null && report.gbp?.review_count == null && socials.length === 0 && (
              <p className="text-sm leading-6 text-slate-600">
                The report found enough qualitative signals to build a diagnosis, but not enough public metrics for a full snapshot.
              </p>
            )}
          </div>
        </SectionCard>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-6">
          {dimensionScores.length > 0 && (
            <SectionCard>
              <SectionHeader
                eyebrow="Brand health"
                title="Where the business is strong or exposed"
                body={crisisType ? `Primary diagnosis: ${crisisType}` : undefined}
              />
              <div className="space-y-5">
                {dimensionScores.map(([dimension, score]) => (
                  <ScoreBar
                    key={dimension}
                    label={dimension.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase())}
                    value={score}
                    showScores={showScores}
                  />
                ))}
              </div>
            </SectionCard>
          )}

          {competitors.length > 0 && (
            <SectionCard>
              <SectionHeader
                eyebrow="Competitor landscape"
                title="How visible the market looks"
                body="Traffic estimates are directional and used to prioritise where to investigate first."
              />
              <div className="space-y-4">
                {yourTraffic != null && (
                  <TrafficRow
                    label={`${report.domain} (you)`}
                    value={yourTraffic}
                    maxValue={maxTraffic}
                    active
                    showScores={showScores}
                  />
                )}
                {competitors.slice(0, 5).map(competitor => (
                  <TrafficRow
                    key={competitor.domain}
                    label={competitor.name ?? competitor.domain}
                    value={competitor.monthly_traffic ?? 0}
                    maxValue={maxTraffic}
                    showScores={showScores}
                  />
                ))}
              </div>
            </SectionCard>
          )}

          {keywords.length > 0 && (
            <SectionCard>
              <SectionHeader eyebrow="Search visibility" title="Keyword opportunities" />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
                      <th className="pb-3 text-left">Keyword</th>
                      <th className="pb-3 text-right">Rank</th>
                      <th className="pb-3 text-right">Volume</th>
                      <th className="pb-3 text-right">Difficulty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {keywords.slice(0, 8).map((keyword, index) => (
                      <tr key={`${keyword.keyword}-${index}`} className="border-b border-slate-100">
                        <td className="py-3 pr-4 font-bold text-slate-800">{keyword.keyword}</td>
                        <td className="py-3 text-right font-semibold tabular-nums text-slate-600">
                          {keyword.semrush_rank ? `#${keyword.semrush_rank}` : '-'}
                        </td>
                        <td className="py-3 text-right tabular-nums text-slate-600">
                          {keyword.semrush_volume ? fmt(keyword.semrush_volume) : keyword.estimated_volume ? `~${fmt(keyword.estimated_volume)}` : '-'}
                        </td>
                        <td className="py-3 text-right tabular-nums text-slate-600">
                          {keyword.semrush_kd ?? '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          )}
        </div>

        <div className="space-y-6">
          {quickFixes.length > 0 && (
            <SectionCard>
              <SectionHeader eyebrow="Quick wins" title="What to fix first" />
              <div className="space-y-3">
                {quickFixes.slice(0, 5).map((fix, index) => (
                  <div key={`${fix}-${index}`} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
                      Priority {index + 1}
                    </p>
                    <p className="mt-2 text-sm font-bold leading-6 text-slate-900">{fix}</p>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}

          {(socials.length > 0 || reviewPlatforms.length > 0 || report.gbp) && (
            <SectionCard>
              <SectionHeader eyebrow="Reputation" title="Social and review footprint" />
              <div className="space-y-3">
                {socials.map(profile => (
                  <InfoRow
                    key={profile.platform}
                    label={profile.platform}
                    value={profile.followers_count ? `${fmt(profile.followers_count)} followers` : profile.handle ?? '-'}
                  />
                ))}
                {report.gbp && (
                  <InfoRow
                    label="Business profile"
                    value={`${report.gbp.rating ? `${report.gbp.rating}/5` : '-'}${report.gbp.review_count ? ` - ${report.gbp.review_count} reviews` : ''}`}
                  />
                )}
                {reviewPlatforms.map(platform => (
                  <InfoRow
                    key={platform.platform}
                    label={platform.platform}
                    value={`${platform.rating ? `${platform.rating}/5` : '-'}${platform.review_count ? ` - ${platform.review_count} reviews` : ''}`}
                  />
                ))}
              </div>
            </SectionCard>
          )}

          <PrescriptionGate />
        </div>
      </div>
    </div>
  )
}

function TrafficRow({
  label,
  value,
  maxValue,
  active = false,
  showScores,
}: {
  label: string
  value: number
  maxValue: number
  active?: boolean
  showScores: boolean
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-4">
        <p className={`truncate text-sm font-bold ${active ? 'text-emerald-800' : 'text-slate-800'}`}>{label}</p>
        <p className={`text-sm font-black tabular-nums ${active ? 'text-emerald-700' : 'text-slate-600'}`}>
          {value ? `${fmt(value)}/mo` : '-'}
        </p>
      </div>
      <div className="h-2 rounded-lg bg-slate-100">
        <div
          className={`h-2 rounded-lg transition-all duration-700 ${active ? 'bg-emerald-500' : 'bg-slate-400'}`}
          style={{ width: showScores ? `${(value / maxValue) * 100}%` : '0%' }}
        />
      </div>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
      <p className="text-sm font-bold capitalize text-slate-800">{label}</p>
      <p className="text-right text-sm font-semibold text-slate-600">{value}</p>
    </div>
  )
}
