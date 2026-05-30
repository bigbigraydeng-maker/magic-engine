/**
 * AU/NZ static holiday & marketing event calendar — 2026–2027.
 * Update once a year. No external API dependency.
 *
 * scope hierarchy:
 *   national → applies to all clients in the country
 *   state    → applies to clients whose state_code is in `states`
 *   city     → applies to clients whose city matches (case-insensitive) one of `cities`
 *
 * business_scope cascade:
 *   local    → national + state(own) + city(own)
 *   state    → national + state(own)
 *   national → national + all states' events
 */

export type EventType = 'public_holiday' | 'shopping_event' | 'cultural' | 'local_show'
export type EventScope = 'national' | 'state' | 'city'

export interface LocalEvent {
  name: string
  date: string          // ISO YYYY-MM-DD
  type: EventType
  scope: EventScope
  country: 'AU' | 'NZ'
  states?: string[]     // for scope='state'; omit for national
  cities?: string[]     // for scope='city'; lowercase for matching
  marketing_note: string
}

// ─── Australia ────────────────────────────────────────────────────────────────

const AU_EVENTS: LocalEvent[] = [
  // ── National public holidays ──────────────────────────────────────────────
  { name: "New Year's Day",      date: '2026-01-01', type: 'public_holiday', scope: 'national', country: 'AU', marketing_note: "New Year campaigns, resolutions, fresh-start messaging" },
  { name: "Australia Day",       date: '2026-01-26', type: 'public_holiday', scope: 'national', country: 'AU', marketing_note: "Patriotic themes, BBQ/outdoor, Aussie lifestyle" },
  { name: "Good Friday",         date: '2026-04-03', type: 'public_holiday', scope: 'national', country: 'AU', marketing_note: "Long weekend — travel, family, gift campaigns" },
  { name: "Easter Saturday",     date: '2026-04-04', type: 'public_holiday', scope: 'national', country: 'AU', marketing_note: "Easter shopping peak" },
  { name: "Easter Sunday",       date: '2026-04-05', type: 'public_holiday', scope: 'national', country: 'AU', marketing_note: "Family gathering, chocolate, spring themes" },
  { name: "Easter Monday",       date: '2026-04-06', type: 'public_holiday', scope: 'national', country: 'AU', marketing_note: "Last day of long weekend" },
  { name: "ANZAC Day",           date: '2026-04-25', type: 'public_holiday', scope: 'national', country: 'AU', marketing_note: "Respectful/reflective tone only. Avoid promotional content." },
  { name: "Christmas Day",       date: '2026-12-25', type: 'public_holiday', scope: 'national', country: 'AU', marketing_note: "Peak retail season. Summer Christmas in AU." },
  { name: "Boxing Day",          date: '2026-12-26', type: 'public_holiday', scope: 'national', country: 'AU', marketing_note: "Biggest sale day of the year for AU retail" },
  { name: "New Year's Eve",      date: '2026-12-31', type: 'cultural',       scope: 'national', country: 'AU', marketing_note: "Celebration, fireworks, year-end reflection" },
  { name: "New Year's Day 2027", date: '2027-01-01', type: 'public_holiday', scope: 'national', country: 'AU', marketing_note: "New year fresh start campaigns" },

  // ── National shopping/marketing events ────────────────────────────────────
  { name: "Valentine's Day",         date: '2026-02-14', type: 'shopping_event', scope: 'national', country: 'AU', marketing_note: "Gifting, dining, romance campaigns" },
  { name: "Mother's Day",            date: '2026-05-10', type: 'shopping_event', scope: 'national', country: 'AU', marketing_note: "Second Sunday in May. Peak gifting." },
  { name: "End of Financial Year",   date: '2026-06-30', type: 'shopping_event', scope: 'national', country: 'AU', marketing_note: "EOFY — tax, upgrades, business purchases" },
  { name: "EOFY Sale Season",        date: '2026-06-01', type: 'shopping_event', scope: 'national', country: 'AU', marketing_note: "AU retailers run EOFY sales June 1–30" },
  { name: "Father's Day",            date: '2026-09-06', type: 'shopping_event', scope: 'national', country: 'AU', marketing_note: "First Sunday in September (AU/NZ — different from US/UK)" },
  { name: "Black Friday",            date: '2026-11-27', type: 'shopping_event', scope: 'national', country: 'AU', marketing_note: "Biggest online sale event. Start campaigns 2 weeks prior." },
  { name: "Cyber Monday",            date: '2026-11-30', type: 'shopping_event', scope: 'national', country: 'AU', marketing_note: "Online deals extension after Black Friday" },
  { name: "Christmas Shopping Peak", date: '2026-12-01', type: 'shopping_event', scope: 'national', country: 'AU', marketing_note: "December 1–24 — Christmas gifting season" },
  { name: "Back to School",          date: '2027-01-20', type: 'shopping_event', scope: 'national', country: 'AU', marketing_note: "Late Jan: school supplies, uniforms, tech" },

  // ── National cultural ──────────────────────────────────────────────────────
  { name: "NAIDOC Week",    date: '2026-07-05', type: 'cultural', scope: 'national', country: 'AU', marketing_note: "National Aboriginal and Torres Strait Islander celebration. Show respect; acknowledge Country." },
  { name: "National Sorry Day", date: '2026-05-26', type: 'cultural', scope: 'national', country: 'AU', marketing_note: "Reconciliation — respectful awareness content only" },
  { name: "Reconciliation Week", date: '2026-05-27', type: 'cultural', scope: 'national', country: 'AU', marketing_note: "27 May–3 June. Acknowledge First Nations. Not promotional." },

  // ── VIC ───────────────────────────────────────────────────────────────────
  { name: "AFL Grand Final Friday", date: '2026-09-25', type: 'public_holiday', scope: 'state', country: 'AU', states: ['VIC'], marketing_note: "VIC public holiday. AFL-themed campaigns resonate strongly." },
  { name: "Melbourne Cup Day",      date: '2026-11-03', type: 'public_holiday', scope: 'city',  country: 'AU', states: ['VIC'], cities: ['melbourne'], marketing_note: "Melbourne metro only. 'Race that stops a nation'. Fashion, hospitality, events." },

  // ── QLD ───────────────────────────────────────────────────────────────────
  { name: "Brisbane Ekka Show Day", date: '2026-08-12', type: 'local_show', scope: 'city', country: 'AU', states: ['QLD'], cities: ['brisbane'], marketing_note: "Brisbane/SEQ only. Family event; agricultural show themes." },
  { name: "Queensland Day",         date: '2026-06-06', type: 'cultural', scope: 'state', country: 'AU', states: ['QLD'], marketing_note: "QLD pride and community campaigns" },

  // ── WA ────────────────────────────────────────────────────────────────────
  { name: "Western Australia Day", date: '2026-06-01', type: 'public_holiday', scope: 'state', country: 'AU', states: ['WA'], marketing_note: "First Monday in June. WA pride, community events." },

  // ── SA ────────────────────────────────────────────────────────────────────
  { name: "Adelaide Cup",    date: '2026-05-11', type: 'public_holiday', scope: 'state', country: 'AU', states: ['SA'], marketing_note: "SA racing carnival. Hospitality and events campaigns." },
  { name: "Proclamation Day", date: '2026-12-28', type: 'public_holiday', scope: 'state', country: 'AU', states: ['SA'], marketing_note: "SA only public holiday between Christmas and New Year." },

  // ── TAS ───────────────────────────────────────────────────────────────────
  { name: "Eight Hours Day", date: '2026-03-09', type: 'public_holiday', scope: 'state', country: 'AU', states: ['TAS'], marketing_note: "TAS Labour Day equivalent. Worker/community themes." },
  { name: "Hobart Regatta",  date: '2026-02-09', type: 'local_show', scope: 'city', country: 'AU', states: ['TAS'], cities: ['hobart'], marketing_note: "Hobart's Royal Regatta. Maritime/outdoor event themes." },

  // ── ACT ───────────────────────────────────────────────────────────────────
  { name: "Canberra Day",          date: '2026-03-16', type: 'public_holiday', scope: 'state', country: 'AU', states: ['ACT'], marketing_note: "ACT only. Canberra community celebrations." },
  { name: "Reconciliation Day ACT", date: '2026-05-25', type: 'public_holiday', scope: 'state', country: 'AU', states: ['ACT'], marketing_note: "ACT public holiday. First Nations recognition." },

  // ── NSW ───────────────────────────────────────────────────────────────────
  { name: "Bank Holiday NSW", date: '2026-08-03', type: 'public_holiday', scope: 'state', country: 'AU', states: ['NSW'], marketing_note: "First Monday in August. NSW retail closed; service businesses may notice quieter day." },

  // ── NT ────────────────────────────────────────────────────────────────────
  { name: "Picnic Day NT",     date: '2026-08-03', type: 'public_holiday', scope: 'state', country: 'AU', states: ['NT'], marketing_note: "NT public holiday. Outdoor/community campaigns." },
  { name: "Darwin Show Day",   date: '2026-07-24', type: 'local_show', scope: 'city', country: 'AU', states: ['NT'], cities: ['darwin'], marketing_note: "Darwin only. Agricultural show / family event." },
]

