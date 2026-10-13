/**
 * 外部平台授权断线 → 今日待办。
 *
 * 2026-09-24 复盘 CTS 邮箱断 9 天（根因见 `platform-oauth/connection-health.ts`
 * 头注）之后补的那条管道。铁律 3 下半句：确实只有人能做的事（重新走一次授权
 * 同意页，只有邮箱本人 / 客户老板能点），**必须下发成人工任务并进同一个管道**，
 * 不许只躺在 `platform_oauth_connections.error_message` 里 —— 那正是这次事故
 * 「发现死在日志里」的形态。
 *
 * 判据全在 `connection-health.ts` 的纯函数里，这里只负责取数和翻译成人话。
 *
 * ## 三条没得商量的纪律（都是复审当场抓出来的）
 *
 * 1. **没有自助重连入口的平台，不许进 PM 的动手栏。** 给 PM 一件产品里根本
 *    没有按钮的活，比不报还糟 —— 他会点进去、找不到、问一遍，然后下次不再信
 *    这份清单。实测：设置页里没有 Facebook / TikTok / GTM 面板，Facebook 的
 *    重连入口在客户页的设置抽屉 `?settings=platform`（跟 page-binding-items
 *    用的是同一个网址）。
 * 2. **读出来是空的，绝不能长得跟"一切正常"一样。** PostgREST 在权限被收掉时
 *    返回的是**零行、不报错**。生产已知有十几条连接，读回零条只可能是查询被挡
 *    了 —— 必须当场喊一声（`feedback-monitoring-writer-silent-failure-inverts-
 *    health-check`）。
 * 3. **给 PM 的文案里不许出现 `**` 这类记号。** 待办邮件是按纯文本转义渲染的
 *    （`daily-todo.ts` 的 `esc()`），写了星号就原样显示成星号。
 *
 * ## 为什么不按 `client_status = 'active'` 过滤
 *
 * 其它待办模块用 `loadActiveClients()`（只要签约客户）。这条不行：NAL 目前
 * 还是 `prospect`，但它的邮箱**正在**往 CRM 里进真实询价，断了照样丢客人。
 * 连接本身就是「这条管道活着」的证据，跟销售阶段无关。只排除 `archived`。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  assessConnections,
  HEARTBEAT_POLICY,
  type ConnectionFinding,
  type ConnectionHealthRow,
} from '@/lib/platform-oauth/connection-health'
import { isPlatformProvider } from '@/lib/platform-oauth/vocabulary'
import { fetchAll } from '@/lib/supabase-paginate'
import type { ManualItem } from './manual-item-types'

export type PlatformConnectionItemKind =
  /** 平台明说这条授权断了（状态位不是 active）—— 只有人能重新点一次同意 */
  | 'platform_connection_broken'
  /** 长期令牌到期了，状态位还是绿的（Meta / TikTok 没有自动续期） */
  | 'platform_connection_token_expired'
  /** 状态是绿的，但已经很久没真的跟对方通上话了 —— 状态位会骗人，心跳不会 */
  | 'platform_connection_silent'
  /** 当初同意的权限比现在系统要的少，下一次续期就会整个断掉（事故发生前的信号） */
  | 'platform_connection_scope_gap'
  /** 这个平台所有客户一起没了心跳 = 取数任务停了，不是谁要去重连（dev 车道） */
  | 'platform_connection_pipeline_down'
  /** 授权连上了但客户不在取数名单里：数据从来没取过，重连也解决不了（dev 车道） */
  | 'platform_connection_not_enrolled'
  /** 这条断了，但产品里根本没有让 PM 自助重连的入口（dev 车道） */
  | 'platform_connection_no_reconnect_ui'
  /** 连接还在、对应的客户却查不到了（dev 车道） */
  | 'platform_connection_orphan'
  /** 这项检查自己读不出来了 —— 不报 ≠ 没事（dev 车道） */
  | 'platform_connection_check_failed'

/** 这几种 PM 做不了，只能转给 dev。要跟 `five-kinds.ts` 的 LANE_OF_KIND 对得上（有测试钉着）。 */
export const DEV_LANE_CONNECTION_KINDS: PlatformConnectionItemKind[] = [
  'platform_connection_pipeline_down',
  'platform_connection_not_enrolled',
  'platform_connection_no_reconnect_ui',
  'platform_connection_orphan',
  'platform_connection_check_failed',
]

