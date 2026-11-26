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

const ENCODED_BYTE_RE = /%([0-9a-fA-F]{2})/g
const UNRESERVED_RE = /^[A-Za-z0-9\-._~]$/

/** "%2D" → "-": an encoded letter, digit or -._~ names the same file to a web server. Other encodings are kept. */
function decodeUnreserved(path: string): string {
  return path.replace(ENCODED_BYTE_RE, (match, hex: string) => {
    const char = String.fromCharCode(Number.parseInt(hex, 16))
    return UNRESERVED_RE.test(char) ? char : match.toUpperCase()
  })
}

/**
 * host + path of a link, written the one way every spelling of the same address comes out as; null when it is not a link
 * with a host. Spellings that open the same file are the same key: "www." or not, "./" and "x/../", "%2e" and other encoded
 * letters, doubled or trailing slashes, port, user-info. Path letters keep their case (HTTP paths are case-sensitive).
 */
export function catalogueKey(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url.replace(/\\/g, '/'))
  } catch {
    return null
  }
  const host = parsed.hostname.toLowerCase().replace(/\.+$/, '').replace(/^www\./, '')
  if (host === '') return null
  // Decoding can turn "%2e" into a dot segment, so resolve the path again afterwards (slashes collapsed first, or "//x"
  // would be read as a host).
  const decoded = decodeUnreserved(parsed.pathname).replace(/\/{2,}/g, '/')
  const path = new URL(decoded, 'https://resolve.invalid').pathname.replace(/(.)\/+$/, '$1')
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
