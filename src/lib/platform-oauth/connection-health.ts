/**
 * 外部平台授权的**断线判据**（纯函数，不碰数据库）。
 *
 * 2026-09-24 事故复盘：CTS 的 `info@ctstours.co.nz` 邮箱同步断了 **9 天**没人
 * 知道。根因是 2026-09-15 给 `MICROSOFT_MAIL_SCOPES` 加了一项新权限 ——
 * 刷新令牌走的是同一份 scope 清单，微软只会按「当初同意过的那些」发新令牌，
 * 带上没同意过的新权限直接被拒（AADSTS65001），连接随即被标成 error，
 * 而 `mailbox-sync` 只捞 `status = active` 的连接，于是它**安静地从循环里消失**，
 * cron 每小时照样报成功。那次改动的提交说明里其实白纸黑字写了「已连的客户需要
 * 重连」——然后就没有然后了：没进今日待办、没有监控、没人重连。
 *
 * 所以这里定三条判据，任何一条命中都必须有人看见：
 *
 *   1. **明说断了**（status ≠ active）—— 最硬的信号，但从来没人把它端出来过。
 *      实测同一时刻还躺着两条从 2026-09-06 就 error 的 Meta 连接，18 天没人管。
 *   2. **状态是绿的，但心跳停了** —— `status` 会被重连流程改回 active 却不代表
 *      真的通了（实测 info@ 重连后 error_message 还挂着旧的报错）。所以**不能
 *      只看状态位**，要看「最近一次真的跟对方通上话是什么时候」。
 *   3. **权限清单比现在要的少** —— 上面那次事故的**发生前**信号。只对「刷新时
 *      会重放 scope」的平台成立（见 SCOPE_REPLAYED_ON_REFRESH）。
 *
 * ## 心跳是什么、为什么不是每个平台都有
 *
 * `platform_oauth_connections.last_synced_at` 由 `token-manager.ts` 的
 * `persistRefreshedToken()` 在**每次成功刷新令牌之后**盖一次 —— 也就是
 * 「我们刚刚成功跟这个平台通上话」。凡是有定时任务按固定节奏调用它的平台，
 * 这个字段就是一条可信的心跳；没有固定节奏的平台，它只是「上次授权的时间」，
 * 拿来判断新鲜度会天天误报。两者必须分开声明，见 HEARTBEAT_POLICY。
 *
 * ## 为什么要跟同一个平台的其它连接比
 *
 * 「这条通道没动静」有两种完全不同的原因：**这一条的授权断了**（去重连），
 * 或者**这个平台的定时任务整个停了**（重连一百次也没用）。同一平台还有别的
 * 连接今天刚通过话，就能排除后者。判据只看一条记录必然分不清 —— 跟
 * `feedback-stuck-detection-must-look-back-one-cycle` 是同一类教训。
 */

import { MICROSOFT_MAIL_SCOPES } from '@/lib/microsoft/mail-oauth'
import {
  CONNECTION_STATUS,
  PLATFORM_PROVIDERS,
  type PlatformProvider,
} from './vocabulary'

const HOUR_MS = 60 * 60 * 1000

// ─── 心跳节奏 ─────────────────────────────────────────────────────────────────

export interface HeartbeatPolicy {
  /**
   * 多久没成功连上对方就算不对劲（小时）。
   * `null` = 这个平台的 `last_synced_at` **不是心跳**，不能拿来判新鲜度。
   */
  staleHours: number | null
  /**
   * 刷令牌的那个任务**一次碰几条连接**，决定心跳按什么粒度判。
   *
   *  · `per_connection` —— 任务逐条遍历（邮箱同步就是，它必须把每个邮箱都读一遍）。
   *    这种平台**必须按条判**：合并算的话，一个客户连了两个邮箱、死了一个，
   *    会被活着的那个盖过去 —— 而 CTS 的 `bdm@` 正是这么死的。
   *  · `one_per_client` —— 取令牌只认「这个客户这个平台最新的那一条」
   *    （`token-manager.ts::fetchConnectionRow` 里 `.limit(1)`）。这种平台
   *    **必须按客户合并判**：老的那条永远不会被刷，按条判会永远误报。
   */
  refreshScope: 'per_connection' | 'one_per_client'
  /**
   * `token-manager.ts::callProviderRefresh()` 认不认这个平台。
   *
   * 认（谷歌 / 微软）：令牌过期是**常态** —— 下一次调用会自动换新的，
   * 所以 `token_expiry` 已过期完全不说明有问题（2026-09-24 实测 7 条谷歌连接
   * 全部处于"已过期待刷新"状态，全都健康）。
   * 不认（Meta / TikTok，用的是长期令牌）：过期就是**真的死了**，
   * 只能让人重新走一次授权。这是这两个平台唯一不依赖心跳的硬信号。
   */
  refreshable: boolean
  /** 为什么是这个数 / 为什么没有。下一个人改判据前先读这句。 */
  why: string
}