const APP_BASE = 'https://app.magicengine.com.au'

/**
 * 平台在 PM 眼里叫什么、断了损失什么、怎么重连、重连入口在哪。
 *
 * 🔴 `reconnect` 为 `null` = **产品里没有自助入口**，这条一律走 dev 车道。
 *    实测 2026-09-24：设置页只有 Google（商家页/搜索/访问数据）和客户邮箱两块
 *    面板；Facebook 在客户页的设置抽屉里；TikTok / 谷歌广告 / GTM 一个面板都没有
 *    （谷歌广告走的是平台共享授权，本来就不按客户连）。
 */
interface ProviderCopy {
  label: string
  cost: string
  reconnect: { how: string; href: (clientId: string) => string } | null
}

const settingsPage = (clientId: string) => `${APP_BASE}/dashboard/clients/${clientId}/settings`
/** Facebook 面板只挂在客户页的设置抽屉里，/settings 路由下没有它。 */
const platformDrawer = (clientId: string) =>
  `${APP_BASE}/dashboard/clients/${encodeURIComponent(clientId)}?settings=platform`

const GOOGLE_RECONNECT = {
  how:
    '打开这个客户的设置页 → 点 Google 那个连接按钮重新授权一次，' +
    '要用能管这家客户谷歌账号的那个账号登录（通常是客户老板的，不是你自己的）。' +
    '一次点完覆盖搜索数据 + 网站访问数据 + 商家页',
  href: settingsPage,
}

const PROVIDER_COPY: Record<string, ProviderCopy> = {
  microsoft_mail: {
    label: '客户邮箱',
    cost: '客人发到这个邮箱的信不会再进客户管理系统，销售那边看不到新询价，也不会有任何报错',
    reconnect: {
      how:
        '打开这个客户的设置页 → 找到「客户邮箱」那一块 → 把邮箱地址填进去、点「连接这个邮箱」，' +
        '要用平时收这个邮箱的本人的账号登录，不是你自己的。' +
        '如果点了跳出「需要管理员批准」，先让对方公司管 Microsoft 365 的那位点一下页面上' +
        '「卡住了？」里的管理员链接批一次 —— 批完还要本人再连一次才算连上',
      href: settingsPage,
    },
  },
  google_gsc: {
    label: '谷歌搜索数据',
    cost: '这个客户的排名和点击数据停在旧的一天，SEO 周报、巡逻和收录检查都会拿着过期的数字下结论',
    reconnect: GOOGLE_RECONNECT,
  },
  google_ga4: {
    label: '网站访问数据',
    cost: '网站有多少人来、从哪来都停更了，月报和广告效果对比会用旧数',
    reconnect: GOOGLE_RECONNECT,
  },
  google_gbp: {
    label: '谷歌商家页',
    cost: '商家页的新评价收不回来，排好的帖子也发不出去',
    reconnect: {
      how:
        '打开这个客户的设置页 → 点 Google 那个连接按钮重新授权一次，' +
        '要用能管理这家客户商家页的那个账号登录',
      href: settingsPage,
    },
  },
  meta: {
    label: 'Facebook / Instagram',
    cost: '这个客户的私信、留资和帖子数据都进不来，广告那边也读不到成绩',
    reconnect: {
      how:
        '打开这个客户的页面（链接直接开在「平台连接」那一栏）→ 在 Facebook 主页那一块重新连一次，' +
        '要用能管理这个客户主页的账号登录，不是你自己的个人号。' +
        '注意入口在客户页的侧边抽屉里，不在「设置」那一页',
      href: platformDrawer,
    },
  },
  google_ads: {
    label: '谷歌广告',
    cost: '这个客户的谷歌广告花了多少、带来什么都取不回来',
    reconnect: null,
  },
  google_gtm: {
    label: '谷歌代码管理器',
    cost: '网站上的追踪代码改不动了',
    reconnect: null,
  },
  tiktok: {
    label: 'TikTok',
    cost: '这个客户的 TikTok 数据进不来，也发不出去',
    reconnect: null,
  },
  whatsapp: {
    label: 'WhatsApp',
    cost: '这个号码的客人消息进不来，也回不了',
    reconnect: null,
  },
}

