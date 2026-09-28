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
 * 三类行都算「系统不会再自动处理」，但确定性不同（Codex round 1/2 复审 P1，
 * round 8 复审 P1 修正确定性表述）：
 *   1. `reply_status='failed' && attempts>=MAX_ATTEMPTS`——分类已经完成、分类
 *      结果允许回复、也真的试着发了，只是发送本身失败、重试也耗尽——**确定**
 *      该有公开回复。
 *   2. `reply_status='dm_sent' && public_reply_id is null`——`processClaimedComment`
 *      的状态判定只要私信发成功就写 `dm_sent`，哪怕公开回复同时失败；`dm_sent`
 *      在 `TERMINAL_OR_INFLIGHT` 里，永远不会再重试公开回复这一半——同样**确定**
 *      该有公开回复（这一半没发出去）。
 *   3. `reply_status='processing'` 且卡住超过 `STALE_PROCESSING_MS`——`claimComment`
 *      先把行改成 `processing` 再调 `processClaimedComment`；如果这中间那次调用
 *      抛错/整个 cron 调用超时，行会永远停在 `processing`（`filterProcessable`
 *      只接纳"没有行"或"`failed` 且 attempts 未耗尽"两种，`processing` 两种都不是），
 *      既不会被重试，也不会被判定为失败——静默失踪，比 `failed` 更隐蔽。
 *      `STALE_PROCESSING_MS` 给了一个远超单次处理耗时的宽限期，避免把正在跑的
 *      同一轮 cron 误判成卡死。**这一类不确定**——中断可能发生在
 *      `classifyComment` 完成之前，这时连分类结果都没有，不能断言"该回复"：
 *      也可能本该判成垃圾隐藏、或者该分类本来就关闭自动回复。`what`/`how` 把
 *      这一类跟前两类分开描述，不对它断言"该回复"（Codex round 8 复审 P1：
 *      原版本三类一起说"该有公开回复"，会让 FDE 对垃圾评论或本该跳过的评论
 *      也去手动公开回复）。
 *
 * 闭环（Codex round 1 复审 P1「没有能让这条待办消失的动作」，round 3 复审 P1
 * 补丁）：FDE 在设置页「评论审计」列表对某一行点「已读」（PATCH
 * .../comment-engagements action=mark_reviewed）会写 `reviewed_at`，本查询
 * 排除已读行。这个按钮原来只在 `needs_human` 的行上出现——大多数卡死评论是
 * 简单夸赞，分类器不会判成需要人工，round 1 的"点已读就能关掉待办"因此对
 * 大多数行其实点不到；已同 PR 把 `CommentAuditList.tsx` 的按钮条件也扩到
 * 卡死状态（见该组件的 `isStuck()`），不需要新建任何新 API，复用同一个动作。
 *
 * `how` 按令牌来源分三档（Codex round 1 + round 3 复审两轮 P1）：
 *   1. `client_oauth`——数据库里存的 OAuth 主页令牌，改 Render 环境变量不会
 *      生效，必须走"重新连接 Meta"（`META_PAGE_SCOPES` 已经带上
 *      `pages_manage_engagement`，重新连一次就能拿到）。
 *   2. `shared_fallback`——`resolveMetaTokenDetailed` 兜底给的公共钥匙
 *      `META_SYSTEM_USER_TOKEN`，不是这个客户专属的变量，改错变量不会影响
 *      实际在用的那把钥匙（round 1 的版本把这档也当成"专属变量"处理，是错的）。
 *   3. 其余——这个客户专属的 env 变量。
 *
 * 三条查询都走 `fetchAll` 分页（Codex round 2 复审 P2）：PostgREST 单次查询硬顶
 * 1000 行、超过静默截断（见 supabase-paginate.ts 头注 2026-07-29 CTS 实测事故），
 * 不分页在这条通道跨全平台客户累计卡住行数变多后会悄悄漏算、漏报某个客户。
 *
 * 本文件只读一行 `mark_reviewed` 之外不碰 social_comment_engagements 任何数据。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-item-types'
