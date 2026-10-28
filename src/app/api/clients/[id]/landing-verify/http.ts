/**
 * Body for the landing check. Only the draft id, and whether to look again.
 */

import { landingSubjectKey } from '@/lib/ads-landing-verify'
import { ConfirmationCardError } from '@/lib/confirmation-card'

const KEYS = ['draftId', 'again']

export interface LandingRequest {
  readonly draftId: string
  readonly again: boolean
}

export function parseLandingRequest(value: unknown): LandingRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ConfirmationCardError('invalid', '请求内容读不懂，没有核实。')
  }
  const row = value as Record<string, unknown>
  for (const key of Object.keys(row)) {
    if (!KEYS.includes(key)) throw new ConfirmationCardError('invalid', '请求里带了核实不认识的内容，没有核实。')
  }
  if (typeof row.draftId !== 'string' || !landingSubjectKey(row.draftId)) {
    throw new ConfirmationCardError('invalid', '要写上是哪条暂停广告。')
  }
  if (row.again !== undefined && typeof row.again !== 'boolean') {
    throw new ConfirmationCardError('invalid', '要不要再查一次，请用是或否。')
  }
  return { draftId: row.draftId.trim().toLowerCase(), again: row.again === true }
}

export function parseDraftQuery(url: string): string {
  const draftId = new URL(url).searchParams.get('draftId') ?? ''
  if (!landingSubjectKey(draftId)) {
    throw new ConfirmationCardError('invalid', '要写上是哪条暂停广告。')
  }
  return draftId.trim().toLowerCase()
}
