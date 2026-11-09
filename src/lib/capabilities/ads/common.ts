/**
 * 六个广告动作共用的三样东西：
 *   ① `snapshotPre`：写 provider 之前抓一份 `kernel_pre` 快照 —— 撤回和验证都要用
 *   ② `readback`：写完之后回读 Meta 真实设置，跟改前快照比对，只允许该动的字段动了
 *   ③ 令牌解析 + 错误分类：Meta 4xx/5xx 该重试哪些、直接 fail 哪些
 *
 * 🔴 这一层刻意不认识具体动作的语义。语义在 `pause-unit.ts`/`scale-unit-budget.ts` 等文件里。
 *    共用底座只做「所有对外写都必须做的事」，避免六个执行器各抄一份 → 各留一处坑。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { CapabilityStepContext, CapabilityStepResult, VerificationResult } from '@/lib/kernel/types'
import { RetryableCapabilityError } from '@/lib/kernel/errors'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'
import { captureClientSnapshots } from '@/lib/ads-strategy/portfolio/snapshot-sync'

/**
 * 读 client_id 的 Meta 令牌。
 *
 * 🔴 找不到令牌 → 抛 RetryableCapabilityError：令牌可能是被 PM 手动重授权、
 *    Meta 把它挤下线，都是环境类问题，重试合理。**不**把这条动作直接
 *    fail_final，那会让 downstream 挂着无法自动恢复。
 */
export async function requireMetaToken(clientId: string): Promise<string> {
  const token = await getMetaTokenForClient(clientId)
  if (!token) throw new RetryableCapabilityError(`读不到客户 ${clientId} 的 Meta 令牌`)
  return token
}

/**
 * `snapshot_pre` 步骤的实现。所有六个动作都用这个，一字不改。
 *
 * 触发 `snapshot-sync` 抓一份 `kernel_pre` 快照，写进 `ad_entity_snapshots`。
 * 这份快照的用处：
 *   · Gateway 在碰 provider 之前用它重算一遍信封（纵深防御）
 *   · 撤回时按它的值把预算/状态写回去
 *   · 验证步骤用它跟改后设置比对
 *
 * 🔴 不返回快照本体，只落一个 `snapshotted_at` 到 output —— 快照的真相在
 *    `ad_entity_snapshots` 表里，那才是 append-only 的审计源；handler 里
 *    捧着一个副本传下去只会造成两份数据不一致。
 */
export function makeSnapshotPreStep(sb: SupabaseClient, opts: { allClientAccounts?: boolean } = {}) {
  return async function snapshotPre(step: CapabilityStepContext): Promise<CapabilityStepResult> {
    const runInput = step.runInput as { ad_account_id?: unknown }
    const adAccountId = typeof runInput.ad_account_id === 'string' ? runInput.ad_account_id : null
    if (!adAccountId) throw new RetryableCapabilityError('input 里没有 ad_account_id')

    // 🔴 snapshot-sync 是幂等的：同一时刻抓一次就够，重试会用同一个 `captured_at`
    //    锚点比对，不会写重。这里失败按可重试处理（网络/Meta 抖动都是环境）。
    let accountIds = [adAccountId]
    if (opts.allClientAccounts) {
      const { data: registered, error: registryError } = await sb
        .from('client_meta_ad_accounts').select('ad_account_id').eq('client_id', step.ctx.clientId)
      if (registryError) throw new RetryableCapabilityError(`读取客户广告账户清单失败：${registryError.message}`)
      accountIds = ((registered ?? []) as Array<{ ad_account_id: string }>).map(row => row.ad_account_id)
      if (accountIds.length === 0) {
        const { data: client, error: clientError } = await sb.from('clients')
          .select('meta_ad_account_id').eq('id', step.ctx.clientId).maybeSingle()
        if (clientError) throw new RetryableCapabilityError(`读取客户主广告账户失败：${clientError.message}`)
        const legacyId = (client as { meta_ad_account_id?: string | null } | null)?.meta_ad_account_id
        if (legacyId) accountIds = [legacyId]
      }
      if (!accountIds.includes(adAccountId)) {
        throw new RetryableCapabilityError('目标广告账户不在客户完整账户清单中')
      }
    }
    const summary = await captureClientSnapshots(step.ctx.clientId, accountIds, { reason: 'kernel_pre' })
      .catch((err: unknown) => {
        throw new RetryableCapabilityError(
          `抓 kernel_pre 快照失败：${err instanceof Error ? err.message : String(err)}`,
        )
      })

    if (!summary.success) {
      // 抓不到（授权断、账户读不到、共用账户元数据缺失）→ 环境类，重试合理。
      throw new RetryableCapabilityError(
        `kernel_pre 快照没抓全：${summary.error ?? summary.accounts.map(a => a.error).filter(Boolean).join('；')}`,
      )
    }

    const rowsWritten = summary.accounts.reduce((n, a) => n + a.rows_written, 0)
    return {
      output: {
        snapshotted_at: new Date().toISOString(),
        ad_account_id: adAccountId,
        rows_written: rowsWritten,
      },
    }
  }
}

/**
 * 回读步骤的验证结果。
 *
 * 🔴 「验证」不是「写入成功了」的同义反复 —— 它必须能真正失败。
 *    这里的判据：从 Meta 拿到的当前值，跟传进来的 `expected` 完全相等。
 *    Meta 有一种「静默强停」：你想改预算，它悄悄把状态改成 PAUSED，
 *    返回 success 但实际没生效。所以判据是「回读拿到什么」，不是「写请求返回 200」。
 */
export function makeReadbackVerification(
  expected: Record<string, string | number>,
  actual: Record<string, string | number | null>,
): VerificationResult {
  const checks: VerificationResult['checks'] = []
  for (const [k, v] of Object.entries(expected)) {
    const passed = actual[k] === v
    checks.push({
      name: k,
      passed,
      detail: passed ? String(v) : `期望 ${v}，实际 ${actual[k]}`,
    })
  }
  const passed = checks.every(c => c.passed)
  return {
    method: 'ads_readback_integrity',
    passed,
    checks,
    ...(passed ? {} : { failure_reason: `Meta 回读跟预期不符：${checks.filter(c => !c.passed).map(c => `${c.name}(${c.detail})`).join('；')}` }),
  }
}