/**
 * 🔴 **每加一个 provider 就必须在这里表态**（有 CI 守卫盯着，见
 * `__tests__/connection-health.test.ts`）。漏掉的话，新平台会默默地没有监控，
 * 而这正是这个文件存在的原因。
 *
 * 阈值一律给**两轮以上**的余量：卡死判定只看「最近一轮」，对高频任务永远
 * 不成立（`feedback-stuck-detection-must-look-back-one-cycle`）。
 */
export const HEARTBEAT_POLICY: Record<PlatformProvider, HeartbeatPolicy> = {
  [PLATFORM_PROVIDERS.MICROSOFT_MAIL]: {
    refreshable: true,
    staleHours: 12,
    refreshScope: 'per_connection',
    why: '邮箱同步挂在 messenger-hourly 里（render.yaml `10 * * * *`），逐个邮箱遍历、每轮都会刷令牌；12 小时 = 连着 12 轮没通上话',
  },
  [PLATFORM_PROVIDERS.GOOGLE_GSC]: {
    refreshable: true,
    staleHours: 48,
    refreshScope: 'one_per_client',
    why: 'google-data-pullback-daily 每天一次会刷令牌（render.yaml `0 17 * * *`），且每个客户只取最新那一条连接；给两轮余量，单日漏跑不报警',
  },
  [PLATFORM_PROVIDERS.GOOGLE_GA4]: {
    refreshable: true,
    staleHours: 48,
    refreshScope: 'one_per_client',
    why: '同 google_gsc，同一个每日任务里刷，同样只取最新那一条',
  },
  [PLATFORM_PROVIDERS.GOOGLE_GBP]: {
    refreshable: true,
    staleHours: null,
    // staleHours 为 null 时这个字段用不上，仍要填 —— 免得以后打开心跳时漏想一层。
    refreshScope: 'per_connection',
    why: '商家页只在有人发帖 / 读评价时才刷令牌，没有固定节奏 —— 拿它当心跳会天天误报',
  },
  [PLATFORM_PROVIDERS.GOOGLE_ADS]: {
    refreshable: true,
    staleHours: null,
    // staleHours 为 null 时这个字段用不上，仍要填 —— 免得以后打开心跳时漏想一层。
    refreshScope: 'per_connection',
    why: '目前没有按固定节奏调用它的任务；接上之后再回来填这个数',
  },
  [PLATFORM_PROVIDERS.GOOGLE_GTM]: {
    refreshable: true,
    staleHours: null,
    // staleHours 为 null 时这个字段用不上，仍要填 —— 免得以后打开心跳时漏想一层。
    refreshScope: 'per_connection',
    why: '同 google_ads，还没有固定节奏的调用方',
  },
  [PLATFORM_PROVIDERS.META]: {
    refreshable: false,
    staleHours: null,
    // staleHours 为 null 时这个字段用不上，仍要填 —— 免得以后打开心跳时漏想一层。
    refreshScope: 'per_connection',
    why: 'token-manager 没有实现 Meta 的刷新（长期令牌），last_synced_at 只在授权那一刻盖过一次，不是心跳',
  },
  [PLATFORM_PROVIDERS.INSTAGRAM]: {
    refreshable: false, staleHours: null, refreshScope: 'per_connection',
    why: '没有定时心跳；仅在发布前由 getInstagramPublishToken 按需续期(距到期 30 天内,开关打开时)。长期不发布会过期,须重新连接',
  },
  [PLATFORM_PROVIDERS.TIKTOK]: {
    refreshable: false,
    staleHours: null,
    // staleHours 为 null 时这个字段用不上，仍要填 —— 免得以后打开心跳时漏想一层。
    refreshScope: 'per_connection',
    why: '同 meta，token-manager 里也还没有 TikTok 的刷新实现',
  },
  [PLATFORM_PROVIDERS.GOOGLE_YOUTUBE]: {
    refreshable: true,
    staleHours: null,
    refreshScope: 'per_connection',
    why: '只在有人上传视频 / 读回时才刷令牌，没有固定节奏的调用方；接上定时发布任务之后再回来填这个数',
  },
  [PLATFORM_PROVIDERS.WHATSAPP]: {
    refreshable: false,
    staleHours: null,
    // staleHours 为 null 时这个字段用不上，仍要填 —— 免得以后打开心跳时漏想一层。
    refreshScope: 'per_connection',
    why: '系统用户令牌不过期；WhatsApp 的心跳口径（超 N 小时没有任何事件）还没做，做之前不拿 last_synced_at 当心跳',
  },
}

