// Pure constant, kept free of server imports so client components (ads-health page) can use it.

/**
 * Goal metrics that autoFetchMetricValue can fill from ad_daily_insights via the
 * outcome ladder (leads_count falls back to the ads 'lead' step; messaging_started
 * is the ads 'messaging_started' step). Keep in sync with the switch in
 * src/lib/strategy/auto-fetch.ts. signups_count is NOT here: it reads real
 * bookings from me_sale_outcomes, which ads cannot move day to day.
 */
export const ADS_ATTRIBUTABLE_METRIC_KEYS: ReadonlySet<string> = new Set(['leads_count', 'messaging_started'])
