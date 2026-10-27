/**
 * Execution of a confirmation card is refused.
 * A click is recorded by human approval and stops at "authorized".
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { CapabilityImplementation } from '@/lib/kernel/types'
import { KernelError } from '@/lib/kernel/errors'
import { CONFIRMATION_ACTION_KEY } from '@/lib/kernel/registry-confirmation'

export function createConfirmationHoldCapability(_sb: SupabaseClient): CapabilityImplementation {
  return {
    actionKey: CONFIRMATION_ACTION_KEY,
    version: 1,
    steps: {
      hold: async () => {
        throw new KernelError(
          'CAPABILITY_NOT_IMPLEMENTED',
          '确认只记下有没有点过。这一步不会改广告，也不会花钱。',
        )
      },
    },
  }
}
