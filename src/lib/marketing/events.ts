export const MARKETING_EVENT = {
  ADS_LANDING_VIEW: 'ads_landing_view',
  ADS_PRIMARY_CTA_CLICK: 'ads_primary_cta_click',
  DISCOVER_START: 'discover_start',
  DISCOVER_SUBMIT: 'discover_submit',
  CONTACT_SUBMIT: 'contact_submit',
  QUALIFIED_LEAD: 'qualified_lead',
} as const

export type MarketingEventName = (typeof MARKETING_EVENT)[keyof typeof MARKETING_EVENT]

declare global {
  interface Window {
    dataLayer?: Array<Record<string, unknown>>
    gtag?: (...args: unknown[]) => void
    fbq?: (...args: unknown[]) => void
  }
}

// Map internal marketing events to Meta Pixel standard events. Anything not in
// this map still fires to GA/dataLayer but doesn't touch Meta — keeps Meta
// signal focused on the moments that actually optimize campaigns.
const META_PIXEL_EVENT: Partial<Record<MarketingEventName, string>> = {
  contact_submit: 'Lead',
  discover_submit: 'CompleteRegistration',
  qualified_lead: 'Lead',
  ads_primary_cta_click: 'InitiateCheckout',
}

export function trackMarketingEvent(
  name: MarketingEventName,
  params: Record<string, unknown> = {},
): void {
  if (typeof window === 'undefined') return

  const payload = { ...params }

  if (typeof window.gtag === 'function') {
    window.gtag('event', name, payload)
  }

  if (Array.isArray(window.dataLayer)) {
    window.dataLayer.push({ event: name, ...payload })
  }

  const metaEvent = META_PIXEL_EVENT[name]
  if (metaEvent && typeof window.fbq === 'function') {
    window.fbq('track', metaEvent, payload)
  }
}
