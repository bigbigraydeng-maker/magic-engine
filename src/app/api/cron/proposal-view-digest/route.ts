/**
 * GET /api/cron/proposal-view-digest
 *
 * Daily digest of who opened a Magic Engine sales proposal in the last 24 hours.
 *
 * Reads the engagement events that the proposal pages post to
 * `website_lead_events` (source = 'proposal_tracking'), rolls them up per visit,
 * and emails a short read-out. **Sends nothing on a quiet day** — a proposal
 * nobody opened is not news, and a digest that arrives every morning regardless
 * stops being read.
 *
 * The point of the email is not "someone visited". It is the read pattern:
 * a prospect who returns a second time, or sits on the investment section, is
 * a call worth making today.
 *
 * Schedule: daily 19:00 UTC (~07:00 NZST next morning) — see render.yaml.
 * Security: Bearer CRON_SECRET, same as every other cron route.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { Resend } from 'resend'
import { startCronRun } from '@/lib/cron/run-logger'

const TO_EMAIL = 'hello@magicengine.cloud'
const LOOKBACK_HOURS = 24

/** A visit is "notable" once it looks like real reading rather than a bounce. */
const NOTABLE_SECONDS = 45
const NOTABLE_SCROLL_PCT = 40

interface EventRow {
  cta_key: string
  destination: string
  created_at: string
  metadata: {
    visit_id?: string
    section?: string | null
    scroll_pct?: number
    seconds?: number
    viewport?: string | null
    country?: string | null
  } | null
}

interface Visit {
  visitId: string
  destination: string
  firstSeen: string
  lastSeen: string
  seconds: number
  scrollPct: number
  sections: string[]
  country: string | null
  viewport: string | null
  events: number
}

