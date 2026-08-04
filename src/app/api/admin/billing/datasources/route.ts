/**
 * Admin Billing API (Internal Tool - Requires Authentication)
 * GET /api/admin/billing/datasources?month=YYYY-MM
 *
 * Returns cost summary for all clients' service usage.
 * Requires CRON_SECRET in Authorization header: Bearer <CRON_SECRET>
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getBillingByMonth, getCostsByService, getAvailableMonths } from '@/lib/billing/usage-tracker'
import { guardAdmin } from '@/lib/auth/require-admin'

export async function GET(req: NextRequest) {
  try {
    // Accept either: admin session (UI) or Bearer CRON_SECRET (cron jobs)
    const authHeader = req.headers.get('authorization')
    const cronToken = `Bearer ${process.env.CRON_SECRET}`
    const isCronCall = authHeader === cronToken

    if (!isCronCall) {
      const guard = await guardAdmin()
      if (guard) return guard
    }

    // Initialize Supabase with service role key
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      process.env.SUPABASE_SERVICE_ROLE_KEY || '',
      { auth: { persistSession: false } }
    )

    const { searchParams } = new URL(req.url)
    const month = searchParams.get('month')

    if (!month) {
      // No data ⇒ an empty list. Inventing months to fill the dropdown would
      // put a month on screen that has no spend behind it.
      const availableMonths = await getAvailableMonths(supabase)

      return NextResponse.json({
        availableMonths,
        message: 'No month specified. Available months returned.',
      })
    }

    // Validate month format (YYYY-MM)
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json(
        { error: 'Invalid month format. Use YYYY-MM.' },
        { status: 400 }
      )
    }

    // 🔴 No fallback, no sample data, no swallowed errors.
    //
    // This route used to answer with a hardcoded SAMPLE_DATA block whenever the
    // query came back empty — "DataForSEO $150.00 / 2500 calls", invented
    // client ids, invented months — and it wrapped both queries in empty
    // catches, so a real database failure also landed on the fake numbers.
    // The page it feeds sits in the admin nav, so those invented figures were
    // shown as fact; the fabricated $150.00 happened to sit within a few
    // dollars of the real all-time spend, which is precisely why nobody
    // questioned it. An empty ledger has to look empty.
    const billingData = await getBillingByMonth(supabase, month)
    const costsByService = await getCostsByService(supabase, month)

    const totalCost = billingData.reduce((sum, row) => sum + (row.cost_usd ?? 0), 0)
    const totalApiCalls = billingData.reduce((sum, row) => sum + (row.api_calls ?? 0), 0)

    return NextResponse.json({
      month,
      totalCost,
      totalApiCalls,
      costsByService,
      byClient: billingData.map((row) => ({
        clientId: row.client_id,
        service: row.service,
        apiCalls: row.api_calls,
        costUsd: row.cost_usd,
      })),
    })
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to fetch billing data',
      },
      { status: 500 }
    )
  }
}
