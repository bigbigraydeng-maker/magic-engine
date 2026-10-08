/**
 * 自动「从刚发布的 Reel 起草一条暂停的 Facebook 广告」流水线的编排核心。
 *
 * 设计原则：
 *   - 先落意图账本，再动 Meta（见 intent-ledger.ts）。
 *   - fail-closed：任何不确定都以一个终态意图收尾，绝不静默。
 *   - 依赖注入：本文件不 import fetch / supabaseAdmin / env / token manager，
 *     所有外部副作用都通过 RunDeps 传入，便于测试与审计。
 *   - 永不抛异常：整个函数体包在 try/catch 里；意图已认领后若发生意外异常，
 *     把意图收尾为 'failed'（provider_impact 'unknown'）并返回 status 'failed'。
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { FactoryReelPublishedEventSchema } from '@/lib/factory/publish/reel-published-event'
import { evaluateReelDraftGates, type ReelWorkOrderRow } from './gates'
import { resolvePromotablePostId, type PostResolverDeps } from './post-resolver'
import type { LoadedFactoryReelDraftConfig } from './config'
import {
  claimIntent,
  finishIntent,
  type IntentPatch,
  type IntentStatus,
} from './intent-ledger'
import { validateDraft, type AdDraft } from '../ad-draft'
import type { CreateDraftDeps, CreateDraftOutcome } from '../draft-and-gate'

export interface ClientMetaFacts {
  adAccountId: string | null
  facebookPageId: string | null
  country: string | null
  industry: string | null
}

export interface RunDeps {
  supabase: SupabaseClient
  nowMs: () => number
  loadConfig: (clientId: string) => Promise<LoadedFactoryReelDraftConfig>
  loadWorkOrder: (
    workOrderId: string,
  ) => Promise<{ ok: true; row: ReelWorkOrderRow | null } | { ok: false; error: string }>
  loadRedlines: (clientId: string) => Promise<string[] | null>
  loadClientMeta: (clientId: string) => Promise<ClientMetaFacts | null>
  isAdAccountRegistered: (clientId: string, adAccountId: string) => Promise<boolean | null>
  resolveToken: (clientId: string) => Promise<{ token: string; source: string } | null>
  probeToken: (token: string) => Promise<{ ok: boolean; detail?: string }>
  loadPageToken: (clientId: string, pageId: string) => Promise<string | null>
  graphGetWith: (pageToken: string) => PostResolverDeps['graphGet']
  createDraft: (draft: AdDraft, deps: CreateDraftDeps) => Promise<CreateDraftOutcome>
}

export type RunStatus =
  | 'skipped_off'
  | 'invalid_event'
  | 'duplicate'
  | 'blocked'
  | 'dry_run_ok'
  | 'drafted'
  | 'draft_blocked'
  | 'failed'

export interface RunOutcome {
  status: RunStatus
  intentActionId: string | null
  blockCode?: string
  message?: string
  draftActionId?: string | null
  recordError?: string
}

/** 事件解析后的可信字段。 */
interface ParsedEvent {
  requestId: string
  clientId: string
  workOrderId: string
  pageId: string
  videoId: string
  publishedAt: string
}

/** 预检通过后携带的全部上下文。 */
interface Preflight {
  event: ParsedEvent
  cfg: LoadedFactoryReelDraftConfig
  row: ReelWorkOrderRow
  redlines: readonly string[] | null
  meta: ClientMetaFacts
  token: string
  postId: string
  matchedBy: string
}

/** 收尾助手：把意图推进到终态，并把写失败记录到 recordError。 */
type Finisher = (
  status: Exclude<IntentStatus, 'started'>,
  patch: IntentPatch,
) => Promise<string | undefined>

function parseEvent(eventData: unknown): ParsedEvent | null {
  const parsed = FactoryReelPublishedEventSchema.safeParse(eventData)
  if (!parsed.success) return null
  const d = parsed.data
  return {
    requestId: d.request_id,
    clientId: d.client_id,
    workOrderId: d.work_order_id,
    pageId: d.page_id,
    videoId: d.video_id,
    publishedAt: d.published_at,
  }
}

