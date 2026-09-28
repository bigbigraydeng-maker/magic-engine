/**
 * POST /api/clients/[id]/ad-strategy-config/release-circuit-breaker
 *
 * 解除熔断器自动设的 deny——把该客户全部 `ads.*` 动作的
 * `client_automation_policies.mode` 从 `deny` 解回 `require_approval`
 * （WP3 熔断器运行时调用方）。
 *
 * 只解熔断器自己写的 deny：唯一写入口 `ads_release_circuit_breaker_policy`
 * 本身只认 `updated_by` 前缀 `circuit-breaker:`，管理员手动设的 deny 这条
 * 路由碰不到。
 *
 * 解到 `require_approval` 而不是 `auto_approve`——解除只是把安全阀放回
 * "需要人批"，不替 PM 决定恢复全自动；PM 要恢复 `bounded_auto` 得自己在
 * 这个页面再拨一次自治模式，那条路径走已有的 PATCH（会重新发
 * `ads_sync_autonomy_policy`）。
 *
 * 🔴 Codex P1 复审：只解策略表不够。`ad_strategy_configs.autonomy_mode` 若仍是
 *    `bounded_auto`（熔断触发的前提条件——见 `ads-circuit-breaker-check.ts` 的
 *    `mode !== 'bounded_auto'` 早退），下一次 `ads-autonomy-sync` 触发（每日
 *    cron `reconcileAutonomyMode`，或任何后续 Settings 写入带出的叫醒铃）会把
 *    刚解到 `require_approval` 的策略重新同步成 `auto_approve`——
 *    `ads_sync_autonomy_policy` 只挡 `mode = 'deny'`，不挡 `require_approval`。
 *    上面这段注释原先的假设（"PM 要恢复得自己再拨一次"）默认了 PM 不动
 *    autonomy_mode 状态就不会变，但每日 reconcile 本身就是那个"自己拨一次"
 *    的等价物，只是没人按。真正闭环解除必须让意向也退回 `observe`。
 *
 * 🔴 Codex P1 复审（round 7）：降级判据不能用"这次调用自己 released 了几条"。
 *    重现路径——第一次调用把全部策略解成 `require_approval`，随后读/写
 *    `ad_strategy_configs` 短暂失败，接口整体返回 500；FDE 看到报错重新点
 *    一次按钮，这次每个键的 RPC 都会幂等报 `not_circuit_tripped`（因为已经
 *    不是 deny 了）——旧代码用 `released > 0` 当降级判据，这次重试
 *    `released === 0`，永久跳过降级，`autonomy_mode` 卡在 `bounded_auto`，
 *    下一次 reconcile 照样把它同步回 `auto_approve`，第一次调用解决的问题
 *    被第二次调用的这个判据错误又打开了。改成只看当前 `autonomy_mode`
 *    是否仍是 `bounded_auto`（不看这次调用自己解了几条）——幂等，重试
 *    多少次结果都一样，不依赖"哪一次调用恰好是真正生效的那一次"。
 *
 * 全局 admin 闸：跟 PATCH ad-strategy-config 同一理由——这是内部控制项，
 * 客户成员不能自己解除熔断。`updated_by` 由 `requireGlobalAdmin` 的 email 拼，
 * 不从 body 读（body 里给身份等于让调用方自报）。
 *
 * 🔴 Codex P2 复审：`race_lost`（或任何非预期返回值）不能当成功报告。前端只
 *    看 `success` 字段就判断"已解除"，如果某个键在 SELECT 和 UPDATE 之间被
 *    并发改动导致这个键其实没解开，这里之前会照样 `success: true`——FDE 会
 *    以为已经解除、不会想到要重试，那个键继续保持 deny。现在任一键的
 *    outcome 不在 `RELEASE_OUTCOME_HANDLED` 里就整体返回 500，不产生"部分
 *    解除也算成功"的假象；FDE 重新点一次按钮即可——已经解开的键在
 *    `ads_release_circuit_breaker_policy` 里会因为不再是 deny 而幂等报
 *    `not_circuit_tripped`，只有真正卡住的那个键会再试一次。
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { requireGlobalAdmin } from '@/lib/auth/require-admin'
import { listAdsActionKeys } from '@/lib/ads-strategy/autonomy/sync-policy'
import { notifyAutonomyModeChanged } from '@/lib/ads-strategy/autonomy/notify'

export const dynamic = 'force-dynamic'

export interface ReleaseKeyResult {
  readonly key: string
  readonly outcome: string // rpc 返回：released | not_circuit_tripped | no_policy_row | race_lost
}

/** 三种都代表"这个键已经处理完，不用重试"：真解了 / 本来就不是熔断锁 / 压根没有策略行。 */
const RELEASE_OUTCOME_HANDLED = new Set(['released', 'not_circuit_tripped', 'no_policy_row'])

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const staff = await requireGlobalAdmin()
  if (!staff.ok) return NextResponse.json({ error: staff.error }, { status: staff.status })
  const updatedBy = `circuit-breaker-release:${staff.user.email ?? 'unknown'}:${new Date().toISOString()}`

  const results: ReleaseKeyResult[] = []
  for (const key of listAdsActionKeys()) {
    const { data, error } = await supabaseAdmin.rpc('ads_release_circuit_breaker_policy', {
      p_client_id: clientId,
      p_action_key: key,
      p_updated_by: updatedBy,
    })
    if (error) {
      return NextResponse.json(
        { error: `ads_release_circuit_breaker_policy(${key}) failed: ${error.message}` },
        { status: 500 },
      )
    }
    results.push({ key, outcome: typeof data === 'string' ? data : 'unknown' })
  }

  const unresolved = results.filter(r => !RELEASE_OUTCOME_HANDLED.has(r.outcome))
  if (unresolved.length > 0) {
    return NextResponse.json(
      {
        error: `release incomplete — retry: ${unresolved.map(r => `${r.key}=${r.outcome}`).join(', ')}`,
        results,
      },
      { status: 500 },
    )
  }

  const released = results.filter(r => r.outcome === 'released').length

  // 意向必须跟着退回 observe，见本文件顶部 Codex P1 说明——否则下一次
  // ads-autonomy-sync 会把刚解开的 require_approval 悄悄同步回 auto_approve。
  // 判据只看"当前意向是不是仍是 bounded_auto"，不看这次调用自己 released
  // 了几条（round 7 修正：那个判据在重试场景下不幂等，见本文件顶部说明）。
  let intentDowngraded = false
  const { data: config, error: readError } = await supabaseAdmin
    .from('ad_strategy_configs')
    .select('autonomy_mode')
    .eq('client_id', clientId)
    .maybeSingle()
  if (readError) {
    return NextResponse.json({ error: `read autonomy_mode failed: ${readError.message}` }, { status: 500 })
  }
  if (config?.autonomy_mode === 'bounded_auto') {
    const nowIso = new Date().toISOString()
    const { error: downgradeError } = await supabaseAdmin
      .from('ad_strategy_configs')
      .update({ autonomy_mode: 'observe', autonomy_mode_updated_by: staff.user.email ?? 'unknown', updated_at: nowIso })
      .eq('client_id', clientId)
    if (downgradeError) {
      return NextResponse.json(
        { error: `downgrade autonomy_mode to observe failed: ${downgradeError.message}` },
        { status: 500 },
      )
    }
    intentDowngraded = true
    // 立即叫醒同步 worker 核对一遍策略表，不等明天的每日 reconcile——跟 PATCH
    // 路由同一惯例。方向是收紧（bounded_auto → observe），不传 relaxed。
    await notifyAutonomyModeChanged(clientId, nowIso).catch(() => undefined)
  }

  return NextResponse.json({ success: true, released, results, intent_downgraded_to_observe: intentDowngraded })
}
