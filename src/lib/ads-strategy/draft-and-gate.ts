/**
 * 「ME 发广告」的中枢：起草 → 建成暂停 → 回读过闸门 → 落账等人点头。
 *
 * ── 三条不许绕的规矩 ──────────────────────────────────────────────────────
 * 1. **建出来的一律是暂停的。** 没有任何一条路径能让 ME 自己让广告开始花钱。
 * 2. **闸门拦下的不进审批队列。** 拦下就是 ME 自己的活没干完，不该拿去问人
 *    「这个有问题你还开吗」—— 那是把技术判断塞回给人。
 * 3. **一步都不许静默。** 建失败、回读失败、闸门拦下，都会留一行账，且各自是
 *    不同的状态。「查不出来」永远不等于「没问题」。
 *
 * ── 账本用 flywheel_actions，没有新表 ────────────────────────────────────
 * 这张表本来就是广告动作的流水（`meta-ads/execute` 一直在写）。状态放 payload
 * 里而不是新开一列：一条广告的一生就三个状态，为它加表加列不值得，而且
 * migration 要 PM 显式点头。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { AdDraft } from './ad-draft'
import { validateDraft, describeDraft, DRAFT_PLAY } from './ad-draft'
import { publishDraftPaused, activatePublished } from '@/lib/meta/ad-publisher'
import { fetchAdSetReadback, fetchAdCreativesReadback } from '@/lib/meta/readback'
import { adaptMetaAdSet } from './meta-readback-adapter'
import { checkLaunch, renderReadback, type LaunchFinding } from './launch-readback'

/** 一条草案在账本里的状态。 */
export type DraftStatus =
  /** 建出来了、闸门过了、等人点头。**只有这个状态会出现在审批页。** */
  | 'awaiting_approval'
  /** 闸门拦下了 —— ME 自己的活没干完，不拿去烦人。 */
  | 'blocked'
  /** 建到一半失败了。 */
  | 'failed'
  /** 人点头开了。 */
  | 'active'
  /** 人否了。 */
  | 'rejected'

export const ADS_CREATE_ACTION = 'ads.create_ad'

export interface DraftRecord {
  status: DraftStatus
  draft: AdDraft
  summary: string
  campaignId?: string
  adSetId?: string
  adIds?: string[]
  findings?: LaunchFinding[]
  /** 买家会看到的每一句，原样存下来给人过目。 */
  buyerWillSee?: { adName: string; lines: string[] }[]
  /** 人能直接读的那段回读报告。 */
  readback?: string
  error?: string
  /** 建到一半没删干净的东西 —— 必须有人去 Meta 后台收拾。 */
  orphans?: string[]
}

export interface CreateDraftDeps {
  supabase: SupabaseClient
  adAccountId: string
  accessToken: string
  /** 客户所在地区，用来对照投放地区。给不出就跳过那条检查。 */
  expectedGeo?: string | null
  /** 客户行业（`clients.industry`），闸门文案从广告剧本取叫法。给不出就用中性词。 */
  industry?: string | null
}

async function record(
  supabase: SupabaseClient,
  clientId: string,
  payload: DraftRecord,
): Promise<string | null> {
  const { data } = await supabase
    .from('flywheel_actions')
    .insert({
      client_id: clientId,
      flywheel: 'ads',
      action_type: ADS_CREATE_ACTION,
      execution_mode: 'third_party',
      vendor: 'meta',
      payload,
    })
    .select('id')
    .maybeSingle()
  return (data as { id?: string } | null)?.id ?? null
}

export interface CreateDraftOutcome {
  actionId: string | null
  status: DraftStatus
  summary: string
  findings: LaunchFinding[]
  readback?: string
  error?: string
}

/**
 * 起草一条广告并建成暂停状态，然后立刻过闸门。
 *
 * 返回的 `status` 就是它现在的处境：`awaiting_approval` 才轮到人看。
 */
