/**
 * Platform OAuth vocabulary — Phase 24.A.1
 *
 * Centralises:
 *  - Provider / status constants (match DB CHECK constraints exactly)
 *  - Token crypto helpers (re-exported from cms/crypto — same AES-256-GCM key)
 *  - TypeScript types for platform_oauth_connections rows
 *
 * Server-side only. Never import from client components.
 *
 * To add a new provider:
 *  1. Add to PLATFORM_PROVIDERS below
 *  2. Add a migration to extend the DB CHECK constraint
 */

export { encryptToken, decryptToken } from '../cms/crypto'

// ─── Providers ────────────────────────────────────────────────────────────────

export const PLATFORM_PROVIDERS = {
  GOOGLE_GBP: 'google_gbp',
  GOOGLE_GSC: 'google_gsc',
  META:       'meta',
  TIKTOK:     'tiktok',
  GOOGLE_ADS: 'google_ads',
  /**
   * 客户自己的邮箱（Microsoft Graph —— 同一套接口既服务 Outlook.com
   * 也服务 Microsoft 365 企业邮箱）。用来把客人发进来的邮件接回 CRM。
   */
  MICROSOFT_MAIL: 'microsoft_mail',
} as const

export type PlatformProvider = (typeof PLATFORM_PROVIDERS)[keyof typeof PLATFORM_PROVIDERS]

export function isPlatformProvider(value: string): value is PlatformProvider {
  return Object.values(PLATFORM_PROVIDERS).includes(value as PlatformProvider)
}

// ─── Connection status ────────────────────────────────────────────────────────

export const CONNECTION_STATUS = {
  ACTIVE:  'active',
  REVOKED: 'revoked',
  EXPIRED: 'expired',
  ERROR:   'error',
} as const

export type ConnectionStatus = (typeof CONNECTION_STATUS)[keyof typeof CONNECTION_STATUS]

// ─── DB row type (server-side only — contains encrypted token fields) ─────────

/** Raw row from platform_oauth_connections. Tokens are still encrypted. */
export interface PlatformOAuthConnectionRow {
  id:                string
  client_id:         string
  provider:          PlatformProvider
  access_token_enc:  string   // AES-256-GCM encrypted
  refresh_token_enc: string   // AES-256-GCM encrypted
  token_expiry:      string   // ISO 8601 timestamp
  account_id:        string
  location_name:     string | null
  display_name:      string
  scopes:            string[]
  status:            ConnectionStatus
  last_synced_at:    string | null
  error_message:     string | null
  created_at:        string
  updated_at:        string
}

// ─── Client-safe summary (no tokens) ─────────────────────────────────────────

/** Safe shape returned to the frontend — no encrypted fields. */
export interface PlatformConnectionSummary {
  id:             string
  provider:       PlatformProvider
  display_name:   string
  account_id:     string
  location_name:  string | null
  status:         ConnectionStatus
  scopes:         string[]
  last_synced_at: string | null
  error_message:  string | null
}

export function toConnectionSummary(
  row: PlatformOAuthConnectionRow,
): PlatformConnectionSummary {
  return {
    id:             row.id,
    provider:       row.provider,
    display_name:   row.display_name,
    account_id:     row.account_id,
    location_name:  row.location_name,
    status:         row.status,
    scopes:         row.scopes,
    last_synced_at: row.last_synced_at,
    error_message:  row.error_message,
  }
}

// ─── Token expiry helper ──────────────────────────────────────────────────────

const EXPIRY_BUFFER_MS = 5 * 60 * 1000 // 5-minute safety buffer

/**
 * Returns true if the access token is expired or will expire within 5 minutes.
 * Callers should refresh when this returns true.
 */
export function isTokenExpired(tokenExpiry: string): boolean {
  return Date.now() + EXPIRY_BUFFER_MS >= new Date(tokenExpiry).getTime()
}

// ─── Upsert input ─────────────────────────────────────────────────────────────

/** Input shape for creating or updating a connection. Tokens are plaintext here
 *  — encryption happens inside connection-store.ts, never in callers. */
export interface UpsertConnectionInput {
  clientId:      string
  provider:      PlatformProvider
  accessToken:   string   // plaintext — will be encrypted before storage
  refreshToken:  string   // plaintext — will be encrypted before storage
  tokenExpiry:   Date
  accountId:     string
  locationName?: string
  displayName:   string
  scopes:        string[]
}
