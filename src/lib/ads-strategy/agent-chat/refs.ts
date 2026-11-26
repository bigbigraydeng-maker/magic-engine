/**
 * Opaque entity refs — server resolves to Meta ids; model only sees refs + names.
 */

import { createHash } from 'node:crypto'

export type EntityLevel = 'campaign' | 'adset' | 'ad'

const PREFIX: Record<EntityLevel, string> = { campaign: 'c', adset: 's', ad: 'a' }

export function opaqueEntityRef(level: EntityLevel, entityId: string): string {
  const h = createHash('sha256').update(`${level}:${entityId}`).digest('hex').slice(0, 10)
  return `${PREFIX[level]}_${h}`
}

export function opaqueAccountRef(adAccountId: string, index: number): string {
  const h = createHash('sha256').update(`acct:${adAccountId}`).digest('hex').slice(0, 8)
  return `acct${index}_${h}`
}
