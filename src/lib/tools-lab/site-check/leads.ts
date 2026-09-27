// Supabase access for the free website check (table discovery_leads).
// Same semantics as website/functions/api/scout.js and report.js.

import { supabaseAdmin } from '@/lib/supabase'
import { validFindings, type CheckContext, type CheckLang, type CheckResult, type CheckSource } from './diagnose'

export interface StoredFindings extends CheckResult {
  lang: CheckLang
  context: CheckContext
  source: CheckSource
  reused: boolean
  meta?: {
    tool: string
    site_key: string | null
    lang: CheckLang
    context: CheckContext
  }
}

export interface RecentResult {
  findings: StoredFindings
  market: string
}

export interface StoreLeadInput {
  url: string
  market: string
  findings: StoredFindings
  answers: { what: string; where: string; who: string } | null
  attribution: unknown
}

const ATTRIBUTION_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'entry_offer', 'entry_page', 'referrer'] as const

function normaliseAttribution(input: unknown): Record<string, string> | null {
  if (!input || typeof input !== 'object') return null
  const src = input as Record<string, unknown>
  const out: Record<string, string> = {}
  for (const key of ATTRIBUTION_KEYS) {
    const value = typeof src[key] === 'string' ? (src[key] as string).trim().slice(0, 300) : ''
    if (value) out[key] = value
  }
  return Object.keys(out).length > 0 ? out : null
}

/** A result for the same site, language and context in the last 24 hours (never returns someone else's lead id). */
export async function recentResult(siteKey: string): Promise<RecentResult | null> {
  const since = new Date(Date.now() - 86_400_000).toISOString()
  try {
    const { data, error } = await supabaseAdmin
      .from('discovery_leads')
      .select('findings,market,url')
      .filter('attribution->>site_key', 'eq', siteKey)
      .gt('created_at', since)
      .not('findings', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
    if (error) return null
    const row = data?.[0] as { findings?: unknown; market?: string } | undefined
    if (!row) return null
    const findings = validFindings(row.findings)
    if (!findings) return null
    return { findings: row.findings as StoredFindings, market: row.market ?? '' }
  } catch {
    return null
  }
}

export async function storeLead(input: StoreLeadInput): Promise<string | null> {
  const { url, market, findings, answers, attribution } = input
  const clean = normaliseAttribution(attribution) ?? {}
  try {
    const { data, error } = await supabaseAdmin
      .from('discovery_leads')
      .insert({
        url: url || '',
        market,
        findings,
        no_website_answers: answers,
        status: 'scouted',
        ...clean,
        referrer: clean.referrer ?? null,
        attribution: { ...clean, ...findings.meta },
      })
      .select('id')
      .single()
    if (error) {
      console.error('site-check lead insert failed', error.message)
      return null
    }
    return (data as { id?: string } | null)?.id ?? null
  } catch (err) {
    console.error('site-check lead insert failed', err instanceof Error ? err.message : String(err))
    return null
  }
}

export interface LeadRow {
  id: string
  url: string
  market: string
  status: string
  findings: StoredFindings | null
}

export async function getLead(id: string): Promise<LeadRow | null> {
  const { data, error } = await supabaseAdmin
    .from('discovery_leads')
    .select('id,url,market,status,findings')
    .eq('id', id)
    .limit(1)
  if (error) return null
  return (data?.[0] as LeadRow | undefined) ?? null
}

/** Atomically move scouted → report_sent for this lead. Returns true only for the one caller that wins. */
export async function claimLead(id: string, email: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('discovery_leads')
    .update({ email, status: 'report_sent', consent_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'scouted')
    .select('id')
  if (error) return false
  return Array.isArray(data) && data.length === 1
}

export async function releaseLead(id: string): Promise<void> {
  try {
    await supabaseAdmin
      .from('discovery_leads')
      .update({ email: null, status: 'scouted', consent_at: null })
      .eq('id', id)
      .eq('status', 'report_sent')
  } catch {
    /* best effort */
  }
}