import { MAX_ATTEMPTS, STALE_PROCESSING_MS } from '@/lib/social/comment-autoreply-constants'
import { APP_BASE } from './binding-request-items'
import { assessConfiguredPage } from '@/lib/meta/page-sync-authorization'
import { resolveMetaTokenDetailed, domainToEnvKey, pageIdToEnvVar, type ScopedTokenSource } from '@/lib/meta/token-selection'
import { fetchAll } from '@/lib/supabase-paginate'

export { MAX_ATTEMPTS, STALE_PROCESSING_MS } from '@/lib/social/comment-autoreply-constants'

export type CommentAutoreplyStuckItemKind = 'comment_autoreply_stuck'

interface StuckRow {
  client_id: string
  page_id: string
  comment_created_at: string
  /** `processing` = stale-processing (Codex round 8 复审 P1: unlike the other two, this one is NOT confirmed "should reply" — see the module docstring). */
  reply_status: 'failed' | 'dm_sent' | 'processing'
}

function daysAgo(iso: string, now: Date): number {
  return Math.floor((now.getTime() - Date.parse(iso)) / 86_400_000)
}

/**
 * 直接链到能重新起一次 Meta 授权的路由，不描述"去找连接 Meta 按钮"（Codex
 * round 6 复审 P1）：那个按钮长在客户主页详情页的 `FacebookPagePanel`，不在
 * 这条待办 `href` 指向的独立 `/settings` 页；就算找对了地方，它的可见性判据
 * （`reachable && verified && via !== 'legacy_client_token'`）只看"读得到吗"，
 * 读没问题、只是缺发评论回复这一项权限的客户会被判定"同步正常"，两个按钮
 * 都不显示。`tokenSourceGuidance` 把这条路由放进 `href`（今日待办页面只把
 * `href` 渲染成可点按钮，`how` 只是纯文本 `<span>`——Codex round 7 复审 P2：
 * round 6 只把 URL 写进了 `how` 文案里，从来没有真的可点）。
 *
 * `intent=comment_reply`（Codex round 8 复审 P1）：评论引擎实际用的主页是
 * `social_comment_config.fb_page_id`，不一定等于 `clients.facebook_page_id`
 * ——不带这个 intent，回调会把新令牌存去 `clients.facebook_page_id`，评论
 * 引擎真正在用的那个主页令牌还是没换，问题原样复发。
 */
function oauthHow(): string {
  return (
    '这个客户的 Facebook 主页令牌是通过"连接 Meta"存的 OAuth 授权，不是 Render 环境变量——' +
    '点这条待办的按钮直接起一次 Meta 授权（不用在页面上找"连接 Meta"按钮，它在权限只缺一项时可能不会显示），' +
    '用对这个主页有管理权限的 Facebook 账号走完同意页，确认 pages_manage_engagement 权限打开；' +
    '改 Render 环境变量对这个客户不会生效，别浪费时间改错地方。'
  )
}

const SHARED_TOKEN_HOW =
  '这个客户没有专属 Meta 令牌，实际用的是公共钥匙 META_SYSTEM_USER_TOKEN（Render 后台 crazycontent 服务的 Environment 里）——' +
  '这把钥匙同时给好几个客户用，改之前先确认真的要动公共钥匙（改错了会影响其他客户），' +
  '权限要勾上 pages_manage_engagement，保存时选带 deploy 的那个选项。'

/**
 * 指名具体变量（Codex round 10 复审 P1）：`pickScopedMetaToken`
 * （`token-selection.ts`）域名变量优先于主页变量——客户如果同时配了两个键，
 * 泛泛说"这个客户专属的令牌变量"会让人改错那一个（比如按评论主页去改
 * `_PAGE_` 那条，实际生效的其实是域名那条），改完部署评论还是回不出去。
 * `varName` 读不出来（客户行读失败 / 两个键都没配）才退回泛泛的指引。
 */
