/**
 * ABR / NZBN connector — type definitions.
 *
 * Reference: ROADMAP.md P8.12.S1.1
 *
 * Two official, free government registries:
 *  - AU: Australian Business Register (ABR) ABN Lookup JSON API
 *  - NZ: New Zealand Business Number (NZBN) API
 *
 * Purpose: replace LLM-fabricated registration data (ABN, entity type,
 * GST status, registration age) with verified structured data.
 */

export type RegistrationCountry = 'AU' | 'NZ'
export type RegistrationIdType = 'ABN' | 'NZBN'

/** Normalised registration status across both registries. */
export type RegistrationStatus = 'active' | 'cancelled' | 'unknown'

/**
 * Unified, registry-agnostic business registration record.
 * This is the shape consumed by the Zhangqian agent.
 */
export interface BusinessRegistration {
  country: RegistrationCountry
  identifier: string                 // ABN (11 digits) or NZBN (13 digits)
  identifier_type: RegistrationIdType
  entity_name: string | null         // legal entity name
  entity_type: string | null         // human-readable, e.g. "Australian Private Company"
  status: RegistrationStatus
  registered_since: string | null    // ISO date string (YYYY-MM-DD) if known
  gst_registered: boolean | null      // null = registry does not expose GST status
}

/** A single fuzzy-name-search match (before fetching full detail). */
export interface RegistrationNameMatch {
  country: RegistrationCountry
  identifier: string
  identifier_type: RegistrationIdType
  name: string
  status: RegistrationStatus
  state: string | null               // AU state code, or null for NZ
  score: number | null               // 0–100 match confidence (ABR only)
}

// ─── Raw upstream response shapes (partial — only fields we read) ─────────────

/** Raw ABR AbnDetails.aspx JSON (delivered as JSONP). */
export interface AbnDetailsRaw {
  Abn?: string
  AbnStatus?: string                 // "Active" | "Cancelled" | ""
  AbnStatusEffectiveFrom?: string    // "YYYY-MM-DD"
  EntityName?: string
  EntityTypeName?: string
  EntityTypeCode?: string
  Gst?: string | null                // GST registration date, or null/"0001-01-01"
  AddressState?: string
  AddressPostcode?: string
  BusinessName?: string[]
  Message?: string                   // non-empty on lookup error
}

/** Raw ABR MatchingNames.aspx JSON (delivered as JSONP). */
export interface AbrNameSearchRaw {
  Names?: Array<{
    Abn?: string
    AbnStatus?: string
    IsCurrent?: boolean
    Name?: string
    NameType?: string
    Postcode?: string
    Score?: number
    State?: string
  }>
  Message?: string
}

/** Raw NZBN entity JSON (v5 API — partial). */
export interface NzbnEntityRaw {
  nzbn?: string
  entityName?: string
  entityTypeCode?: string
  entityTypeDescription?: string
  entityStatusCode?: string
  entityStatusDescription?: string   // "Registered" | "Removed" | ...
  registrationDate?: string          // "YYYY-MM-DD"
}

/** Raw NZBN search JSON (v5 API — partial). */
export interface NzbnSearchRaw {
  items?: NzbnEntityRaw[]
  totalItems?: number
}
