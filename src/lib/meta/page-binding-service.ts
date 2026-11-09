/**
 * PATCH /api/clients/[id]/facebook-page 的业务流程（AD-SEC-4）。
 * 路由只管鉴权和把结果转成 HTTP；各道闸防什么见 page-binding.ts。
 * 模板是 ad-account-binding-service.ts，差别：重复绑定不允许覆盖、只有一列要写。
 *
 * 流程一览（调用方已确认是内部员工）：
 *   bind  → Meta 核实 → 跨客户重复检查 → 审计 authorized（写不进去 = 拒绝）→ 写列 → 审计 applied
 *   clear → 审计 authorized（写不进去 = 拒绝）→ 清列 → 审计 applied
 */

import { supabaseAdmin } from '@/lib/supabase'
import {
  insertBindingAudit, finishBindingAudit, recordRejectedBinding, type BindingTokenSource,
} from '@/lib/clients/binding-audit'
import { findOtherClientsBoundToPage, type OtherPageBinding } from './page-binding'
import { getStoredPageToken, resolveMetaTokenForClient } from './token-manager'
import { listManagedPages } from './page-posts'

export interface ServiceResult {
  status: number
  body: Record<string, unknown>
}

const KIND = 'facebook_page' as const

export type PageVerification =
  | { ok: true; page: { id: string; name: string | null }; tokenSource: BindingTokenSource }
  | { ok: false; kind: 'no_token' | 'graph_unavailable' | 'not_accessible' }

/**
 * ME 现在能不能替这个客户操作这个主页：
 *   这个客户存过这个主页的 OAuth 令牌（授权人在主页上有角色）→ 通过；
 *   否则用客户的令牌问 Meta 能管理哪些主页，列表里有 → 通过（记下令牌来源）。
 * 共享令牌列得出来不代表主页属于这个客户 —— 跨客户靠重复检查守。
 */
export async function verifyPageReachable(clientId: string, pageId: string): Promise<PageVerification> {
  if (await getStoredPageToken(clientId, pageId)) {
    return { ok: true, page: { id: pageId, name: null }, tokenSource: 'client_oauth' }
  }

  const token = await resolveMetaTokenForClient(clientId)
  if (!token) return { ok: false, kind: 'no_token' }

  const pages = await listManagedPages(token.token)
  if (!pages) return { ok: false, kind: 'graph_unavailable' }

  const hit = pages.find((p) => p.id === pageId)
  if (!hit) return { ok: false, kind: 'not_accessible' }
  return { ok: true, page: { id: hit.id, name: hit.name }, tokenSource: token.source }
}

async function readCurrent(clientId: string): Promise<{ value: string | null } | { error: string }> {
  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('facebook_page_id')
    .eq('id', clientId)
    .maybeSingle()
  if (error) return { error: error.message }
  if (!data) return { error: 'Client not found' }
  const raw = (data as { facebook_page_id: unknown }).facebook_page_id
  return { value: typeof raw === 'string' && raw.trim() ? raw : null }
}

/** 写列 + 补记审计结果。 */
async function writeAndFinish(
  clientId: string,
  auditId: string,
  next: string | null,
  success: Record<string, unknown>,
): Promise<ServiceResult> {
  const { error } = await supabaseAdmin.from('clients').update({ facebook_page_id: next }).eq('id', clientId)
  if (error) {
    await finishBindingAudit(auditId, 'write_failed', error.message)
    return { status: 500, body: { error: `保存失败，主页绑定没有改动，可以重试：${error.message}`, reason: 'write_failed' } }
  }
  const audited = await finishBindingAudit(auditId, 'applied')
  return { status: 200, body: { success: true, page_id: next, ...success, ...(audited ? {} : { audit_incomplete: true }) } }
}

export async function bindPage(clientId: string, actorEmail: string, pageId: string): Promise<ServiceResult> {
  const base = { client_id: clientId, binding_kind: KIND, actor_email: actorEmail, action: 'bind' as const, requested_value: pageId }

  const verified = await verifyPageReachable(clientId, pageId)
  if (!verified.ok) {
    if (verified.kind === 'no_token') {
      await recordRejectedBinding({ ...base, outcome: 'rejected_no_token' })
      return { status: 424, body: { error: '这个客户没有可用的 Meta 令牌，也没有「连接 Meta」授权，无法核实主页，已拒绝保存。', reason: 'no_meta_token' } }
    }
    await recordRejectedBinding({ ...base, outcome: 'rejected_graph', detail: verified.kind })
    return verified.kind === 'graph_unavailable'
      ? { status: 502, body: { error: '暂时问不到 Meta（令牌失效或 Meta 故障），无法核实主页，已拒绝保存，稍后重试。', reason: 'graph_unavailable' } }
      : { status: 422, body: { error: 'Meta 说 ME 管理不了这个主页（号填错了，或主页还没授权给我们），已拒绝保存。', reason: 'page_not_accessible' } }
  }

  let others: OtherPageBinding[]
  try {
    others = await findOtherClientsBoundToPage(supabaseAdmin, clientId, pageId)
  } catch (err) {
    return { status: 500, body: { error: `查不到其他客户的主页绑定，无法确认有没有重复，已拒绝保存：${err instanceof Error ? err.message : String(err)}`, reason: 'duplicate_check_failed' } }
  }
  if (others.length > 0) {
    await recordRejectedBinding({
      ...base, outcome: 'rejected_duplicate', token_source: verified.tokenSource,
      shared_with_client_ids: others.map((o) => o.client_id),
    })
    return {
      status: 409,
      body: { error: '这个主页已经绑在别的客户名下，一个主页只能属于一个客户，已拒绝保存。', reason: 'page_bound_to_other_client', bound_to: others },
    }
  }

  const prev = await readCurrent(clientId)
  if ('error' in prev) return { status: 500, body: { error: `读不到当前绑定：${prev.error}` } }

  const audit = await insertBindingAudit({
    ...base, outcome: 'authorized', previous_value: prev.value,
    token_source: verified.tokenSource, graph_account: { ...verified.page },
  })
  if ('error' in audit) {
    return { status: 500, body: { error: `审计记录写不进去，为安全起见没有保存：${audit.error}`, reason: 'audit_unavailable' } }
  }
  return writeAndFinish(clientId, audit.id, pageId, { page: verified.page, token_source: verified.tokenSource })
}

export async function clearPage(clientId: string, actorEmail: string): Promise<ServiceResult> {
  const prev = await readCurrent(clientId)
  if ('error' in prev) return { status: 500, body: { error: `读不到当前绑定：${prev.error}` } }

  const audit = await insertBindingAudit({
    client_id: clientId, binding_kind: KIND, actor_email: actorEmail, action: 'clear',
    outcome: 'authorized', previous_value: prev.value, requested_value: null,
  })
  if ('error' in audit) {
    return { status: 500, body: { error: `审计记录写不进去，为安全起见没有清空：${audit.error}`, reason: 'audit_unavailable' } }
  }
  return writeAndFinish(clientId, audit.id, null, {})
}
