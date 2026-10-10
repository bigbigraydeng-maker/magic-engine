/**
 * Access, settings, members and publish-request shapes shared by the tour-catalog API routes
 * and the admin page. Type-only module: safe to import from client components.
 * Design: docs/specs/2026-10-09-cts-tour-catalog-in-me-design-v0.3.md §6.10 / §6.10.1
 */

/** Who is using the catalog. `me_admin` = Magic Engine global admin; `client_editor` = a client's own staff on the access list. */
export type CatalogRole = 'me_admin' | 'client_editor'

export type CatalogCapability =
  | 'view'
  | 'edit'
  | 'assistant'
  | 'request_publish'
  | 'import'
  | 'aliases'
  | 'seed'
  | 'publish'
  | 'manage_members'
  | 'manage_settings'

export type CatalogPermissions = Record<CatalogCapability, boolean>

export interface CatalogViewer {
  /** Lower-cased sign-in email taken from the server session. */
  email: string
  role: CatalogRole
}

/** Brand + rollout switches for one client's catalog page. Only a global admin can change these. */
export interface CatalogSettings {
  /** https URL on the client's own registered website domain, or null. */
  logoUrl: string | null
  /** #RRGGBB or null. Header, primary buttons, selected state. */
  brandPrimary: string | null
  /** #RRGGBB or null. Thin lines and small labels only. */
  brandSecondary: string | null
  /** False until the website (or any channel) actually reads the published catalog. Drives the honesty copy. */
  channelsConnected: boolean
}

export interface PublishRequestView {
  id: string
  /** Shown to client editors as their own email, or as "Magic Engine 团队" when masked. */
  requestedBy: string
  note: string
  createdAt: string
  /** Draft revision when the request was made; the page compares it with the current one. */
  draftVersion: number
}

/** Extra fields on GET …/tour-catalog (in addition to tours / departures / domain; aliases and batches only when permitted). */
export interface CatalogAccessEnvelope {
  clientName: string
  viewer: CatalogViewer
  permissions: CatalogPermissions
  settings: CatalogSettings
  /** The newest request that has not been published yet, if any. */
  pendingPublishRequest: PublishRequestView | null
}

/** GET …/tour-catalog/members (manage_members) */
export interface CatalogMemberView {
  email: string
  grantedBy: string
  createdAt: string
  /** True when this email already has a sign-in membership for this client; false = they cannot log in yet. */
  hasLogin: boolean
}
export interface MembersResponse {
  members: CatalogMemberView[]
}
/** POST …/tour-catalog/members { email } → MembersResponse; DELETE …/tour-catalog/members?email= → MembersResponse */

/** PUT …/tour-catalog/settings (manage_settings) → { settings: CatalogSettings } */
export type SettingsRequest = CatalogSettings
export type SettingsErrorCode =
  | 'invalid_request'
  | 'invalid_color'
  | 'invalid_logo_url'
  | 'logo_not_on_client_domain'
  | 'save_failed'

/** POST …/tour-catalog/publish-requests { note } (request_publish) → { request: PublishRequestView } */
export interface PublishRequestBody {
  note: string
}

export type ChangeSource = 'manual' | 'assistant' | 'import' | 'rollback' | 'system'

/** GET …/tour-catalog/changes with no tourId: newest first, at most 100, an import collapsed into one line. */
export interface CatalogChangeView {
  id: string
  createdAt: string
  /** Email, or "Magic Engine 团队" when masked for a client editor, or "系统". */
  actorLabel: string
  source: ChangeSource
  tourId: string | null
  tourName: string
  /** Plain-Chinese one-liner, e.g. "展示价：NZD $7,999 → NZD $8,111" or "出团表导入：新增 12 个班期、更新 3 个". */
  summary: string
}
export interface CatalogChangesResponse {
  changes: CatalogChangeView[]
}

/** Added to the publish preview: who contributed how many changes since the last publish. */
export interface PublishContributor {
  actorLabel: string
  changes: number
}

/** POST …/tour-catalog/assistant may now answer 429 { error: 'assistant_limit' }. */
export type AssistantLimitError = 'assistant_limit'
