/**
 * GET  /api/admin/distributors → all distributors with current level, upline name and net sales.
 * POST /api/admin/distributors → add a distributor (status pending). Body: display_name, contact_email?,
 *      contact_phone?, parent_id? (must be an approved distributor).
 * Global admin only. Spec: docs/specs/2026-11-10-distributor-commission-system-v0.1.md
 */
import { NextResponse } from 'next/server'
import { parseCreateDistributor } from '@/lib/distributor/admin-input'
import { gate, invalid, readJson, storeFailure } from '@/lib/distributor/admin-http'
import { createDistributor, listDistributors } from '@/lib/distributor/store'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const g = await gate(req, false)
  if (!g.ok) return g.response
  try {
    return NextResponse.json({ distributors: await listDistributors() })
  } catch (err) {
    return storeFailure(err)
  }
}

export async function POST(req: Request) {
  const g = await gate(req, true)
  if (!g.ok) return g.response
  const parsed = parseCreateDistributor(await readJson(req))
  if (!parsed.ok) return invalid(parsed.errors)
  try {
    return NextResponse.json({ distributor: await createDistributor(parsed.value) }, { status: 201 })
  } catch (err) {
    return storeFailure(err)
  }
}
