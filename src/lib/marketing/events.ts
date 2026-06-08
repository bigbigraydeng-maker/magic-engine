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
  }
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
}
