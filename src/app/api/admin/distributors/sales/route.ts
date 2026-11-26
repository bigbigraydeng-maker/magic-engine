/**
 * GET  /api/admin/distributors/sales → latest 200 sales and refunds.
 * POST /api/admin/distributors/sales → record one. Body `type: 'sale'` (kind plan|addon, plan_code, months,
 *      extra_avatars, is_self_purchase, order_ref, paid_at, amount_cents? ≤ list price) or `type: 'refund'`
 *      (refund_of_sale_id, amount_cents > 0, order_ref, paid_at). Recording is not a payout.
 * Global admin only.
 */
import { NextResponse } from 'next/server'
import { AI_STEWARD_RULES_V1 } from '@/lib/distributor/config'
import { parseRefund, parseSale } from '@/lib/distributor/admin-input'
import { gate, invalid, readJson, storeFailure } from '@/lib/distributor/admin-http'
import { listSales, recordRefund, recordSale } from '@/lib/distributor/store'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const g = await gate(req, false)
  if (!g.ok) return g.response
  try {
    return NextResponse.json({ sales: await listSales(), catalog: AI_STEWARD_RULES_V1.catalog })
  } catch (err) {
    return storeFailure(err)
  }
}

export async function POST(req: Request) {
  const g = await gate(req, true)
  if (!g.ok) return g.response
  const body = await readJson(req)
  const type = body !== null && typeof body === 'object' ? (body as { type?: unknown }).type : undefined
  try {
    if (type === 'refund') {
      const parsed = parseRefund(body, Date.now())
      if (!parsed.ok) return invalid(parsed.errors)
      return NextResponse.json({ sale: await recordRefund(parsed.value, g.email) }, { status: 201 })
    }
    if (type === 'sale') {
      const parsed = parseSale(body, AI_STEWARD_RULES_V1, Date.now())
      if (!parsed.ok) return invalid(parsed.errors)
      return NextResponse.json({ sale: await recordSale(parsed.value, g.email) }, { status: 201 })
    }
    return invalid(['type must be sale or refund'])
  } catch (err) {
    return storeFailure(err)
  }
}
