/**
 * Phase 26 — Client Locale Intelligence
 *
 * getClientLocale(clientId) returns the full locale context for a client,
 * combining DB fields with derived season/events/signals.
 *
 * All AI generators should call this instead of reading semrush_db directly.
 * semrush_db is preserved for backward-compatible DataForSEO calls.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { getUpcomingEvents, getCurrentSeason, type LocalEvent } from './calendar'

export type Country = 'AU' | 'NZ'
export type BusinessScope = 'local' | 'state' | 'national'

export interface ClientLocale {
  country: Country
  state_code: string | null
  city: string | null
  business_scope: BusinessScope
  confirmed: boolean                  // locale_confirmed_at IS NOT NULL

  // Derived fields
  timezone: string
  currency: 'NZD' | 'AUD'
  language: 'en-NZ' | 'en-AU'
  season_current: 'summer' | 'autumn' | 'winter' | 'spring'
  upcoming_events: LocalEvent[]       // next 60 days, filtered by scope
  consumer_signals: string[]          // marketing mood keywords

  // DataForSEO params (replaces direct semrush_db reads in new code)
  dataforseo: {
    location_code: number
    language_code: 'en'
  }
  serp_config: {
    gl: 'au' | 'nz'
    location: string
  }
}

// ─── Static lookup tables ─────────────────────────────────────────────────────

const TIMEZONE: Record<string, string> = {
  // AU states
  VIC: 'Australia/Melbourne', NSW: 'Australia/Sydney',
  QLD: 'Australia/Brisbane',  WA:  'Australia/Perth',
  SA:  'Australia/Adelaide',  TAS: 'Australia/Hobart',
  ACT: 'Australia/Sydney',    NT:  'Australia/Darwin',
  // NZ regions (all same TZ)
  AKL: 'Pacific/Auckland', WLG: 'Pacific/Auckland',
  CAN: 'Pacific/Auckland', OTG: 'Pacific/Auckland',
  HKB: 'Pacific/Auckland', NLS: 'Pacific/Auckland',
  MBR: 'Pacific/Auckland', STH: 'Pacific/Auckland',
  TRK: 'Pacific/Auckland', WKO: 'Pacific/Auckland',
}

const SERP_LOCATION: Record<string, string> = {
  VIC: 'Melbourne, Victoria, Australia',
  NSW: 'Sydney, New South Wales, Australia',
  QLD: 'Brisbane, Queensland, Australia',
  WA:  'Perth, Western Australia, Australia',
  SA:  'Adelaide, South Australia, Australia',
  TAS: 'Hobart, Tasmania, Australia',
  ACT: 'Canberra, Australian Capital Territory, Australia',
  NT:  'Darwin, Northern Territory, Australia',
  AKL: 'Auckland, New Zealand',
  WLG: 'Wellington, New Zealand',
  CAN: 'Christchurch, New Zealand',
  OTG: 'Dunedin, New Zealand',
  HKB: 'Napier, New Zealand',
  NLS: 'Nelson, New Zealand',
  MBR: 'Blenheim, New Zealand',
  STH: 'Invercargill, New Zealand',
  TRK: 'New Plymouth, New Zealand',
  WKO: 'Hamilton, New Zealand',
}

// DataForSEO location codes: AU=2036, NZ=2554
const DFS_LOCATION_CODE: Record<Country, number> = { AU: 2036, NZ: 2554 }

// ─── Consumer signals by season + upcoming events ─────────────────────────────

function deriveConsumerSignals(
  season: 'summer' | 'autumn' | 'winter' | 'spring',
  events: LocalEvent[],
): string[] {
  const signals: string[] = []

  const seasonSignals: Record<string, string[]> = {
    summer: ['outdoor activities', 'travel & holidays', 'BBQ & entertaining', 'beach lifestyle', 'summer gifting'],
    autumn: ['back to routine', 'comfort food', 'school term', 'indoor activities', 'Anzac reflection'],
    winter: ['warmth & comfort', 'home improvement', 'wellness', 'cosy experiences', 'mid-year planning'],
    spring: ['fresh start', 'outdoor renovation', 'spring cleaning', 'new beginnings', 'health & fitness'],
  }
  signals.push(...(seasonSignals[season] ?? []))

  // Add signals from upcoming events within next 30 days
  const soon = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  for (const ev of events) {
    if (new Date(ev.date) > soon) continue
    if (ev.type === 'shopping_event') signals.push(`${ev.name} shopping`)
    if (ev.type === 'public_holiday')  signals.push(`${ev.name} long weekend`)
    if (ev.type === 'cultural')        signals.push(`${ev.name} cultural moment`)
  }

  return Array.from(new Set(signals)).slice(0, 8)
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function getClientLocale(clientId: string): Promise<ClientLocale> {
  const { data: client, error } = await supabaseAdmin
    .from('clients')
    .select('id, semrush_db, country, state_code, city, business_scope, locale_confirmed_at')
    .eq('id', clientId)
    .single()

  if (error || !client) throw new Error(`Client not found: ${clientId}`)

  // Resolve country — prefer new column, fall back to semrush_db mapping
  const country: Country =
    (client.country as Country) ??
    (client.semrush_db === 'nz' ? 'NZ' : 'AU')

  const state_code: string | null = client.state_code ?? null
  const city: string | null = client.city ?? null
  const business_scope: BusinessScope = (client.business_scope as BusinessScope) ?? 'local'
  const confirmed = !!client.locale_confirmed_at

  const season = getCurrentSeason(country)

  const upcoming_events = getUpcomingEvents({
    country,
    state_code,
    city,
    business_scope,
    daysAhead: 60,
  })

  const consumer_signals = deriveConsumerSignals(season, upcoming_events)

  const tz = (state_code && TIMEZONE[state_code]) ??
    (country === 'NZ' ? 'Pacific/Auckland' : 'Australia/Sydney')

  const serpLocation = (state_code && SERP_LOCATION[state_code]) ??
    (country === 'NZ' ? 'New Zealand' : 'Australia')

  return {
    country,
    state_code,
    city,
    business_scope,
    confirmed,
    timezone: tz,
    currency: country === 'NZ' ? 'NZD' : 'AUD',
    language: country === 'NZ' ? 'en-NZ' : 'en-AU',
    season_current: season,
    upcoming_events,
    consumer_signals,
    dataforseo: {
      location_code: DFS_LOCATION_CODE[country],
      language_code: 'en',
    },
    serp_config: {
      gl: country === 'NZ' ? 'nz' : 'au',
      location: serpLocation,
    },
  }
}

/**
 * Formats ClientLocale into a concise string for AI prompt injection.
 * Keeps it tight — AI prompts don't need the full object.
 */
export function formatLocaleForPrompt(locale: ClientLocale): string {
  const lines: string[] = [
    `Market: ${locale.country === 'NZ' ? 'New Zealand' : 'Australia'}${locale.state_code ? ` (${locale.state_code})` : ''}${locale.city ? `, ${locale.city}` : ''}`,
    `Business scope: ${locale.business_scope} market`,
    `Season: ${locale.season_current} (Southern Hemisphere)`,
    `Currency: ${locale.currency} · Language: AU/NZ English spelling`,
  ]

  if (locale.upcoming_events.length > 0) {
    const eventList = locale.upcoming_events
      .slice(0, 4)
      .map(e => `${e.name} (${e.date})`)
      .join(', ')
    lines.push(`Upcoming events: ${eventList}`)
  }

  if (locale.consumer_signals.length > 0) {
    lines.push(`Current consumer mood: ${locale.consumer_signals.slice(0, 4).join(', ')}`)
  }

  return lines.join('\n')
}
