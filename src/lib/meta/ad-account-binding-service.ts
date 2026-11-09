/**
 * PATCH /api/clients/[id]/meta-ad-account 的业务流程（AD-SEC-3）。
 * 路由只管鉴权分流和把结果转成 HTTP；为什么要这几道闸见 ad-account-binding.ts，
 * 两张表怎么一起改、失败怎么恢复见 ad-account-registry-write.ts。
 *
 * 流程一览：
 *   内部员工 bind  → 令牌 → Graph 核实 → 跨客户重复检查 → [preview 到此为止]
 *                   → 审计 authorized（写不进去 = 拒绝）→ 改主账户（失败回滚）→ 审计 applied
 *   内部员工 clear → 审计 authorized → 清主账户（失败回滚）→ 审计 applied
 *   内部员工 dismiss_request → 审计 request_dismissed
 *   客户成员提交   → 不写任何绑定，只记 requested_by_client（限流），交给每日待办
 */

import {
  insertBindingAudit, finishBindingAudit, recordRejectedBinding,
  recentClientRequestValues, CLIENT_REQUESTS_PER_DAY,
} from '@/lib/clients/binding-audit'
import { supabaseAdmin } from '@/lib/supabase'
import { resolveMetaTokenForClient, type MetaTokenSource } from './token-manager'
import {
  verifyAdAccountAccessible, findOtherClientRegistrations,
  type VerifiedAdAccount, type OtherClientRegistration,
} from './ad-account-binding'
import { applyPrimaryChange } from './ad-account-registry-write'
import { listPendingBindingRequests } from '@/lib/clients/binding-requests'

export interface ServiceResult {
  status: number
  body: Record<string, unknown>
}

export interface BindOptions {
  clientId: string
  actorEmail: string
  adAccountId: string
  preview: boolean
  override: { reason: string } | null
  /** 旧主账户保留为这个客户的第二账户（仍受归属校验放行）；默认移除。 */
  keepPrevious: boolean
}

const KIND = 'meta_ad_account' as const
const MIN_OVERRIDE_REASON = 10

/** body 里的覆盖参数 → null（未覆盖）/ {reason} / 抛错（要覆盖但原因不够）。 */
export function parseOverride(body: { allow_shared_account?: unknown; override_reason?: unknown }) {
  if (body.allow_shared_account !== true) return null
  const reason = typeof body.override_reason === 'string' ? body.override_reason.trim() : ''
  if (reason.length < MIN_OVERRIDE_REASON) {
    throw new Error(`共用账户需要写清原因（至少 ${MIN_OVERRIDE_REASON} 个字）`)
  }
  return { reason: reason.slice(0, 500) }
}

async function readPrimary(clientId: string): Promise<{ value: string | null } | { error: string }> {
  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('meta_ad_account_id')
    .eq('id', clientId)
    .maybeSingle()
  if (error) return { error: error.message }
  if (!data) return { error: 'Client not found' }
  const raw = (data as { meta_ad_account_id: unknown }).meta_ad_account_id
  return { value: typeof raw === 'string' && raw.trim() ? raw : null }
}

interface Checked {
  account: VerifiedAdAccount
  tokenSource: MetaTokenSource
  sharedWith: OtherClientRegistration[]
}

/** 令牌 + Graph + 重复检查。返回 ServiceResult = 已拒绝（拒绝原因已尽力审计）。 */
async function runChecks(opts: BindOptions): Promise<Checked | ServiceResult> {
  const base = { client_id: opts.clientId, binding_kind: KIND, actor_email: opts.actorEmail,
    action: 'bind' as const, requested_value: opts.adAccountId }

  const token = await resolveMetaTokenForClient(opts.clientId)
  if (!token) {
    if (!opts.preview) await recordRejectedBinding({ ...base, outcome: 'rejected_no_token' })
    return { status: 424, body: { error: '这个客户没有可用的 Meta 令牌，无法核实账户，已拒绝保存。', reason: 'no_meta_token' } }
  }

  const verified = await verifyAdAccountAccessible(opts.adAccountId, token.token)
  if (!verified.ok) {
    if (!opts.preview) {
      await recordRejectedBinding({ ...base, outcome: 'rejected_graph', token_source: token.source, detail: `${verified.kind}: ${verified.detail}` })
    }
    const status = verified.kind === 'graph_unavailable' ? 502 : 422
    return { status, body: { error: 'Meta 读不到这个广告账户（号填错了，或 ME 没有这个账户的权限），已拒绝保存。', reason: verified.kind } }
  }

  let sharedWith: OtherClientRegistration[]
  try {
    sharedWith = await findOtherClientRegistrations(opts.clientId, verified.account.id)
  } catch (err) {
    return { status: 500, body: { error: `查不到其他客户的账户登记，无法确认有没有重复，已拒绝保存：${err instanceof Error ? err.message : String(err)}`, reason: 'duplicate_check_failed' } }
  }
  return { account: verified.account, tokenSource: token.source, sharedWith }
}

interface WriteArgs {
  clientId: string
  auditId: string
  previous: string | null
  next: string | null
  keepPrevious: boolean
}

