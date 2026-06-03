/**
 * GET /api/admin/mtc/overview
 *
 * Admin/FDE overview of MTC (Magic Token Credits) across all clients.
 *
 * Returns aggregated balance, revenue, and per-client spending for the
 * current billing period.  Access is restricted to users on the admin
 * whitelist via guardAdmin().
 *
 * Reference: ROADMAP.md [P-MTC.1]
 */

import { NextResponse } from 'next/server'
import { guardAdmin } from '@/lib/auth/require-admin'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// ─── Types ────────────────────────────────────────────────────────────────────

type PurchaseRow = {
  id: string
  client_id: string
  amount_nzd: number
  mtc_amount: number
  mtc_remaining: number
}

type LedgerRow = {
  client_id: string
  direction: string
  mtc_amount: number
}

type ClientRow = {
  id: string
  name: string
}

type ClientSummary = {
  clientId: string
  name: string
  currentBalance: number
  thisMonthSpend: number
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function GET(_request: Request) {
  // ── Admin guard (whitelist check) ─────────────────────────────────────────

  const guard = await guardAdmin()
  if (guard) return guard

  // ── Fetch valid purchases (completed + not expired) ───────────────────────

  const now = new Date().toISOString()

  const { data: purchaseData, error: purchaseErr } = await supabaseAdmin
    .from('mtc_purchases')
    .select('id, client_id, amount_nzd, mtc_amount, mtc_remaining')
    .eq('status', 'completed')
    .gt('expires_at', now)

  if (purchaseErr) {
    return NextResponse.json({ error: purchaseErr.message }, { status: 500 })
  }

  const purchases = (purchaseData ?? []) as PurchaseRow[]

  // ── Fetch all completed purchases for revenue calculation (no expiry filter) ──

  const { data: allCompletedPurchases, error: allPurchasesErr } = await supabaseAdmin
    .from('mtc_purchases')
    .select('amount_nzd')
    .eq('status', 'completed')

  if (allPurchasesErr) {
    return NextResponse.json({ error: allPurchasesErr.message }, { status: 500 })
  }

  // ── Fetch this-month ledger debits ────────────────────────────────────────

  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)

  const { data: ledgerData, error: ledgerErr } = await supabaseAdmin
    .from('mtc_ledger')
    .select('client_id, direction, mtc_amount')
    .eq('direction', 'debit')
    .gte('created_at', monthStart.toISOString())

  if (ledgerErr) {
    return NextResponse.json({ error: ledgerErr.message }, { status: 500 })
  }

  const ledgerRows = (ledgerData ?? []) as LedgerRow[]

  // ── Resolve client names ──────────────────────────────────────────────────

  const clientIds = Array.from(new Set(purchases.map(p => p.client_id)))

  let clientNameMap: Map<string, string> = new Map()

  if (clientIds.length > 0) {
    const { data: clientData } = await supabaseAdmin
      .from('clients')
      .select('id, name')
      .in('id', clientIds)

    for (const c of (clientData ?? []) as ClientRow[]) {
      clientNameMap.set(c.id, c.name)
    }
  }

  // ── Aggregate global totals ───────────────────────────────────────────────

  const totalBalanceMtc = purchases.reduce((sum, p) => sum + p.mtc_remaining, 0)
  const totalRevenue    = (allCompletedPurchases ?? []).reduce(
    (sum, p) => sum + Number(p.amount_nzd), 0,
  )
  const totalSoldMtc    = purchases.reduce((sum, p) => sum + p.mtc_amount, 0)
  const totalConsumedMtc = totalSoldMtc - totalBalanceMtc

  // ── Per-client balance ────────────────────────────────────────────────────

  const balanceByClient = new Map<string, number>()
  for (const p of purchases) {
    balanceByClient.set(p.client_id, (balanceByClient.get(p.client_id) ?? 0) + p.mtc_remaining)
  }

  // ── Per-client this-month spend ───────────────────────────────────────────

  const spendByClient = new Map<string, number>()
  for (const row of ledgerRows) {
    spendByClient.set(row.client_id, (spendByClient.get(row.client_id) ?? 0) + row.mtc_amount)
  }

  // ── Build clients array sorted by currentBalance desc ────────────────────

  const clients: ClientSummary[] = Array.from(balanceByClient.entries()).map(
    ([clientId, currentBalance]) => ({
      clientId,
      name: clientNameMap.get(clientId) ?? clientId.substring(0, 8),
      currentBalance,
      thisMonthSpend: spendByClient.get(clientId) ?? 0,
    }),
  )

  clients.sort((a, b) => b.currentBalance - a.currentBalance)

  // ── Response ──────────────────────────────────────────────────────────────

  return NextResponse.json({
    totalBalanceMtc,
    totalRevenue,
    totalSoldMtc,
    totalConsumedMtc,
    clients,
  })
}
