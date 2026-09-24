/**
 * 外部平台授权断线 → 今日待办「🙋 需要你动手」。
 *
 * 2026-09-24 复盘 CTS 邮箱断 9 天（根因见 `platform-oauth/connection-health.ts`
 * 头注）之后补的那条管道。铁律 3 下半句：确实只有人能做的事（重新走一次授权
 * 同意页，只有邮箱本人 / 客户老板能点），**必须下发成人工任务并进同一个管道**，
 * 不许只留在 `platform_oauth_connections.error_message` 里 —— 那正是这次事故
 * 「发现死在日志里」的形态。
 *
 * 判据全在 `connection-health.ts` 的纯函数里，这里只负责取数和翻译成人话。
 *
 * ## 为什么不按 `client_status = 'active'` 过滤
 *
 * 其它待办模块用 `loadActiveClients()`（只要签约客户）。这条不行：NAL 目前
 * 还是 `prospect`，但它的邮箱**正在**往 CRM 里进真实询价，断了照样丢客人。
 * 连接本身就是「这条管道活着」的证据，跟销售阶段无关。只排除 `archived`
 * （已归档的客户不该每天来烦人）。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  assessConnections,
  type ConnectionFinding,
  type ConnectionHealthRow,
} from '@/lib/platform-oauth/connection-health'
import { fetchAll } from '@/lib/supabase-paginate'
import type { ManualItem } from './manual-item-types'

export type PlatformConnectionItemKind =
  /** 平台明说这条授权断了（状态位不是 active）—— 只有人能重新点一次同意 */
  | 'platform_connection_broken'
  /** 状态是绿的，但已经很久没真的跟对方通上话了 —— 状态位会骗人，心跳不会 */
  | 'platform_connection_silent'
  /** 当初同意的权限比现在系统要的少，下一次续期就会整个断掉（事故发生**前**的信号） */
  | 'platform_connection_scope_gap'
  /** 这个平台所有客户一起没了心跳 = 取数任务停了，不是谁要去重连（dev 车道） */
  | 'platform_connection_pipeline_down'
  /** 这项检查自己读不出来了 —— 不报 ≠ 没事（dev 车道） */
  | 'platform_connection_check_failed'

const SETTINGS_BASE = 'https://app.magicengine.com.au/dashboard/clients'
const RENDER_DASHBOARD_URL = 'https://dashboard.render.com'

/**
 * 平台在 PM 眼里叫什么、断了会损失什么、怎么重连。
 *
 * 三件事写死在一起，是为了让 `what/how` 永远配套 —— 铁律 3 的三件套里
 * 「how 要具体到点哪里」，分开维护迟早对不上。
 */
interface ProviderCopy {
  /** PM 认得的说法，不用平台内部代号 */
  label: string
  /** 断了之后客户侧实际损失什么 */
  cost: string
  /** 重新授权具体怎么走 —— 要让人不用问第二遍 */
  reconnect: string
}

