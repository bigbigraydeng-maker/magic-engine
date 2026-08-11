import { CMS_ACTION_TYPE } from '../../cms/vocabulary'

export interface GscPagePerformance {
  page?: string
  clicks: number
  impressions: number
  position: number
}

export type GscAttributionScope =
  | { kind: 'domain' }
  | { kind: 'page'; pageUrl: string }
  | { kind: 'skip' }

export function resolveGscAttributionScope(action: {
  action_type: string
  expected_metric: string | null
  payload: Record<string, unknown> | null
}): GscAttributionScope {
  if (!action.expected_metric) return { kind: 'skip' }
  if (action.action_type !== CMS_ACTION_TYPE.UPDATE_EXISTING) return { kind: 'domain' }
  if (action.payload?.status !== 'live' || typeof action.payload.page_url !== 'string') {
    return { kind: 'skip' }
  }
  return { kind: 'page', pageUrl: action.payload.page_url }
}

export function findGscPage(
  rows: GscPagePerformance[] | null | undefined,
  pageUrl: string,
): GscPagePerformance | null {
  const target = canonicalPageKey(pageUrl)
  if (!target) return null
  return rows?.find((row) => row.page && canonicalPageKey(row.page) === target) ?? null
}

function canonicalPageKey(value: string): string | null {
  try {
    const url = new URL(value)
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    const path = url.pathname === '/' ? '/' : url.pathname.replace(/\/+$/, '')
    return `${host}${path}`
  } catch {
    return null
  }
}
