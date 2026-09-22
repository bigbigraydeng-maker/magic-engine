export type TrafficDirectionObservation = {
  domain: string
  is_client?: boolean
  source_url: string
  observed_at: string
  valid_until: string | null
  excerpt: string
}

function sameDomain(left: string, right: string): boolean {
  return left.replace(/^www\./i, '').toLowerCase() === right.replace(/^www\./i, '').toLowerCase()
}

export type TrafficDirectionSignal = TrafficDirectionObservation & {
  observation_count: number
  previous_observed_at: string | null
  estimated_visits: number | null
  previous_estimated_visits: number | null
  snapshot_change_pct: number | null
  visits_change_pct: number | null
  top_country: string | null
}

function parseCompactNumber(value: string): number | null {
  const match = value.trim().match(/^([\d,.]+)\s*([KMB])?$/i)
  if (!match) return null
  const base = Number(match[1].replace(/,/g, ''))
  if (!Number.isFinite(base)) return null
  const multiplier = { K: 1_000, M: 1_000_000, B: 1_000_000_000 }[match[2]?.toUpperCase() as 'K' | 'M' | 'B'] ?? 1
  return base * multiplier
}

function metric(excerpt: string, label: string): string | null {
  const line = excerpt.split('\n').find(value => value.startsWith(`${label}：`))
  return line ? line.slice(label.length + 1).trim() : null
}

function parseVisits(excerpt: string): number | null {
  const value = metric(excerpt, '估算访问量')
  return value && value !== '未测量' ? parseCompactNumber(value) : null
}

function parseVisitsChange(excerpt: string): number | null {
  const value = metric(excerpt, '访问量变化')
  if (!value || value === '未测量') return null
  const parsed = Number.parseFloat(value.replace('%', '').replace('+', ''))
  return Number.isFinite(parsed) ? parsed : null
}

function parseTopCountry(excerpt: string): string | null {
  const value = metric(excerpt, '主要国家')
  return value && value !== '未测量' ? value : null
}

/** Project immutable observations into one current signal per competitor. */
export function projectTrafficDirectionSignals(rows: TrafficDirectionObservation[], clientDomain?: string | null): TrafficDirectionSignal[] {
  const grouped = new Map<string, TrafficDirectionObservation[]>()
  for (const row of rows) {
    const current = grouped.get(row.domain) ?? []
    current.push(row)
    grouped.set(row.domain, current)
  }
  return [...grouped.entries()].map(([domain, items]) => {
    const ordered = [...items].sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at))
    const latest = ordered[0]
    const previous = ordered[1]
    const estimatedVisits = parseVisits(latest.excerpt)
    const previousEstimatedVisits = previous ? parseVisits(previous.excerpt) : null
    const snapshotChangePct = estimatedVisits !== null && previousEstimatedVisits !== null && previousEstimatedVisits > 0
      ? Math.round(((estimatedVisits - previousEstimatedVisits) / previousEstimatedVisits) * 1000) / 10
      : null
    return {
      ...latest,
      is_client: latest.is_client ?? (clientDomain ? sameDomain(domain, clientDomain) : false),
      observation_count: ordered.length,
      previous_observed_at: previous?.observed_at ?? null,
      estimated_visits: estimatedVisits,
      previous_estimated_visits: previousEstimatedVisits,
      snapshot_change_pct: snapshotChangePct,
      visits_change_pct: parseVisitsChange(latest.excerpt),
      top_country: parseTopCountry(latest.excerpt),
    }
  }).sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at))
}