function envVarHow(varName: string | null): string {
  const varClause = varName
    ? `${varName}（就是这一条，不是别的变量名，改错变量不会生效）`
    : '这个客户专属的令牌变量（具体变量名这次没读出来，去 Render 后台按客户域名 / Facebook 主页 id 找对应那条）'
  return (
    '重新走一遍 Meta 授权换一把新令牌（developers.facebook.com/tools/explorer/），这次生成时权限要勾上 ' +
    'pages_manage_engagement（发评论回复要用，最容易被漏勾）；换好在 Render 后台 crazycontent 服务的 ' +
    `Environment 更新 ${varClause}，保存时选带 deploy 的那个选项（别选 Save only）。`
  )
}

interface TokenSourceGuidance {
  how: string
  href: string
}

/**
 * 判不出令牌来源（读失败/未核实）就退回默认的专属令牌指引——不让一次额外查询
 * 失败拖垮整条待办。
 *
 * 三档而不是两档（Codex round 3 复审 P1）：`assessConfiguredPage` 判定
 * `staff_verified`（非 OAuth）时，实际用的令牌可能是这个客户专属的，也可能是
 * `resolveMetaTokenDetailed` 兜底出的共享 `META_SYSTEM_USER_TOKEN`
 * （`shared_fallback`）——原来无条件当成"这个客户专属变量"，对共享令牌客户
 * 会指错地方，改了一把不存在的"专属变量"根本不影响实际在用的那把钥匙。
 *
 * 返回值带 `href` 而不是只返回文案（Codex round 7 复审 P2）：三档里只有
 * `client_oauth` 需要一条不一样的落地页，其余两档仍然落设置页——href 跟着
 * 令牌来源走，不是固定值。
 */
async function tokenSourceGuidance(
  supabase: SupabaseClient,
  clientId: string,
  pageId: string,
  env: Record<string, string | undefined>,
): Promise<TokenSourceGuidance> {
  const settingsHref = `${APP_BASE}/dashboard/clients/${clientId}/settings`
  try {
    const assessment = await assessConfiguredPage(supabase, clientId, pageId, env)
    if (assessment.verified && assessment.via === 'client_oauth') {
      return { how: oauthHow(), href: `${APP_BASE}/api/auth/facebook/connect?client_id=${clientId}&intent=comment_reply` }
    }
  } catch {
    // fall through — 用下面的令牌来源查询兜底判断
  }
  try {
    const resolved = await resolveMetaTokenDetailed(supabase, clientId, env)
    if (resolved && resolved !== 'ownership_unknown') {
      if (resolved.source === 'shared_fallback') return { how: SHARED_TOKEN_HOW, href: settingsHref }
      const varName = await scopedEnvVarName(supabase, clientId, resolved.source)
      return { how: envVarHow(varName), href: settingsHref }
    }
  } catch {
    // fall through to the default
  }
  return { how: envVarHow(null), href: settingsHref }
}

/** `client_domain`/`client_page` 各自对应的实际变量名（`token-selection.ts` 同一套推导）。 */
async function scopedEnvVarName(
  supabase: SupabaseClient,
  clientId: string,
  source: ScopedTokenSource,
): Promise<string | null> {
  const { data } = await supabase.from('clients').select('domain, facebook_page_id').eq('id', clientId).maybeSingle()
  const row = data as { domain?: string | null; facebook_page_id?: string | null } | null
  if (source === 'client_domain') {
    return row?.domain ? `META_SYSTEM_USER_TOKEN_${domainToEnvKey(row.domain)}` : null
  }
  return row?.facebook_page_id ? pageIdToEnvVar(row.facebook_page_id) : null
}

