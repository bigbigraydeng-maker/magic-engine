import type { LandingClassConfig } from './organic-landing-leads'

/**
 * Per-client configuration: which landing-page URL prefixes count as a product page vs a guide page.
 * Client configuration only — shared code (organic-landing-leads.ts) never names a client.
 * A client without an entry is reported with raw paths and a "missing" note, never guessed.
 */
const CTS_CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'

const BY_CLIENT: Record<string, LandingClassConfig> = {
  [CTS_CLIENT_ID]: {
    productPrefixes: ['/tours/', '/campaigns/'],
    guideContains: ['-travel-guide', '/blog', '/guide', '/faq', 'visa-guide', 'food-guide', 'best-time-to-visit'],
    enquiryEvent: 'enquiry_thank_you',
    thankYouPathContains: 'thank',
  },
}

export function getLandingClassConfig(clientId: string): LandingClassConfig | null {
  return BY_CLIENT[clientId] ?? null
}