function rollUp(rows: EventRow[]): Visit[] {
  const byVisit = new Map<string, Visit>()

  for (const row of rows) {
    const m = row.metadata ?? {}
    const visitId = m.visit_id || `unknown-${row.created_at}`

    let v = byVisit.get(visitId)
    if (!v) {
      v = {
        visitId,
        destination: row.destination,
        firstSeen: row.created_at,
        lastSeen: row.created_at,
        seconds: 0,
        scrollPct: 0,
        sections: [],
        country: m.country ?? null,
        viewport: m.viewport ?? null,
        events: 0,
      }
      byVisit.set(visitId, v)
    }

    v.events += 1
    if (row.created_at < v.firstSeen) v.firstSeen = row.created_at
    if (row.created_at > v.lastSeen) v.lastSeen = row.created_at
    v.seconds = Math.max(v.seconds, m.seconds ?? 0)
    v.scrollPct = Math.max(v.scrollPct, m.scroll_pct ?? 0)
    if (m.section && !v.sections.includes(m.section)) v.sections.push(m.section)
    if (!v.country && m.country) v.country = m.country
    if (!v.viewport && m.viewport) v.viewport = m.viewport
  }

  return Array.from(byVisit.values()).sort((a, b) => b.seconds - a.seconds)
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const nz = (iso: string) =>
  new Date(iso).toLocaleString('en-NZ', {
    timeZone: 'Pacific/Auckland',
    hour12: false,
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })

const mmss = (s: number) => `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`

const isMobile = (viewport: string | null) => {
  const w = Number.parseInt((viewport ?? '').split('x')[0] ?? '', 10)
  return Number.isFinite(w) && w < 700
}

/** The one line that tells the reader what to do about this visit. */
function readSignal(v: Visit): string {
  if (v.seconds >= 240 && v.scrollPct >= 80) return 'Read it end to end — call today'
  if (v.sections.some(s => /investment|return|pricing/i.test(s)) && v.seconds >= NOTABLE_SECONDS) {
    return 'Sat on the money section — expect a price question'
  }
  if (v.scrollPct >= NOTABLE_SCROLL_PCT && v.seconds >= NOTABLE_SECONDS) return 'Genuine read'
  if (v.seconds < 20) return 'Opened and left — may be the wrong recipient'
  return 'Skimmed'
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const cronRun = await startCronRun('proposal-view-digest')
  const since = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabaseAdmin
    .from('website_lead_events')
    .select('cta_key, destination, created_at, metadata')
    .eq('source', 'proposal_tracking')
    .gte('created_at', since)
    .order('created_at', { ascending: true })

  if (error) {
    await cronRun.finish({ failed: 1, error: error.message })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const visits = rollUp((data ?? []) as EventRow[])

  // Quiet day — say nothing.
  if (visits.length === 0) {
    await cronRun.finish({ processed: 0, completed: 1, failed: 0, summary: { quiet_day: true } })
    return NextResponse.json({ sent: false, reason: 'No proposal views in last 24h' })
  }

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    await cronRun.finish({ failed: 1, error: 'RESEND_API_KEY not configured' })
    return NextResponse.json({ error: 'Email not configured' }, { status: 503 })
  }

  const hot = visits.filter(v => v.seconds >= NOTABLE_SECONDS && v.scrollPct >= NOTABLE_SCROLL_PCT)
  const prospects = Array.from(new Set(visits.map(v => v.destination)))

  const rows = visits
    .map(v => {
      const deepest = v.sections.length ? v.sections[v.sections.length - 1] : '—'
      return `
    <tr>
      <td style="padding:10px 12px;font-size:13px;border-bottom:1px solid #e2e8f0">${esc(nz(v.firstSeen))}</td>
      <td style="padding:10px 12px;font-size:13px;border-bottom:1px solid #e2e8f0">${esc(v.destination)}</td>
      <td style="padding:10px 12px;font-size:13px;font-variant-numeric:tabular-nums;border-bottom:1px solid #e2e8f0">${esc(mmss(v.seconds))}</td>
      <td style="padding:10px 12px;font-size:13px;font-variant-numeric:tabular-nums;border-bottom:1px solid #e2e8f0">${v.scrollPct}%</td>
      <td style="padding:10px 12px;font-size:12px;color:#475569;border-bottom:1px solid #e2e8f0">${esc(deepest)}</td>
      <td style="padding:10px 12px;font-size:12px;color:#64748b;border-bottom:1px solid #e2e8f0">${esc(v.country ?? '—')} · ${isMobile(v.viewport) ? 'mobile' : 'desktop'}</td>
      <td style="padding:10px 12px;font-size:12px;font-weight:600;color:#0f172a;border-bottom:1px solid #e2e8f0">${esc(readSignal(v))}</td>
    </tr>`
    })
    .join('')

  const headline =
    hot.length > 0
      ? `${hot.length} genuine read${hot.length > 1 ? 's' : ''} of ${hot.length > 1 ? 'your proposals' : 'your proposal'}`
      : `${visits.length} proposal open${visits.length > 1 ? 's' : ''} — all brief`

  const html = `
    <div style="font-family:sans-serif;max-width:860px;margin:0 auto;padding:24px">
      <h2 style="margin:0 0 6px;font-size:18px;color:#0f172a">${esc(headline)}</h2>
      <p style="margin:0 0 20px;font-size:14px;color:#64748b">
        Last 24 hours · ${visits.length} visit${visits.length > 1 ? 's' : ''} across ${prospects.length} proposal${prospects.length > 1 ? 's' : ''}.
      </p>
      <table style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
        <thead>
          <tr style="background:#f8fafc">
            <th style="padding:10px 12px;text-align:left;font-size:11px;color:#475569;text-transform:uppercase">Opened (NZ)</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;color:#475569;text-transform:uppercase">Proposal</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;color:#475569;text-transform:uppercase">Time</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;color:#475569;text-transform:uppercase">Read</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;color:#475569;text-transform:uppercase">Got as far as</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;color:#475569;text-transform:uppercase">Where</th>
            <th style="padding:10px 12px;text-align:left;font-size:11px;color:#475569;text-transform:uppercase">Signal</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="margin-top:18px;font-size:12px;color:#94a3b8">
        Engagement only — no name, email or IP is collected. Each visit is an anonymous
        per-session id, so repeat opens from the same browser group together.
      </p>
    </div>`

  const resend = new Resend(apiKey)
  const { error: sendError } = await resend.emails.send({
    from: 'Magic Engine Monitor <onboarding@resend.dev>',
    to: [TO_EMAIL],
    subject: `${hot.length > 0 ? '🔥 ' : ''}${headline} — ${new Date().toLocaleDateString('en-NZ', { timeZone: 'Pacific/Auckland' })}`,
    html,
  })

  if (sendError) {
    console.error('[proposal-view-digest] Resend error:', sendError)
    await cronRun.finish({ failed: 1, error: String(sendError) })
    return NextResponse.json({ error: 'Failed to send email' }, { status: 500 })
  }

  await cronRun.finish({
    processed: visits.length,
    completed: 1,
    failed: 0,
    summary: { email_sent: true, visits: visits.length, genuine_reads: hot.length },
  })

  return NextResponse.json({ sent: true, visits: visits.length, genuine_reads: hot.length })
}
