import { SAFE_BOTTOM, SAFE_RIGHT, SAFE_TOP } from '../theme.ts'
import type { ResolvedLook } from './types.ts'

/** Left inset of the 9:16 safe area. The other three edges live in theme.ts. */
export const SAFE_LEFT = 60

/** Fixed safe area. Style packs are not allowed to move it. */
export function safeZone(): ResolvedLook['safe'] {
  return { top: SAFE_TOP, bottom: SAFE_BOTTOM, left: SAFE_LEFT, right: SAFE_RIGHT }
}