/** 改主账户 + 补记审计结果，统一成 ServiceResult。 */
async function writeAndFinish(args: WriteArgs, success: Record<string, unknown>): Promise<ServiceResult> {
  const res = await applyPrimaryChange({
    clientId: args.clientId, previous: args.previous, next: args.next, keepPrevious: args.keepPrevious,
  })
  if (!res.ok) {
    await finishBindingAudit(args.auditId, 'write_failed', `${res.error} | rolled_back=${res.rolledBack}`)
    return res.rolledBack
      ? { status: 500, body: { error: `保存失败，已恢复成改之前的样子，可以重试：${res.error}`, reason: 'write_failed' } }
      : { status: 500, body: { error: `只写了一半，恢复也没成功 —— 这个客户的广告账户登记现在可能前后不一致，请把这句话截图发给开发：${res.error}`, reason: 'partial_write' } }
  }
  const detail = args.previous ? `previous ${args.previous}: ${res.removedPrevious ? 'removed' : 'kept as secondary'}` : undefined
  const audited = await finishBindingAudit(args.auditId, 'applied', detail)
  return {
    status: 200,
    body: { success: true, ...success, previous_removed: res.removedPrevious, ...(audited ? {} : { audit_incomplete: true }) },
  }
}

export async function bindAdAccount(opts: BindOptions): Promise<ServiceResult> {
  const checked = await runChecks(opts)
  if ('status' in checked) return checked
  const { account, tokenSource, sharedWith } = checked
  const summary = { account, token_source: tokenSource, shared_with: sharedWith }

  if (opts.preview) return { status: 200, body: { preview: true, ...summary } }

  if (sharedWith.length > 0 && !opts.override) {
    await recordRejectedBinding({
      client_id: opts.clientId, binding_kind: KIND, actor_email: opts.actorEmail, action: 'bind',
      outcome: 'rejected_duplicate', requested_value: account.id, token_source: tokenSource,
      shared_with_client_ids: sharedWith.map(s => s.client_id),
    })
    return { status: 409, body: { error: '这个广告账户已经登记在别的客户名下，已拒绝保存。', reason: 'account_registered_to_other_client', ...summary } }
  }

  const prev = await readPrimary(opts.clientId)
  if ('error' in prev) return { status: 500, body: { error: `读不到当前绑定：${prev.error}` } }

  const audit = await insertBindingAudit({
    client_id: opts.clientId, binding_kind: KIND, actor_email: opts.actorEmail, action: 'bind',
    outcome: 'authorized', previous_value: prev.value, requested_value: account.id,
    token_source: tokenSource, graph_account: { ...account },
    shared_with_client_ids: sharedWith.length ? sharedWith.map(s => s.client_id) : null,
    override_reason: sharedWith.length ? opts.override?.reason ?? null : null,
  })
  if ('error' in audit) {
    return { status: 500, body: { error: `审计记录写不进去，为安全起见没有保存：${audit.error}`, reason: 'audit_unavailable' } }
  }

  return writeAndFinish(
    { clientId: opts.clientId, auditId: audit.id, previous: prev.value, next: account.id, keepPrevious: opts.keepPrevious },
    { ad_account_id: account.id, ...summary },
  )
}

export async function clearAdAccount(clientId: string, actorEmail: string, keepPrevious: boolean): Promise<ServiceResult> {
  const prev = await readPrimary(clientId)
  if ('error' in prev) return { status: 500, body: { error: `读不到当前绑定：${prev.error}` } }

  const audit = await insertBindingAudit({
    client_id: clientId, binding_kind: KIND, actor_email: actorEmail, action: 'clear',
    outcome: 'authorized', previous_value: prev.value, requested_value: null,
  })
  if ('error' in audit) {
    return { status: 500, body: { error: `审计记录写不进去，为安全起见没有清空：${audit.error}`, reason: 'audit_unavailable' } }
  }
  return writeAndFinish({ clientId, auditId: audit.id, previous: prev.value, next: null, keepPrevious }, { ad_account_id: null })
}

export async function dismissBindingRequest(clientId: string, actorEmail: string): Promise<ServiceResult> {
  const res = await insertBindingAudit({
    client_id: clientId, binding_kind: KIND, actor_email: actorEmail,
    action: 'dismiss_request', outcome: 'request_dismissed',
  })
  if ('error' in res) return { status: 500, body: { error: `记录失败：${res.error}` } }
  return { status: 200, body: { success: true, dismissed: true } }
}

/**
 * 客户成员（含自助客户、受限管理员）提交的账户号：**不写绑定**，记一笔待核实，
 * 返回 403 让界面说清楚「已收到、团队核实后接上」。
 *
 * 限流（魏征实施审）：每个客户每天最多记 CLIENT_REQUESTS_PER_DAY 条；超了或读不到
 * 就不记，request_recorded=false，向导退回「上门时处理」—— 不会让客户以为交上去了。
 * 去重只跟「现在还挂着待处理」的那个号比：被 FDE 忽略过又重交，要重新记一条，
 * 否则回「已记下」而待办里其实没有（狄仁杰 2026-09-13 实测）。
 */
export async function recordClientRequest(
  clientId: string,
  actorEmail: string,
  adAccountId: string,
): Promise<ServiceResult> {
  const denied = {
    error: 'Only the Magic Lab team can connect an ad account. We have noted this number and will verify it with you.',
    reason: 'fde_verification_required',
  }
  const recent = await recentClientRequestValues(clientId, KIND)
  if (recent === null || recent.length >= CLIENT_REQUESTS_PER_DAY) {
    return { status: 403, body: { ...denied, request_recorded: false } }
  }
  let pending
  try {
    ;[pending] = await listPendingBindingRequests(supabaseAdmin, KIND, new Date(), [clientId])
  } catch {
    return { status: 403, body: { ...denied, request_recorded: false } }
  }
  if (pending?.requested_value === adAccountId) {
    return { status: 403, body: { ...denied, request_recorded: true } }
  }
  const res = await insertBindingAudit({
    client_id: clientId, binding_kind: KIND, actor_email: actorEmail,
    action: 'request', outcome: 'requested_by_client', requested_value: adAccountId,
  })
  if ('error' in res) console.error('[meta-ad-account] failed to record client request:', res.error)
  return { status: 403, body: { ...denied, request_recorded: !('error' in res) } }
}
