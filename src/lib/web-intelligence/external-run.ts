import type { ExternalObservation } from './contracts'
import { recordExternalObservation } from './store'
import { collectApifyExternalObservations, collectTrafficDirectionObservations, type ApifyExternalCollection } from './apify-external'

export type ExternalRunReceipt = ApifyExternalCollection & {
  persisted: number
  duplicates: number
  writeFailures: number
  filtered: number
}

async function persistCollection(collection: ApifyExternalCollection, persist: (observation: ExternalObservation) => Promise<string>): Promise<ExternalRunReceipt> {
  let persisted = 0
  let duplicates = 0
  let writeFailures = 0
  for (const observation of collection.observations) {
    try {
      await persist(observation)
      persisted += 1
    } catch (error) {
      if (error instanceof Error && error.message === 'external_observation_duplicate') duplicates += 1
      else writeFailures += 1
    }
  }
  return { ...collection, persisted, duplicates, writeFailures, filtered: 0 }
}

/**
 * Execute one bounded Apify collection and persist its normalized rows.
 * Persistence is deliberately per observation so one duplicate cannot discard
 * the rest of a successful provider result.
 */
export async function collectAndRecordExternalObservations(input: {
  actorId: string
  actorInput: Record<string, unknown>
  sourceId: string
  clientId: string
  observedAt: string
  validUntil?: string | null
  timeoutMs?: number
  relevanceTerms?: string[]
  persist?: (observation: ExternalObservation) => Promise<string>
}): Promise<ExternalRunReceipt> {
  const collection = await collectApifyExternalObservations(input)
  let filtered = 0
  if (input.relevanceTerms?.length) {
    const terms = input.relevanceTerms.map(term => term.trim().toLowerCase()).filter(Boolean)
    filtered = collection.observations.filter(observation => !terms.some(term => `${observation.title}\n${observation.excerpt}`.toLowerCase().includes(term))).length
    collection.observations = collection.observations.filter(observation => terms.some(term => `${observation.title}\n${observation.excerpt}`.toLowerCase().includes(term)))
  }
  return { ...(await persistCollection(collection, input.persist ?? recordExternalObservation)), filtered }
}

/** Persist the Apify traffic-direction signal through the same shared path. */
export async function collectAndRecordTrafficDirectionObservations(input: {
  clientId: string; domains: string[]; observedAt: string; maxChargeUsd?: number
  persist?: (observation: ExternalObservation) => Promise<string>
}): Promise<ExternalRunReceipt> {
  const collection = await collectTrafficDirectionObservations(input)
  return persistCollection(collection, input.persist ?? recordExternalObservation)
}
