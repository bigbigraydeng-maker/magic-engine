/**
 * GET /report/[id]
 *
 * Public, customer-facing "free digital health check" — the hook sent to a
 * cold prospect (Phase 35). No login: the owner opens the link from the
 * outreach email and sees a Magic Engine-branded report of where enquiries
 * are leaking, a lead-health score, how they compare in AI search, the
 * five-stage funnel, and a locked 90-day plan that converts to a call.
 *
 * Brand: Magic Engine VI — ivory / gold / charcoal, Space Grotesk display,
 * the MeMark logo. (Not the dark scan-report theme.)
 *
 * Data: the leak report is REBUILT deterministically from evidence already on
 * the prospect row (audit + ai_report + score_breakdown) — no new column, no
 * migration. Only client-safe fields render (never prospect_score, raw
 * internal analysis, or vendor names). noindex: private to one business.
 */

import type { Metadata } from 'next'
import { supabaseAdmin } from '@/lib/supabase'
import { MeMark, MeMarkDefs } from '@/components/ui/me-mark'
import { buildLeakReport, type LeakStage } from '@/lib/prospecting/report'
import { INDUSTRY_LABELS, type ProspectAnalysis } from '@/lib/prospecting/analyze'
import type { ProspectAudit } from '@/lib/prospecting/audit'
import type { ScoreSignal } from '@/lib/prospecting/score'

export const metadata: Metadata = {
  title: 'Your digital health check — Magic Engine',
  robots: { index: false, follow: false },
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ── Brand tokens (me.* palette) ───────────────────────────────────────────────
const IVORY = '#FBF8F3', STONE = '#EAE6DF', OCHRE = '#C4912E', GOLD = '#EBCB8B'
const CHARCOAL = '#1A1A1A', GREEN = '#5C8A4A', RED = '#C2453A'
const GOLD_GRAD = 'linear-gradient(135deg,#EBCB8B,#C4912E 55%,#A6781F)'
const DISPLAY = 'var(--font-display, "Space Grotesk"), sans-serif'

const DOT: Record<LeakStage['status'], string> = { leak: RED, weak: OCHRE, ok: GREEN }
const OK_FALLBACK = 'This part looks healthy — no action needed.'

function scoreColor(v: number): string { return v < 40 ? RED : v < 70 ? OCHRE : GREEN }

interface ProspectRow {
  business_name: string
  industry:      string
  city:          string
  country:       string
  rating:        number | null
  review_count:  number | null
  audit:         ProspectAudit | null
  score_breakdown: ScoreSignal[] | null
  ai_report:     ProspectAnalysis | null
}

function InvalidLink() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4" style={{ background: IVORY, color: CHARCOAL }}>
      <div className="max-w-md text-center">
        <div className="mb-3 text-3xl">🔗</div>
        <h1 className="text-lg font-semibold">This link is no longer valid</h1>
        <p className="mt-2 text-sm" style={{ color: 'rgba(26,26,26,0.55)' }}>
          Please ask your Magic Engine contact to send you a fresh link.
        </p>
      </div>
    </main>
  )
}

function cap(s: string): string { return s ? s[0].toUpperCase() + s.slice(1) : s }
function cityDisplay(c: string): string { return c.split('_').map(cap).join(' ') }

