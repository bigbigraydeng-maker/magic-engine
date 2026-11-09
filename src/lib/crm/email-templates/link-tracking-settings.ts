/**
 * `providers.link_tracking` in the versioned send settings: parse (strict), cross-check, write back.
 * Design: docs/specs/2026-11-10-crm-email-click-tracking-b2-design-v0.md §4.1.
 *
 * Shipped on its own, before the tracking itself (§6 step 0): once the parser knows this key, rolling the tracking code
 * back later can never leave a settings version this code cannot read.
 */

import type { EmailSettings, LinkTrackingSettings } from './types'
import type { AddError } from './catalogue-settings'

const MAX_HOSTS = 10
const HOSTNAME_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readHosts(value: unknown, path: string, add: AddError): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_HOSTS) {
    add(path, `must be an array of 1-${MAX_HOSTS} hostnames`)
    return null
  }
  const out: string[] = []
  let ok = true
  value.forEach((entry, i) => {
    const host = typeof entry === 'string' ? entry.trim().toLowerCase() : ''
    if (!HOSTNAME_RE.test(host)) {
      add(`${path}[${i}]`, 'must be a bare hostname')
      ok = false
      return
    }
    if (!out.includes(host)) out.push(host)
  })
  return ok ? out : null
}

export function parseLinkTrackingSettings(value: unknown, path: string, add: AddError): LinkTrackingSettings | null {
  if (!isPlainObject(value)) {
    add(path, 'must be an object')
    return null
  }
  let keysOk = true
  if (!('hosts' in value)) {
    add(`${path}.hosts`, 'is required')
    keysOk = false
  }
  for (const key of Object.keys(value)) {
    if (key === 'hosts') continue
    add(`${path}.${key}`, 'unknown key')
    keysOk = false
  }
  const hosts = readHosts(value.hosts, `${path}.hosts`, add)
  if (!keysOk || hosts === null) return null
  return { hosts }
}

/** Every tracked host must be a host links may point at at all. Call only on a version that otherwise parsed. */
export function checkLinkTrackingAgainst(settings: EmailSettings, add: AddError): void {
  const tracking = settings.providers.linkTracking
  if (tracking === undefined) return
  for (const host of tracking.hosts) {
    if (!settings.guardrails.allowedLinkHosts.includes(host)) {
      add('providers.link_tracking.hosts', `host ${host} must be in guardrails.allowed_link_hosts`)
    }
  }
}

export function serialiseLinkTracking(tracking: LinkTrackingSettings): Record<string, unknown> {
  return { hosts: [...tracking.hosts] }
}
