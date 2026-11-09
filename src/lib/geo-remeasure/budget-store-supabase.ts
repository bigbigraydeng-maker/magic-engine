/**
 * GeoBudgetStore 的 Supabase 实现（#1347）—— 只调 RPC，不自己算余额。
 * 🔴 本文件是**纯工厂**：接收已建好的 supabase client，返回一个闭包 store —— 工厂本身无 I/O，
 *    client 引用在函数注册时被闭包捕获，真正的 RPC 调用发生在 handler 内（魏征 S3 复审提到
 *    注释与实操对齐）。CLAUDE.md 铁律 7 针对的是 3rd-party API SDK（如 OpenAI/Anthropic）
 *    在模块顶层构造，本工厂不违反。RPC 名/参数与 migration 20260904000001 对齐。RPC 报错
 *    一律当拒绝（fail-closed）。
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  GeoBudgetStore, GeoBudgetReserveResult, GeoBudgetSettleResult, GeoBudgetReserveReason,
} from './budget-ledger'

export function createSupabaseGeoBudgetStore(client: SupabaseClient): GeoBudgetStore {
  return {
    async reserve(reservationId, clientId, periodKey, worstCaseUsd): Promise<GeoBudgetReserveResult> {
      const { data, error } = await client.rpc('geo_reserve_budget_v1', {
        p_reservation_id: reservationId,
        p_client_id: clientId,
        p_period_key: periodKey,
        p_worst_case_usd: worstCaseUsd,
      })
      // 🔴 RPC 报错 / 空响应 = 未知，一律当拒绝，绝不当授权。
      if (error || data == null) return { reserved: false, reason: 'no_budget_row' }
      const d = data as { reserved?: boolean; reason?: string; remaining_usd?: number; idempotent?: boolean }
      return {
        reserved: d.reserved === true,
        reason: d.reason as GeoBudgetReserveReason | undefined,
        remainingUsd: typeof d.remaining_usd === 'number' ? d.remaining_usd : undefined,
        idempotent: d.idempotent === true,
      }
    },
    async settle(reservationId, actualUsd): Promise<GeoBudgetSettleResult> {
      const { data, error } = await client.rpc('geo_settle_budget_v1', {
        p_reservation_id: reservationId,
        p_actual_usd: actualUsd,
      })
      if (error || data == null) return { settled: false, reason: 'rpc_error' }
      const d = data as { settled?: boolean; reason?: string; charged_usd?: number; idempotent?: boolean }
      return {
        settled: d.settled === true,
        reason: d.reason,
        chargedUsd: typeof d.charged_usd === 'number' ? d.charged_usd : undefined,
        idempotent: d.idempotent === true,
      }
    },
  }
}
