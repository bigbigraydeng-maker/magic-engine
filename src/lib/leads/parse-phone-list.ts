/**
 * Parse a free-text or array field into a deduped list of E.164 phone numbers
 * (`+<digits>`) — same shape as parseEmailList / parseDomainList, for the
 * ownPhoneNumbers entry of clients.leads_config.
 *
 * Reuses normalisePhone from crm/identity.ts so numbers are normalised exactly
 * like every other phone in the CRM. Anything it cannot recognise is returned in
 * `rejected` — never silently stored (a bad number would never match anyone).
 *
 * Pure function, no Supabase.
 */

import { normalisePhone } from '@/lib/crm/identity'

export type PhoneCountry = 'NZ' | 'AU'

export interface ParsedPhoneList {
  phones: string[]
  rejected: string[]
}

/** clients.default_phone_country is free text; anything but AU falls back to NZ. */
export function toPhoneCountry(raw: string | null | undefined): PhoneCountry {
  return String(raw ?? '').trim().toUpperCase() === 'AU' ? 'AU' : 'NZ'
}

export function parsePhoneList(input: unknown, defaultCountry: PhoneCountry = 'NZ'): ParsedPhoneList {
  // Separators: newline, comma, semicolon (incl. CJK). Spaces/dashes stay inside a number.
  const pieces = Array.isArray(input)
    ? input.filter((x): x is string => typeof x === 'string')
    : typeof input === 'string'
      ? input.split(/[\n\r,;、，；]+/)
      : []

  const phones: string[] = []
  const rejected: string[] = []
  for (const piece of pieces) {
    const t = piece.trim()
    if (!t) continue
    // Letters mean it is a name or a note, not a number — normalisePhone would strip them.
    const e164 = /[a-z]/i.test(t) ? null : normalisePhone(t, defaultCountry)
    if (e164) {
      if (!phones.includes(e164)) phones.push(e164)
    } else {
      rejected.push(t)
    }
  }
  return { phones, rejected }
}
