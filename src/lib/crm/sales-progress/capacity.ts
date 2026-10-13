/**
 * Capacity resolution for a sales unit.
 * Combines the internal capacity with the official tour max group size
 * into a single effective capacity plus an optional explanatory note.
 * Pure functions only: no IO, no side effects, no mutation.
 */

export interface EffectiveCapacityInput {
  internalCapacity: unknown
  tourMaxGroupSize: unknown
}

export interface EffectiveCapacityResult {
  capacity: number | null
  note: string | null
}

export const INTERNAL_BAD_NOTE = '内部座位格式不对，请到团目录核对'

/** A value is valid only if it is a finite integer strictly greater than 0. */
function isValidCapacity(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value > 0
}

/**
 * Resolve the effective capacity from the internal and official values.
 * When both are valid and differ, the smaller one wins and a note is added.
 */
export function effectiveCapacity(input: EffectiveCapacityInput): EffectiveCapacityResult {
  // An internal capacity that is PRESENT but unusable (a string, 0, a fraction, a negative) must NOT silently fall
  // back to the public tour-level number: the real internal limit may be smaller, and falling back would overstate
  // the free seats. Only a missing / null internal value (nothing was entered) falls back.
  const internalPresent = input.internalCapacity !== undefined && input.internalCapacity !== null
  if (internalPresent && !isValidCapacity(input.internalCapacity)) {
    return { capacity: null, note: INTERNAL_BAD_NOTE }
  }
  const internal = isValidCapacity(input.internalCapacity) ? input.internalCapacity : null
  const tour = isValidCapacity(input.tourMaxGroupSize) ? input.tourMaxGroupSize : null

  if (internal !== null && tour !== null) {
    if (internal === tour) {
      return { capacity: internal, note: null }
    }
    const min = Math.min(internal, tour)
    return { capacity: min, note: `内部 ${internal} / 官方 ${tour}，按 ${min} 算` }
  }
  if (internal !== null) {
    return { capacity: internal, note: null }
  }
  if (tour !== null) {
    return { capacity: tour, note: null }
  }
  return { capacity: null, note: null }
}

/**
 * Read the `capacity` key from an internal capacity object.
 * Returns the raw value (undefined when the key is absent) when `internal` is a plain object, otherwise null.
 * Never returns any other key.
 */
export function readInternalCapacity(internal: unknown): unknown {
  if (typeof internal !== 'object' || internal === null || Array.isArray(internal)) {
    return null
  }
  return (internal as Record<string, unknown>).capacity
}