function copyOf(provider: string): ProviderCopy {
  return (
    PROVIDER_COPY[provider] ?? {
      label: provider,
      cost: '这条通道的数据进不来',
      reconnect: null,
    }
  )
}

/** 「多久」说成人话：算不出来就如实说算不出来，绝不当成 0。 */
export function humanDuration(hours: number | null): string {
  if (hours === null || !Number.isFinite(hours)) return '具体多久算不出来'
  if (hours < 1) return '不到 1 小时'
  if (hours < 48) return `${Math.floor(hours)} 小时`
  return `${Math.floor(hours / 24)} 天`
}

/** 权限清单说成人话 —— 完整的 scope 网址对 PM 没有任何意义，末段才有。 */
function scopeTail(scope: string): string {
  return scope.split('/').pop() ?? scope
}

function devLaneItem(
  kind: PlatformConnectionItemKind,
  what: string,
  how: string,
): ManualItem {
  return {
    kind,
    client_id: 'infra',
    client_name: 'Magic Engine 后台',
    what,
    how,
    // 🔴 空 href，照抄 ai_alerting_broken：dev 车道这几条的入口在 Render / 代码里，
    //    给一个会被链接闸真 fetch 的外部网址，只要那天返非 2xx 整条就被静默丢掉
    //    （`dropBrokenLinks`），而这几条恰恰是「监控自己出问题了」。
    href: '',
  }
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
      items.push(
        devLaneItem(
          'platform_connection_pipeline_down',
          `「${copy.label}」这条通道全部客户一起没动静了（${names}），` +
            `都超过 ${humanDuration(finding.staleHours)} 没跟对方通上话 —— ` +
            '全部一起停，说明多半不是谁的授权断了，而是我们这边取数的那个自动任务停了',
          '这条不用你动手 —— 一起停不是客户的问题，重连一百次也不会好。' +
            '回我一句「查一下这条通道」我去看是哪个自动任务停了',
        ),
      )
      continue
    }

    const row = finding.row
    const copy = copyOf(row.provider)
    const clientName = nameOf(row.client_id) ?? row.display_name ?? row.account_id
    const who = row.display_name ?? row.account_id

    if (finding.kind === 'not_enrolled') {
      items.push(
        devLaneItem(
          'platform_connection_not_enrolled',
          `${clientName} 的「${copy.label}」授权是连上了，但这个客户不在取数名单里 —— ` +
            `系统从来没去取过这条通道的数据，${copy.cost}。` +
            '后台看上去是「已连接」，所以这件事从外面完全看不出来',
          '这条不用你动手，重连也没用 —— 缺的不是授权，是我们这边还差一项配置' +
            '（比如没填客户的网站地址 / 数据编号）。回我一句「这个客户没接上取数」我去补',
        ),
      )
      continue
    }

    // 没有自助重连入口的平台：不管是哪种坏法，都只能转给 dev。
    if (!copy.reconnect) {
      items.push(
        devLaneItem(
          'platform_connection_no_reconnect_ui',
          `${clientName} 的「${copy.label}」（${who}）连不上了，` +
            `而后台里还没有让你自己重连的按钮 —— ${copy.cost}`,
          '这条不用你动手 —— 这个平台的重连入口还没做。回我一句「接一下这个平台的重连」我去接',
        ),
      )
      continue
    }

    const href = copy.reconnect.href(row.client_id)
    const how = copy.reconnect.how

    if (finding.kind === 'broken') {
      items.push({
        kind: 'platform_connection_broken',
        client_id: row.client_id,
        client_name: clientName,
        what:
          `${copy.label}（${who}）的授权已经断了 ${humanDuration(finding.sinceHours)}——` +
          `${copy.cost}。断了之后系统会直接跳过它，什么都不会报`,
        how,
        href,
      })
      continue
    }

    if (finding.kind === 'token_expired') {
      items.push({
        kind: 'platform_connection_token_expired',
        client_id: row.client_id,
        client_name: clientName,
        what:
          `${copy.label}（${who}）的授权在 ${humanDuration(finding.expiredHours)}前就到期了。` +
          `这个平台的授权不会自动续期，到期就是真的断了 —— ${copy.cost}。` +
          '后台显示的还是「已连接」，所以从外面看不出来',
        how,
        href,
      })
      continue
    }

    if (finding.kind === 'silent') {
      const extra = finding.cohortFresh
        ? '（同一个平台别的客户今天都通上了，所以问题出在这一个上）'
        : '（这个平台今天没有别的客户可以对照，所以也可能是我们这边取数的自动任务停了 —— 你重连一次还是报，回我一句我去查）'
      items.push({
        kind: 'platform_connection_silent',
        client_id: row.client_id,
        client_name: clientName,
        what:
          `${copy.label}（${who}）后台显示「已连接」，但超过 ` +
          `${humanDuration(finding.staleHours)}没真的跟对方通上话了${extra}—— ${copy.cost}`,
        how,
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
        '现在还在正常工作，但下一次自动续期就会整个断掉，断了以后' +
        `${copy.cost}`,
      how: `趁现在还没断，先重连一次就能避免：${how}`,
      href,
    })
  }

  return items
}