function shortTag(workOrderId: string): string {
  return workOrderId.slice(0, 8)
}

function buildDraft(
  event: ParsedEvent,
  cfg: LoadedFactoryReelDraftConfig,
  postId: string,
): AdDraft {
  const c = cfg.config
  if (!c) throw new Error('config missing')
  const short = shortTag(event.workOrderId)
  const draft: AdDraft = {
    kind: 'video_thruplay',
    clientId: event.clientId,
    campaignName: `[ME-DRAFT] ${short} Reel 养受众`,
    adSetName: `[ME-DRAFT] ${short} Reel 养受众 组`,
    dailyBudget: c.dailyBudget,
    durationDays: c.durationDays,
    ageMin: c.ageMin,
    ageMax: c.ageMax,
    geoCountries: c.geoCountries,
    pageId: event.pageId,
    creatives: [
      {
        name: `[ME-DRAFT] ${short} Reel`,
        primaryText: '',
        headline: '',
        postId,
      },
    ],
  }
  if (c.geoCityKeys.length > 0) draft.geoCityKeys = c.geoCityKeys
  return draft
}

/**
 * 编排核心。永不抛异常。
 */
export async function runFactoryReelAdDraft(
  deps: RunDeps,
  eventData: unknown,
): Promise<RunOutcome> {
  let intentActionId: string | null = null
  let finish: Finisher | null = null
  let recordError: string | undefined
  let shortRef = ''
  const ctx = { metaTouched: false }

  const blockWith = async (code: string, message: string): Promise<RunOutcome> => {
    if (finish) {
      const err = await finish('blocked', { block_code: code, error: message })
      if (err) recordError = err
    }
    return { status: 'blocked', intentActionId, blockCode: code, message, recordError }
  }

  try {
    // 1. 解析事件
    const event = parseEvent(eventData)
    if (!event) {
      return { status: 'invalid_event', intentActionId: null, message: '事件格式不合法' }
    }
    shortRef = shortTag(event.workOrderId)

    // 2. 读配置
    const cfg = await deps.loadConfig(event.clientId)
    if (cfg.effectiveMode === 'off' || cfg.config === null) {
      return {
        status: 'skipped_off',
        intentActionId: null,
        message: `source=${cfg.source}`,
      }
    }

    // 3. 认领意图
    const nowIso = new Date(deps.nowMs()).toISOString()
    const claim = await claimIntent(deps.supabase, {
      requestId: event.requestId,
      clientId: event.clientId,
      workOrderId: event.workOrderId,
      videoId: event.videoId,
      pageId: event.pageId,
      mode: cfg.effectiveMode,
      nowIso,
    })
    if (!claim.ok) {
      return {
        status: 'failed',
        intentActionId: null,
        blockCode: claim.reason,
        message: `认领意图失败：${claim.reason}`,
      }
    }
    intentActionId = claim.actionId
    if (claim.created === false) {
      return {
        status: 'duplicate',
        intentActionId: claim.actionId,
        message: `existing status=${claim.existing.status}`,
      }
    }

    finish = async (status, patch) => {
      const res = await finishIntent(deps.supabase, claim.actionId, status, patch, new Date(deps.nowMs()).toISOString())
      return res.ok ? undefined : res.error
    }

    // 4-9. 预检
    const pre = await preflight(deps, event, cfg, blockWith)
    if ('outcome' in pre) return pre.outcome

    // 10. 构建草稿
    const draft = buildDraft(event, cfg, pre.postId)
    const problems = validateDraft(draft)
    if (problems.length > 0) {
      const msg = problems.map((p) => `${p.field}：${p.message}`).join('；')
      return blockWith('draft_invalid', msg)
    }

    // 11. dry_run
    if (cfg.effectiveMode === 'dry_run') {
      const err = await finish('dry_run_ok', {
        post_id: pre.postId,
        ad_account_id: pre.meta.adAccountId ?? undefined,
        draft_preview: {
          campaignName: draft.campaignName,
          adSetName: draft.adSetName,
          dailyBudget: draft.dailyBudget,
          durationDays: draft.durationDays,
          geoCountries: draft.geoCountries ?? [],
          geoCityKeys: draft.geoCityKeys ?? [],
          ageMin: draft.ageMin,
          ageMax: draft.ageMax,
          adAccountId: pre.meta.adAccountId,
          postId: pre.postId,
          matchedBy: pre.matchedBy,
        },
      })
      if (err) recordError = err
      return { status: 'dry_run_ok', intentActionId, recordError }
    }

    // 12. on：真正起草
    return await createAndRecord(deps, event, cfg, pre, draft, finish, intentActionId, ctx)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (finish) {
      const err = await finish('failed', {
        error: ctx.metaTouched
          ? `起草时出现异常：${msg}。Meta 上可能已建好暂停对象，请按名字「[ME-DRAFT] ${shortRef}」去后台核对`
          : `起草时出现异常：${msg}`,
        provider_impact: ctx.metaTouched ? 'unknown' : 'none',
      })
      if (err) recordError = err
    }
    return { status: 'failed', intentActionId, message: msg, recordError }
  }
}

