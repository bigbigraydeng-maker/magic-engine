/**
 * Phase X.S1 — Unified MTC charge helper for content generation.
 *
 * Wraps balance check + budget check + deductMtc + refund-on-fail into a single
 * call so every content generation route (image / video / blog / social / reels)
 * uses the same code path. Two flavours:
 *
 *   chargeForGeneration(...)   — synchronous: deduct upfront, refund on throw
 *   prechargeAndCommit(...)    — async: precheck only, caller commits/refunds
 *                                later when the background job resolves
 *
 * Pricing is read from MTC_RATES (types.ts). To change a price, edit one number
 * in that table — call sites are price-agnostic.
 *
 * Return shape mirrors NextResponse.json patterns so callers can do:
 *   const charge = await chargeForGeneration(...)
 *   if (!charge.ok) return NextResponse.json(charge.body, { status: charge.status })
 */

import { supabaseAdmin } from '@/lib/supabase'
import { getMtcBalance } from './balance'
import { deductMtc } from './deduct'
import { refundMtc } from './refund'
import { checkBudget } from './budget-guard'
import { MTC_RATES } from './types'
import type { ServiceKey } from './types'

// ─── Public types ─────────────────────────────────────────────────────────────

export type ChargeFailReason =
  | 'insufficient_balance'
  | 'monthly_cap_reached'
  | 'db_error'

export interface ChargeSuccess {
  ok: true
  ledgerEntryId: string
  /** Total MTC actually deducted (`unitCost × units`). */
  mtcAmount: number
}

export interface ChargeFailure {
  ok: false
  reason: ChargeFailReason
  /** HTTP status the caller should return. 402 for balance, 429 for cap. */
  status: 402 | 429 | 500
  /** Ready-made JSON body. */
  body: {
    success: false
    error: string
    reason: ChargeFailReason
    balance?: number
    required?: number
    budget?: { spent: number; cap: number; remaining: number }
  }
}

export type ChargeResult = ChargeSuccess | ChargeFailure

export interface ChargeOptions {
  /** When > 1, multiplies unit price (e.g. batch image of 4 → units=4). */
  units?: number
  referenceId?: string
  notes?: string
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function failBalance(balance: number, required: number): ChargeFailure {
  return {
    ok: false,
    reason: 'insufficient_balance',
    status: 402,
    body: {
      success: false,
      error: `余额不足：本次需要 ${required} MTC，当前余额 ${balance} MTC。请充值后重试。`,
      reason: 'insufficient_balance',
      balance,
      required,
    },
  }
}

function failBudget(spent: number, cap: number, remaining: number): ChargeFailure {
  return {
    ok: false,
    reason: 'monthly_cap_reached',
    status: 429,
    body: {
      success: false,
      error: `本月预算已达上限（已用 ${spent}/${cap} MTC）。请下月继续或联系 Magic Engine 提升配额。`,
      reason: 'monthly_cap_reached',
      budget: { spent, cap, remaining },
    },
  }
}

function failDb(message: string): ChargeFailure {
  return {
    ok: false,
    reason: 'db_error',
    status: 500,
    body: { success: false, error: `MTC 扣费失败：${message}`, reason: 'db_error' },
  }
}

// ─── chargeForGeneration — synchronous ────────────────────────────────────────

/**
 * Synchronous "deduct upfront" pattern. Use this for fast, in-process generation
 * (sync image, sync social plan). Caller is expected to call `refundOnFail()` if
 * the post-charge work throws.
 *
 * For long-running async work that returns a job_id immediately, use
 * `prechargeAndCommit` instead — it only validates upfront and leaves the
 * deduction to happen at completion time.
 */
export async function chargeForGeneration(
  clientId: string,
  serviceKey: ServiceKey,
  opts: ChargeOptions = {},
): Promise<ChargeResult> {
  const units = Math.max(1, Math.floor(opts.units ?? 1))
  const unitCost = MTC_RATES[serviceKey]
  const required = unitCost * units

  // 1. Budget cap (monthly)
  const budget = await checkBudget(clientId, required)
  if (!budget.allowed) {
    return failBudget(budget.spent, budget.cap, budget.remaining)
  }

  // 2. Balance precheck — returns a clean 402 instead of generic db_error.
  const { balance } = await getMtcBalance(clientId)
  if (balance < required) {
    return failBalance(balance, required)
  }

  // 3. Deduct
  const result = await deductMtc(clientId, serviceKey, required, {
    referenceId: opts.referenceId,
    notes: opts.notes,
    source: 'auto',
  })

  if (!result.ok) {
    if (result.reason === 'insufficient_balance') {
      return failBalance(result.balance ?? 0, required)
    }
    return failDb(`deduction failed (${result.reason})`)
  }

  return { ok: true, ledgerEntryId: result.ledgerEntryId, mtcAmount: required }
}

// ─── refundOnFail — pairs with chargeForGeneration ────────────────────────────

/**
 * Credit the MTC back to the client when the post-charge work fails.
 * Records a `refund` ledger row referencing the failed work for audit.
 *
 * Phase X.S6 M-2: when the refund itself fails (DB error, mid-table state),
 * we now persist a row to `mtc_refund_failures` so an ops sweep can replay it
 * — previously the failure was just console.error'd and the over-charged
 * customer had no audit trail to discover the situation.
 *
 * Best-effort: errors writing to mtc_refund_failures are also logged but
 * never thrown — refund failure must not mask the original generation failure.
 */
export async function refundOnFail(
  clientId: string,
  serviceKey: ServiceKey,
  mtcAmount: number,
  opts: { referenceId?: string; reason?: string } = {},
): Promise<void> {
  const notes = opts.reason
    ? `Auto-refund: ${serviceKey} failed — ${opts.reason}`
    : `Auto-refund: ${serviceKey} failed`

  let lastError: string | null = null
  try {
    const result = await refundMtc(clientId, serviceKey, mtcAmount, {
      referenceId: opts.referenceId,
      notes,
    })
    if (result.ok) return
    lastError = 'refundMtc returned ok=false (likely ledger insert failure)'
    console.error('[mtc/refundOnFail] refund failed', { clientId, serviceKey, mtcAmount })
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err)
    console.error('[mtc/refundOnFail] refund threw', err)
  }

