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
 *
 * 🔴 Codex P1 复审（round 9）：`not_circuit_tripped` 不区分安全的
 *    `require_approval` 和危险的 `auto_approve`。重现路径——第一次调用把
 *    全部策略解成 `require_approval`，随后意向降级失败、接口 500；这时
 *    `autonomy_mode` 还没来得及降到 `observe`，如果这段间隙里旧的
 *    `bounded_auto` 每日 reconcile 恰好跑了一轮，`ads_sync_autonomy_policy`
 *    只挡 `mode='deny'`、不挡 `require_approval`，会把这些键悄悄同步成
 *    `auto_approve`。FDE 重试时，release RPC 对这些已经不是 deny 的键只会
 *    报 `not_circuit_tripped`（当成"已处理"），如果只看这个字段就返回
 *    成功，客户其实正在 `auto_approve` 状态下继续自动花钱，而 API 调用方
 *    以为已经安全解除。修法：返回成功前一定读一次 `client_automation_policies`
 *    的最终状态，只要有任何键是 `auto_approve` 就返回 500 而不是谎报成功——
 *    不去同步"抢救"（那是 `ads-autonomy-sync` worker 的唯一职责，见架构锁
 *    ②），而是老实说"还没解除干净，请重试"；意向这时已经降到 `observe`
 *    并且已经叫醒过同步 worker，重试间隔内基本会自愈。
 *
 * 🔴 Codex P1 复审（round 10）：上一条说"已经叫醒过同步 worker"这句话本身
 *    不够可靠——`notifyAutonomyModeChanged` 只在 `intentDowngraded` 分支里
 *    调用一次，是 fire-and-forget（`.catch(() => undefined)`）。如果那一次
 *    调用恰好发送失败，且后续重试时 `autonomy_mode` 已经是 `observe`（不
 *    会再进降级分支），就没有任何路径会再叫醒同步 worker——终检会一直
 *    发现同样的 `auto_approve` 残留、一直返回 500，直到明天的每日
 *    reconcile 才会自愈，这段时间客户仍在自动花钱。修法：终检发现卡住时，
 *    不管这次调用有没有走过降级分支，都额外调一次 `reconcileAutonomyMode`
 *    （重新读当前 `updated_at` 再发通知）——每次 500 都会重新尝试叫醒，
 *    不是只有第一次机会。
 *
 * 🔴 Codex P2 复审（round 13）：终检只筛 `auto_approve` 漏掉另一种"没解干净"
 *    ——逐键调用 release RPC 和终检读之间有一个窗口，如果熔断检查那个
 *    Inngest 函数恰好在这个窗口里判定客户仍要熔断（真实异常花费还在继续），
 *    批次 trip RPC 会把刚解开的键重新写回 `deny`。这种情况键的当前 mode
 *    是 `deny` 不是 `auto_approve`，原判据完全看不见，会带着一个其实又被
 *    重新熔断的键返回成功。改成任何一键只要还是 `auto_approve`，或者是
 *    circuit-breaker 自己写的 `deny`（被重新熔断），都算没解干净——跟
 *    `already_tripped` SQL 分支判断"是不是熔断器自己的 deny"同一个
 *    `updated_by` 前缀判据，不新造一套。
 *
 * 🔴 Codex P1 复审（round 14）：逐键循环里某个键的 RPC 调用本身失败（网络/
 *    连接层，不是业务返回的 race_lost）时，之前直接 500 返回、完全跳过
 *    降级——前面已经跑过的键可能已经真的从 deny 解成了 require_approval，
 *    晾在这个状态 + autonomy_mode 仍是 bounded_auto，之后任何一次更新
 *    `ad_strategy_configs.updated_at` 的写入都会被每日 reconcile 悄悄同步
 *    回 auto_approve。把降级逻辑抽成 `downgradeIfBoundedAuto`，这条早退
 *    路径也调用它——跟 race_lost/`unresolved` 那条早退路径不同，那条的
 *    "不降级"是刻意设计（测试里写明原因：race_lost 代表有并发写入方，
 *    半解除状态不确定，没有再加一次写入的必要性），这条纯粹是连接层失败，
 *    没有并发不确定性，降级是安全的，不能援引同一个"不降级"理由。
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { requireGlobalAdmin } from '@/lib/auth/require-admin'
import { listAdsActionKeys } from '@/lib/ads-strategy/autonomy/sync-policy'
import { notifyAutonomyModeChanged, reconcileAutonomyMode } from '@/lib/ads-strategy/autonomy/notify'

