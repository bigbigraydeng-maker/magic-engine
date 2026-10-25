/**
 * 今日待办里的「客户的 Meta 专属钥匙被 Meta 作废了」（2026-09-25）。
 *
 * 拉模式，跟 `ai-auto-review-circuit-breaker-items.ts` 同一个原则：每次生成待办时
 * 直接拿 env 里的钥匙去问 Meta 一句「你还认我吗」，不依赖任何通知送达。
 * 只有 Graph 明确回 code 190（令牌失效）才算死——限流(4/17/613)、5xx、超时、
 * 网络抖动一律算 unknown，宁可漏报也不能因为一次网络抖动就误报。
 * 起因：2026-09-21/23/25 CTS 的令牌连死三次，每次都是 PM 自己发现才有人知道。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-item-types'
import {
  domainToEnvKey,
  hasScopedEnvToken,
  loadStoredClientMetaToken,
  loadTokenOwnerPeers,
  ownsKey,
  pageIdToEnvVar,
  pickScopedMetaToken,
  type TokenOwnerRow,
} from '@/lib/meta/token-selection'

export type MetaTokenHealthKind = 'meta_token_dead'

export type MetaTokenProbe =
  | { status: 'alive' }
  | { status: 'dead'; message: string }
  | { status: 'unknown' }

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export const META_TOKEN_FIX_URL = 'https://business.facebook.com/settings/system-users'

/** Magic Engine's own Meta business id. Optional. Never a client id. */
export const ME_META_BUSINESS_ID_ENV = 'ME_META_BUSINESS_ID'

/** Digits only, so a bad value cannot change the query string. */
function readMeMetaBusinessId(env: Record<string, string | undefined>): string | null {
  const raw = env[ME_META_BUSINESS_ID_ENV]
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return /^\d{1,32}$/.test(trimmed) ? trimmed : null
}

/** System-users page for an ME admin. Falls back without a business id. */
function metaTokenFixHref(env: Record<string, string | undefined>): string {
  const businessId = readMeMetaBusinessId(env)
  return businessId ? `${META_TOKEN_FIX_URL}?business_id=${businessId}` : META_TOKEN_FIX_URL
}

function clientTokenDeadHow(businessId: string | null): string {
  const idLine = businessId
    ? `填上 Magic Engine 的企业编号 ${businessId}`
    : '填上 Magic Engine 的企业编号（这个编号还没配进系统，请向 Ray 要，不要自己猜）'
  return (
    '这个客户的 Meta 专属钥匙已经作废。请不要用个人 Facebook 账号重新生成钥匙。个人钥匙会过期，那个人一改密码或离职，钥匙会再次作废。' +
    '正确做法是让客户把广告账户和主页共享给 Magic Engine 企业，之后统一用 Magic Engine 的系统用户钥匙。这套做法还在做（跟进 #3092）。上线前请按下面办：' +
    `① 如果这个客户的广告账户或主页还没共享过来，请客户打开自己的商务管理平台，进入「设置 → 用户 → 合作伙伴」（英文界面是 Business settings → Users → Partners），添加合作伙伴，${idLine}，再勾上要共享的广告账户和主页，以及对应权限。` +
    '② 客户共享之后，还要由 Ray（或 ME 管理员）在 Magic Engine 的商务管理平台里，把这些广告账户和主页分配给名叫 MagicEngine 的系统用户。只共享、不分配的话，系统用户钥匙仍然读不到这个客户。这一步由 ME 管理员操作。请用这条待办上的链接打开系统用户页面，不要把这个链接发给客户。' +
    '③ 在这套做法上线之前，这个客户的读广告和同步留资会继续失败。不要自己换钥匙，也不要把个人钥匙粘进后台。' +
    '④ 如果急着恢复，请直接找 Ray。新钥匙就位后的第二天，这条待办会自己消失。'
  )
}

/** 问 Meta 一句「这个令牌还认吗」。只有明确的 code 190 才算死。故意不查权限：钥匙还活着但被收了广告权限时 /me 仍回 200，这里判 alive —— 那类问题由各功能自己的报错负责，这里只抓「整把钥匙作废」。 */
export async function probeMetaToken(token: string, fetchImpl: FetchLike = fetch): Promise<MetaTokenProbe> {
  let res: Response
  try {
    res = await fetchImpl('https://graph.facebook.com/v21.0/me?fields=id', {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    })
  } catch {
    return { status: 'unknown' }
  }

  if (res.ok) return { status: 'alive' }

  let body: { error?: { code?: unknown; message?: unknown } } | null = null
  try {
    body = (await res.json()) as { error?: { code?: unknown; message?: unknown } }
  } catch {
    return { status: 'unknown' }
  }

  if (body?.error?.code === 190) {
    return { status: 'dead', message: String(body.error.message ?? '') }
  }
  return { status: 'unknown' }
}

/** 这个客户（或公共钥匙）对应的 env 变量名。 */
function envVarNameFor(
  row: { domain: string | null; facebook_page_id: string | null },
  source: 'client_domain' | 'client_page',
): string {
  return source === 'client_domain'
    ? `META_SYSTEM_USER_TOKEN_${domainToEnvKey(row.domain as string)}`
    : pageIdToEnvVar(row.facebook_page_id as string)
}

/** clients.name → env-safe slug, same rule the cron route uses. */
const nameSlug = (name: string): string => name.toUpperCase().replace(/[^A-Z0-9]/g, '_')

