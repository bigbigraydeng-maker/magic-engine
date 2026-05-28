/**
 * CMS Connector — shared constants and type guards.
 *
 * Keep this file free of side effects and external imports so it can be
 * imported from both server-side orchestration code and the browser UI.
 */

// ─── Provider ────────────────────────────────────────────────────────────────

export const CMS_PROVIDER = {
  GITHUB:    'github',
  WORDPRESS: 'wordpress',
  SHOPIFY:   'shopify',
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

/**
 * WordPress-specific connection display data.
 * Returned by the wordpress-aware variant of getConnectionStatus (added in P14.A.5).
 */
export interface WordpressConnectionStatus {
  connected:    boolean
  provider:     typeof CMS_PROVIDER.WORDPRESS
  /** Site origin, e.g. https://example.com (no trailing slash). */
  siteUrl:      string
  /** WP username paired with the Application Password. */
  username:     string
  /** Last four characters of the stored Application Password, for display only. */
  tokenHint:    string | null
  status:       CmsStatus
  lastError:    string | null
  lastTestedAt: string | null
  /**
   * P14.B.1: true once ME has confirmed that Yoast SEO meta keys are
   * REST-writable on this WP site (probe via yoast-probe endpoint).
   */
  yoastPluginInstalled: boolean
  /**
   * P14.B.6: WP category ID to assign by default when publishing posts.
   * null = uncategorized (WP default).
   */
  wpDefaultCategoryId: number | null
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

/**
 * Shopify-specific connection display data.
 * Returned by the Shopify-aware variant of getConnectionStatus (added in P14.A.4).
 */
export interface ShopifyConnectionStatus {
  connected:    boolean
  provider:     typeof CMS_PROVIDER.SHOPIFY
  /** Normalised shop URL, e.g. https://my-store.myshopify.com */
  shopUrl:      string
  /** Last four characters of the stored access token, for display only. */
  tokenHint:    string | null
  status:       CmsStatus
  lastError:    string | null
  lastTestedAt: string | null
}

export function isCmsStatus(value: unknown): value is CmsStatus {
  return (
    typeof value === 'string' &&
    Object.values(CMS_STATUS).includes(value as CmsStatus)
  )
}
