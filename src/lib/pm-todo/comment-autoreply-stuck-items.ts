/**
 * 评论自动回复卡死在失败 —— 下发到「需要你动手」。
 *
 * `comment-autoreply-engine.ts` 对每条评论最多重试 `MAX_ATTEMPTS` 次，第 3 次
 * 还是失败就永久放弃、不会再自动重试。2026-09-28 发现 CTS 卡了 39 天：8/20 后
 * 没有一条评论公开回复成功过，7 条评论卡在 `failed`——而现成的「Meta 钥匙健康
 * 检查」（meta-token-health-items.ts）故意只查「钥匙死没死」，不查权限范围，
 * 钥匙没死就不报警，这类「钥匙活着但缺 pages_manage_engagement 权限」的情况
 * 完全没人看见，是 PM 自己想起来才发现的。
 *
 * 这条不猜根因（限流 / 缺权限 / Meta 接口变更都可能让 replyToComment 返回
 * null，`error_message` 存的是引擎写死的通用文案，看不出具体原因），只认一个
 * 直接信号：一条评论该有公开回复、系统也真的试了，但连续 `MAX_ATTEMPTS` 次都
 * 没发出去。这样不管以后失败原因是不是还是权限问题，这条待办都不会失效。
 *
 * 两类行都算「该有公开回复但永远不会有」（Codex round 1 复审 P1）：
 *   1. `reply_status='failed' && attempts>=MAX_ATTEMPTS`——送失败，重试也耗尽。
 *   2. `reply_status='dm_sent' && public_reply_id is null`——`processClaimedComment`
 *      的状态判定只要私信发成功就写 `dm_sent`，哪怕公开回复同时失败；`dm_sent`
 *      在 `TERMINAL_OR_INFLIGHT` 里，永远不会再重试公开回复这一半。
 *
 * 闭环（Codex round 1 复审 P1「没有能让这条待办消失的动作」）：FDE 在设置页
 * 「评论审计」列表对某一行点「已读」（PATCH .../comment-engagements action=
 * mark_reviewed）会写 `reviewed_at`，本查询排除已读行——不需要新建任何 UI/API，
 * 复用已有的审核动作就是关闭这条待办的方式。
 *
 * `how` 按令牌来源分支（Codex round 1 复审 P1）：`page-sync-authorization.ts`
 * 的 `evaluate()` 优先用数据库里存的 OAuth 主页令牌（`client_oauth`），Render
 * 环境变量只在没有存量令牌时才会被用到——对 OAuth 客户，改环境变量不会生效，
 * 必须走"重新连接 Meta"。
 *
 * 本文件只读一行 `mark_reviewed` 之外不碰 social_comment_engagements 任何数据。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-item-types'
import { MAX_ATTEMPTS } from '@/lib/social/comment-autoreply-engine'
import { APP_BASE } from './binding-request-items'
import { assessConfiguredPage } from '@/lib/meta/page-sync-authorization'

export type CommentAutoreplyStuckItemKind = 'comment_autoreply_stuck'

interface StuckRow {
  client_id: string
  page_id: string
  comment_created_at: string
}

function daysAgo(iso: string, now: Date): number {
  return Math.floor((now.getTime() - Date.parse(iso)) / 86_400_000)
}

const OAUTH_HOW =
  '这个客户的 Facebook 主页令牌是通过"连接 Meta"存的 OAuth 授权，不是 Render 环境变量——' +
  '去客户设置页找"连接 Meta"（或"重新连接"）按钮，用对这个主页有管理权限的 Facebook 账号重新授权一次，' +
  '同意页上要确认 pages_manage_engagement 权限打开；改 Render 环境变量对这个客户不会生效，别浪费时间改错地方。'

const ENV_VAR_HOW =
  '重新走一遍 Meta 授权换一把新令牌（developers.facebook.com/tools/explorer/），这次生成时权限要勾上 ' +
  'pages_manage_engagement（发评论回复要用，最容易被漏勾）；换好在 Render 后台 crazycontent 服务的 ' +
  'Environment 更新这个客户对应的令牌变量，保存时选带 deploy 的那个选项（别选 Save only）。'

/** 判不出令牌来源（读失败/未核实）就退回默认的环境变量指引——不让一次额外查询失败拖垮整条待办。 */
async function tokenSourceHow(
  supabase: SupabaseClient,
  clientId: string,
  pageId: string,
  env: Record<string, string | undefined>,
): Promise<string> {
  try {
    const assessment = await assessConfiguredPage(supabase, clientId, pageId, env)
    if (assessment.verified && assessment.via === 'client_oauth') return OAUTH_HOW
  } catch {
    // fall through to the default
  }
  return ENV_VAR_HOW
}

