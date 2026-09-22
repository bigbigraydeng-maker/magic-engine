/**
 * 广告写路径的最低限度归属校验（AD-SEC-1）。
 *
 * ── 问题 ─────────────────────────────────────────────────────────────────
 * `meta-ads/execute` / `ad-health/stop-loss` 这类路径只校验 URL 里的客户身份
 * （`requirePaidClientAccess(clientId)`），`campaign_id` 却原样取自请求体、
 * 从不核对这条广告是不是真的属于这个客户。有权限的人提交一个别家客户的
 * campaign_id，就能停/改别家客户在投的广告。
 *
 * ── 这条守卫能挡住什么、挡不住什么 ───────────────────────────────────────
 * 挡住：campaign_id 根本不在这个客户注册的任一 Meta 广告账户里的情况——最
 * 粗暴的跨账户误操作/越权，也是本仓目前唯一有真凭实据可以核对的边界。
 *
 * 🔴 挡不住：CTS / Oztop 目前共用同一个 Meta 广告账户，account_id 本来就
 * 相同——同账户内的跨客户操作，这条校验查不出来。根治需要账户拆分，或者
 * 补一张「谁创建的这条广告」归属表，两条都是产品/运维决策，不是能靠这一次
 * 代码改动单方面解决的（详见 ROADMAP.md AD-SEC-1）。上线前必须让 PM 知道
 * 这个局限，不能把这条守卫当成「问题已解决」。
 *
 * ── 2026-09-13 多账户支持 ───────────────────────────────────────────────
 * 一个客户现在可以登记多个广告账户（`client_meta_ad_accounts`，见同名
 * migration）——CTS 就有两个：`meta_ad_account_id` 登记的"个人号"，和只在
 * 新表里、跑 ThruPlay 顶层认知广告的"CTStours 官方账户"。这里改成核对
 * campaign 是否属于**任意一个**登记账户，而不是只认 `meta_ad_account_id`
 * 那一个——否则官方账户上的广告永远过不了这道闸，将来想在健康检查页面暂停/
 * 调整那边的广告会被这道本该保护客户的闸门误拦。
 * 直接查表而不复用 `getClientAdAccounts`（后者对查询失败会静默退化成空
 * 数组）：这里是安全闸，"查不出来"必须原样拒绝并报错，不能被悄悄吞成
 * "没有账户"再走进下一个分支。
 */

import { supabaseAdmin } from '@/lib/supabase'
import { getCampaignDetails, type CampaignDetails } from './client'

function normalizeAccountId(id: string): string {
  return id.startsWith('act_') ? id.slice(4) : id
}

export type OwnershipCheckResult =
  | { ok: true; campaign: CampaignDetails }
  | { ok: false; error: string }

/**
 * 这个客户登记过的全部广告账户 id。查询本身出错时返回 `error`，调用方必须
 * fail closed，不能把"查不出来"当成"查到了 0 个"。
 */
export async function getRegisteredAccountIds(
  clientId: string,
): Promise<{ ids: string[]; error?: string }> {
  const { data, error } = await supabaseAdmin
    .from('client_meta_ad_accounts')
    .select('ad_account_id')
    .eq('client_id', clientId)

  if (error) {
    return { ids: [], error: `查不到这个客户的广告账户登记：${error.message}` }
  }
  if (data && data.length > 0) {
    return { ids: (data as Array<{ ad_account_id: string }>).map(row => row.ad_account_id) }
  }

  // 新表没有这个客户的行——多半是还没跑过回填 migration 的老客户，
  // 退回老列（clients.meta_ad_account_id）过渡期兼容。
  const { data: client, error: clientError } = await supabaseAdmin
    .from('clients')
    .select('meta_ad_account_id')
    .eq('id', clientId)
    .maybeSingle()

  if (clientError) {
    return { ids: [], error: `查不到这个客户的广告账户登记：${clientError.message}` }
  }
  const legacy = (client as { meta_ad_account_id?: string | null } | null)?.meta_ad_account_id
  return { ids: legacy ? [legacy] : [] }
}

/**
 * 读一次 campaign（带 account_id）+ 核对它是不是这个客户登记过的任意一个
 * 广告账户。任何一步读不出来都 fail closed（拒绝执行，不是放行）。
 */
export async function assertCampaignOwnedByClient(
  campaignId: string,
  clientId: string,
  accessToken: string,
): Promise<OwnershipCheckResult> {
  // campaign_id 来自请求体/查询串，下面会原样拼进 Graph 地址并带着令牌发出去。
  // 不是纯数字就先拒：`123?method=post&status=PAUSED` 这类值会在归属判定**之前**
  // 就把一次「读」变成别的请求（狄仁杰 2026-09-13 发现，未对真 Meta 实测）。
  // Meta 的 campaign id 一直是纯数字。
  if (!/^\d{1,32}$/.test(campaignId)) {
    return { ok: false, error: 'campaign_id 格式不对（只能是数字），已拒绝执行。' }
  }

  const { ids: registeredAccountIds, error: registryError } = await getRegisteredAccountIds(clientId)
  if (registryError) {
    return { ok: false, error: registryError }
  }
  if (registeredAccountIds.length === 0) {
    return { ok: false, error: '这个客户没有登记 Meta 广告账户，无法核对这条广告的归属，已拒绝执行。' }
  }

  const campaign = await getCampaignDetails(campaignId, accessToken)
  if (!campaign) {
    return { ok: false, error: '读不到这条广告的详情，无法核对归属，已拒绝执行。' }
  }
  if (!campaign.account_id) {
    return { ok: false, error: 'Meta 没有返回这条广告所属的账户信息，无法核对归属，已拒绝执行。' }
  }

  const normalizedCampaignAccount = normalizeAccountId(campaign.account_id)
  const belongsToClient = registeredAccountIds.some(
    id => normalizeAccountId(id) === normalizedCampaignAccount,
  )
  if (!belongsToClient) {
    return {
      ok: false,
      error: '这条广告不属于这个客户登记的任何广告账户 —— 已拒绝执行，防止跨客户误操作。',
    }
  }
  return { ok: true, campaign }
}
