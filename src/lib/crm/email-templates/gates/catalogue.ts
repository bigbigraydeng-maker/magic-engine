/**
 * The catalogue gate: once the client's catalogue is past its last valid day, no mail may carry its link — the
 * one-click catalogue mail, a template, or a link a staff member pasted into a free-written mail alike.
 * Design: docs/specs/2026-11-09-crm-catalogue-send-b0-b3-design-v0.md §3.3.
 *
 * A link is "the catalogue" when host and path match the configured url: host compared case-insensitively, path
 * case-SENSITIVELY (HTTP paths are), scheme, port, user-info, query and fragment ignored ("?v=2" does not make it another
 * document). Known limit: the same file saved under another address is only held by the host allow-list.
 */

import { extractLinks } from './content-gates'
import { normalizeForLinks } from './normalize'
import { isCatalogueExpired } from '../render'

export interface CatalogueGateInput {
  /** Subject, body and footer as they will go out. */
  texts: readonly string[]
  catalogue: { url: string; validUntil: string } | undefined
  /** YYYY-MM-DD in the client's time zone. */
  today: string
  /** The template this mail came from uses {{catalogue_url}}. */
  templateUsesCatalogue: boolean
}

export type CatalogueGateResult =
  | { ok: true }
  | { ok: false; reason: 'catalogue_expired'; validUntil: string }
  | { ok: false; reason: 'catalogue_unavailable' }

/** host + path of a link, or null when it is not a link with an authority. */
export function catalogueKey(url: string): string | null {
  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)([^?#]*)/i.exec(url.replace(/\\/g, '/'))
  if (match === null) return null
  const authority = match[1]
  const hostPart = authority.includes('@') ? authority.slice(authority.lastIndexOf('@') + 1) : authority
  const host = hostPart.replace(/:\d+$/, '').toLowerCase().replace(/\.+$/, '')
  if (host === '') return null
  const path = match[2] === '' ? '/' : match[2]
  return `${host}${path}`
}

export function evaluateCatalogue(input: CatalogueGateInput): CatalogueGateResult {
  const { catalogue, today } = input
  const usable = catalogue !== undefined && !isCatalogueExpired(catalogue.validUntil, today)
  if (input.templateUsesCatalogue && !usable) return { ok: false, reason: 'catalogue_unavailable' }
  if (catalogue === undefined || usable) return { ok: true }
  const target = catalogueKey(catalogue.url)
  if (target === null) return { ok: true }
  const links = extractLinks(normalizeForLinks(input.texts.join('\n')))
  const carriesIt = links.some((link) => catalogueKey(link) === target)
  return carriesIt ? { ok: false, reason: 'catalogue_expired', validUntil: catalogue.validUntil } : { ok: true }
}
