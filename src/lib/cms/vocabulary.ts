/**
 * CMS Connector — shared constants and type guards.
 *
 * Keep this file free of side effects and external imports so it can be
 * imported from both server-side orchestration code and the browser UI.
 */

// ─── Provider ────────────────────────────────────────────────────────────────

export const CMS_PROVIDER = {
  GITHUB: 'github',
} as const

export type CmsProvider = (typeof CMS_PROVIDER)[keyof typeof CMS_PROVIDER]

// ─── Connection status ────────────────────────────────────────────────────────

export const CMS_STATUS = {
  CONNECTED:    'connected',
  DISCONNECTED: 'disconnected',
  ERROR:        'error',
} as const

export type CmsStatus = (typeof CMS_STATUS)[keyof typeof CMS_STATUS]

// ─── Fix action types ─────────────────────────────────────────────────────────

export const CMS_ACTION_TYPE = {
  META_UPDATE:    'cms_meta_update',     // patch metaTitle / metaDescription
  CONTENT_INSERT: 'cms_content_insert',  // create / overwrite a content file
} as const

export type CmsActionType = (typeof CMS_ACTION_TYPE)[keyof typeof CMS_ACTION_TYPE]

// ─── PR branch prefix ─────────────────────────────────────────────────────────

/** All Magic Engine PRs use this prefix so they are easy to filter in GitHub. */
export const ME_BRANCH_PREFIX = 'feat/me-seo-'

// ─── GitHub API base URL ──────────────────────────────────────────────────────

export const GITHUB_API_BASE = 'https://api.github.com'

// ─── Type shapes (shared between server + UI) ─────────────────────────────────

export interface CmsConnectionStatus {
  connected: boolean
  provider:  CmsProvider
  repoOwner: string
  repoName:  string
  branch:    string
  /** Last four characters of the stored token, for display only. */
  tokenHint: string | null
  status:    CmsStatus
  lastError: string | null
  lastTestedAt: string | null
}

export interface CmsSeoFixPayload {
  /** Relative path in the repo to the file containing the metadata. */
  filePath: string
  /** The slug used to locate the correct object in the file. */
  slug: string
  /** Field to update, e.g. "metaTitle" or "metaDescription". */
  field: string
  /** Current value in the file (used to verify nothing changed under us). */
  oldValue: string
  /** New value to write. */
  newValue: string
  /** Human-readable description of the change for the PR body. */
  reason: string
}

// ─── Type guard ───────────────────────────────────────────────────────────────

export function isCmsStatus(value: unknown): value is CmsStatus {
  return (
    typeof value === 'string' &&
    Object.values(CMS_STATUS).includes(value as CmsStatus)
  )
}
