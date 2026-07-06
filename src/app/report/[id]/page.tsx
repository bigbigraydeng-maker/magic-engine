/**
 * GET /report/[id]
 *
 * Public, customer-facing "free digital health check" — the hook sent to a
 * cold prospect. No login: the business owner opens the link from the outreach
 * email and sees where enquiries may be leaking, plus the one-line fix per
 * stage (report copy version A).
 *
 * Data: the leak report is REBUILT deterministically from the evidence already
 * stored on the prospect row (audit + ai_report + score_breakdown) via
 * buildLeakReport — no new column, no migration. Only client-safe fields are
 * rendered (never prospect_score, raw internal analysis, or vendor names).
 *
 * noindex: each report is private to one business and must not be crawled.
 */

import type { Metadata } from 'next'
import { supabaseAdmin } from '@/lib/supabase'
import { buildLeakReport, type LeakStage } from '@/lib/prospecting/report'
import { senderIdentity } from '@/lib/prospecting/outreach'
import type { ProspectAudit } from '@/lib/prospecting/audit'
import type { ProspectAnalysis } from '@/lib/prospecting/analyze'
import type { ScoreSignal } from '@/lib/prospecting/score'

export const metadata: Metadata = {
  title: 'Your digital health check — Magic Engine',
  robots: { index: false, follow: false },
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

const DOT: Record<LeakStage['status'], string> = {
  leak: 'bg-red-500',
  weak: 'bg-amber-400',
  ok:   'bg-emerald-500',
}

const OK_FALLBACK = 'This part looks healthy — no action needed.'

function InvalidLink() {
  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-md text-center">
        <div className="mb-3 text-3xl">🔗</div>
        <h1 className="text-lg font-semibold text-gray-900">This link is no longer valid</h1>
        <p className="mt-2 text-sm text-gray-500">
          Please ask your Magic Engine contact to send you a fresh link.
        </p>
      </div>
    </main>
  )
}

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

  const sender = senderIdentity()
  const mailto = `mailto:${process.env.OUTREACH_REPLY_EMAIL ?? 'hello@magicengine.com.au'}` +
    `?subject=${encodeURIComponent(`Health check chat — ${p.business_name}`)}`

  return (
    <main className="min-h-screen bg-gray-50 text-gray-900">
      <div className="mx-auto max-w-2xl px-4 py-10 sm:py-14">

        <header className="mb-8">
          <p className="text-xs font-semibold uppercase tracking-wider text-indigo-600">Magic Engine · Free health check</p>
          <h1 className="mt-2 font-display text-2xl font-bold sm:text-3xl">{report.headline}</h1>
          <p className="mt-3 text-sm text-gray-600">
            We had a look at how <span className="font-semibold">{p.business_name}</span> shows up online.
            Here&apos;s where ready customers might be slipping away — and what we&apos;d do about each one.
          </p>
        </header>

        <ol className="space-y-4">
          {report.stages.map(stage => (
            <li key={stage.key} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-2.5">
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${DOT[stage.status]}`} aria-hidden />
                <h2 className="text-sm font-semibold text-gray-900">{stage.label}</h2>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-gray-700">
                {stage.finding || OK_FALLBACK}
              </p>
              {stage.status !== 'ok' && (
                <p className="mt-2 border-l-2 border-indigo-200 pl-3 text-sm leading-relaxed text-indigo-900">
                  <span className="font-semibold">What we&apos;d do:</span> {stage.fix}
                </p>
              )}
            </li>
          ))}
        </ol>

        <section className="mt-8 rounded-xl bg-gray-900 p-6 text-white">
          <h2 className="font-display text-lg font-bold">We fix all of this in 90 days</h2>
          <p className="mt-2 text-sm text-gray-300">
            One flat price of AUD&nbsp;$990 for the first three months. We get you found, plug the leaks,
            and switch on a steady flow of enquiries — all done for you. If you&apos;re not happy with what
            we deliver, you get a full refund.
          </p>
          <a
            href={mailto}
            className="mt-4 inline-flex items-center justify-center rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-gray-900 hover:bg-gray-100"
          >
            Book a 15-minute chat →
          </a>
        </section>

        <footer className="mt-8 text-xs leading-relaxed text-gray-400">
          <p>{sender.company}</p>
          <p className="mt-1">
            We put this together after coming across {p.business_name} in your public Google Business
            listing. Not happy to hear from us? Just reply &ldquo;no thanks&rdquo; and we won&apos;t be in touch again.
          </p>
        </footer>
      </div>
    </main>
  )
}