/**
 * 步骤 5-9：读工单、跑闸门、核对客户/账号/令牌、解析可推广帖子。
 * 返回 { outcome } 表示已阻断；返回 Preflight 表示通过。
 */
async function preflight(
  deps: RunDeps,
  event: ParsedEvent,
  cfg: LoadedFactoryReelDraftConfig,
  blockWith: (code: string, message: string) => Promise<RunOutcome>,
): Promise<Preflight | { outcome: RunOutcome }> {
  // 5. 工单
  const wo = await deps.loadWorkOrder(event.workOrderId)
  if (!wo.ok) return { outcome: await blockWith('work_order_unreadable', wo.error) }
  if (wo.row === null) {
    return { outcome: await blockWith('work_order_not_found', '找不到对应工单') }
  }

  // 6. 闸门
  const redlines = await deps.loadRedlines(event.clientId)
  const gates = evaluateReelDraftGates({
    claim: {
      clientId: event.clientId,
      workOrderId: event.workOrderId,
      pageId: event.pageId,
      videoId: event.videoId,
      publishedAt: event.publishedAt,
    },
    row: wo.row,
    redlines,
    nowMs: deps.nowMs(),
    maxAgeHours: cfg.config?.maxAgeHours ?? 0,
  })
  if (!gates.ok) return { outcome: await blockWith(gates.code, gates.message) }

  // 7. 客户 / 账号
  const meta = await deps.loadClientMeta(event.clientId)
  if (meta === null) return { outcome: await blockWith('client_unreadable', '读不到客户信息') }
  if (meta.facebookPageId !== event.pageId) {
    return { outcome: await blockWith('page_not_registered', '该主页未登记在本客户名下') }
  }
  if (!meta.adAccountId) {
    return { outcome: await blockWith('ad_account_missing', '客户没有广告账号') }
  }
  const registered = await deps.isAdAccountRegistered(event.clientId, meta.adAccountId)
  if (registered === null) {
    return { outcome: await blockWith('ad_account_unreadable', '读不到广告账号登记状态') }
  }
  if (!registered) {
    return { outcome: await blockWith('ad_account_not_registered', '广告账号未登记') }
  }

  // 8. 令牌
  const tok = await deps.resolveToken(event.clientId)
  if (tok === null) return { outcome: await blockWith('token_missing', '没有可用令牌') }
  if (tok.source === 'shared_fallback') {
    return { outcome: await blockWith('token_shared_fallback', '只找到共享兜底令牌，拒绝使用') }
  }
  const probe = await deps.probeToken(tok.token)
  if (!probe.ok) {
    return { outcome: await blockWith('token_dead', probe.detail ?? '令牌不可用') }
  }

  // 9. 主页令牌 + 解析帖子
  const pageToken = await deps.loadPageToken(event.clientId, event.pageId)
  if (pageToken === null) {
    return { outcome: await blockWith('page_token_missing', '没有主页令牌') }
  }
  const resolved = await resolvePromotablePostId(
    { graphGet: deps.graphGetWith(pageToken) },
    { pageId: event.pageId, videoId: event.videoId },
  )
  if (!resolved.ok) {
    return {
      outcome: await blockWith('post_unresolved:' + resolved.reason, resolved.message),
    }
  }

  return {
    event,
    cfg,
    row: wo.row,
    redlines,
    meta,
    token: tok.token,
    postId: resolved.postId,
    matchedBy: resolved.matchedBy,
  }
}

