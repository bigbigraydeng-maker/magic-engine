import type {
  PublishedTourFact,
  PublishedTourFactDeparture,
} from '@/lib/tour-catalog/publish-contract'
import type { FactSource, PickFilter, PickMode, PublishedToursProviderSettings } from '../types'

export type { PublishedTourFact, PublishedTourFactDeparture }

/** What the staff member picked in the panel: a tour and (when the tour manages departures) a departure day. */
export interface PickInput {
  tourId: string
  departOn: string | null
}

export interface ResolvedPick {
  tour: PublishedTourFact
  departure: PublishedTourFactDeparture | null
}

export type ResolvePicksResult =
  | { ok: true; picks: ResolvedPick[] }
  | { ok: false; reason: 'invalid_pick' | 'tour_unavailable'; detail: string }

/** A value for one placeholder, or the reason it cannot be filled. */
export type ProviderValue = { ok: true; value: string } | { ok: false; missing: string }

export interface VariableSpec {
  /** Pick modes of the template in which the variable may be used. */
  pickModes: readonly PickMode[]
  /** Accepts a `:N` count suffix (a bullet list). */
  list: boolean
  /** Renders more than one line, so it may not be used in a subject. */
  multiline: boolean
}

/** Everything a provider needs to render and to check a message; assembled by the caller. */
export interface RenderFacts {
  /** The whole published snapshot (sellable or not), used to validate links. */
  tours: PublishedTourFact[]
  picks: ResolvedPick[]
  settings: PublishedToursProviderSettings | null
}

export interface LinkViolation {
  url: string
  code: 'tour_page_not_on_sale' | 'departure_not_on_sale'
  detail: string
}

export interface FactProvider {
  id: FactSource
  variables: Readonly<Record<string, VariableSpec>>
  /** Fill one placeholder. `count` is the `:N` suffix or null. */
  resolve(name: string, count: number | null, facts: RenderFacts): ProviderValue
  /** Provider-specific link checks (host and https checks are done by the shared gate). */
  checkLinks(urls: readonly string[], facts: RenderFacts): LinkViolation[]
  /** Normalised money amounts (see amounts.ts) that are legitimately quotable for these picks. */
  knownAmounts(facts: RenderFacts): string[]
  /** Validate what the staff member picked against the published snapshot and the template's filter. */
  resolvePicks(
    tours: readonly PublishedTourFact[],
    inputs: readonly PickInput[],
    filter: PickFilter,
    mode: PickMode,
  ): ResolvePicksResult
  /** The picks must still be sellable now. */
  sellable(picks: readonly ResolvedPick[]): { ok: true } | { ok: false; detail: string }
}