// ─── New Zealand ──────────────────────────────────────────────────────────────

const NZ_EVENTS: LocalEvent[] = [
  // ── National public holidays ──────────────────────────────────────────────
  { name: "New Year's Day",     date: '2026-01-01', type: 'public_holiday', scope: 'national', country: 'NZ', marketing_note: "New Year campaigns, fresh-start messaging" },
  { name: "Day after New Year's Day", date: '2026-01-02', type: 'public_holiday', scope: 'national', country: 'NZ', marketing_note: "NZ extends New Year with a second public holiday" },
  { name: "Waitangi Day",       date: '2026-02-06', type: 'public_holiday', scope: 'national', country: 'NZ', marketing_note: "NZ founding document. Bi-cultural themes. Respectful acknowledgement of Te Tiriti." },
  { name: "Good Friday",        date: '2026-04-03', type: 'public_holiday', scope: 'national', country: 'NZ', marketing_note: "Long weekend — travel, family" },
  { name: "Easter Monday",      date: '2026-04-06', type: 'public_holiday', scope: 'national', country: 'NZ', marketing_note: "Last day of Easter long weekend" },
  { name: "ANZAC Day",          date: '2026-04-25', type: 'public_holiday', scope: 'national', country: 'NZ', marketing_note: "Respectful/reflective tone only. No promotional content." },
  { name: "King's Birthday",    date: '2026-06-01', type: 'public_holiday', scope: 'national', country: 'NZ', marketing_note: "First Monday in June (NZ). Long weekend." },
  { name: "Matariki",           date: '2026-06-26', type: 'public_holiday', scope: 'national', country: 'NZ', marketing_note: "Māori New Year. Star cluster rising. Cultural celebration, reflection, giving. Strong in Māori heartland regions." },
  { name: "Labour Day",         date: '2026-10-26', type: 'public_holiday', scope: 'national', country: 'NZ', marketing_note: "Fourth Monday in October. Long weekend." },
  { name: "Christmas Day",      date: '2026-12-25', type: 'public_holiday', scope: 'national', country: 'NZ', marketing_note: "Peak summer retail season." },
  { name: "Boxing Day",         date: '2026-12-26', type: 'public_holiday', scope: 'national', country: 'NZ', marketing_note: "Major NZ sale day." },
  { name: "New Year's Day 2027", date: '2027-01-01', type: 'public_holiday', scope: 'national', country: 'NZ', marketing_note: "New year fresh start campaigns" },

  // ── National shopping/marketing events ────────────────────────────────────
  { name: "Valentine's Day",  date: '2026-02-14', type: 'shopping_event', scope: 'national', country: 'NZ', marketing_note: "Gifting, dining, romance campaigns" },
  { name: "Mother's Day",     date: '2026-05-10', type: 'shopping_event', scope: 'national', country: 'NZ', marketing_note: "Second Sunday in May." },
  { name: "Father's Day",     date: '2026-09-06', type: 'shopping_event', scope: 'national', country: 'NZ', marketing_note: "First Sunday in September (NZ — same as AU, different from US/UK)" },
  { name: "Black Friday",     date: '2026-11-27', type: 'shopping_event', scope: 'national', country: 'NZ', marketing_note: "Growing fast in NZ. Major online sale event." },
  { name: "Cyber Monday",     date: '2026-11-30', type: 'shopping_event', scope: 'national', country: 'NZ', marketing_note: "Online deals after Black Friday" },
  { name: "Christmas Shopping Peak", date: '2026-12-01', type: 'shopping_event', scope: 'national', country: 'NZ', marketing_note: "December gifting season" },
  { name: "Back to School",   date: '2027-01-28', type: 'shopping_event', scope: 'national', country: 'NZ', marketing_note: "Late Jan: school supplies, uniforms" },

  // ── National cultural ──────────────────────────────────────────────────────
  { name: "Te Wiki o te Reo Māori", date: '2026-09-14', type: 'cultural', scope: 'national', country: 'NZ', marketing_note: "Māori Language Week (third week of September). Incorporate te reo Māori." },

  // ── Regional Anniversary Days ─────────────────────────────────────────────
  { name: "Auckland Anniversary Day",    date: '2026-01-26', type: 'public_holiday', scope: 'state', country: 'NZ', states: ['AKL'], marketing_note: "Auckland only. Long weekend in late January." },
  { name: "Wellington Anniversary Day",  date: '2026-01-19', type: 'public_holiday', scope: 'state', country: 'NZ', states: ['WLG'], marketing_note: "Wellington region. Fourth Monday in January." },
  { name: "Nelson Anniversary Day",      date: '2026-02-02', type: 'public_holiday', scope: 'state', country: 'NZ', states: ['NLS'], marketing_note: "Nelson/Tasman region." },
  { name: "Taranaki Anniversary Day",    date: '2026-03-09', type: 'public_holiday', scope: 'state', country: 'NZ', states: ['TRK'], marketing_note: "Taranaki region." },
  { name: "Otago Anniversary Day",       date: '2026-03-23', type: 'public_holiday', scope: 'state', country: 'NZ', states: ['OTG'], marketing_note: "Otago region including Dunedin." },
  { name: "Southland Anniversary Day",   date: '2026-01-19', type: 'public_holiday', scope: 'state', country: 'NZ', states: ['STH'], marketing_note: "Southland region." },
  { name: "Hawke's Bay Anniversary Day", date: '2026-10-23', type: 'public_holiday', scope: 'state', country: 'NZ', states: ['HKB'], marketing_note: "Hawke's Bay region." },
  { name: "Marlborough Anniversary Day", date: '2026-11-02', type: 'public_holiday', scope: 'state', country: 'NZ', states: ['MBR'], marketing_note: "Marlborough region." },
  { name: "Canterbury Anniversary Day",  date: '2026-11-13', type: 'public_holiday', scope: 'state', country: 'NZ', states: ['CAN'], marketing_note: "Canterbury region including Christchurch." },
  { name: "Waikato Anniversary Day",     date: '2026-10-19', type: 'public_holiday', scope: 'state', country: 'NZ', states: ['WKO'], marketing_note: "Waikato region including Hamilton." },

  // ── Local shows ───────────────────────────────────────────────────────────
  { name: "Auckland Show",         date: '2026-10-22', type: 'local_show', scope: 'city', country: 'NZ', states: ['AKL'], cities: ['auckland'], marketing_note: "Auckland A&P Show. Agricultural/family themes." },
  { name: "Canterbury A&P Show",   date: '2026-11-11', type: 'local_show', scope: 'city', country: 'NZ', states: ['CAN'], cities: ['christchurch'], marketing_note: "Christchurch. Largest A&P show in NZ." },
  { name: "Royal Easter Show AKL", date: '2026-04-02', type: 'local_show', scope: 'city', country: 'NZ', states: ['AKL'], cities: ['auckland'], marketing_note: "Auckland Easter Show. Family/community event." },
]

