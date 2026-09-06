/**
 * Meta 授权体检 —— 一个客户的 Facebook 主页，今天还能不能用。
 *
 * ## 为什么要有这个
 *
 * Meta 授权会自己坏掉，而且坏得很安静：
 *
 * - 手工配在环境变量里的令牌是 Graph API Explorer 出的用户令牌，**60 天到期**
 *   （见 `token-manager.ts` 文件头）。没有 Business Manager 的客户只能这么配。
 * - `platform-oauth/token-manager.ts` 的 `callProviderRefresh` 对 meta 直接抛
 *   「not yet implemented」，所以 Meta 的失效**永远走不到** `markConnectionError()`
 *   —— 库里连一行痕迹都不会有。
 *
 * 于是失效只能靠人撞上：2026-08-21 起 4 个客户的线索同步全线断供 9 天，
 * CTS 一家漏掉 45 条线索；2026-09-03 发帖失败，真实原因（拿不到主页令牌）
 * 还被 CDN 的错误页盖住，查了两小时。两次都是同一个病根，也都没人提前知道。
 *
 * 这个模块只回答一句话，不修不改：**这个客户的 Meta 授权现在是什么状态。**
 *
 * ## 两条硬规矩
 *
 * ### 1. 问不到 Meta ≠ 没问题（fail-closed）
 *
 * 网络抖一下、Graph 回 5xx、或者我们自己抛异常 —— 一律记 `unknown`，
 * 并且 `unknown` **算不健康**、会下发待办。反过来做（问不到当健康）就是把
 * 「通道哑了」显示成「一切正常」，这个仓库已经为此付过两次学费
 * （见 `comment-autoreply-probe/route.ts` 与 `crm/mailbox-run.ts` 的文件头）。
 *
 * ### 2. 公共兜底令牌不许让客户看起来是健康的
 *
 * `getMetaTokenForClient()` 在找不到客户专属令牌时会退回全局那条
 * `META_SYSTEM_USER_TOKEN`。体检**故意不走那条退路**：拿公共令牌去探客户 A 的
 * 主页，探通了只证明「某个身份能访问它」，不证明「A 自己有授权」。那会让一个
 * 从未授权过的客户天天显示健康 —— 正是隔离要防的事。所以这里只认两种客户专属
 * 来源：一键授权存下来的主页令牌，和按域名/主页 ID 命名的那条环境变量。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getStoredPageToken, domainToEnvKey, pageIdToEnvVar } from '@/lib/meta/token-manager'
import { listGrantedScopes, META_PAGE_SCOPES } from '@/lib/meta-oauth/client'
import { CONNECTION_STATUS, isTokenExpired } from '@/lib/platform-oauth/vocabulary'

const GRAPH_BASE = 'https://graph.facebook.com/v20.0'

/**
 * 运行记录里这一趟叫什么。
 *
 * 放在这里而不是 cron 路由里：下发待办的 `pm-todo/meta-auth-health-items.ts` 要按
 * 这个名字查运行记录，而它绝不该 import 一个 Next 路由（会把服务端那套东西拖进
 * 生成清单的路径）。两边都从这里取，名字就只有一处。
 */
export const META_AUTH_HEALTH_JOB = 'meta-auth-health'

/** Meta 的原话截多长进待办 —— 够认出是哪类错，又不至于铺满一屏。 */
const PROVIDER_ERROR_MAX = 160

export type MetaAuthState =
  /** 令牌活着，该有的权限都在。 */
  | 'ok'
  /** 客户档案里没登记 Facebook 主页 —— 无从可查，也不该报成坏。 */
  | 'no_page'
  /** 这个客户没有任何专属令牌（公共兜底不算，见文件头规矩 2）。 */
  | 'no_token'
  /** Meta 明确拒了这个令牌：过期、被撤、或没有这个主页的角色。 */
  | 'rejected'
  /** 令牌能用，但少了我们实际要用的权限。 */
  | 'scope_missing'
  /** 问不到 Meta —— fail-closed，算不健康。 */
  | 'unknown'

export type MetaTokenSource = 'stored_connection' | 'client_env' | 'none'

export interface MetaAuthHealth {
  client_id: string
  page_id: string | null
  state: MetaAuthState
  token_source: MetaTokenSource
  /** Meta / 授权记录里认的权限；问不到时是 null，跟「一个都没有」区分开。 */
  granted_scopes: string[] | null
  /** 我们要用但没拿到的权限。 */
  missing_scopes: string[]
  /** 存下来的那条授权记录的状态；走环境变量时是 null。 */
  connection_status: string | null
  /** Meta 的原话，给待办文案用。 */
  provider_error: string | null
  checked_at: string
}

/** 体检算健康的只有一种状态 —— 其余全部（含 unknown）都要有人看见。 */
export function isHealthy(h: MetaAuthHealth): boolean {
  return h.state === 'ok'
}

