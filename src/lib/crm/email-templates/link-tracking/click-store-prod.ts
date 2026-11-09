/** The real reads and writes behind recordClick. Events never throw: a lost event never loses the click row. */

import type { SupabaseClient } from '@supabase/supabase-js'
import { sendInngestEvent } from '@/lib/workflows/inngest-event'
import type { ClickRow, ClickStore, TokenInfo } from './record-click'
import type { LinkKind } from './tag-links-prod'
import type { TourLinkRef } from '../facts/published-tours'

export const CRM_EMAIL_LINK_CLICKED = 'crm.email_link.clicked'
const EMIT_TIMEOUT_MS = 2000

export interface CrmEmailLinkClickedData {
  [key: string]: unknown
  client_id: string
  contact_id: string
  request_id: string
  token: string
  kind: LinkKind
  tour: TourLinkRef | null
  clicked_at: string
}

interface TokenRowRead {
  token: string
  client_id: string
  contact_id: string
  request_id: string
  kind: LinkKind
  tour: TourLinkRef | null
  created_at: string
}

export interface PriorSendLookup {
  findPriorSend(clientId: string, requestId: string, contactId: string): Promise<{ status: 'pending' | 'sent' | 'failed' } | null>
}

export function createClickStore(db: SupabaseClient, mail: PriorSendLookup): ClickStore {
  return {
    async findToken(token): Promise<TokenInfo | null> {
      const { data, error } = await db
        .from('crm_email_link_tokens')
        .select('token, client_id, contact_id, request_id, kind, tour, created_at')
        .eq('token', token)
        .maybeSingle()
      if (error) throw new Error(`crm_email_link_tokens: ${error.message}`)
      if (data === null) return null
      const row = data as TokenRowRead
      return { token: row.token, clientId: row.client_id, contactId: row.contact_id, requestId: row.request_id, kind: row.kind, tour: row.tour, createdAt: row.created_at }
    },
    async mailWasSent(info) {
      const prior = await mail.findPriorSend(info.clientId, info.requestId, info.contactId)
      return prior !== null && prior.status === 'sent'
    },
    async clickStats(token) {
      const { data, error } = await db
        .from('crm_email_link_clicks')
        .select('occurred_at, counts_as_human')
        .eq('token', token)
        .order('occurred_at', { ascending: false })
        .limit(60)
      if (error) throw new Error(`crm_email_link_clicks: ${error.message}`)
      const rows = (data as Array<{ occurred_at: string; counts_as_human: boolean }> | null) ?? []
      return { count: rows.length, lastAt: rows[0]?.occurred_at ?? null, hasHuman: rows.some((r) => r.counts_as_human) }
    },
    async insertClick(row: ClickRow) {
      const { error } = await db.from('crm_email_link_clicks').insert(row)
      if (error) throw new Error(`crm_email_link_clicks insert: ${error.message}`)
    },
    async emitFirstHumanClick(info, clickedAt) {
      try {
        await sendInngestEvent<CrmEmailLinkClickedData>(
          {
            // One event per token at most: downstream (day-2 reminder, weekly stats) can rely on this id to de-duplicate.
            id: `email-link-click:${info.token}`,
            name: CRM_EMAIL_LINK_CLICKED,
            data: { client_id: info.clientId, contact_id: info.contactId, request_id: info.requestId, token: info.token, kind: info.kind, tour: info.tour, clicked_at: clickedAt },
          },
          { fetcher: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(EMIT_TIMEOUT_MS) }) },
        )
      } catch (err) {
        console.error('[link-click] 事件没发出去（点击已记下）:', err instanceof Error ? err.message : err)
      }
    },
  }
}