/**
 * 步骤 12：真正调用 createDraft 并据结果收尾。
 */
async function createAndRecord(
  deps: RunDeps,
  event: ParsedEvent,
  cfg: LoadedFactoryReelDraftConfig,
  pre: Preflight,
  draft: AdDraft,
  finish: Finisher,
  intentActionId: string,
  ctx: { metaTouched: boolean },
): Promise<RunOutcome> {
  const short = shortTag(event.workOrderId)
  const createDeps: CreateDraftDeps = {
    supabase: deps.supabase,
    adAccountId: pre.meta.adAccountId ?? '',
    accessToken: pre.token,
    expectedGeo: pre.meta.country,
    industry: pre.meta.industry,
    brandRedlines: pre.redlines ?? undefined,
  }

  let outcome: CreateDraftOutcome
  try {
    ctx.metaTouched = true
    outcome = await deps.createDraft(draft, createDeps)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const err = await finish('failed', {
      error: `起草时出现异常：${msg}。Meta 上可能已建好暂停对象，请按名字「[ME-DRAFT] ${short}」去后台核对`,
      provider_impact: 'unknown',
      post_id: pre.postId,
      ad_account_id: pre.meta.adAccountId ?? undefined,
    })
    return { status: 'failed', intentActionId, message: msg, recordError: err }
  }

  if (outcome.actionId === null) {
    const err = await finish('failed', {
      error: `广告草稿的账本行没写进去；Meta 上可能已建好暂停对象，请按名字「[ME-DRAFT] ${short}」去后台核对`,
      provider_impact: 'unknown',
      post_id: pre.postId,
      ad_account_id: pre.meta.adAccountId ?? undefined,
    })
    return { status: 'failed', intentActionId, recordError: err }
  }

  if (outcome.status === 'awaiting_approval') {
    const err = await finish('drafted', {
      post_id: pre.postId,
      draft_action_id: outcome.actionId,
      provider_impact: 'paused_objects_created',
      ad_account_id: pre.meta.adAccountId ?? undefined,
    })
    return {
      status: 'drafted',
      intentActionId,
      draftActionId: outcome.actionId,
      recordError: err,
    }
  }

  if (outcome.status === 'blocked') {
    const unpaused = outcome.findings.some((f) => f.code === 'not_paused')
    const baseError = outcome.error ?? summarizeFindings(outcome)
    const err = await finish('draft_blocked', {
      post_id: pre.postId,
      draft_action_id: outcome.actionId,
      provider_impact: unpaused ? 'unknown' : 'paused_objects_created',
      error: unpaused
        ? `回读发现有对象不是暂停状态，可能正在花钱，请立刻去 Meta 后台核对（补暂停结果见草稿账本）。${baseError}`
        : baseError,
      ad_account_id: pre.meta.adAccountId ?? undefined,
    })
    return {
      status: 'draft_blocked',
      intentActionId,
      draftActionId: outcome.actionId,
      recordError: err,
    }
  }

  const err = await finish('failed', {
    post_id: pre.postId,
    draft_action_id: outcome.actionId ?? undefined,
    error: outcome.error ?? 'unknown',
    provider_impact: 'unknown',
    ad_account_id: pre.meta.adAccountId ?? undefined,
  })
  return {
    status: 'failed',
    intentActionId,
    draftActionId: outcome.actionId,
    recordError: err,
  }
}

function summarizeFindings(outcome: CreateDraftOutcome): string {
  const codes = outcome.findings
    .map((f) => (typeof f === 'object' && f !== null && 'code' in f ? String((f as { code: unknown }).code) : ''))
    .filter((c) => c.length > 0)
  return codes.length > 0 ? codes.join('；') : '草稿被阻断'
}