/**
 * 需要有人动手的状态。
 *
 * `no_page` 不在内：客户压根没打算连 Facebook 时，天天提醒「去登记主页」是噪音。
 * 它照样写进结果，只是不下发。
 */
export function needsHuman(h: MetaAuthHealth): boolean {
  return h.state !== 'ok' && h.state !== 'no_page'
}

function trimError(message: string): string {
  return message.replace(/\s+/g, ' ').trim().slice(0, PROVIDER_ERROR_MAX)
}

/**
 * 这个客户专属的 Meta 令牌 —— 只认客户专属来源。
 *
 * 顺序跟发布路由一致（先一键授权存下的主页令牌，再手工环境变量），这样体检说的
 * 「能发」跟真发时用的是同一条令牌。**故意不含**全局 `META_SYSTEM_USER_TOKEN`。
 */
async function resolveClientToken(
  clientId: string,
  pageId: string,
  domain: string | null,
): Promise<{ token: string; source: MetaTokenSource }> {
  const stored = await getStoredPageToken(clientId, pageId)
  if (stored) return { token: stored, source: 'stored_connection' }

  if (domain) {
    const byDomain = process.env[`META_SYSTEM_USER_TOKEN_${domainToEnvKey(domain)}`]
    if (byDomain) return { token: byDomain, source: 'client_env' }
  }
  const byPage = process.env[pageIdToEnvVar(pageId)]
  if (byPage) return { token: byPage, source: 'client_env' }

  return { token: '', source: 'none' }
}

/**
 * 存下来的那条授权记录 —— 要它的权限清单、状态和到期时间。
 *
 * 没有复用 `platform-oauth/token-manager.ts` 的 `fetchConnectionRow`：那个函数
 * 只取 `status = active` 的行，而体检要看的恰恰是 revoked / expired / error 那几行；
 * 它也不按 `account_id` 过滤，一个客户连了多个主页时会拿错行。这里按
 * (client_id, provider, account_id) 三个字段一起过滤 —— 这也正是表上的唯一约束。
 */
async function readConnection(
  supabase: SupabaseClient,
  clientId: string,
  pageId: string,
): Promise<{ scopes: string[]; status: string; token_expiry: string | null } | null> {
  const { data } = await supabase
    .from('platform_oauth_connections')
    .select('scopes, status, token_expiry')
    .eq('client_id', clientId)
    .eq('provider', 'meta')
    .eq('account_id', pageId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!data) return null
  const row = data as { scopes?: unknown; status?: unknown; token_expiry?: unknown }
  return {
    scopes: Array.isArray(row.scopes) ? row.scopes.filter((s): s is string => typeof s === 'string') : [],
    status: typeof row.status === 'string' ? row.status : 'unknown',
    token_expiry: typeof row.token_expiry === 'string' ? row.token_expiry : null,
  }
}

/**
 * 实测一次：拿这个令牌去读这个主页。
 *
 * 只读 id 和 name，绝不写任何东西。返回 `alive` / `rejected` / `unreachable`
 * 三态 —— 第三态是「我们问不到」，绝不能塌进前两态里的任何一个。
 */
async function probePage(
  pageId: string,
  token: string,
  fetcher: typeof fetch,
): Promise<{ result: 'alive' | 'rejected' | 'unreachable'; error: string | null }> {
  const url = `${GRAPH_BASE}/${encodeURIComponent(pageId)}?fields=id,name&access_token=${encodeURIComponent(token)}`
  try {
    const res = await fetcher(url)
    if (res.ok) {
      // 2xx 还不够 —— 必须确认返回体真的是这张主页。CDN / 登录墙可能回一个
      // HTTP 200 的 HTML 错误页（本文件头记的 2026-09-03 事故真因就被这种页盖过），
      // 那种响应 res.ok=true 但根本不是 Graph 成功。读不出 `id === pageId` 一律按
      // fail-closed 归到「问不到」，绝不让一个非真成功的 200 塌成 alive。
      const okBody = (await res.json().catch(() => null)) as { id?: unknown } | null
      if (okBody && okBody.id === pageId) return { result: 'alive', error: null }
      return { result: 'unreachable', error: '返回 200 但不是这个主页的 Graph 响应（可能是代理错误页 / 登录墙）' }
    }

    const body = (await res.json().catch(() => null)) as
      | { error?: { message?: string; code?: number; type?: string } }
      | null
    const message = body?.error?.message ?? `HTTP ${res.status}`

    // 4xx 是 Meta 在拒绝我们（令牌过期 / 被撤 / 没这个主页的角色）；5xx 是 Meta
    // 自己出问题，那不是这个客户授权坏了，按「问不到」办。
    if (res.status >= 500) return { result: 'unreachable', error: trimError(message) }
    return { result: 'rejected', error: trimError(message) }
  } catch (e) {
    return { result: 'unreachable', error: trimError(e instanceof Error ? e.message : String(e)) }
  }
}