/** Every env token this client owns, with the env var name it came from. */
function ownedTokens(
  row: TokenOwnerRow,
  peers: TokenOwnerRow[],
  env: Record<string, string | undefined>,
): { envVar: string; token: string }[] {
  const out: { envVar: string; token: string }[] = []

  if (hasScopedEnvToken(row, env)) {
    const scoped = pickScopedMetaToken(row, peers, env)
    if (scoped) out.push({ envVar: envVarNameFor(row, scoped.source), token: scoped.token })
  }

  // Legacy per-name key, still read by src/app/api/cron/google-data-pullback-daily/route.ts.
  if (row.name) {
    const envVar = `${nameSlug(row.name)}_META_SYSTEM_USER_TOKEN`
    const token = env[envVar]
    if (token && ownsKey(row, peers, (r) => (r.name ? nameSlug(r.name) : null))) {
      out.push({ envVar, token })
    }
  }

  return out
}

const PROBE_TTL_MS = 10 * 60 * 1000
const probeCache = new Map<string, { at: number; result: MetaTokenProbe }>()

/** Tests only. */
export function clearMetaTokenProbeCache(): void {
  probeCache.clear()
}

/** Cached probe: alive/dead are cached for PROBE_TTL_MS, unknown never is. */
async function probeCached(
  token: string,
  fetchImpl: FetchLike,
  now: () => number,
): Promise<MetaTokenProbe> {
  const cached = probeCache.get(token)
  if (cached && now() - cached.at < PROBE_TTL_MS) return cached.result
  const result = await probeMetaToken(token, fetchImpl)
  if (result.status !== 'unknown') probeCache.set(token, { at: now(), result })
  return result
}

export async function pushMetaTokenHealthItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  env: Record<string, string | undefined> = process.env,
  fetchImpl: FetchLike = fetch,
  now: () => number = Date.now,
): Promise<void> {
  const peers = await loadTokenOwnerPeers(supabase)
  if (peers === null) throw new Error('客户表读取失败，没法判断各客户的 Meta 钥匙归属')
  // 权限被收掉时 PostgREST 回的是零行、不报错；生产里不可能一个客户都没有
  if (peers.length === 0) throw new Error('客户表读回零行（多半是读权限被挡了），没法检查各客户的 Meta 钥匙')

  const targets: { row: TokenOwnerRow; envVar: string; token: string; fromDb?: boolean }[] = []
  for (const row of peers) {
    // Preferred: DB-stored per-client token (post env-var migration path).
    const dbToken = await loadStoredClientMetaToken(supabase, row.id)
    if (dbToken) {
      targets.push({ row, envVar: 'platform_oauth_connections', token: dbToken, fromDb: true })
      continue
    }
    // Legacy: env-var tokens.
    for (const owned of ownedTokens(row, peers, env)) {
      targets.push({ row, envVar: owned.envVar, token: owned.token })
    }
  }

  const shared = env.META_SYSTEM_USER_TOKEN
  const distinct = new Set(targets.map((t) => t.token))
  if (shared) distinct.add(shared)

  const probes = new Map<string, MetaTokenProbe>()
  await Promise.all(
    Array.from(distinct).map(async (token) => {
      probes.set(token, await probeCached(token, fetchImpl, now))
    }),
  )

  // 限流 / 超时 / 连不上时一把都问不到：不报 ≠ 钥匙都活着，交给上层下发「检查没跑成」
  if (probes.size > 0 && Array.from(probes.values()).every((p) => p.status === 'unknown')) {
    throw new Error('一把 Meta 钥匙都问不到（限流 / 超时 / 连不上 Meta），今天没法判断钥匙死没死')
  }

  pushDeadItems(items, targets, probes, metaTokenFixHref(env), readMeMetaBusinessId(env))
  if (shared && probes.get(shared)?.status === 'dead') items.push(sharedTokenDeadItem())
}

function pushDeadItems(
  items: ManualItem[],
  targets: { row: TokenOwnerRow; envVar: string; token: string; fromDb?: boolean }[],
  probes: Map<string, MetaTokenProbe>,
  href: string,
  businessId: string | null,
): void {
  const how = clientTokenDeadHow(businessId)
  for (const target of targets) {
    if (probes.get(target.token)?.status !== 'dead') continue
    const name = target.row.name ?? '未知客户'
    const sourceLabel = target.fromDb
      ? 'ME 后台数据库'
      : `Render 里的 ${target.envVar}`
    items.push({
      kind: 'meta_token_dead',
      client_id: target.row.id,
      client_name: name,
      what:
        `${name} 的 Meta 专属钥匙（${sourceLabel}）被 Meta 作废了 —— ` +
        `这个客户读广告数据、同步留资这些功能现在都在失败，而且不会自己报错。` +
        `（Meta 回复错误码 190：这把钥匙已作废）`,
      how,
      href,
    })
  }
}

function sharedTokenDeadItem(): ManualItem {
  return {
    kind: 'meta_token_dead',
    client_id: 'infra',
    client_name: 'Magic Engine 后台',
    what:
      `公共 Meta 钥匙（Render 里的 META_SYSTEM_USER_TOKEN）被 Meta 作废了 —— ` +
      `所有没有专属钥匙的客户，读广告、同步留资都在失败。` +
      `（Meta 回复错误码 190：这把钥匙已作废）`,
    how:
      '公共钥匙是 Magic Engine 企业下「系统用户」的口令，不是个人授权：打开链接 → 系统用户 → MagicEngine → ' +
      '生成新口令（选 Magic Engine 应用，勾上 ads_management、ads_read、business_management、pages_read_engagement、leads_retrieval）→ ' +
      '打开 Render 后台 crazycontent 服务 → Environment → 把 META_SYSTEM_USER_TOKEN 的值换成新口令 → 保存时选带 deploy 的那个选项（别选 Save only，否则不生效）。换完第二天这条待办会自己消失。',
    href: 'https://business.facebook.com/settings/system-users',
  }
}
