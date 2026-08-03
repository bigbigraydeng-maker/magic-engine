import { supabaseAdmin } from '@/lib/supabase'
import { getMtcBalance } from './balance'
import type { ServiceKey, MtcSource, DeductResult } from './types'

/**
 * Phase X.S6 M-1: deductMtc is now atomic via the mtc_deduct_atomic RPC
 * (migration 20260626000006). The function holds row locks on the client's
 * batches across the SELECT-decrement-insert sequence, so concurrent
 * callers serialise instead of racing each other's reads.
 *
 * The JS-side legacy implementation is preserved as a fallback for safety:
 * if the RPC errors out (e.g. not deployed, transient DB issue), we fall
 * back to the non-atomic path with a logged warning rather than 500-ing on
 * every deduction.
 *
 * ⚠️ 2026-08-03：这个兜底救了命，别急着删。
 *
 * 审计发现 mtc_deduct_atomic 自 2026-06-26 上线起**从未成功执行过一次** ——
 * 函数里有两个 bug（`FOR UPDATE` 与聚合同句 → 0A000；reference_id text 写进
 * uuid 列 → 42804），第二个还被第一个挡着。5 周里 21 笔扣费全部由下面这个
 * 兜底完成，金额正确，但「原子扣费」这道保险实际一直是空的。
 *
 * 原注释写的「跑一周稳定后就可以删掉兜底」是基于一个从未被验证的前提 ——
 * 真按它删了，MTC 扣费会全线中断，而且只会以 console.warn 的形式静默失败。
 *
 * 两个 bug 已修（migration 20260803094500），并用真客户在事务内验证过
 * 扣费 → 账本 → 批次表三处一致。**删除兜底前，先确认生产日志里
 * 「atomic RPC failed」这条 warn 已经连续多日为零** —— 别再靠注释里的
 * 「应该没问题」做判断。
 */
export async function deductMtc(
  clientId: string,
  serviceKey: ServiceKey,
  mtcAmount: number,
  opts: { referenceId?: string; source?: MtcSource; notes?: string } = {},
): Promise<DeductResult> {
  // ── Primary path: atomic RPC ────────────────────────────────────────────────
  const { data, error } = await supabaseAdmin.rpc('mtc_deduct_atomic', {
    p_client_id:    clientId,
    p_service_key:  serviceKey,
    p_mtc_amount:   mtcAmount,
    p_reference_id: opts.referenceId ?? null,
    p_source:       opts.source ?? 'auto',
    p_notes:        opts.notes ?? null,
  })

  if (!error) {
    // RPC TABLE-returning functions come back as an array with one row.
    const row = Array.isArray(data) ? data[0] : data
    const okRow = row as { ok: boolean; ledger_entry_id: string | null; balance_remaining: number } | null
    if (okRow) {
      if (okRow.ok && okRow.ledger_entry_id) {
        return { ok: true, ledgerEntryId: okRow.ledger_entry_id }
      }
      if (!okRow.ok) {
        return { ok: false, reason: 'insufficient_balance', balance: okRow.balance_remaining }
      }
    }
    // Defensive: malformed row shape. Treat as db_error rather than silently
    // crediting the user with success.
    console.error('[mtc/deduct] atomic RPC returned malformed row', { row })
    return { ok: false, reason: 'db_error' }
  }

  // ── Fallback path: legacy SELECT-then-UPDATE (non-atomic) ──────────────────
  // Logged so we notice when the RPC starts failing in prod and can react.
  console.warn('[mtc/deduct] atomic RPC failed, falling back to non-atomic path', {
    message: error.message,
    code:    (error as { code?: string }).code,
  })

  return legacyDeductMtc(clientId, serviceKey, mtcAmount, opts)
}

/**
 * Non-atomic implementation kept as fallback. Documented race: a concurrent
 * pair of requests on the same balance can both read the same starting value
 * and both succeed. The atomic RPC above is the real fix; this remains only
 * to keep deductMtc usable if the RPC is temporarily unavailable.
 */
async function legacyDeductMtc(
  clientId: string,
  serviceKey: ServiceKey,
  mtcAmount: number,
  opts: { referenceId?: string; source?: MtcSource; notes?: string },
): Promise<DeductResult> {
  const { balance, batches } = await getMtcBalance(clientId)

  if (balance < mtcAmount) {
    return { ok: false, reason: 'insufficient_balance', balance }
  }

  // FIFO: consume from earliest-expiring batch first
  let remaining = mtcAmount
  const updates: Array<{ id: string; newRemaining: number }> = []

  for (const batch of batches) {
    if (remaining <= 0) break
    const consume = Math.min(batch.remaining, remaining)
    updates.push({ id: batch.purchaseId, newRemaining: batch.remaining - consume })
    remaining -= consume
  }

  const { data: ledgerRow, error: ledgerErr } = await supabaseAdmin
    .from('mtc_ledger')
    .insert({
      client_id:    clientId,
      purchase_id:  updates[0]?.id ?? null,
      direction:    'debit',
      service_key:  serviceKey,
      mtc_amount:   mtcAmount,
      reference_id: opts.referenceId ?? null,
      source:       opts.source ?? 'auto',
      notes:        opts.notes ?? null,
    })
    .select('id')
    .single()

  if (ledgerErr || !ledgerRow) {
    return { ok: false, reason: 'db_error' }
  }

  for (const update of updates) {
    await supabaseAdmin
      .from('mtc_purchases')
      .update({ mtc_remaining: update.newRemaining })
      .eq('id', update.id)
  }

  return { ok: true, ledgerEntryId: ledgerRow.id as string }
}
