/**
 * The "sales unit" source for the sales-progress page. The page shell only knows `SalesUnitSource`; the travel
 * adapter below maps tour departures to units. It reads catalog facts ONLY through the sanctioned read module
 * `@/lib/tour-catalog/sales-facts` (which returns just the internal seat NUMBER, never the internal JSON), and
 * combines the internal and public limits with `effectiveCapacity`. Read-only.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { loadSalesDepartureFacts } from '@/lib/tour-catalog/sales-facts'
import { effectiveCapacity } from './capacity'
import type { SalesUnit } from './types'

/** The only thing the page shell knows about "what can be sold": a source that lists sales units. */
export interface SalesUnitSource {
  listSalesUnits(clientId: string): Promise<SalesUnit[]>
}

export function createDepartureUnitSource(db: SupabaseClient): SalesUnitSource {
  return {
    async listSalesUnits(clientId: string): Promise<SalesUnit[]> {
      const facts = await loadSalesDepartureFacts(db, clientId)
      return facts.map((fact) => {
        const { capacity, note } = effectiveCapacity({
          internalCapacity: fact.internalCapacity,
          tourMaxGroupSize: fact.tourMaxGroupSize,
        })
        return {
          unitId: fact.departureId,
          groupId: fact.tourId,
          label: `${fact.tourName ?? '未知团'} · ${fact.departOn}`,
          date: fact.departOn,
          capacity,
          capacityNote: note,
          unitStatus: fact.status ?? 'open',
        }
      })
    },
  }
}