  // Refund did not complete — persist for ops replay.
  try {
    await supabaseAdmin.from('mtc_refund_failures').insert({
      client_id:      clientId,
      service_key:    serviceKey,
      mtc_amount:     mtcAmount,
      reference_id:   opts.referenceId ?? null,
      failure_reason: opts.reason ?? null,
      last_error:     lastError,
    })
  } catch (writeErr) {
    // Last-resort log only — at this point both the refund AND the failure
    // record write failed, and there's nothing else we can do server-side.
    console.error('[mtc/refundOnFail] mtc_refund_failures insert threw', writeErr)
  }
}

// ─── prechargeAndCommit — for async/background work ───────────────────────────

/**
 * For routes that hand off to a background job and return a job_id immediately:
 * validate balance + budget upfront (so the user gets an instant 402/429), then
 * stash the projected cost on the job record and call `commitCharge` /
 * `refundOnFail` from the worker once the job resolves.
 *
 * Returns the projected cost so the route can persist it (e.g. into
 * blog_posts.projected_mtc) for later commit/refund.
 */
export async function precheckCharge(
  clientId: string,
  serviceKey: ServiceKey,
  opts: ChargeOptions = {},
): Promise<
  | { ok: true; projectedMtc: number }
  | ChargeFailure
> {
  const units = Math.max(1, Math.floor(opts.units ?? 1))
  const unitCost = MTC_RATES[serviceKey]
  const required = unitCost * units

  const budget = await checkBudget(clientId, required)
  if (!budget.allowed) {
    return failBudget(budget.spent, budget.cap, budget.remaining)
  }

  const { balance } = await getMtcBalance(clientId)
  if (balance < required) {
    return failBalance(balance, required)
  }

  return { ok: true, projectedMtc: required }
}

/**
 * Background workers call this after the generation actually succeeds.
 * Errors are logged + returned but never thrown — never block successful work
 * just because the ledger write failed.
 */
export async function commitCharge(
  clientId: string,
  serviceKey: ServiceKey,
  mtcAmount: number,
  opts: { referenceId?: string; notes?: string } = {},
): Promise<{ ok: boolean; ledgerEntryId?: string }> {
  try {
    const result = await deductMtc(clientId, serviceKey, mtcAmount, {
      referenceId: opts.referenceId,
      notes: opts.notes,
      source: 'auto',
    })
    if (!result.ok) {
      console.error('[mtc/commitCharge] deduct failed', { clientId, serviceKey, mtcAmount, reason: result.reason })
      return { ok: false }
    }
    return { ok: true, ledgerEntryId: result.ledgerEntryId }
  } catch (err) {
    console.error('[mtc/commitCharge] deduct threw', err)
    return { ok: false }
  }
}