/**
 * 「这个客户在不在这条通道的取数名单里」—— 只有名单存在的平台需要这一步。
 *
 * 谷歌那条每日取数任务（`google-data-pullback-daily`）的客户名单**不是**从
 * `platform_oauth_connections` 取的，而是 `client_connectors` 里 `status =
 * 'connected'` 且配置里填了网址 / 数据编号的那些。2026-09-24 实测 NAL 的
 * 搜索数据连接就卡在这儿：授权是活的、`client_connectors` 是 `partial`、
 * 没有 site_url —— 令牌永远不会被刷，心跳永远不动。按「断线」报就是每天给 PM
 * 派一件重连也没用的活。
 */
const ENROLMENT_ANCHOR: Record<string, string> = {
  google_gsc: 'gsc',
  google_ga4: 'ga4',
}

const ENROLMENT_CONFIG_KEY: Record<string, string> = { gsc: 'site_url', ga4: 'property_id' }

async function loadPipelineEnrolment(supabase: SupabaseClient): Promise<Set<string>> {
  const rows = await fetchAll<{
    client_id: string
    anchor: string
    config: Record<string, unknown> | null
  }>((from, to) =>
    supabase
      .from('client_connectors')
      .select('client_id, anchor, config')
      .in('anchor', Object.values(ENROLMENT_ANCHOR))
      .eq('status', 'connected')
      .order('client_id', { ascending: true })
      .range(from, to),
  )
  const out = new Set<string>()
  for (const r of rows) {
    // 名单在、但配置缺关键那一项，任务同样会跳过它 —— 跟不在名单里是同一个后果。
    const key = ENROLMENT_CONFIG_KEY[r.anchor]
    const value = key ? (r.config ?? {})[key] : undefined
    if (typeof value === 'string' && value.length > 0) out.add(`${r.client_id}:${r.anchor}`)
  }
  return out
}

