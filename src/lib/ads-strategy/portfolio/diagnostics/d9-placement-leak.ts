/**
 * D9 · 纯播放广告没排除 Audience Network（`docs/PITFALLS.md` D9）。只读，结构性检查。
 *
 * `optimization_goal` 是纯播放类（THRUPLAY / VIDEO_VIEW，"用最低成本换看完/播放次数"）的广告组，
 * 建的时候如果没有显式设置 `targeting.publisher_platforms` 排除 Audience Network，
 * Meta 会自动把预算导向 Audience Network 的"奖励视频"版位——用户是在别的手游里为换游戏奖励被迫看完，
 * 完播率会逼近 100%，但这是假信号，不代表真实兴趣。
 *
 * 判定不看实际花费按版位的分布（那需要 `breakdowns=publisher_platform` 的 insights，
 * 现有的每日快照管线不采集这一层），只看**结构性配置**：
 *   - `optimization_goal` 命中纯播放清单
 *   - 且 `targeting_summary.publisher_platforms` 为空（= 留自动版位）
 *     或者显式包含了 `audience_network`
 *   - 且窗口内有花费（避免对还没花钱的新建广告组报噪音）
 *
 * 2026-09-21 CTS 圣诞团 ThruPlay 广告组就是这个模式：建的时候没设 `publisher_platforms`，
 * 次日实测 95%+ 花费落进 `audience_network/rewarded_video`。这条规则设计出来的时候就该有，
 * 一直没人写（`ad_entity_snapshots` 快照表本身在跑，缺的是读这批数据的规则），
 * 这次补上，永不进客户版——这是我们自己配置错误，不是客户生意的问题。
 */

import type { AccountContext } from './context'
import { adsetRows, sumSpend, unitOf } from './context'
import type { Diagnosis } from './types'
import { D9_MIN_WINDOW_SPEND, D9_VIEW_OPTIMIZATION_GOALS } from './thresholds'

type ViewGoal = (typeof D9_VIEW_OPTIMIZATION_GOALS)[number]

function isViewOptimized(goal: string | null): goal is ViewGoal {
  return goal !== null && (D9_VIEW_OPTIMIZATION_GOALS as readonly string[]).includes(goal)
}

function publisherPlatforms(targetingSummary: Record<string, unknown> | null): string[] | null {
  const raw = targetingSummary?.publisher_platforms
  return Array.isArray(raw) ? raw.filter((p): p is string => typeof p === 'string') : null
}

/** 排除干净 = 显式设了版位列表，且列表里没有 audience_network。 */
function excludesAudienceNetwork(platforms: string[] | null): boolean {
  return platforms !== null && !platforms.includes('audience_network')
}

export function diagnosePlacementLeak(ctx: AccountContext): Diagnosis[] {
  const out: Diagnosis[] = []

  for (const s of Array.from(ctx.adsets.values())) {
    if (ctx.experimentIds.has(s.entity_id)) continue
    if (!isViewOptimized(s.optimization_goal)) continue

    const platforms = publisherPlatforms(s.targeting_summary)
    if (excludesAudienceNetwork(platforms)) continue

    const rows = adsetRows(ctx, [s.entity_id])
    const spend = sumSpend(rows)
    if (spend < D9_MIN_WINDOW_SPEND) continue

    const unit = unitOf(ctx, 'adset', s.entity_id)
    const configuredButLeaky = platforms !== null && platforms.includes('audience_network')
    out.push({
      code: 'D9',
      status: 'hit',
      clientVisible: false,
      units: [unit],
      title: configuredButLeaky
        ? `纯播放广告组的投放位置里明确包含了 Audience Network：近 7 天已花 ${spend}`
        : `纯播放广告组没有排除 Audience Network（留了自动版位）：近 7 天已花 ${spend}`,
      evidence: {
        window_start: ctx.window[0],
        window_end: ctx.date,
        optimization_goal: s.optimization_goal,
        publisher_platforms: platforms === null ? null : platforms.join(','),
        window_spend: spend,
      },
      sample: [{ label: '近 7 天有花费的天数', value: rows.filter(r => r.spend > 0).length }],
      reasons: [
        '纯播放类优化目标 + 未排除 Audience Network = Meta 会自动找全网最低成本的"完播"来源，' +
          'Audience Network 奖励视频是这类库存里最便宜、完播率必然接近 100% 的一种（用户是被游戏奖励"绑住"看完，不是被内容打动）',
      ],
      manualTask: {
        what: `广告组 ${s.entity_name ?? s.entity_id}（${ctx.account.adAccountId}）在花钱，但很可能大部分曝光落进了 Audience Network 假用户。`,
        how: '把这个广告组的"投放位置"手动改成只投 Facebook / Instagram，排除 Audience Network；改完拿真实 insights（按 publisher_platform 拆开）核实花费确实不再流向 audience_network。',
        href: `https://adsmanager.facebook.com/adsmanager/manage/adsets?act=${ctx.account.adAccountId.replace(/^act_/, '')}`,
      },
    })
  }

  return out
}