const PROVIDER_COPY: Record<string, ProviderCopy> = {
  microsoft_mail: {
    label: '客户邮箱',
    cost: '客人发到这个邮箱的信不会再进客户管理系统，销售那边看不到新询价，也不会有任何报错',
    reconnect:
      '打开这个客户的设置页 → 找到「客户邮箱」那一块 → 点「连接这个邮箱」，' +
      '要用**平时收这个邮箱的本人**的账号登录（不是你自己的）。' +
      '如果点了跳出「需要管理员批准」，先让对方公司管 Microsoft 365 的那位点一下页面上' +
      '「卡住了？」里的管理员链接批一次，**批完还要本人再连一次**才算连上',
  },
  google_gsc: {
    label: '谷歌搜索数据',
    cost: '这个客户的排名和点击数据停在旧的一天，SEO 周报、巡逻和收录检查都会拿着过期的数字下结论',
    reconnect:
      '打开这个客户的设置页 → 点 Google 那个连接按钮重新授权一次，' +
      '要用能管这家客户谷歌账号的那个账号登录（通常是客户老板的，不是你自己的）。' +
      '一次点完覆盖搜索数据 + 网站访问数据 + 商家页',
  },
  google_ga4: {
    label: '网站访问数据',
    cost: '网站有多少人来、从哪来都停更了，月报和广告效果对比会用旧数',
    reconnect:
      '打开这个客户的设置页 → 点 Google 那个连接按钮重新授权一次，' +
      '要用能管这家客户谷歌账号的那个账号登录。一次点完覆盖搜索数据 + 网站访问数据 + 商家页',
  },
  google_gbp: {
    label: '谷歌商家页',
    cost: '商家页的新评价收不回来，排好的帖子也发不出去',
    reconnect:
      '打开这个客户的设置页 → 点 Google 那个连接按钮重新授权一次，' +
      '要用**能管理这家客户商家页**的那个账号登录',
  },
  google_ads: {
    label: '谷歌广告',
    cost: '这个客户的谷歌广告花了多少、带来什么都取不回来',
    reconnect: '打开这个客户的设置页 → 重新连一次谷歌广告账户',
  },
  google_gtm: {
    label: '谷歌代码管理器',
    cost: '网站上的追踪代码改不动了',
    reconnect: '打开这个客户的设置页 → 重新连一次',
  },
  meta: {
    label: 'Facebook / Instagram',
    cost: '这个客户的私信、留资和帖子数据都进不来，广告那边也读不到成绩',
    reconnect:
      '打开这个客户的设置页 → 重新连一次 Facebook，' +
      '要用**能管理这个客户主页**的账号登录（不是你自己的个人号）',
  },
  tiktok: {
    label: 'TikTok',
    cost: '这个客户的 TikTok 数据进不来',
    reconnect: '打开这个客户的设置页 → 重新连一次 TikTok',
  },
}

function copyOf(provider: string): ProviderCopy {
  return (
    PROVIDER_COPY[provider] ?? {
      label: provider,
      cost: '这条通道的数据进不来',
      reconnect: '打开这个客户的设置页，重新授权一次',
    }
  )
}

/** 「多久」说成人话：不到一天说小时，一天以上说天。 */
export function humanDuration(hours: number): string {
  if (hours < 1) return '不到 1 小时'
  if (hours < 48) return `${Math.floor(hours)} 小时`
  return `${Math.floor(hours / 24)} 天`
}

/** 权限清单说成人话 —— 完整的 scope 网址对 PM 没有任何意义，末段才有。 */
function scopeTail(scope: string): string {
  const tail = scope.split('/').pop() ?? scope
  return tail
}

/**
 * 把发现翻译成待办。**纯函数**，方便直接单测（不需要 supabase）。
 *
 * `nameOf` 取不到名字时退回连接自己的显示名 —— 宁可显示邮箱地址，
 * 也不能因为客户表没读到就把这条丢掉。
 */
