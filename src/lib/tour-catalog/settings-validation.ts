/**
 * Validation for the tour-catalog page settings (brand header + "channels connected" switch).
 * Pure, no I/O. Design §6.10.1 item 6: colours are strict #RRGGBB, the logo must be an https URL
 * on the client's own registered website domain (or a subdomain of it).
 */

import { normalizeDomain } from './domain'
import type { CatalogSettings, SettingsErrorCode } from './catalog-contract'

const MAX_IMAGE_HOSTS = 10
/** Bare lower-case hostname: at least one dot, last label starts with a letter (so no IPv4), no scheme / path / port. */
const IMAGE_HOST_RE = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/

export function isValidImageHost(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 253 && IMAGE_HOST_RE.test(value)
}

/** The allow-list as sent: an array of at most 10 valid hostnames; duplicates are dropped. Null = invalid. */
function checkImageHosts(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_IMAGE_HOSTS) return null
  const hosts: string[] = []
  for (const item of raw) {
    if (!isValidImageHost(item)) return null
    if (!hosts.includes(item)) hosts.push(item)
  }
  return hosts
}

export type SettingsValidation =
  | { ok: true; value: CatalogSettings }
  | { ok: false; error: SettingsErrorCode }

const COLOR_RE = /^#[0-9a-fA-F]{6}$/
const MAX_LOGO_URL_LENGTH = 500
const MAX_EMAIL_LENGTH = 254
/** Deliberately simple: one @, no spaces or control characters, a dot in the domain part. */
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"\u0000-\u001f\u007f]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/

function fail(error: SettingsErrorCode): SettingsValidation {
  return { ok: false, error }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isColorOrNull(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && COLOR_RE.test(value))
}

/** True when `host` is the client's registered domain or a subdomain of it. */
export function hostBelongsToDomain(host: string, clientDomain: string | null): boolean {
  const domain = clientDomain === null ? '' : normalizeDomain(clientDomain)
  if (domain === '' || !domain.includes('.')) return false
  const lowered = host.toLowerCase()
  return lowered === domain || lowered.endsWith(`.${domain}`)
}

type LogoCheck = { ok: true; value: string | null } | { ok: false; error: SettingsErrorCode }

function checkLogoUrl(raw: unknown, clientDomain: string | null): LogoCheck {
  if (raw === null) return { ok: true, value: null }
  if (typeof raw !== 'string' || raw.length > MAX_LOGO_URL_LENGTH || /[\s\u0000-\u001f\u007f]/.test(raw)) {
    return { ok: false, error: 'invalid_logo_url' }
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, error: 'invalid_logo_url' }
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== '') {
    return { ok: false, error: 'invalid_logo_url' }
  }
  if (!hostBelongsToDomain(url.hostname, clientDomain)) {
    return { ok: false, error: 'logo_not_on_client_domain' }
  }
  const normalised = url.toString()
  if (normalised.length > MAX_LOGO_URL_LENGTH) return { ok: false, error: 'invalid_logo_url' }
  return { ok: true, value: normalised }
}

/** `clientDomain` is the client's registered website domain as stored (null when not registered). */
export function validateSettings(input: unknown, clientDomain: string | null): SettingsValidation {
  if (!isPlainObject(input)) return fail('invalid_request')
  if (typeof input.channelsConnected !== 'boolean') return fail('invalid_request')
  if (input.logoUrl === undefined || input.brandPrimary === undefined || input.brandSecondary === undefined) {
    return fail('invalid_request')
  }
  if (!isColorOrNull(input.brandPrimary) || !isColorOrNull(input.brandSecondary)) {
    return fail('invalid_color')
  }
  const imageHosts = checkImageHosts(input.imageHosts)
  if (imageHosts === null) return fail('invalid_request')
  const logo = checkLogoUrl(input.logoUrl, clientDomain)
  if (!logo.ok) return fail(logo.error)
  return {
    ok: true,
    value: {
      logoUrl: logo.value,
      brandPrimary: input.brandPrimary,
      brandSecondary: input.brandSecondary,
      channelsConnected: input.channelsConnected,
      imageHosts,
    },
  }
}

/** Trimmed, lower-cased email when it looks like one (3–254 chars); null otherwise. */
export function normaliseMemberEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const email = raw.trim().toLowerCase()
  if (email.length < 3 || email.length > MAX_EMAIL_LENGTH) return null
  return EMAIL_RE.test(email) ? email : null
}
