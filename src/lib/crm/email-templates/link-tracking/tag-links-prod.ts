/**
 * The real `tagLinks` step of sendMailNew: token the tracked links of one mail and store the tokens, inside the
 * guest's lock, after every gate has passed. NEVER throws (design §4.2): tracking is not a safety gate, so any failure
 * sends the original text and leaves a warning on the receipt.
 */

import { randomBytes } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { EffectiveEmailConfig } from '../effective-config'
import { classifyTourLink, type TourLinkRef } from '../facts/published-tours'
import type { RenderFacts } from '../facts/types'
import { catalogueKey } from '../gates/catalogue'
import { tagBody } from './tag-links'

const TABLE = 'crm_email_link_tokens'
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

export type LinkKind = 'catalogue' | 'tour' | 'all_tours' | 'other'

export interface TagLinksArgs {
  clientId: string
  contactId: string
  requestId: string
  body: string
  config: Pick<EffectiveEmailConfig, 'providers'>
  facts: RenderFacts | null
}

export interface TagLinksOutcome {
  body: string
  tagged: number
  /** `link_tracking_failed` / `link_tracking_mismatch`, or null. Goes on the receipt. */
  warning: string | null
}

/** 12 letters/digits, uniformly drawn (rejection sampling keeps the 62-letter alphabet unbiased). */
export function newToken(): string {
  let out = ''
  while (out.length < 12) {
    for (const byte of randomBytes(24)) {
      if (byte < 248 && out.length < 12) out += ALPHABET[byte % 62]
    }
  }
  return out
}

export function classifyLink(url: string, config: Pick<EffectiveEmailConfig, 'providers'>, facts: RenderFacts | null): { kind: LinkKind; tour: TourLinkRef | null } {
  const catalogue = config.providers.catalogue
  const full = /^https?:\/\//i.test(url) ? url : `https://${url}`
  if (catalogue !== undefined && catalogueKey(full) !== null && catalogueKey(full) === catalogueKey(catalogue.url)) {
    return { kind: 'catalogue', tour: null }
  }
  const tour = classifyTourLink(full, facts)
  if (tour?.kind === 'tour') return { kind: 'tour', tour: tour.tour }
  if (tour?.kind === 'all_tours') return { kind: 'all_tours', tour: null }
  return { kind: 'other', tour: null }
}

export interface TokenRow {
  token: string
  client_id: string
  contact_id: string
  request_id: string
  url: string
  kind: LinkKind
  tour: TourLinkRef | null
}

/** Saves the token rows; resolves with an error message instead of throwing. */
export type SaveTokens = (rows: TokenRow[]) => Promise<{ error: string | null }>

export function saveTokensTo(db: SupabaseClient): SaveTokens {
  return async (rows) => {
    const { error } = await db.from(TABLE).insert(rows)
    return { error: error === null ? null : error.message }
  }
}

export async function tagLinks(save: SaveTokens, args: TagLinksArgs, makeToken: () => string = newToken): Promise<TagLinksOutcome> {
  const untouched = (warning: string | null): TagLinksOutcome => ({ body: args.body, tagged: 0, warning })
  try {
    const tracking = args.config.providers.linkTracking
    if (tracking === undefined) return untouched(null)
    const result = tagBody(args.body, tracking.hosts, makeToken)
    if (!result.ok) return untouched('link_tracking_mismatch')
    if (result.links.length === 0) return untouched(null)
    const rows: TokenRow[] = result.links.map((link) => {
      const { kind, tour } = classifyLink(link.url, args.config, args.facts)
      return { token: link.token, client_id: args.clientId, contact_id: args.contactId, request_id: args.requestId, url: link.url.slice(0, 600), kind, tour }
    })
    const { error } = await save(rows)
    if (error !== null) {
      console.error('[link-tracking] 编号没写进去，这封按原文发出:', error)
      return untouched('link_tracking_failed')
    }
    return { body: result.body, tagged: rows.length, warning: null }
  } catch (err) {
    console.error('[link-tracking] 打编号出错，这封按原文发出:', err instanceof Error ? err.message : err)
    return untouched('link_tracking_failed')
  }
}
