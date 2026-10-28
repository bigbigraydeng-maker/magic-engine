/**
 * The landing check stored on the paused draft's existing record.
 * A missing or unreadable record is not a pass.
 */

import type { ItemKey, ItemState, LandingItem } from './judge'

const KEYS: readonly ItemKey[] = ['loads', 'right_page', 'form_fields', 'utm']
const STATES = new Set<ItemState>(['pass', 'fail', 'unchecked', 'skip'])

export interface LandingReceipt {
  readonly v: 1
  readonly checkedAt: string
  readonly destinationKey: string
  readonly items: readonly LandingItem[]
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function oneItem(value: unknown, key: ItemKey): LandingItem | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const state = row.state
  const detail = text(row.detail)
  if (row.key !== key || typeof state !== 'string' || !STATES.has(state as ItemState) || !detail) return null
  if (detail.length > 180) return null
  return { key, state: state as ItemState, detail }
}

export function readStoredReceipt(payload: unknown): LandingReceipt | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const raw = (payload as Record<string, unknown>).landing_verify
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const row = raw as Record<string, unknown>
  const checkedAt = text(row.checkedAt)
  const destinationKey = text(row.destinationKey)
  if (row.v !== 1 || !checkedAt || Number.isNaN(Date.parse(checkedAt)) || !destinationKey) return null
  if (!Array.isArray(row.items) || row.items.length !== KEYS.length) return null
  const items: LandingItem[] = []
  for (let index = 0; index < KEYS.length; index += 1) {
    const item = oneItem(row.items[index], KEYS[index])
    if (!item) return null
    items.push(item)
  }
  return { v: 1, checkedAt, destinationKey, items }
}

export function receiptBody(checkedAt: string, destinationKey: string, items: readonly LandingItem[]): LandingReceipt {
  return { v: 1, checkedAt, destinationKey, items }
}