/**
 * 取数 + 判定 + 下发。
 *
 * 🔴 读不出来、或者读出来是空的，都必须自己喊一声。监控读不到数据反而让体检
 * 报绿，是 `feedback-monitoring-writer-silent-failure-inverts-health-check`
 * 那条教训 —— 不报 ≠ 没事。PostgREST 在权限被收掉时返回的是**零行、不报错**，
 * 所以「读到零条连接」必须当成故障，不能当成「今天一切正常」。
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
        .select(
          'id, client_id, provider, account_id, display_name, status, scopes, last_synced_at, token_expiry, created_at, updated_at',
        )
        // 🔴 只看客户日常通道。`meta_ads_read` 是 Meta 只读试点自己的一条线，
        //    有独立的授权 / 撤回 / revision 生命周期（见 meta/ai/manage.ts），
        //    取令牌的路径也全都 `.eq('purpose','legacy')` —— 混进来会给 PM 发
        //    根本不归他管的活。
        .eq('purpose', 'legacy')
        // 排序要唯一，否则翻页会重复或漏行（见 client-roster.ts 同一条注释）
        .order('id', { ascending: true })
        .range(from, to),
    )

    // 生产里一直有十几条连接。读回零条只可能是查询被权限挡了 —— 零行不报错
    // 正是 PostgREST 的行为，也是这套监控最容易自己瞎掉的方式。
    if (connections.length === 0) {
      items.push(
        devLaneItem(
          'platform_connection_check_failed',
          '今天一条外部平台授权都没读到 —— 生产里一直有十几条，读回零条几乎只可能是' +
            '查询被权限挡了（这种情况数据库不会报错，只会给零行）。' +
            '所以今天这份清单里没有这项检查的结果，不报警不等于没断',
          '这条不用你动手 —— 是我们这边读取被挡了。回我一句「修一下授权体检」我去修',
        ),
      )
      return
    }

    const clientRows = await fetchAll<{ id: string; name: string; client_status: string }>(
      (from, to) =>
        supabase
          .from('clients')
          .select('id, name, client_status')
          .order('id', { ascending: true })
          .range(from, to),
    )
    // 已归档的客户不再每天来烦人。
    const liveClients = new Map(
      clientRows.filter((c) => c.client_status !== 'archived').map((c) => [c.id, c.name]),
    )
    if (liveClients.size === 0) {
      items.push(
        devLaneItem(
          'platform_connection_check_failed',
          `读到了 ${connections.length} 条外部平台授权，却一个在用的客户都没读到 —— ` +
            '客户表这一步被挡住了（零行不报错）。这项检查今天等于没跑',
          '这条不用你动手 —— 是我们这边读客户表被挡了。回我一句「修一下授权体检」我去修',
        ),
      )
      return
    }

    // 客户表里查不到的连接（删了客户但没断连接）—— 不能无声丢掉：
    // 它可能还在真的收邮件，是一条活着却没人看的管道。
    const orphans = connections.filter((c) => !liveClients.has(c.client_id))
    if (orphans.length > 0) {
      items.push(
        devLaneItem(
          'platform_connection_orphan',
          `有 ${orphans.length} 条外部平台授权挂在查不到的客户名下（客户被删或已归档，连接没断）。` +
            '它们可能还在真的收数据，但不会出现在任何一份按客户看的清单里',
          '这条不用你动手 —— 回我一句「清一下没主的连接」我去核对该断还是该改挂',
        ),
      )
    }

    const enrolled = await loadPipelineEnrolment(supabase)
    const unknownProviders = new Set<string>()
    rows = connections
      .filter((c) => liveClients.has(c.client_id))
      .map((c) => {
        if (!isPlatformProvider(c.provider) || !HEARTBEAT_POLICY[c.provider]) {
          unknownProviders.add(c.provider)
        }
        const anchor = ENROLMENT_ANCHOR[c.provider]
        return anchor === undefined
          ? c
          : { ...c, pipelineEnrolled: enrolled.has(`${c.client_id}:${anchor}`) }
      })

    // 判据表里没有的平台 = 那个平台悄悄地没有监控。这正是本文件要防的事，
    // 必须响一声，不能靠 `??` 兜底静默降级。
    if (unknownProviders.size > 0) {
      items.push(
        devLaneItem(
          'platform_connection_check_failed',
          `库里有我们判据表没登记的平台（${Array.from(unknownProviders).join('、')}）—— ` +
            '这几个平台现在只有「状态位说断了」这一条判据，没有断线心跳，等于半瞎',
          '这条不用你动手 —— 回我一句「补一下新平台的判据」我去登记',
        ),
      )
    }

    nameOf = (id) => liveClients.get(id)
  } catch (e) {
    items.push(
      devLaneItem(
        'platform_connection_check_failed',
        `今天没查成「各个平台的授权还连着没有」（${(e instanceof Error ? e.message : String(e)).slice(0, 160)}）` +
          '—— 今天这份清单里没有这项检查的结果，不报警不等于没断',
        '这条不用你动手 —— 是我们这边读取失败了。回我一句「修一下授权体检」我去修',
      ),
    )
    return
  }

  items.push(...buildPlatformConnectionItems(assessConnections(rows, now), nameOf))
}
