import { SEO_METRIC_KEY } from '../flywheel/vocabulary'

export interface GithubPrLifecycle {
  state: 'open' | 'closed'
  merged: boolean
  mergedAt: string | null
}

export type PageUpgradePrTransition =
  | { status: 'live'; occurredAt: string; expectedMetric: string; expectedDelta: number }
  | { status: 'rejected'; occurredAt: string; expectedMetric: null; expectedDelta: null }
  | null

export function resolvePageUpgradePrTransition(
  pr: GithubPrLifecycle,
  checkedAt: string,
): PageUpgradePrTransition {
  if (pr.state === 'open') return null

  if (pr.merged) {
    return {
      status: 'live',
      occurredAt: pr.mergedAt ?? checkedAt,
      expectedMetric: SEO_METRIC_KEY.GSC_PAGE_CLICKS,
      expectedDelta: 1,
    }
  }

  return {
    status: 'rejected',
    occurredAt: checkedAt,
    expectedMetric: null,
    expectedDelta: null,
  }
}

export function readPrNumber(payload: Record<string, unknown> | null): number | null {
  const value = payload?.pr_number
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}