export default async function ReportPage({ params }: { params: { id: string } }) {
  if (!UUID_RE.test(params.id)) return <InvalidLink />

  const { data: p } = await supabaseAdmin
    .from('outbound_prospects')
    .select('business_name, industry, city, country, rating, review_count, audit, score_breakdown, ai_report')
    .eq('id', params.id)
    .maybeSingle<ProspectRow>()

  if (!p) return <InvalidLink />

  const report = buildLeakReport({
    business_name: p.business_name,
    industry:      p.industry,
    city:          p.city,
    country:       p.country,
    rating:        p.rating,
    review_count:  p.review_count,
    https_ok:      p.audit?.https_ok ?? null,
    tracking:      p.audit?.tracking ?? null,
    breakdown:     p.score_breakdown ?? null,
    analysis:      p.ai_report ?? null,
  })

  // AI-search competitor comparison — the sharpest, most on-brand element:
  // real competitor names the AI surfaced when this business did not.
  const probe = p.ai_report?.geo_probe
  const rivals = (probe && !probe.mentioned ? probe.competitors_mentioned : []).slice(0, 3)
  const tradeLabel = INDUSTRY_LABELS[p.industry] ?? p.industry.replace(/_/g, ' ')
  const social = p.ai_report?.social_activity

  const keyFinding = report.summary_points[0] ?? ''
  const mailto = `mailto:${process.env.OUTREACH_REPLY_EMAIL ?? 'hello@magicengine.com.au'}` +
    `?subject=${encodeURIComponent(`Health check chat — ${p.business_name}`)}`

  const stats: Array<{ v: string; label: string }> = []
  if (p.rating != null) stats.push({ v: `${p.rating}★`, label: 'Google rating' })
  if (p.review_count != null) stats.push({ v: String(p.review_count), label: 'Reviews' })
  if (social) stats.push({ v: social.followers.toLocaleString(), label: `${cap(social.platform)} followers` })
  if (social) stats.push({ v: String(social.posts_last_30d), label: 'Posts last 30 days' })

  const PLAN = [
    'Get you found in Google and AI search — the exact queries and fixes',
    'Plug every enquiry leak on your site — form, click-to-call, WhatsApp',
    'Reactivate your social with a month of AI-made posts and video',
    'Switch on the video-ad lead engine — who to target and how',
    'Auto email and SMS follow-up so no enquiry ever goes cold',
  ]

  return (
    <main className="min-h-screen" style={{ background: IVORY, color: CHARCOAL }}>
      <MeMarkDefs />

      {/* Nav */}
      <nav className="border-b" style={{ borderColor: STONE }}>
        <div className="mx-auto flex h-[64px] max-w-[640px] items-center justify-between px-5">
          <div className="flex items-center gap-2.5">
            <MeMark className="h-7 w-auto" />
            <span style={{ fontFamily: DISPLAY, fontWeight: 700, fontSize: 16, letterSpacing: '-0.02em' }}>Magic Engine</span>
          </div>
          <a href={mailto} className="rounded-lg px-3.5 py-1.5 text-xs font-semibold text-white" style={{ background: GOLD_GRAD }}>
            Talk to us →
          </a>
        </div>
      </nav>

      <div className="mx-auto max-w-[640px] px-5 py-10 sm:py-12">

        {/* Hero: score + verdict + business */}
        <p className="text-xs font-semibold uppercase tracking-[0.16em]" style={{ color: OCHRE }}>
          Magic Engine · Free digital health check
        </p>

        <div className="mt-4 flex items-start justify-between gap-5 rounded-[24px] p-6" style={{ background: '#fff', boxShadow: '0 1px 2px rgba(26,26,26,.04), 0 8px 28px rgba(26,26,26,.06)' }}>
          <div className="flex-1">
            <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider"
                  style={{ background: 'rgba(194,69,58,0.1)', color: RED }}>
              🔴 {report.verdict}
            </span>
            <h1 className="mt-3 text-[22px] font-semibold leading-tight sm:text-[26px]" style={{ fontFamily: DISPLAY, letterSpacing: '-0.02em' }}>
              {p.business_name}
            </h1>
            <p className="mt-1 text-xs" style={{ color: 'rgba(26,26,26,0.5)' }}>
              {tradeLabel} · {cityDisplay(p.city)}
            </p>
            {keyFinding && (
              <p className="mt-4 border-l-2 pl-3 text-sm italic leading-relaxed" style={{ borderColor: GOLD, color: 'rgba(26,26,26,0.7)' }}>
                &ldquo;{keyFinding}&rdquo;
              </p>
            )}
          </div>
          <div className="shrink-0 text-right">
            <div className="text-[48px] font-bold leading-none tabular-nums" style={{ fontFamily: DISPLAY, color: scoreColor(report.health_score) }}>
              {report.health_score}
            </div>
            <div className="text-[10px]" style={{ color: 'rgba(26,26,26,0.35)' }}>/ 100 lead health</div>
          </div>
        </div>

        {/* Quick stats */}
        {stats.length > 0 && (
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {stats.map(s => (
              <div key={s.label} className="rounded-2xl p-4 text-center" style={{ background: '#fff', border: `1px solid ${STONE}` }}>
                <div className="text-lg font-bold" style={{ fontFamily: DISPLAY, color: CHARCOAL }}>{s.v}</div>
                <div className="mt-0.5 text-[10px] uppercase tracking-wide" style={{ color: 'rgba(26,26,26,0.45)' }}>{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* AI-search competitor comparison — the killer element */}
        {rivals.length > 0 && (
          <section className="mt-4 rounded-[24px] p-6" style={{ background: '#fff', boxShadow: '0 1px 2px rgba(26,26,26,.04), 0 8px 28px rgba(26,26,26,.06)' }}>
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: OCHRE }}>
              <span>🤖</span> When customers ask AI
            </p>
            <p className="mt-3 text-sm leading-relaxed" style={{ color: 'rgba(26,26,26,0.7)' }}>
              We asked ChatGPT for a {tradeLabel} in {cityDisplay(p.city)}. These came up:
            </p>
            <div className="mt-3 space-y-2">
              {rivals.map(name => (
                <div key={name} className="flex items-center gap-2.5 rounded-lg px-3 py-2" style={{ background: IVORY }}>
                  <span style={{ color: GREEN }}>✓</span>
                  <span className="text-sm font-medium">{name}</span>
                </div>
              ))}
              <div className="flex items-center gap-2.5 rounded-lg px-3 py-2" style={{ background: 'rgba(194,69,58,0.08)' }}>
                <span style={{ color: RED }}>✕</span>
                <span className="text-sm font-semibold" style={{ color: RED }}>{p.business_name} — not mentioned</span>
              </div>
            </div>
            <p className="mt-3 text-xs" style={{ color: 'rgba(26,26,26,0.5)' }}>
              More and more people ask AI instead of Googling. Right now it sends them to your competitors.
            </p>
          </section>
        )}

        {/* Five-stage funnel */}
        <div className="mt-8 flex items-center gap-3">
          <span className="h-px w-8" style={{ background: OCHRE, opacity: 0.5 }} />
          <span className="text-xs font-semibold uppercase tracking-[0.16em]" style={{ color: OCHRE }}>
            {report.headline}
          </span>
        </div>
        <p className="mt-2 text-sm" style={{ color: 'rgba(26,26,26,0.6)' }}>
          We had a look at how <span className="font-semibold">{p.business_name}</span> shows up online.
          Here&apos;s where ready customers might be slipping away — and what we&apos;d do about each one.
        </p>

        <ol className="mt-5 space-y-3">
          {report.stages.map(stage => (
            <li key={stage.key} className="rounded-2xl p-5" style={{ background: '#fff', border: `1px solid ${STONE}` }}>
              <div className="flex items-center gap-2.5">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: DOT[stage.status] }} aria-hidden />
                <h2 className="text-sm font-semibold">{stage.label}</h2>
              </div>
              <p className="mt-2 text-sm leading-relaxed" style={{ color: 'rgba(26,26,26,0.72)' }}>
                {stage.finding || OK_FALLBACK}
              </p>
              {stage.status !== 'ok' && (
                <p className="mt-2 border-l-2 pl-3 text-sm leading-relaxed" style={{ borderColor: GOLD, color: 'rgba(26,26,26,0.82)' }}>
                  <span className="font-semibold" style={{ color: OCHRE }}>What we&apos;d do:</span> {stage.fix}
                </p>
              )}
            </li>
          ))}
        </ol>

        {/* Locked 90-day plan — curiosity gap → call */}
        <div className="mt-6 overflow-hidden rounded-[24px]" style={{ border: `1px solid ${STONE}` }}>
          <div className="relative">
            <div className="select-none px-6 pt-6 pb-16" style={{ filter: 'blur(5px)', opacity: 0.5 }} aria-hidden>
              <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: OCHRE }}>⚡ Your 90-day plan</p>
              <div className="mt-3 space-y-2.5">
                {PLAN.map(t => (
                  <div key={t} className="flex items-start gap-2">
                    <span style={{ color: OCHRE }}>◆</span>
                    <span className="text-sm" style={{ color: 'rgba(26,26,26,0.7)' }}>{t}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="absolute inset-0 flex flex-col items-center justify-end pb-6"
                 style={{ background: `linear-gradient(to bottom, ${IVORY}00 0%, ${IVORY} 62%)` }}>
              <p className="mb-3 px-6 text-center text-sm" style={{ color: 'rgba(26,26,26,0.6)' }}>
                Your step-by-step 90-day plan is ready — we&apos;ll walk you through it on a free call.
              </p>
              <a href={mailto} className="rounded-xl px-6 py-3 text-sm font-semibold text-white" style={{ background: GOLD_GRAD }}>
                Book a 15-minute chat →
              </a>
            </div>
          </div>
        </div>

        {/* Offer */}
        <section className="mt-6 rounded-[24px] p-6 text-white" style={{ background: CHARCOAL }}>
          <h2 className="text-lg font-semibold" style={{ fontFamily: DISPLAY }}>We fix all of this in 90 days</h2>
          <p className="mt-2 text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.72)' }}>
            One flat price of AUD&nbsp;$990 for the first three months. We get you found, plug the leaks,
            and switch on a steady flow of enquiries — all done for you. If you&apos;re not happy with what we
            deliver, you get a full refund.
          </p>
          <a href={mailto} className="mt-4 inline-flex rounded-xl px-5 py-2.5 text-sm font-semibold" style={{ background: GOLD_GRAD, color: CHARCOAL }}>
            Book a 15-minute chat →
          </a>
        </section>

        <footer className="mt-8 text-xs leading-relaxed" style={{ color: 'rgba(26,26,26,0.4)' }}>
          <p>Magic Engine · Digital marketing for AU/NZ local businesses</p>
          <p className="mt-1">
            We put this together after coming across {p.business_name} in your public Google Business
            listing. Not happy to hear from us? Just reply &ldquo;no thanks&rdquo; and we won&apos;t be in touch again.
          </p>
        </footer>
      </div>
    </main>
  )
}
