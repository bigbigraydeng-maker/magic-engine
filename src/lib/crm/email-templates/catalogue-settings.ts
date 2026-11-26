/**
 * `providers.catalogue` in the versioned send settings: parse (strict), cross-check against the rest of the version, and
 * write back. Design: docs/specs/2026-11-09-crm-catalogue-send-b0-b3-design-v0.md §3.1.
 *
 * Cross-checks run on the whole version, so a catalogue that is saved is one that can actually be sent:
 *  - its host is in guardrails.allowed_link_hosts (else the link check would refuse every catalogue mail);
 *  - its template is NOT cap-exempt (a catalogue mail always counts towards the weekly cap; changing that is a code change).
 */

import type { CatalogueProviderSettings, EmailSettings } from './types'
import { isAutomatedTemplateKey } from './automated-template-key'
import { TEMPLATE_KEY_RE } from './template-store'

export type AddError = (path: string, message: string) => void

const KEYS = ['template_key', 'version_label', 'url', 'valid_until'] as const
const MAX_URL_LENGTH = 500
const VERSION_LABEL_RE = /^[A-Za-z0-9][A-Za-z0-9. -]{0,19}$/
const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A real calendar day written as YYYY-MM-DD (2026-02-30 is not one). */
export function isRealYmd(value: string): boolean {
  const m = YMD_RE.exec(value)
  if (m === null) return false
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return date.toISOString().slice(0, 10) === value
}

/** The reason a catalogue URL is refused, or null when it is fine. */
function urlProblem(value: string): string | null {
  if (value.length > MAX_URL_LENGTH) return `must be at most ${MAX_URL_LENGTH} characters`
  if (/\s/.test(value)) return 'must not contain whitespace'
  if (!value.startsWith('https://')) return 'must start with https://'
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return 'must be a valid URL'
  }
  const rawHost = value.slice('https://'.length).split(/[/?#]/, 1)[0]
  if (rawHost.includes('@') || parsed.username !== '' || parsed.password !== '') return 'must not contain credentials'
  if (rawHost.includes('%') || parsed.port !== '') return 'host must be a bare hostname (no encoding or port)'
  // Stored the way a browser writes it, so the expiry gate compares like with like.
  if (parsed.pathname.includes('%') || parsed.href !== value) return `must be written plainly, as ${parsed.href}`
  return null
}

function readUrl(value: unknown, path: string, add: AddError): string | null {
  const problem = typeof value === 'string' ? urlProblem(value) : 'must be a string'
  if (problem !== null) {
    add(path, problem)
    return null
  }
  return value as string
}

function readField(value: unknown, path: string, add: AddError, ok: (s: string) => boolean, rule: string): string | null {
  if (typeof value !== 'string' || !ok(value)) {
    add(path, rule)
    return null
  }
  return value
}

export function parseCatalogueSettings(value: unknown, path: string, add: AddError): CatalogueProviderSettings | null {
  if (!isPlainObject(value)) {
    add(path, 'must be an object')
    return null
  }
  let keysOk = true
  for (const key of KEYS) {
    if (key in value) continue
    add(`${path}.${key}`, 'is required')
    keysOk = false
  }
  for (const key of Object.keys(value)) {
    if ((KEYS as readonly string[]).includes(key)) continue
    add(`${path}.${key}`, 'unknown key')
    keysOk = false
  }
  const templateKey = readField(
    value.template_key,
    `${path}.template_key`,
    add,
    (s) => TEMPLATE_KEY_RE.test(s) && !isAutomatedTemplateKey(s),
    'must be a template key (lower-case letters, digits and hyphens), not an automated letter (auto-…)',
  )
  const versionLabel = readField(value.version_label, `${path}.version_label`, add, (s) => VERSION_LABEL_RE.test(s), 'must be 1-20 letters, digits, dots, hyphens or spaces')
  const url = readUrl(value.url, `${path}.url`, add)
  const validUntil = readField(value.valid_until, `${path}.valid_until`, add, isRealYmd, 'must be a real date written YYYY-MM-DD')
  if (!keysOk || templateKey === null || versionLabel === null || url === null || validUntil === null) return null
  return { templateKey, versionLabel, url, validUntil }
}

/** Checks that need the rest of the version. Call only on a version that otherwise parsed. */
export function checkCatalogueAgainst(settings: EmailSettings, add: AddError): void {
  const catalogue = settings.providers.catalogue
  if (catalogue === undefined) return
  const host = new URL(catalogue.url).hostname.toLowerCase()
  if (!settings.guardrails.allowedLinkHosts.includes(host)) {
    add('providers.catalogue.url', `host ${host} must be in guardrails.allowed_link_hosts`)
  }
  if (settings.capExemptTemplateKeys.includes(catalogue.templateKey)) {
    add('cap_exempt_template_keys', `must not contain the catalogue template ${catalogue.templateKey}: a catalogue mail always counts`)
  }
}

export function serialiseCatalogue(catalogue: CatalogueProviderSettings): Record<string, string> {
  return {
    template_key: catalogue.templateKey,
    version_label: catalogue.versionLabel,
    url: catalogue.url,
    valid_until: catalogue.validUntil,
  }
}
