/**
 * GET  /api/admin/distributors/statements → latest monthly statements with per-distributor balances.
 * POST /api/admin/distributors/statements → compute one NZ month now. Body { month: 'YYYY-MM', dry_run?: boolean }.
 *      dry_run = compute and report only. Computing never pays anyone. Global admin only.
 * The same computation also runs on its own on the 1st of each month (Inngest distributor-monthly-statement).
 */
import { NextResponse } from 'next/server'
import { gate, invalid, readJson, storeFailure } from '@/lib/distributor/admin-http'
import { computeMonth, listStatements } from '@/lib/distributor/settlement-store'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const g = await gate(req, false)
  if (!g.ok) return g.response
  try {
    return NextResponse.json({ statements: await listStatements() })
  } catch (err) {
    return storeFailure(err)
  }
}

export async function POST(req: Request) {
  const g = await gate(req, true)
  if (!g.ok) return g.response
  const body = await readJson(req)
  const b = body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : {}
  const month = typeof b.month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(b.month) ? b.month : null
  if (!month) return invalid(['month must be YYYY-MM'])
  try {
    return NextResponse.json({ result: await computeMonth(month, b.dry_run === true) }, { status: b.dry_run === true ? 200 : 201 })
  } catch (err) {
    return storeFailure(err)
  }
}