async function fetchStuckRows(
  supabase: SupabaseClient,
  activeClientIds: readonly string[],
  now: Date,
): Promise<StuckRow[]> {
  const staleBefore = new Date(now.getTime() - STALE_PROCESSING_MS).toISOString()

  const [failed, dmOnly, stuckProcessing] = await Promise.all([
    fetchAll<StuckRow>((from, to) =>
      supabase
        .from('social_comment_engagements')
        .select('client_id, page_id, comment_created_at, reply_status')
        .eq('reply_status', 'failed')
        .gte('attempts', MAX_ATTEMPTS)
        .is('reviewed_at', null)
        .in('client_id', activeClientIds)
        .order('id', { ascending: true })
        .range(from, to),
    ),
    fetchAll<StuckRow>((from, to) =>
      supabase
        .from('social_comment_engagements')
        .select('client_id, page_id, comment_created_at, reply_status')
        .eq('reply_status', 'dm_sent')
        .is('public_reply_id', null)
        .is('reviewed_at', null)
        .in('client_id', activeClientIds)
        .order('id', { ascending: true })
        .range(from, to),
    ),
    fetchAll<StuckRow>((from, to) =>
      supabase
        .from('social_comment_engagements')
        .select('client_id, page_id, comment_created_at, reply_status')
        .eq('reply_status', 'processing')
        .lt('updated_at', staleBefore)
        .is('reviewed_at', null)
        .in('client_id', activeClientIds)
        .order('id', { ascending: true })
        .range(from, to),
    ),
  ])
  return [...failed, ...dmOnly, ...stuckProcessing]
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

  const rows = await fetchStuckRows(supabase, activeClientIds, now)

  const byClient = new Map<string, { count: number; oldest: string; pageId: string; stale: number }>()
  for (const row of rows) {
    const stale = row.reply_status === 'processing' ? 1 : 0
    const cur = byClient.get(row.client_id)
    if (!cur) {
      byClient.set(row.client_id, { count: 1, oldest: row.comment_created_at, pageId: row.page_id, stale })
    } else {
      cur.count += 1
      cur.stale += stale
      if (row.comment_created_at < cur.oldest) cur.oldest = row.comment_created_at
    }
  }

  for (const [clientId, agg] of Array.from(byClient.entries())) {
    const days = daysAgo(agg.oldest, now)
    const guidance = await tokenSourceGuidance(supabase, clientId, agg.pageId, env)
    const confirmed = agg.count - agg.stale

    // 确定该回复的（failed / dm_sent 半失败）跟处理到一半中断、不确定原本该
    // 怎么处理的（processing 卡死）分开描述，不对后者断言"该回复"——中断可能
    // 发生在分类完成之前，那种情况下也可能本该隐藏成垃圾或本来就不回复
    // （Codex round 8 复审 P1）。
    const whatParts: string[] = []
    if (confirmed > 0) {
      whatParts.push(`${confirmed} 条确定该有公开回复但发不出去了（发送重试耗尽 / 私信发了但公开回复没发）`)
    }
    if (agg.stale > 0) {
      whatParts.push(`${agg.stale} 条处理到一半中断，原本该怎么处理还不确定（可能该回复、可能该隐藏成垃圾、也可能本该跳过不回，中断导致分类没能走完）`)
    }

    items.push({
      kind: 'comment_autoreply_stuck',
      client_id: clientId,
      client_name: nameOf(clientId),
      what:
        `${whatParts.join('，另外 ')}，系统都已经不会再自动处理了，最早一条已经卡了 ${days} 天。` +
        '具体原因系统存的是引擎写死的通用文案，看不出细节——常见是 Facebook Page 令牌缺了发评论回复需要的权限，' +
        '也可能是限流或 Meta 接口的其他问题，需要人工核实。',
      how:
        '先打开客户设置页的"评论审计"列表核对这几条评论的内容（卡住的评论不管多旧都会显示，不受"最近 25 条"限制）；' +
        '再去 Facebook 主页对应评论下面看一眼是不是已经有回复了（个别卡住的是系统其实发出去了、只是没能把"发成功"这件事存回数据库，不是真的没回，' +
        '直接补发会变成重复回复客户）——' +
        (confirmed > 0 ? '确定该回复的这些，没有回复的才手动回一下（系统不会补发）；' : '') +
        (agg.stale > 0
          ? '处理到一半中断的这些先自己判断该怎么处理，不要不分青红皂白照单全回——明显是垃圾广告就去 Facebook 手动隐藏，不确定要不要回、或者本来就不该回（比如这类评论客户设置里关了自动回复）就不用勉强回，跳过即可；'
          : '') +
        `${guidance.how} ` +
        '确认处理完之后，回到"评论审计"列表给这几条点"已读"，这条待办会自动消失，不会一直卡在这里重复出现。',
      href: guidance.href,
    })
  }
}
