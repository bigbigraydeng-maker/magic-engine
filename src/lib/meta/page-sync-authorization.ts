/**
 * 同步闸：只在「核实过属于这个客户」的 Facebook 主页上拉私信 / 表单线索（AD-SEC-4）。
 *
 * ── 为什么 ───────────────────────────────────────────────────────────────
 * 同步按 clients.facebook_page_id 取主页，令牌没有存下的 OAuth 主页令牌时会回落到
 * 能看到多家客户主页的共享令牌。2026-09-14 之前客户员工能随手改这一列，
 * 所以「列里有值」不能当作「主页是这个客户的」。
 *
 * ── 什么算核实过（按顺序）────────────────────────────────────────────────
 * 1. （拒）bound_to_other_client  同一主页还绑在别的客户名下 —— 说不清是谁的，
 *                        连 OAuth 也不放行（历史遗留的重复绑定不能被第 2 步洗白）。
 * 2. client_oauth        这个客户存过这个主页的「连接 Meta」授权（授权人在主页上有角色），
 *                        且只用那把存下的主页令牌 —— 解不开就不算这一步，按后面规则重判。
 * 3. staff_verified      审计表里这个客户最新一条 applied / authorized 的主页记录 = 员工绑定了
 *                        这个主页（跑过 Meta 核实 + 重复检查）。authorized 也认：写列成功但
 *                        补记 applied 失败时行会停在 authorized。最新记录对不上 →
 *                        （拒）audit_mismatch：列被绕过审计改过。
 * 4. legacy_client_token 审计表里没有这个客户的主页记录（2026-09-17 之前绑的），且令牌是
 *                        员工给这个客户单独配的（按域名 / 按主页，归属规则见 token-selection.ts）。
 *                        只有共享令牌 → （拒）unverified_shared_token。
 * 任何一次读失败 → （拒）check_failed。审计表还没建（迁移未 apply）按「没有记录」处理，
 * 此时员工也写不了绑定（审计写不进去就拒），所以不会放过员工路径之外的东西。
 *
 * 被拒的客户由每日待办下发（pm-todo/page-binding-items.ts），不会只死在运行记录里。
 * 本文件不在 import 时创建 Supabase 客户端（调用方传入），每日待办可以复用。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getPageAccessToken } from './page-posts'
import { resolveMetaTokenDetailed, loadStoredPageToken, type MetaTokenSource } from './token-selection'
import { findOtherClientsBoundToPage, pageIdMatches } from './page-binding'
import { isKernelNotProvisioned } from '@/lib/kernel-approval/errors'

export type PageSyncRefusal =
  | 'bound_to_other_client'
  /** 配置里填的主页（评论自动回复 / 主页数据）不是这个客户绑定的主页，也没有它的 OAuth 授权。 */
  | 'not_bound_page'
  | 'audit_mismatch'
  | 'unverified_shared_token'
  | 'no_meta_token'
  | 'check_failed'

export type PageVerifiedVia = 'client_oauth' | 'staff_verified' | 'legacy_client_token'

export type PageBindingAssessment =
  | { verified: true; via: PageVerifiedVia }
  | { verified: false; reason: PageSyncRefusal; detail?: string }

type Env = Record<string, string | undefined>

type AuditRead =
  | { kind: 'none' }
  | { kind: 'row'; action: string; requested_value: string | null }
  | { kind: 'error'; message: string }