export interface CheckMetaAuthInput {
  clientId: string
  /** 这个客户自己档案里登记的主页 ID —— 调用方负责保证它属于这个客户。 */
  pageId: string | null
  domain: string | null
}

/**
 * 一个客户的一次体检。
 *
 * 每一步都只用传进来的这个 client 的东西：它自己的主页 ID、它自己的令牌、
 * 按它自己 client_id 过滤出来的授权记录。跨客户的数据一次都不碰。
 */
export async function checkMetaAuth(
  supabase: SupabaseClient,
  input: CheckMetaAuthInput,
  options: { now?: Date; fetcher?: typeof fetch } = {},
): Promise<MetaAuthHealth> {
  const now = options.now ?? new Date()
  const fetcher = options.fetcher ?? fetch
  const checkedAt = now.toISOString()

  const base = {
    client_id: input.clientId,
    page_id: input.pageId,
    granted_scopes: null as string[] | null,
    missing_scopes: [] as string[],
    connection_status: null as string | null,
    provider_error: null as string | null,
    checked_at: checkedAt,
  }

  if (!input.pageId) {
    return { ...base, state: 'no_page', token_source: 'none' }
  }

  const connection = await readConnection(supabase, input.clientId, input.pageId).catch(() => null)

  let resolved: { token: string; source: MetaTokenSource }
  try {
    resolved = await resolveClientToken(input.clientId, input.pageId, input.domain)
  } catch (e) {
    // 解析令牌本身炸了（解密失败等）—— 问不到，不是「没有」。
    return {
      ...base,
      state: 'unknown',
      token_source: 'none',
      connection_status: connection?.status ?? null,
      provider_error: trimError(e instanceof Error ? e.message : String(e)),
    }
  }

  if (resolved.source === 'none' || !resolved.token) {
    return {
      ...base,
      state: 'no_token',
      token_source: 'none',
      connection_status: connection?.status ?? null,
      provider_error: connection
        ? `授权记录还在，但取不出可用的令牌（记录状态：${connection.status}）`
        : null,
    }
  }

  const probe = await probePage(input.pageId, resolved.token, fetcher)

  if (probe.result === 'unreachable') {
    return {
      ...base,
      state: 'unknown',
      token_source: resolved.source,
      connection_status: connection?.status ?? null,
      provider_error: probe.error,
    }
  }

  if (probe.result === 'rejected') {
    return {
      ...base,
      state: 'rejected',
      token_source: resolved.source,
      connection_status: connection?.status ?? null,
      provider_error: probe.error,
    }
  }

  // 令牌活着。接下来看权限够不够。
  //
  // 两条来路的权限从不同地方问：
  // - 存下来的是**主页**令牌，`/me/permissions` 对它没意义，所以用授权当时记进
  //   `platform_oauth_connections.scopes` 的那份清单。
  // - 环境变量里那条是**用户**令牌，可以直接问 Meta 现在还剩哪些权限。
  let granted: string[] | null
  if (resolved.source === 'stored_connection') {
    granted = connection ? connection.scopes : null
  } else {
    granted = await listGrantedScopes(resolved.token)
  }

  if (granted === null) {
    // 令牌能读主页，但权限清单问不出来 —— 说不清够不够，按 fail-closed 办。
    return {
      ...base,
      state: 'unknown',
      token_source: resolved.source,
      connection_status: connection?.status ?? null,
      provider_error: '令牌能用，但问不出它现在有哪些权限',
    }
  }

  const missing = META_PAGE_SCOPES.filter((s) => !granted!.includes(s))

  // 记录自己说过期/被撤，但令牌实测还能读 —— 以记录为准报出来，别让一次侥幸成功
  // 盖掉「这条授权已经不该用了」。
  const staleByRecord =
    connection !== null &&
    (connection.status === CONNECTION_STATUS.REVOKED ||
      connection.status === CONNECTION_STATUS.EXPIRED ||
      (connection.token_expiry !== null && isTokenExpired(connection.token_expiry)))

  if (staleByRecord) {
    return {
      ...base,
      state: 'rejected',
      token_source: resolved.source,
      granted_scopes: granted,
      missing_scopes: missing,
      connection_status: connection?.status ?? null,
      provider_error: `授权记录已标记为 ${connection?.status}${
        connection?.token_expiry ? `（到期 ${connection.token_expiry}）` : ''
      }`,
    }
  }

  if (missing.length > 0) {
    return {
      ...base,
      state: 'scope_missing',
      token_source: resolved.source,
      granted_scopes: granted,
      missing_scopes: missing,
      connection_status: connection?.status ?? null,
    }
  }

  return {
    ...base,
    state: 'ok',
    token_source: resolved.source,
    granted_scopes: granted,
    connection_status: connection?.status ?? null,
  }
}
