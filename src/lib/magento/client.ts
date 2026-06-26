/**
 * Magento 2 REST API client — thin wrapper for ecommerce store data.
 *
 * Auth: Integration access token (Bearer), configured per-client in
 * client_connectors.config = { store_url, access_token }.
 *
 * Returns null / [] gracefully on any API failure so callers never crash.
 */

const MAGENTO_API_VERSION = 'V1'

export interface MagentoOrdersSummary {
  total_orders: number
  total_revenue: number
  average_order_value: number
  period_start: string
  period_end: string
}

export interface MagentoTopProduct {
  product_id: string
  product_name: string
  qty_ordered: number
  revenue: number
}

function apiBase(storeUrl: string): string {
  return `${storeUrl.replace(/\/$/, '')}/rest/${MAGENTO_API_VERSION}`
}

function authHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }
}

/**
 * Fetch order-level summary (total orders, revenue, AOV) for a date range.
 * Excludes cancelled orders. Uses Magento search criteria filter syntax.
 */
export async function getMagentoOrdersSummary(
  storeUrl: string,
  accessToken: string,
  since: string,
  until: string,
): Promise<MagentoOrdersSummary | null> {
  const params = new URLSearchParams({
    'searchCriteria[filter_groups][0][filters][0][field]': 'created_at',
    'searchCriteria[filter_groups][0][filters][0][value]': `${since} 00:00:00`,
    'searchCriteria[filter_groups][0][filters][0][condition_type]': 'gteq',
    'searchCriteria[filter_groups][1][filters][0][field]': 'created_at',
    'searchCriteria[filter_groups][1][filters][0][value]': `${until} 23:59:59`,
    'searchCriteria[filter_groups][1][filters][0][condition_type]': 'lteq',
    'searchCriteria[filter_groups][2][filters][0][field]': 'status',
    'searchCriteria[filter_groups][2][filters][0][value]': 'cancelled',
    'searchCriteria[filter_groups][2][filters][0][condition_type]': 'neq',
    'searchCriteria[pageSize]': '1000',
    'fields': 'items[base_grand_total],total_count',
  })

  const url = `${apiBase(storeUrl)}/orders?${params.toString()}`

  let res: Response
  try {
    res = await fetch(url, { headers: authHeaders(accessToken) })
  } catch (err) {
    console.error('[magento/client] orders fetch error:', err)
    return null
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[magento/client] orders HTTP ${res.status}:`, body.slice(0, 300))
    return null
  }

  const json = await res.json() as {
    items?: Array<{ base_grand_total?: number }>
    total_count?: number
  }

  const items = json.items ?? []
  const totalOrders = json.total_count ?? items.length
  const totalRevenue = items.reduce((sum, item) => sum + (Number(item.base_grand_total) || 0), 0)
  const aov = totalOrders > 0 ? totalRevenue / totalOrders : 0

  return {
    total_orders: totalOrders,
    total_revenue: Math.round(totalRevenue * 100) / 100,
    average_order_value: Math.round(aov * 100) / 100,
    period_start: since,
    period_end: until,
  }
}

/**
 * Fetch top-selling products via the Magento bestsellers report.
 * Falls back to empty array if the store's reporting module is disabled.
 */
export async function getMagentoTopProducts(
  storeUrl: string,
  accessToken: string,
  since: string,
  until: string,
  limit = 10,
): Promise<MagentoTopProduct[]> {
  const params = new URLSearchParams({
    'searchCriteria[pageSize]': String(limit),
    'searchCriteria[sortOrders][0][field]': 'qty_ordered',
    'searchCriteria[sortOrders][0][direction]': 'DESC',
    'searchCriteria[filter_groups][0][filters][0][field]': 'period',
    'searchCriteria[filter_groups][0][filters][0][value]': since,
    'searchCriteria[filter_groups][0][filters][0][condition_type]': 'gteq',
    'searchCriteria[filter_groups][1][filters][0][field]': 'period',
    'searchCriteria[filter_groups][1][filters][0][value]': until,
    'searchCriteria[filter_groups][1][filters][0][condition_type]': 'lteq',
  })

  const url = `${apiBase(storeUrl)}/reports/bestsellers/search?${params.toString()}`

  let res: Response
  try {
    res = await fetch(url, { headers: authHeaders(accessToken) })
  } catch (err) {
    console.error('[magento/client] bestsellers fetch error:', err)
    return []
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[magento/client] bestsellers HTTP ${res.status}:`, body.slice(0, 300))
    return []
  }

  const json = await res.json() as {
    items?: Array<{
      product_id?: number | string
      product_name?: string
      qty_ordered?: number
      product_price?: number
    }>
  }

  return (json.items ?? []).map(item => ({
    product_id: String(item.product_id ?? ''),
    product_name: item.product_name ?? String(item.product_id ?? ''),
    qty_ordered: Number(item.qty_ordered) || 0,
    revenue: Math.round(
      (Number(item.qty_ordered) || 0) * (Number(item.product_price) || 0) * 100,
    ) / 100,
  }))
}

/**
 * Verify that the store_url + access_token are valid by calling the
 * lightweight /store/storeConfigs endpoint. Returns the store name on
 * success, null on failure.
 */
export async function pingMagentoStore(
  storeUrl: string,
  accessToken: string,
): Promise<string | null> {
  const url = `${apiBase(storeUrl)}/store/storeConfigs`

  let res: Response
  try {
    res = await fetch(url, { headers: authHeaders(accessToken) })
  } catch (err) {
    console.error('[magento/client] ping fetch error:', err)
    return null
  }

  if (!res.ok) return null

  const json = await res.json() as Array<{ base_url?: string; store_name?: string }> | null
  return json?.[0]?.store_name ?? storeUrl
}