export async function createDraftForApproval(
  draft: AdDraft,
  deps: CreateDraftDeps,
): Promise<CreateDraftOutcome> {
  const summary = describeDraft(draft)

  // ── 0. ME 自己就能判的错，不要浪费一次真实创建 ────────────────────────
  const problems = validateDraft(draft)
  if (problems.length > 0) {
    const error = problems.map((p) => `${p.field}：${p.message}`).join('；')
    const id = await record(deps.supabase, draft.clientId, {
      status: 'failed', draft, summary, error,
    })
    return { actionId: id, status: 'failed', summary, findings: [], error }
  }

  // ── 1. 建（全程暂停）────────────────────────────────────────────────
  const published = await publishDraftPaused(draft, deps.adAccountId, deps.accessToken)
  if (!published.ok) {
    const error = `建到「${published.step}」这步失败：${published.error}`
    const id = await record(deps.supabase, draft.clientId, {
      status: 'failed', draft, summary, error,
      orphans: published.orphans.length > 0 ? published.orphans : undefined,
    })
    return { actionId: id, status: 'failed', summary, findings: [], error }
  }

  // ── 2. 回读 —— Meta 自动加了什么，只有这一步看得见 ────────────────────
  const [rawAdSet, creatives] = await Promise.all([
    fetchAdSetReadback(published.adSetId, deps.accessToken),
    fetchAdCreativesReadback(published.adSetId, deps.accessToken),
  ])

  if (!rawAdSet || !creatives) {
    // 回读不出来 ≠ 没问题。建都建出来了，但没人能保证它是干净的 —— 不进审批队列。
    const error =
      '广告建出来了（暂停着），但回读不到它的真实设置 —— 这是「查不出来」，不是「没问题」。' +
      '在查清楚之前不该开。'
    const id = await record(deps.supabase, draft.clientId, {
      status: 'blocked', draft, summary, error,
      campaignId: published.campaignId, adSetId: published.adSetId, adIds: published.adIds,
    })
    return { actionId: id, status: 'blocked', summary, findings: [], error }
  }

  // ── 3. 闸门 ────────────────────────────────────────────────────────
  const report = checkLaunch({
    ...adaptMetaAdSet(rawAdSet, creatives, {
      expectedGeo: deps.expectedGeo ?? null,
      // 打法确实是重定向就直说；**不是的时候不能传 false**。
      // 传 false 会顶掉名字启发式那道保险 —— 一个叫「暖池重定向」的组
      // 就此不再受重定向那几条检查约束，而它恰好是最需要被查的那种。
      // 2026-08-05 自测抓到：这行原来无条件传 false，等于把闸门关了一半。
      isRetargeting: DRAFT_PLAY[draft.kind] === 'warm_pool_retarget' ? true : undefined,
    }),
    industry: deps.industry ?? null,
  })
  const status: DraftStatus = report.safeToActivate ? 'awaiting_approval' : 'blocked'
  const readback = renderReadback(report)

  const id = await record(deps.supabase, draft.clientId, {
    status, draft, summary, readback,
    campaignId: published.campaignId, adSetId: published.adSetId, adIds: published.adIds,
    findings: report.findings,
    buyerWillSee: report.buyerWillSee,
  })

  return { actionId: id, status, summary, findings: report.findings, readback }
}

/**
 * 人点头 → 真的开。
 *
 * 开之前**再查一次状态**：草案可能是几小时前建的，中间 Meta 可能改过东西，
 * 也可能同一条被点了两次。只有 `awaiting_approval` 能开。
 */
export async function approveDraft(
  actionId: string,
  supabase: SupabaseClient,
  accessToken: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from('flywheel_actions')
    .select('id, client_id, payload')
    .eq('id', actionId)
    .eq('action_type', ADS_CREATE_ACTION)
    .maybeSingle()

  if (error) return { ok: false, error: error.message }
  if (!data) return { ok: false, error: '找不到这条草案' }

  const p = (data as { payload: DraftRecord | null }).payload
  if (!p) return { ok: false, error: '这条草案没有内容' }
  if (p.status !== 'awaiting_approval') {
    return { ok: false, error: `这条现在是「${p.status}」，只有等待批准的才能开` }
  }
  if (!p.campaignId || !p.adSetId || !p.adIds) {
    return { ok: false, error: '这条草案没记下 Meta 那边的 id，开不了' }
  }

  const r = await activatePublished(
    { campaignId: p.campaignId, adSetId: p.adSetId, adIds: p.adIds },
    accessToken,
  )
  if (!r.ok) return r

  await supabase
    .from('flywheel_actions')
    .update({ payload: { ...p, status: 'active' satisfies DraftStatus } })
    .eq('id', actionId)

  return { ok: true }
}

/** 人否了 —— 只改账本状态，Meta 那边它本来就是暂停的。 */
export async function rejectDraft(
  actionId: string,
  supabase: SupabaseClient,
  reason?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data } = await supabase
    .from('flywheel_actions')
    .select('payload')
    .eq('id', actionId)
    .eq('action_type', ADS_CREATE_ACTION)
    .maybeSingle()

  const p = (data as { payload: DraftRecord | null } | null)?.payload
  if (!p) return { ok: false, error: '找不到这条草案' }

  await supabase
    .from('flywheel_actions')
    .update({
      payload: { ...p, status: 'rejected' satisfies DraftStatus, error: reason ?? p.error },
    })
    .eq('id', actionId)
  return { ok: true }
}
