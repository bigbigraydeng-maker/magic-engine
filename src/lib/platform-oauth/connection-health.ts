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
    staleHours: 12,
    why: '邮箱同步挂在 messenger-hourly 里（render.yaml `10 * * * *`），每轮都会刷令牌；12 小时 = 连着 12 轮没通上话',
  },
  [PLATFORM_PROVIDERS.GOOGLE_GSC]: {
    staleHours: 48,
    why: 'google-data-pullback-daily 每天一次会刷令牌（render.yaml `0 17 * * *`）；给两轮余量，单日漏跑不报警',
  },
  [PLATFORM_PROVIDERS.GOOGLE_GA4]: {
    staleHours: 48,
    why: '同 google_gsc，同一个每日任务里刷',
  },
  [PLATFORM_PROVIDERS.GOOGLE_GBP]: {
    staleHours: null,
    why: '商家页只在有人发帖 / 读评价时才刷令牌，没有固定节奏 —— 拿它当心跳会天天误报',
  },
  [PLATFORM_PROVIDERS.GOOGLE_ADS]: {
    staleHours: null,
    why: '目前没有按固定节奏调用它的任务；接上之后再回来填这个数',
  },
  [PLATFORM_PROVIDERS.GOOGLE_GTM]: {
    staleHours: null,
    why: '同 google_ads，还没有固定节奏的调用方',
  },
  [PLATFORM_PROVIDERS.META]: {
    staleHours: null,
    why: 'token-manager 没有实现 Meta 的刷新（长期令牌），last_synced_at 只在授权那一刻盖过一次，不是心跳',
  },
  [PLATFORM_PROVIDERS.TIKTOK]: {
    staleHours: null,
    why: '同 meta，token-manager 里也还没有 TikTok 的刷新实现',
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
  scopes: string[] | null
  last_synced_at: string | null
  created_at: string
  updated_at: string
}

export type ConnectionFinding =
  /** 状态位自己说断了。`sinceHours` 从 updated_at 算（被标 error 的那一刻）。 */
  | { kind: 'broken'; row: ConnectionHealthRow; sinceHours: number }
  /**
   * 状态是绿的，但心跳停了。`soleConnection` = 这个平台就这一条连接，
   * 分不清是「这条断了」还是「整条通道停了」，文案必须如实说两种都有可能。
   */
  | { kind: 'silent'; row: ConnectionHealthRow; staleHours: number; soleConnection: boolean }
  /**
   * 这个平台**所有**连接都停了心跳 —— 不是某个客户要重连，是取数任务整个停了。
   * 合成一条，不给每个客户各发一条「去重连」的假活。
   */
  | { kind: 'pipeline_down'; provider: PlatformProvider; rows: ConnectionHealthRow[]; staleHours: number }
  /** 当初同意的权限比现在要的少，下次续期就会断（只对微软那类平台成立）。 */
  | { kind: 'scope_gap'; row: ConnectionHealthRow; missing: string[] }

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
 * 把一批连接判成若干条发现。**纯函数** —— 取数、下发都在外面。
 *
 * 一条连接最多产出一条发现，优先级：断了 > 心跳停了 > 权限缺了。
 * 理由是三者的动作是同一个（重新授权一次），一条连接刷三行只会淹掉别的客户。
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
    const policy = HEARTBEAT_POLICY[provider] ?? { staleHours: null, why: '未知平台' }
    const required = SCOPE_REPLAYED_ON_REFRESH[provider] ?? null

    const broken = all.filter((r) => r.status !== CONNECTION_STATUS.ACTIVE)
    for (const row of broken) {
      findings.push({
        kind: 'broken',
        row,
        sinceHours: hoursSince(row.updated_at, now) ?? 0,
      })
    }

    const live = all.filter((r) => r.status === CONNECTION_STATUS.ACTIVE)

    // 心跳判据只对声明了节奏的平台成立。没声明的平台到这里就只剩权限那一条。
    const stale: ConnectionHealthRow[] = []
    if (policy.staleHours !== null) {
      for (const row of live) {
        const age = heartbeatAgeHours(row, now)
        if (age !== null && age > policy.staleHours) stale.push(row)
      }
    }

    // 🔴 全部都停 = 取数任务的问题，不是某个客户的授权问题。合成一条，
    //    否则会给每个客户发一件「去重连」——他连一百次也不会好。
    //    只有一条连接时**不算**整条通道停（分不清，交给下面按条报，文案里说清）。
    const cohortDown = stale.length > 1 && stale.length === live.length
    if (cohortDown && policy.staleHours !== null) {
      findings.push({ kind: 'pipeline_down', provider, rows: stale, staleHours: policy.staleHours })
    }

    const staleIds = new Set(stale.map((r) => r.id))
    for (const row of live) {
      if (staleIds.has(row.id)) {
        if (!cohortDown && policy.staleHours !== null) {
          findings.push({
            kind: 'silent',
            row,
            staleHours: policy.staleHours,
            soleConnection: live.length === 1,
          })
        }
        continue // 已经在报断线了，不再叠一条权限的
      }
      if (required) {
        const missing = missingScopes(row.scopes, required)
        if (missing.length > 0) findings.push({ kind: 'scope_gap', row, missing })
      }
    }
  }

  return findings
}