// ─── 刷新时会不会重放权限清单 ─────────────────────────────────────────────────

/**
 * 「改了权限清单会不会**弄死**已经连好的连接」——按平台分两种，差别是致命的：
 *
 *  · 微软：刷新请求里**必须带 scope**（见 token-manager 的 refreshMicrosoftToken），
 *    带上没同意过的新权限 → `invalid_grant` → 连接当场死。**这就是 9 天事故。**
 *  · 谷歌：刷新请求里**不带 scope**（同文件 refreshGoogleToken 实测只发
 *    grant_type/client_id/client_secret/refresh_token）。所以加新 scope **不会**
 *    弄死已有连接，只会让用到新权限的那个功能拿旧令牌时被判 403。
 *
 * 所以这道判据只对前一种成立。后一种的风险是「新功能对老客户静默失效」，
 * 归各功能自己兜底，不在这里报——否则每加一个 scope 就给全部客户刷一屏。
 */
export const SCOPE_REPLAYED_ON_REFRESH: Record<PlatformProvider, readonly string[] | null> = {
  [PLATFORM_PROVIDERS.MICROSOFT_MAIL]: MICROSOFT_MAIL_SCOPES,
  [PLATFORM_PROVIDERS.GOOGLE_GSC]: null,
  [PLATFORM_PROVIDERS.GOOGLE_GA4]: null,
  [PLATFORM_PROVIDERS.GOOGLE_GBP]: null,
  [PLATFORM_PROVIDERS.GOOGLE_ADS]: null,
  [PLATFORM_PROVIDERS.GOOGLE_GTM]: null,
  [PLATFORM_PROVIDERS.META]: null,
  [PLATFORM_PROVIDERS.TIKTOK]: null,
  [PLATFORM_PROVIDERS.INSTAGRAM]: null,
  [PLATFORM_PROVIDERS.WHATSAPP]: null,
  [PLATFORM_PROVIDERS.GOOGLE_YOUTUBE]: null,
}

// ─── 输入 / 输出 ──────────────────────────────────────────────────────────────

/** 判据用得到的那几列。刻意不复用整行类型 —— 这里永远不该碰到令牌字段。 */
export interface ConnectionHealthRow {
  id: string
  client_id: string
  provider: PlatformProvider
  account_id: string
  display_name: string | null
  status: string
  /**
   * ⚠️ 存的是**我们当初请求过**的权限清单（授权回调直接写常量），不是平台实际
   * 批准的那一份。所以 `scope_gap` 的真实含义是「这条连接是在清单改动之前连的」——
   * 这恰好就是要抓的判据，但别误以为它反映了平台的真实授予。
   */
  scopes: string[] | null
  last_synced_at: string | null
  /** 访问令牌的到期时间。**只有不能自动续期的平台**（Meta / TikTok）才有判断价值。 */
  token_expiry: string | null
  created_at: string
  /** 行最后一次被改动的时间。当成「断了多久」的**下界**用，不是断掉那一刻。 */
  updated_at: string
  /**
   * 这个客户在**这条通道的取数名单里**吗。
   *
   * `false` = 授权是连上了，但那个会刷令牌的定时任务根本不会碰它（比如谷歌那条
   * 按 `client_connectors` 取名单，客户没配完 site_url 就不在名单里）。这种连接
   * 的心跳永远不会动 —— 按「断线」报就是每天给 PM 派一件重连也没用的活。
   * `undefined` = 这个平台没有「名单」这个概念，不适用。
   */
  pipelineEnrolled?: boolean
}