export const dynamic = 'force-dynamic'

export interface ReleaseKeyResult {
  readonly key: string
  readonly outcome: string // rpc 返回：released | not_circuit_tripped | no_policy_row | race_lost
}

/** 三种都代表"这个键已经处理完，不用重试"：真解了 / 本来就不是熔断锁 / 压根没有策略行。 */
const RELEASE_OUTCOME_HANDLED = new Set(['released', 'not_circuit_tripped', 'no_policy_row'])

/**
 * 尝试把 autonomy_mode 从 bounded_auto 收紧到 observe——从主路径（round 7/9/10/11
 * 一路修过来的那段）抽出来，让新的早退路径也能调用同一份逻辑，而不是各自
 * 再攒一份、漏掉某一处（round 14 复审起因）。
 *
 * 只在读/写 `ad_strategy_configs` 本身失败时返回非 null 的 `error`——不是
 * "没降级"就算错误，`autonomy_mode` 本来就不是 `bounded_auto` 时"没降级"是
 * 正常路径，不当失败。通知发送是 fire-and-forget（`.catch` 吞掉），不影响
 * 这里的返回值。
 */
async function downgradeIfBoundedAuto(
  clientId: string,
  staffEmail: string,
): Promise<{ downgraded: boolean; error: string | null }> {
  const { data: config, error: readError } = await supabaseAdmin
    .from('ad_strategy_configs')
    .select('autonomy_mode')
    .eq('client_id', clientId)
    .maybeSingle()
  if (readError) return { downgraded: false, error: `read autonomy_mode failed: ${readError.message}` }
  if (config?.autonomy_mode !== 'bounded_auto') return { downgraded: false, error: null }

  const nowIso = new Date().toISOString()
  const { error: downgradeError } = await supabaseAdmin
    .from('ad_strategy_configs')
    .update({ autonomy_mode: 'observe', autonomy_mode_updated_by: staffEmail, updated_at: nowIso })
    .eq('client_id', clientId)
  if (downgradeError) {
    return { downgraded: false, error: `downgrade autonomy_mode to observe failed: ${downgradeError.message}` }
  }
  // 立即叫醒同步 worker 核对一遍策略表，不等明天的每日 reconcile——跟 PATCH
  // 路由同一惯例。方向是收紧（bounded_auto → observe），不传 relaxed。
  await notifyAutonomyModeChanged(clientId, nowIso).catch(() => undefined)
  return { downgraded: true, error: null }
}

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
      // 🔴 Codex P1 复审（round 14）：前面已经跑过的键可能已经真的从 deny
      // 解成了 require_approval——这里直接 500 返回、完全跳过降级，会让那些
      // 键晾在 require_approval + autonomy_mode 仍是 bounded_auto 的状态，
      // 之后任何一次更新 ad_strategy_configs.updated_at 的写入（比如批准
      // 素材）都会让每日 reconcile 把它们悄悄同步回 auto_approve。这是 RPC
      // 调用本身失败（网络/连接层），不是业务返回的 race_lost（那条路径的
      // "不降级"是刻意设计，见下面 unresolved 分支旁的测试），没有并发方
      // 正在动这一行的不确定性，降级是安全的。
      const downgrade = await downgradeIfBoundedAuto(clientId, staff.user.email ?? 'unknown')
      return NextResponse.json(
        {
          error: `ads_release_circuit_breaker_policy(${key}) failed: ${error.message}`,
          results,
          intent_downgraded_to_observe: downgrade.downgraded,
          ...(downgrade.error ? { downgrade_error: downgrade.error } : {}),
        },
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
  const mainDowngrade = await downgradeIfBoundedAuto(clientId, staff.user.email ?? 'unknown')
  if (mainDowngrade.error) {
    return NextResponse.json({ error: mainDowngrade.error }, { status: 500 })
  }
  const intentDowngraded = mainDowngrade.downgraded

  // 终检（round 9）：见本文件顶部说明——not_circuit_tripped 不能区分
  // require_approval 和 auto_approve，返回成功前必须确认真的没有任何键
  // 停在 auto_approve。
  //
  // 🔴 Codex P2 复审（round 13）：只筛 auto_approve 漏掉另一种"没解干净"——
  // 上面逐键调用 release RPC 和这里的终检读之间有一个窗口，如果熔断检查
  // 那个 Inngest 函数恰好在这个窗口里判定同一个客户仍要熔断（比如异常花费
  // 还在继续），批次 trip RPC 会把刚解开的键重新写回 deny。这种情况下键的
  // 当前 mode 是 deny 不是 auto_approve，原判据完全看不见，会带着一个其实
  // 又被重新熔断的键返回 success。改成任何一键只要还是 auto_approve，或者
  // 是 circuit-breaker 自己写的 deny（被重新熔断），都算没解干净——跟
  // "already_tripped" SQL 分支判断"是不是熔断器自己的 deny"同一个 updated_by
  // 前缀判据。两种情况下都不是"谎报成功"，是老实说"没解干净"；如果是真被
  // 重新熔断，FDE 再点一次解除会看到同样的结果，不会无限重试卡死。
  const { data: finalPolicies, error: finalReadError } = await supabaseAdmin
    .from('client_automation_policies')
    .select('action_key, mode, updated_by')
    .eq('client_id', clientId)
    .in('action_key', listAdsActionKeys())
    .is('effective_to', null)
  if (finalReadError) {
    return NextResponse.json({ error: `final policy verification failed: ${finalReadError.message}` }, { status: 500 })
  }
  const notReleased = (finalPolicies ?? []).filter(
    (p): p is { action_key: string; mode: string; updated_by: string | null } =>
      p.mode === 'auto_approve' ||
      (p.mode === 'deny' && typeof p.updated_by === 'string' && p.updated_by.startsWith('circuit-breaker:')),
  )
  if (notReleased.length > 0) {
    // 🔴 Codex P1 复审（round 10）：这次调用自己的 notifyAutonomyModeChanged
    // 只在 intentDowngraded 分支里发（fire-and-forget，被 catch 吞掉）。如果
    // 那次通知恰好发送失败，且这次意向早已经是 observe（上面的 if 分支不会
    // 再进），就再也没有路径会重新叫醒同步 worker——只能等明天的每日
    // reconcile，这段时间客户在 auto_approve 状态下继续自动花钱。终检发现
    // 卡住时，不管这次调用有没有走过降级分支，都用 reconcileAutonomyMode
    // 重新读一次当前 ad_strategy_configs.updated_at 再叫醒一次——每次卡住
    // 都会重新尝试，不是只有第一次机会。
    //
    // 🔴 Codex P1 复审（round 11）：光是"再叫醒一次"还不够——默认幂等 id 只
    // 认 (client_id, updated_at)，如果第一次事件已经成功送达（不是发送失败，
    // 是 sync worker 收到了但自己重试耗尽后仍然失败），`updated_at` 这时不会
    // 再变，用默认 id 重发会被 Inngest 24h 去重直接吞掉，worker 连再跑一次
    // 的机会都拿不到。这里传 idSuffix 绕开去重——sync worker 自己基于
    // `ads_autonomy_sync_receipts`（不是事件 id）判断某个 updated_at 是否
    // 真的同步成功过，绕开事件级去重不会让它把已经成功的键重新做一遍。
    await reconcileAutonomyMode(supabaseAdmin, clientId, { idSuffix: `release-retry-${Date.now()}` }).catch(() => undefined)
    return NextResponse.json(
      {
        error: `release not safely complete — retry: ${notReleased.map(p => `${p.action_key}(${p.mode})`).join(', ')}`,
        released,
        results,
        intent_downgraded_to_observe: intentDowngraded,
      },
      { status: 500 },
    )
  }

  return NextResponse.json({ success: true, released, results, intent_downgraded_to_observe: intentDowngraded })
}
