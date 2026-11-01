/** 把「客人开没开口」写到这通电话的触点上，CRM 靠它区分真聊过和语音信箱；前提是触点挂的正是这份分析、且分析没被人否掉；并发保护见 mergeTouchpointMetadata. */

import { mergeTouchpointMetadata, type MetadataMergeOutcome } from '@/lib/crm/touchpoint-metadata'
import type { CustomerSpokeVerdict } from './customer-spoke'

export function writeCustomerSpoke(input: { touchpointId: string; clientId: string; analysisId: string; verdict: CustomerSpokeVerdict }): Promise<MetadataMergeOutcome> {
  return mergeTouchpointMetadata({
    touchpointId: input.touchpointId,
    clientId: input.clientId,
    decide: (md) => {
      if (md.call_analysis_id !== input.analysisId) return null
      if (md.call_analysis_review === 'rejected') return null
      if (md.customer_spoke === input.verdict) return null
      return { customer_spoke: input.verdict }
    },
  })
}