export type ConnectionFinding =
  /**
   * 状态位自己说断了。`sinceHours` 是**下界**（从 updated_at 算，见该字段注释），
   * 时间戳读不出来时为 `null` —— 必须如实说"算不出多久"，绝不能当成 0 小时，
   * 那会把"断了 9 天"说成"刚刚断的"，方向正好反了。
   */
  | { kind: 'broken'; row: ConnectionHealthRow; sinceHours: number | null }
  /**
   * 长期令牌到期了（只对不能自动续期的平台成立）。跟 `broken` 分开，是因为
   * 状态位还是绿的 —— 没有任何代码会去改它，这是唯一能提前看见它的判据。
   */
  | { kind: 'token_expired'; row: ConnectionHealthRow; expiredHours: number }
  /**
   * 状态是绿的，但心跳停了。
   * `cohortFresh` = 同一个平台**别的客户**今天通上了 → 问题就在这一条上；
   * 为 false 时没有可比的对照，文案必须如实说「也可能是我们这边停了」。
   */
  | { kind: 'silent'; row: ConnectionHealthRow; staleHours: number; cohortFresh: boolean }
  /**
   * 这个平台**所有客户**都停了心跳 —— 不是某个客户要重连，是取数任务整个停了。
   * 合成一条，不给每个客户各发一条「去重连」的假活。
   * 🔴 判据按**不同客户数**算，不按连接条数：同一个客户的两个邮箱一起断
   *    （CTS 2026-09-15 就是这个形状）是客户级授权问题，必须留在 PM 动手栏。
   */
  | { kind: 'pipeline_down'; provider: PlatformProvider; rows: ConnectionHealthRow[]; staleHours: number }
  /** 当初同意的权限比现在要的少，下次续期就会断（只对微软那类平台成立）。 */
  | { kind: 'scope_gap'; row: ConnectionHealthRow; missing: string[] }
  /**
   * 授权连上了，但这个客户压根不在这条通道的取数名单里 —— 数据从来没取过，
   * 而且**重连解决不了**（要补的是配置，不是授权）。必须跟「断线」分开报，
   * 否则 PM 会每天收到一件他做了也没用的活。
   */
  | { kind: 'not_enrolled'; row: ConnectionHealthRow }

// ─── 判据 ─────────────────────────────────────────────────────────────────────

/** 距今多少小时。取不到时间戳返回 null（当成"没有心跳记录"处理）。 */
function hoursSince(iso: string | null, now: Date): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return (now.getTime() - t) / HOUR_MS
}

/**
 * 这条连接「上一次真的跟对方通上话」离现在多久。
 *
 * 从没刷新成功过（`last_synced_at` 为 null）的，用建立时间兜底 —— 连上两天
 * 一次都没通过话，本身就是问题，不能因为字段是空的就当它健康。
 */
export function heartbeatAgeHours(row: ConnectionHealthRow, now: Date): number | null {
  return hoursSince(row.last_synced_at, now) ?? hoursSince(row.created_at, now)
}

/**
 * 缺了哪些权限。
 *
 * 大小写敏感地按字符串比 —— 平台发回来的就是原样字符串。
 */
export function missingScopes(
  granted: string[] | null,
  required: readonly string[],
): string[] {
  const have = new Set(granted ?? [])
  return required.filter((s) => !have.has(s))
}

/**
 * 状态位里哪些算「坏了，要人去重连」。
 *
 * 🔴 `revoked` **不在**里面 —— 那是**人主动点了断开**时写的（设置页上四条
 * DELETE 路由、谷歌回调换账号、Meta 只读试点退出，都写这个值）。把它当故障报，
 * 等于每天早上给 PM 刷一件「去重连一条你自己断掉的连接」，而待办每天从零重算、
 * 没有任何消除机制 —— 他做什么都消不掉，只会越积越多。
 */
const BROKEN_STATUSES = new Set<string>([CONNECTION_STATUS.ERROR, CONNECTION_STATUS.EXPIRED])

/**
 * 把一批连接判成若干条发现。**纯函数** —— 取数、下发都在外面。
 *
 * 一条连接最多产出一条发现，优先级：没进名单 > 断了 > 心跳停了 > 权限缺了。
 * 理由是后三者的动作是同一个（重新授权一次），一条连接刷三行只会淹掉别的客户；
 * 而「没进名单」的动作完全不同，必须排在最前面盖掉其它判据。
 */
