import type { SupabaseClient } from '@supabase/supabase-js'
import { loadPublishedNameHistory, loadPublishedTourFacts } from '@/lib/tour-catalog/store-publish'
import type { PublishedTourFact } from '@/lib/tour-catalog/publish-contract'

export interface NamedTour {
  id: string
  name: string
  title?: string | null
}

export interface TourNameSnapshot {
  version: number
  tours: NamedTour[]
}

const DASH_SPLIT = /\s+[—–-]\s+/
const MIN_ALIAS_LENGTH = 4
const SNAPSHOT_LIMIT = 20

/** Last segment of a name split on a dash ("Brand Line — Short Name" -> "Short Name"); the whole trimmed name if no dash. */
export function nameSuffix(name: string): string {
  const trimmed = name.trim()
  const parts = trimmed.split(DASH_SPLIT)
  const last = parts[parts.length - 1]
  return (last ?? trimmed).trim()
}

function collectCandidates(tour: NamedTour): string[] {
  const raw: string[] = [tour.name]
  if (typeof tour.title === 'string' && tour.title.trim().length > 0) {
    raw.push(tour.title)
  }
  raw.push(nameSuffix(tour.name))
  if (typeof tour.title === 'string' && tour.title.trim().length > 0) {
    raw.push(nameSuffix(tour.title))
  }
  return raw
}

function normalizeCandidate(value: string): string | null {
  const trimmed = value.trim()
  if (trimmed.length < MIN_ALIAS_LENGTH) return null
  return trimmed
}

function buildCurrentNameSet(currentTours: NamedTour[]): Set<string> {
  const set = new Set<string>()
  for (const tour of currentTours) {
    for (const candidate of collectCandidates(tour)) {
      const normalized = normalizeCandidate(candidate)
      if (normalized !== null) set.add(normalized.toLowerCase())
    }
  }
  return set
}

function pushUnique(target: string[], seen: Set<string>, value: string): void {
  const key = value.toLowerCase()
  if (seen.has(key)) return
  seen.add(key)
  target.push(value)
}

/** Every earlier name/title (and their nameSuffix) of the same tour id that differs from the tour's current name/title/suffix. */
export function deriveAliases(
  snapshots: TourNameSnapshot[],
  currentTours: NamedTour[],
): Record<string, string[]> {
  const currentNames = buildCurrentNameSet(currentTours)
  const result: Record<string, string[]> = {}

  for (const current of currentTours) {
    const aliases: string[] = []
    const seen = new Set<string>()

    for (const snapshot of snapshots) {
      for (const past of snapshot.tours) {
        if (past.id !== current.id) continue
        for (const candidate of collectCandidates(past)) {
          const normalized = normalizeCandidate(candidate)
          if (normalized === null) continue
          if (currentNames.has(normalized.toLowerCase())) continue
          pushUnique(aliases, seen, normalized)
        }
      }
    }

    if (aliases.length > 0) {
      result[current.id] = aliases
    }
  }

  return result
}

export type SocialFactSource =
  | {
      ok: true
      catalogVersion: number
      tours: PublishedTourFact[]
      aliasesByTourId: Record<string, string[]>
    }
  | { ok: false; reason: string }

async function readSnapshots(
  db: SupabaseClient,
  clientId: string,
): Promise<TourNameSnapshot[] | null> {
  const read = await loadPublishedNameHistory(db, clientId, SNAPSHOT_LIMIT)
  return read.ok ? read.versions : null
}

export async function loadSocialFactSource(
  db: SupabaseClient,
  clientId: string,
  today: string,
): Promise<SocialFactSource> {
  try {
    const published = await loadPublishedTourFacts(db, clientId, today)
    if (!published.published) {
      return { ok: false, reason: 'catalog_not_published' }
    }
    if (published.tours.length === 0) {
      return { ok: false, reason: 'catalog_empty' }
    }

    const snapshots = await readSnapshots(db, clientId)
    if (snapshots === null) {
      return { ok: false, reason: 'snapshot_read_failed' }
    }

    const currentTours: NamedTour[] = published.tours.map((t) => ({
      id: t.id,
      name: t.name,
      title: t.title,
    }))
    const aliasesByTourId = deriveAliases(snapshots, currentTours)

    return {
      ok: true,
      catalogVersion: published.version,
      tours: published.tours,
      aliasesByTourId,
    }
  } catch {
    return { ok: false, reason: 'load_failed' }
  }
}
