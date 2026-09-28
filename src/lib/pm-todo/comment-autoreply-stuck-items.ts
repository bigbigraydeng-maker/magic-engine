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
 * null），只认一个直接信号：一条评论该回复、系统也真的试了，但连续
 * `MAX_ATTEMPTS` 次都没发出去。这样不管以后失败原因是不是还是权限问题，
 * 这条待办都不会失效。
 *
 * 本文件只读，不碰 social_comment_engagements 的任何一行。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-item-types'
import { MAX_ATTEMPTS } from '@/lib/social/comment-autoreply-engine'
import { APP_BASE } from './binding-request-items'

export type CommentAutoreplyStuckItemKind = 'comment_autoreply_stuck'

interface StuckRow {
  client_id: string
  comment_created_at: string
}

function daysAgo(iso: string, now: Date): number {
  return Math.floor((now.getTime() - Date.parse(iso)) / 86_400_000)
}

export async function pushCommentAutoreplyStuckItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
  nameOf: (id: string) => string,
  activeClientIds: readonly string[],
): Promise<void> {
  if (activeClientIds.length === 0) return

  const { data, error } = await supabase
    .from('social_comment_engagements')
    .select('client_id, comment_created_at')
    .eq('reply_status', 'failed')
    .gte('attempts', MAX_ATTEMPTS)
    .in('client_id', activeClientIds)
  if (error) throw new Error(`social_comment_engagements 读取失败：${error.message}`)

  const byClient = new Map<string, { count: number; oldest: string }>()
  for (const row of (data ?? []) as StuckRow[]) {
    const cur = byClient.get(row.client_id)
    if (!cur) {
      byClient.set(row.client_id, { count: 1, oldest: row.comment_created_at })
    } else {
      cur.count += 1
      if (row.comment_created_at < cur.oldest) cur.oldest = row.comment_created_at
    }
  }

  for (const [clientId, agg] of Array.from(byClient.entries())) {
    const days = daysAgo(agg.oldest, now)
    items.push({
      kind: 'comment_autoreply_stuck',
      client_id: clientId,
      client_name: nameOf(clientId),
      what:
        `${agg.count} 条粉丝评论（夸奖/提问类）自动回复连续失败 ${MAX_ATTEMPTS} 次后被系统放弃，不会再自动重试，` +
        `最早一条已经卡了 ${days} 天——大概率是 Facebook Page 令牌缺了发评论回复需要的权限，不是普通限流` +
        '（限流不会连续几十天 100% 失败）。',
      how:
        '先手动打开这个客户的 Facebook 主页，把卡住的这几条评论回复掉（系统不会补发，卡住的具体评论见下面链接设置页的「评论审计」列表）；' +
        '再重新走一遍 Meta 授权换一把新令牌，这次生成时权限要勾上 pages_manage_engagement' +
        '（发评论回复要用，最容易被漏勾）；换好在 Render 后台 crazycontent 服务的 Environment 更新这个客户对应的令牌变量，保存时选带 deploy 的那个选项。',
      href: `${APP_BASE}/dashboard/clients/${clientId}/settings`,
    })
  }
}