async function latestAppliedPageAudit(supabase: SupabaseClient, clientId: string): Promise<AuditRead> {
  const { data, error } = await supabase
    .from('client_binding_audit')
    .select('action, requested_value, created_at')
    .eq('client_id', clientId)
    .eq('binding_kind', 'facebook_page')
    .in('outcome', ['applied', 'authorized'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) {
    // Table not there yet (migration not applied) = no audited bindings exist.
    // Anything else — including a CHECK/permission error — is a failed read.
    return isKernelNotProvisioned(error) ? { kind: 'none' } : { kind: 'error', message: error.message }
  }
  if (!data) return { kind: 'none' }
  const row = data as { action: string; requested_value: string | null }
  return { kind: 'row', action: row.action, requested_value: row.requested_value }
}

interface Evaluation {
  verdict: PageBindingAssessment
  storedPageToken: string | null
  userToken: { token: string; source: MetaTokenSource } | null
}

async function evaluate(supabase: SupabaseClient, clientId: string, pageId: string, env: Env): Promise<Evaluation> {
  const refuse = (reason: PageSyncRefusal, detail?: string): Evaluation => ({
    verdict: { verified: false, reason, ...(detail ? { detail } : {}) }, storedPageToken: null, userToken: null,
  })

  try {
    const others = await findOtherClientsBoundToPage(supabase, clientId, pageId)
    if (others.length > 0) return refuse('bound_to_other_client', others.map((o) => o.client_id).join(','))
  } catch (err) {
    return refuse('check_failed', `duplicate check: ${err instanceof Error ? err.message : String(err)}`)
  }

  const storedPageToken = await loadStoredPageToken(supabase, clientId, pageId)
  if (storedPageToken) return { verdict: { verified: true, via: 'client_oauth' }, storedPageToken, userToken: null }

  const audit = await latestAppliedPageAudit(supabase, clientId)
  if (audit.kind === 'error') return refuse('check_failed', `audit read: ${audit.message}`)
  const staffVerified = audit.kind === 'row' && audit.action === 'bind' && audit.requested_value === pageId
  if (audit.kind === 'row' && !staffVerified) {
    return refuse('audit_mismatch', `latest applied ${audit.action} ${audit.requested_value ?? '(none)'}`)
  }

  const userToken = await resolveMetaTokenDetailed(supabase, clientId, env)
  if (userToken === 'ownership_unknown') return refuse('check_failed', 'could not read who owns the scoped token key')
  if (!userToken) return refuse('no_meta_token')
  if (staffVerified) return { verdict: { verified: true, via: 'staff_verified' }, storedPageToken: null, userToken }
  if (userToken.source === 'shared_fallback') return refuse('unverified_shared_token')
  return { verdict: { verified: true, via: 'legacy_client_token' }, storedPageToken: null, userToken }
}

/** 只判定、不碰 Meta —— 每日待办和设置页用。 */
export async function assessPageBinding(
  supabase: SupabaseClient,
  clientId: string,
  pageId: string,
  env: Env,
): Promise<PageBindingAssessment> {
  return (await evaluate(supabase, clientId, pageId, env)).verdict
}

export type PageSyncAuthorization =
  | { ok: true; pageToken: string; via: PageVerifiedVia }
  | { ok: false; skipped: 'page_not_verified'; reason: PageSyncRefusal; detail?: string }
  | { ok: false; skipped: 'no_meta_token' | 'no_page_token' }

/**
 * 同步前调用：核实通过才换主页令牌。私信同步和表单线索同步共用。
 * 永不抛异常（getPageAccessToken 的网络错误按「换不到令牌」处理）。
 */
export async function authorizePageSync(
  supabase: SupabaseClient,
  clientId: string,
  pageId: string,
  env: Env,
): Promise<PageSyncAuthorization> {
  const { verdict, storedPageToken, userToken } = await evaluate(supabase, clientId, pageId, env)
  if (!verdict.verified) {
    if (verdict.reason === 'no_meta_token') return { ok: false, skipped: 'no_meta_token' }
    return { ok: false, skipped: 'page_not_verified', reason: verdict.reason, ...(verdict.detail ? { detail: verdict.detail } : {}) }
  }
  if (storedPageToken) return { ok: true, pageToken: storedPageToken, via: verdict.via }

  let pageToken: string | null = null
  try {
    pageToken = userToken ? await getPageAccessToken(userToken.token, pageId) : null
  } catch {
    pageToken = null
  }
  return pageToken ? { ok: true, pageToken, via: verdict.via } : { ok: false, skipped: 'no_page_token' }
}

/**
 * 别处配置的主页号（social_comment_config.fb_page_id、factory_config.publish_target）
 * 客户成员能改，不能直接拿去读 / 回复 / 隐藏 / 发私信。放行条件：
 *   · 就是这个客户绑定的主页 → 走 authorizePageSync 同一道闸；
 *   · 不是 → 只认这个客户对该主页的「连接 Meta」授权（发布主页的重新授权就会存这个），
 *     且主页没绑在别的客户名下；只用那把存下的主页令牌。
 * 其余一律 page_not_verified / not_bound_page。
 */
type ConfiguredPage =
  | { kind: 'bound'; bound: string }
  | { kind: 'oauth'; pageId: string; token: string }
  | { kind: 'refused'; reason: PageSyncRefusal; detail?: string }

async function resolveConfiguredPage(
  supabase: SupabaseClient,
  clientId: string,
  configuredPageId: string,
): Promise<ConfiguredPage> {
  const configured = configuredPageId.trim()
  const { data, error } = await supabase
    .from('clients')
    .select('facebook_page_id')
    .eq('id', clientId)
    .maybeSingle()
  if (error) return { kind: 'refused', reason: 'check_failed', detail: error.message }
  const bound = ((data as { facebook_page_id?: string | null } | null)?.facebook_page_id ?? '').trim()

  if (bound && configured && pageIdMatches(bound, configured)) return { kind: 'bound', bound }
  if (!/^\d+$/.test(configured)) return { kind: 'refused', reason: 'not_bound_page' }

  try {
    const others = await findOtherClientsBoundToPage(supabase, clientId, configured)
    if (others.length > 0) return { kind: 'refused', reason: 'bound_to_other_client' }
  } catch (err) {
    return { kind: 'refused', reason: 'check_failed', detail: err instanceof Error ? err.message : String(err) }
  }
  const token = await loadStoredPageToken(supabase, clientId, configured)
  return token ? { kind: 'oauth', pageId: configured, token } : { kind: 'refused', reason: 'not_bound_page' }
}

export async function authorizeConfiguredPage(
  supabase: SupabaseClient,
  clientId: string,
  configuredPageId: string,
  env: Env,
): Promise<PageSyncAuthorization> {
  const page = await resolveConfiguredPage(supabase, clientId, configuredPageId)
  if (page.kind === 'bound') return authorizePageSync(supabase, clientId, page.bound, env)
  if (page.kind === 'oauth') return { ok: true, pageToken: page.token, via: 'client_oauth' }
  return { ok: false, skipped: 'page_not_verified', reason: page.reason, ...(page.detail ? { detail: page.detail } : {}) }
}

/** 同 authorizeConfiguredPage 的判定，不碰 Meta —— 每日待办用。 */
export async function assessConfiguredPage(
  supabase: SupabaseClient,
  clientId: string,
  configuredPageId: string,
  env: Env,
): Promise<PageBindingAssessment> {
  const page = await resolveConfiguredPage(supabase, clientId, configuredPageId)
  if (page.kind === 'bound') return assessPageBinding(supabase, clientId, page.bound, env)
  if (page.kind === 'oauth') return { verified: true, via: 'client_oauth' }
  return { verified: false, reason: page.reason, ...(page.detail ? { detail: page.detail } : {}) }
}