export function buildPlatformConnectionItems(
  findings: ConnectionFinding[],
  nameOf: (clientId: string) => string | undefined,
): ManualItem[] {
  const items: ManualItem[] = []

  for (const finding of findings) {
    if (finding.kind === 'pipeline_down') {
      const copy = copyOf(finding.provider)
      const names = finding.rows
        .map((r) => nameOf(r.client_id) ?? r.display_name ?? r.account_id)
        .join('、')
      items.push({
        kind: 'platform_connection_pipeline_down',
        client_id: 'infra',
        client_name: 'Magic Engine 后台',
        what:
          `「${copy.label}」这条通道**全部客户**一起没动静了（${names}），` +
          `都超过 ${humanDuration(finding.staleHours)} 没跟对方通上话 —— ` +
          '全部一起停，说明多半不是谁的授权断了，而是我们这边取数的那个自动任务停了',
        how:
          '这条不用你动手 —— 一起停不是客户的问题，重连一百次也不会好。' +
          '回我一句「查一下这条通道」我去看是哪个自动任务停了',
        href: RENDER_DASHBOARD_URL,
      })
      continue
    }

    const row = finding.row
    const copy = copyOf(row.provider)
    const clientName = nameOf(row.client_id) ?? row.display_name ?? row.account_id
    const who = row.display_name ?? row.account_id
    const href = `${SETTINGS_BASE}/${row.client_id}/settings`

    if (finding.kind === 'broken') {
      items.push({
        kind: 'platform_connection_broken',
        client_id: row.client_id,
        client_name: clientName,
        what:
          `${copy.label}（${who}）的授权已经断了 ${humanDuration(finding.sinceHours)}——` +
          `${copy.cost}。断了之后系统会直接跳过它，什么都不会报`,
        how: copy.reconnect,
        href,
      })
      continue
    }

    if (finding.kind === 'silent') {
      const extra = finding.soleConnection
        ? '（这个平台目前只连了这一个，所以也可能是我们这边取数的自动任务停了 —— 你重连一次还是报，回我一句我去查）'
        : '（同一个平台别的客户今天都通上了，所以问题出在这一个的授权上）'
      items.push({
        kind: 'platform_connection_silent',
        client_id: row.client_id,
        client_name: clientName,
        what:
          `${copy.label}（${who}）后台显示「已连接」，但超过 ` +
          `${humanDuration(finding.staleHours)}没真的跟对方通上话了${extra}—— ${copy.cost}`,
        how: copy.reconnect,
        href,
      })
      continue
    }

    // scope_gap
    items.push({
      kind: 'platform_connection_scope_gap',
      client_id: row.client_id,
      client_name: clientName,
      what:
        `${copy.label}（${who}）当初同意的权限比现在系统要的少了 ${finding.missing.length} 项` +
        `（${finding.missing.map(scopeTail).join('、')}）。` +
        '现在还在正常工作，但**下一次自动续期就会整个断掉**，断了以后' +
        `${copy.cost}`,
      how: `趁现在还没断，先重连一次就能避免：${copy.reconnect}`,
      href,
    })
  }

  return items
}

/**
 * 取数 + 判定 + 下发。
 *
 * 🔴 读不出来必须自己喊一声。监控写不进去 / 读不出来反而让体检报绿，是
 * `feedback-monitoring-writer-silent-failure-inverts-health-check` 那条教训 ——
 * 不报 ≠ 没事。
 */
export async function pushPlatformConnectionItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
): Promise<void> {
  let rows: ConnectionHealthRow[]
  let nameOf: (clientId: string) => string | undefined

  try {
    const connections = await fetchAll<ConnectionHealthRow>((from, to) =>
      supabase
        .from('platform_oauth_connections')
        .select('id, client_id, provider, account_id, display_name, status, scopes, last_synced_at, created_at, updated_at')
        // 排序要唯一，否则翻页会重复或漏行（见 client-roster.ts 同一条注释）
        .order('id', { ascending: true })
        .range(from, to),
    )
    const clientRows = await fetchAll<{ id: string; name: string; client_status: string }>(
      (from, to) =>
        supabase
          .from('clients')
          .select('id, name, client_status')
          .order('id', { ascending: true })
          .range(from, to),
    )
    // 已归档的客户不再每天来烦人；客户表里查不到的连接（删了客户没删连接）
    // 同样跳过 —— 没人能对一个不存在的客户点重连。
    const liveClients = new Map(
      clientRows.filter((c) => c.client_status !== 'archived').map((c) => [c.id, c.name]),
    )
    rows = connections.filter((c) => liveClients.has(c.client_id))
    nameOf = (id) => liveClients.get(id)
  } catch (e) {
    items.push({
      kind: 'platform_connection_check_failed',
      client_id: 'infra',
      client_name: 'Magic Engine 后台',
      what:
        `今天没查成「各个平台的授权还连着没有」（${(e instanceof Error ? e.message : String(e)).slice(0, 160)}）` +
        '—— 今天这份清单里没有这项检查的结果，不报警不等于没断',
      how: '这条不用你动手 —— 是我们这边读取失败了。回我一句「修一下授权体检」我去修',
      href: RENDER_DASHBOARD_URL,
    })
    return
  }

  items.push(...buildPlatformConnectionItems(assessConnections(rows, now), nameOf))
}
