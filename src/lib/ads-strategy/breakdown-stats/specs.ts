import type { BreakdownKey, BreakdownSpec, BreakdownValue, GraphBreakdownRow } from './types'

/** Read a raw Graph field as a trimmed non-empty string, else null. */
function readString(raw: string | undefined): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** Parse "21:00:00 - 21:59:59" → 21; null when malformed or out of range. */
function parseHour(raw: string | undefined): number | null {
  const text = readString(raw)
  if (text === null) return null
  const hour = Number(text.slice(0, 2))
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null
  return hour
}

function hourValueOf(row: GraphBreakdownRow): BreakdownValue | null {
  const hour = parseHour(row.hourly_stats_aggregated_by_advertiser_time_zone)
  return hour === null ? null : { hour }
}

function placementValueOf(row: GraphBreakdownRow): BreakdownValue | null {
  const platform = readString(row.publisher_platform)
  const position = readString(row.platform_position)
  const device = readString(row.impression_device)
  if (platform === null || position === null || device === null) return null
  return { platform, position, device }
}

function ageGenderValueOf(row: GraphBreakdownRow): BreakdownValue | null {
  const age = readString(row.age)
  const gender = readString(row.gender)
  if (age === null || gender === null) return null
  return { age, gender }
}

function regionValueOf(row: GraphBreakdownRow): BreakdownValue | null {
  const region = readString(row.region)
  return region === null ? null : { region }
}

export const BREAKDOWN_SPECS: readonly BreakdownSpec[] = [
  {
    key: 'hour_account_tz',
    graphBreakdowns: 'hourly_stats_aggregated_by_advertiser_time_zone',
    metaActionsAvailable: false,
    valueOf: hourValueOf,
  },
  {
    key: 'placement_device',
    graphBreakdowns: 'publisher_platform,platform_position,impression_device',
    metaActionsAvailable: true,
    valueOf: placementValueOf,
  },
  {
    key: 'age_gender',
    graphBreakdowns: 'age,gender',
    metaActionsAvailable: true,
    valueOf: ageGenderValueOf,
  },
  {
    key: 'region',
    graphBreakdowns: 'region',
    metaActionsAvailable: false,
    valueOf: regionValueOf,
  },
]

export function specFor(key: BreakdownKey): BreakdownSpec {
  const spec = BREAKDOWN_SPECS.find((s) => s.key === key)
  if (!spec) throw new Error(`unknown breakdown key: ${key}`)
  return spec
}
