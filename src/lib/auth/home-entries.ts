/**
 * Which client-home entries this person can actually open.
 *
 * A portal member (access_type both / dashboard / client / fde) stays role
 * client-viewer unless an internal signal promotes them. Internal role admin
 * comes from ADMIN_EMAILS, ADMIN_EMAIL_DOMAIN, DEMO_ADMINS, or scoped_admin.
 * Story, week overview, and reels are narrower than "any admin": they call
 * isGlobalAdminEmail, which is the exact ADMIN_EMAILS list only.
 */

export const HOME_ENTRIES = [
  'story',
  'week-overview',
  'reels',
  'business-calculator',
  'geo-composer',
  'ai-visibility',
  'ad-approval',
  'factory',
  'memory',
  'factory-clips',
  'work-logs',
] as const

export type HomeEntry = (typeof HOME_ENTRIES)[number]

export interface ViewerFacts {
  role: string
  allowedClientId: string | null
  /** Admin with no client cap, and the email is on the exact ADMIN_EMAILS list. */
  exactGlobalAdmin: boolean
}

export function viewerFacts(
  role: string,
  allowedClientId: string | null,
  exactGlobalAdmin: boolean,
): ViewerFacts {
  const unrestricted = role === 'admin' && !allowedClientId
  return {
    role,
    allowedClientId,
    exactGlobalAdmin: unrestricted && exactGlobalAdmin,
  }
}

const EXACT_GLOBAL = new Set<HomeEntry>(['story', 'week-overview', 'reels'])
const UNRESTRICTED_ADMIN = new Set<HomeEntry>([
  'business-calculator',
  'geo-composer',
  'ai-visibility',
  'ad-approval',
  'factory',
])
const ANY_ADMIN = new Set<HomeEntry>(['memory', 'factory-clips', 'work-logs'])

export function homeEntryVisible(facts: ViewerFacts, entry: HomeEntry): boolean {
  if (EXACT_GLOBAL.has(entry)) return facts.exactGlobalAdmin
  const unrestricted = facts.role === 'admin' && !facts.allowedClientId
  if (UNRESTRICTED_ADMIN.has(entry)) return unrestricted
  if (ANY_ADMIN.has(entry)) return facts.role === 'admin'
  return true
}