export function assessConnections(
  rows: ConnectionHealthRow[],
  now: Date,
): ConnectionFinding[] {
  const findings: ConnectionFinding[] = []

  const byProvider = new Map<PlatformProvider, ConnectionHealthRow[]>()
  for (const row of rows) {
    const list = byProvider.get(row.provider) ?? []
    list.push(row)
    byProvider.set(row.provider, list)
  }

  for (const [provider, all] of Array.from(byProvider.entries())) {
    const policy = HEARTBEAT_POLICY[provider]
    // 没见过的 provider：不猜节奏（猜了就是天天误报），但也不能当它健康 ——
    // 状态位那条判据对所有平台都成立，照常走。
    const staleHours = policy?.staleHours ?? null
    const refreshScope = policy?.refreshScope ?? 'per_connection'
    const required = SCOPE_REPLAYED_ON_REFRESH[provider] ?? null

    // 人主动断开的整条跳过 —— 它不是故障。
    const inScope = all.filter((r) => r.status !== CONNECTION_STATUS.REVOKED)

    for (const row of inScope.filter((r) => BROKEN_STATUSES.has(r.status))) {
      findings.push({ kind: 'broken', row, sinceHours: hoursSince(row.updated_at, now) })
    }

    let live = inScope.filter((r) => r.status === CONNECTION_STATUS.ACTIVE)

    // 不能自动续期的平台（Meta / TikTok）：令牌到期 = 真的死了，而状态位不会变。
    // 能续期的平台跳过这条 —— 它们的令牌本来就长期处于"已过期待刷新"。
    if (policy && !policy.refreshable) {
      const expired = live.filter((r) => (hoursSince(r.token_expiry, now) ?? -1) > 0)
      for (const row of expired) {
        findings.push({ kind: 'token_expired', row, expiredHours: hoursSince(row.token_expiry, now)! })
      }
      const expiredIds = new Set(expired.map((r) => r.id))
      live = live.filter((r) => !expiredIds.has(r.id))
    }

    // 不在取数名单里的，心跳永远不会动 —— 单独报，且不参与下面任何新鲜度计算，
    // 否则它会把「整条通道停了」的判据拖成永远成立。
    const enrolled: ConnectionHealthRow[] = []
    for (const row of live) {
      if (row.pipelineEnrolled === false) findings.push({ kind: 'not_enrolled', row })
      else enrolled.push(row)
    }

    // 心跳判据只对声明了节奏的平台成立。没声明的平台到这里就只剩权限那一条。
    //
    // `one_per_client`：刷令牌只认这个客户最新的那一条，老的那条永远不会被刷 ——
    // 所以按客户合并，只要这个客户有任意一条是新鲜的，就算这条通道活着。
    // `per_connection`：任务逐条遍历，必须按条判，合并会把死掉的那个邮箱盖过去。
    const groupKey = (r: ConnectionHealthRow) =>
      refreshScope === 'one_per_client' ? r.client_id : r.id
    const freshestOfGroup = new Map<string, { row: ConnectionHealthRow; age: number }>()
    if (staleHours !== null) {
      for (const row of enrolled) {
        const age = heartbeatAgeHours(row, now) ?? 0
        const cur = freshestOfGroup.get(groupKey(row))
        if (!cur || age < cur.age) freshestOfGroup.set(groupKey(row), { row, age })
      }
    }
    const groups = Array.from(freshestOfGroup.values())
    const staleGroups = groups.filter((g) => g.age > staleHours!)

    // 🔴 全部客户一起停 = 取数任务的问题，不是某个客户的授权问题。合成一条。
    //    按**不同客户数**算：同一个客户的两条连接一起停（CTS 那次的形状）是
    //    客户级授权问题，重连能解决，必须留在 PM 的动手栏。
    const staleClients = new Set(staleGroups.map((g) => g.row.client_id))
    const liveClients = new Set(groups.map((g) => g.row.client_id))
    const cohortDown =
      staleHours !== null && staleClients.size > 1 && staleClients.size === liveClients.size

    if (cohortDown) {
      findings.push({
        kind: 'pipeline_down',
        provider,
        rows: staleGroups.map((g) => g.row),
        staleHours: staleHours!,
      })
    } else {
      for (const g of staleGroups) {
        findings.push({
          kind: 'silent',
          row: g.row,
          staleHours: staleHours!,
          // 有别的客户今天通上了 = 对照组成立，问题就在这一条上。
          cohortFresh: liveClients.size > staleClients.size,
        })
      }
    }

    const reportedIds = new Set(staleGroups.map((g) => g.row.id))
    for (const row of enrolled) {
      if (reportedIds.has(row.id)) continue // 已经在报断线了，不再叠一条权限的
      if (!required) continue
      const missing = missingScopes(row.scopes, required)
      if (missing.length > 0) findings.push({ kind: 'scope_gap', row, missing })
    }
  }

  return findings
}