async function fetchStuckRows(
  supabase: SupabaseClient,
  activeClientIds: readonly string[],
): Promise<StuckRow[]> {
  const [failed, dmOnly] = await Promise.all([
    supabase
      .from('social_comment_engagements')
      .select('client_id, page_id, comment_created_at')
      .eq('reply_status', 'failed')
      .gte('attempts', MAX_ATTEMPTS)
      .is('reviewed_at', null)
      .in('client_id', activeClientIds),
    supabase
      .from('social_comment_engagements')
      .select('client_id, page_id, comment_created_at')
      .eq('reply_status', 'dm_sent')
      .is('public_reply_id', null)
      .is('reviewed_at', null)
      .in('client_id', activeClientIds),
  ])
  if (failed.error) throw new Error(`social_comment_engagements 读取失败：${failed.error.message}`)
  if (dmOnly.error) throw new Error(`social_comment_engagements 读取失败：${dmOnly.error.message}`)
  return [...(failed.data ?? []), ...(dmOnly.data ?? [])] as StuckRow[]
}

export async function pushCommentAutoreplyStuckItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
  nameOf: (id: string) => string,
  activeClientIds: readonly string[],
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  if (activeClientIds.length === 0) return

  const rows = await fetchStuckRows(supabase, activeClientIds)

  const byClient = new Map<string, { count: number; oldest: string; pageId: string }>()
  for (const row of rows) {
    const cur = byClient.get(row.client_id)
    if (!cur) {
      byClient.set(row.client_id, { count: 1, oldest: row.comment_created_at, pageId: row.page_id })
    } else {
      cur.count += 1
      if (row.comment_created_at < cur.oldest) cur.oldest = row.comment_created_at
    }
  }

  for (const [clientId, agg] of Array.from(byClient.entries())) {
    const days = daysAgo(agg.oldest, now)
    const how = await tokenSourceHow(supabase, clientId, agg.pageId, env)
    items.push({
      kind: 'comment_autoreply_stuck',
      client_id: clientId,
      client_name: nameOf(clientId),
      what:
        `${agg.count} 条粉丝评论该有公开回复但永远不会有了（连续失败 ${MAX_ATTEMPTS} 次后系统放弃重试），` +
        `最早一条已经卡了 ${days} 天。具体原因系统存的是引擎写死的通用文案，看不出是哪一种——常见是 Facebook Page ` +
        '令牌缺了发评论回复需要的权限，也可能是限流或 Meta 接口的其他问题，需要人工核实。',
      how:
        '先打开客户设置页的"评论审计"列表核对这几条评论的内容（默认只显示最近 25 条、不分状态，卡住的评论如果是旧的可能要往前翻）；' +
        '手动去 Facebook 主页把这几条回复掉（系统不会补发）；' +
        `${how} ` +
        '确认修好、回复完之后，回到"评论审计"列表给这几条点"已读"，这条待办会自动消失，不会一直卡在这里重复出现。',
      href: `${APP_BASE}/dashboard/clients/${clientId}/settings`,
    })
  }
}