export const ALL_EVENTS: LocalEvent[] = [...AU_EVENTS, ...NZ_EVENTS]

/**
 * Returns events relevant to a client based on their location and business scope.
 * - local:    national + own state + own city (within daysAhead window)
 * - state:    national + own state
 * - national: national + all states
 */
export function getUpcomingEvents(params: {
  country: 'AU' | 'NZ'
  state_code?: string | null
  city?: string | null
  business_scope: 'local' | 'state' | 'national'
  daysAhead?: number
}): LocalEvent[] {
  const { country, state_code, city, business_scope, daysAhead = 60 } = params
  const now = new Date()
  const cutoff = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000)

  const cityLower = city?.toLowerCase().trim() ?? ''
  const stateLower = state_code?.toUpperCase() ?? ''

  return ALL_EVENTS.filter(ev => {
    if (ev.country !== country) return false

    const evDate = new Date(ev.date)
    if (evDate < now || evDate > cutoff) return false

    if (ev.scope === 'national') return true

    if (ev.scope === 'state') {
      if (business_scope === 'national') return true
      return ev.states?.includes(stateLower) ?? false
    }

    if (ev.scope === 'city') {
      if (business_scope === 'national') return true
      if (business_scope === 'state') return ev.states?.includes(stateLower) ?? false
      // local: must match both state and city
      const stateMatch = ev.states?.includes(stateLower) ?? true
      const cityMatch = ev.cities?.some(c => cityLower.includes(c) || c.includes(cityLower)) ?? false
      return stateMatch && cityMatch
    }

    return false
  }).sort((a, b) => a.date.localeCompare(b.date))
}

/** Current season in the Southern Hemisphere based on month. */
export function getCurrentSeason(country: 'AU' | 'NZ'): 'summer' | 'autumn' | 'winter' | 'spring' {
  void country // both AU and NZ follow Southern Hemisphere seasons
  const month = new Date().getMonth() + 1 // 1–12
  if (month >= 12 || month <= 2) return 'summer'
  if (month >= 3 && month <= 5)  return 'autumn'
  if (month >= 6 && month <= 8)  return 'winter'
  return 'spring'
}
