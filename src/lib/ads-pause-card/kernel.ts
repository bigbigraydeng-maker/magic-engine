/**
 * This card's kernel uses the existing pause-unit steps.
 * Its rollback is a no-op, so a mismatched readback cannot turn the ad set back on.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { createCapabilities } from '@/lib/capabilities'
import { createKernel, type KernelDeps } from '@/lib/kernel'
import type { CapabilityImplementation, OutwardRollbackResult } from '@/lib/kernel/types'

export async function neverResume(): Promise<OutwardRollbackResult> {
  return {
    ok: true,
    rollbackKind: 'noop',
    detail: { reason: 'this card never writes a resume' },
  }
}

export function withoutResume(pause: CapabilityImplementation): CapabilityImplementation {
  return {
    actionKey: pause.actionKey,
    version: pause.version,
    steps: pause.steps,
    rollback: neverResume,
  }
}

export function kernelThatCannotResume(sb: SupabaseClient): KernelDeps {
  const capabilities = createCapabilities(sb)
  const pause = capabilities['ads.pause_unit']
  if (!pause) throw new Error('pause unit is not registered')
  return createKernel(sb, {
    capabilities: { ...capabilities, 'ads.pause_unit': withoutResume(pause) },
  })
}
