/**
 * Approved plan step + pooled creative → one AdDraft → one paused-draft card.
 * Does not write Meta. The card's existing submit path is the only build.
 * One card per ad step, because the publisher builds one ad set.
 * A work order opened by this plan's promotion signal can be used without a
 * stored promo window. A window that is present and does not cover still blocks.
 */

import type { AdDraft, AdDraftAdSet, AdDraftCreative, DraftExpansionSwitches, DraftKind } from './ad-draft'
import { canonicalHashOfInput } from '@/lib/kernel/canonical-hash'
import { draftNotYetBuildable, readPromoPhaseAdSets, reviewDraftForBuild } from './ad-draft-expansion'
import type { CreativePoolEntry } from './config'
import type { PausedDraftReview } from './paused-draft-facts'
import type { AdPlay } from './plan-seed/ad-plays'
import { PLAY_CATALOG } from './play-vocabulary'
import {
  accountBlockReason,
  chooseLeadForm,
  creativeReadyReason,
  expansionForAudiences,
  flightDays,
  kindForPlay,
  playForStep,
  videoIdFromPool,
  type CopyPair,
  type LeadFormRow,
} from './plan-to-draft-rules'
import { nzToday } from './promo-window'
import { plannedFlightSchedule } from './planned-flight'
import { parsePromoSpec, type AdsStep, type PromoPhase } from '@/lib/marketing-plan/promo/spec'

export interface AssemblyState {
  copies: Record<string, CopyPair>
  steps: Record<string, { status: 'issued' | 'blocked'; reason?: string; cardRunId?: string; at: string }>
}

export interface AssemblyPlan {
  id: string
  clientId: string
  title: string
  promo: unknown
  prescriptionId: string | null
  state: AssemblyState
}

export interface AssemblyDeps {
  now(): Date
  loadPlans(clientId: string): Promise<AssemblyPlan[]>
  loadPlays(clientId: string, prescriptionId: string): Promise<AdPlay[] | null>
  accounts(clientId: string): Promise<AccountFacts>
  pool(clientId: string): Promise<CreativePoolEntry[] | null>
  /** Work orders from this plan's promotion signal. Unreadable is not "none". */
  promotionWorkOrders(clientId: string, prescriptionId: string | null): Promise<{ unreadable: boolean; ids: string[] }>
  forms(clientId: string, pageId: string): Promise<{ ok: true; forms: LeadFormRow[] } | { ok: false; reason: string }>
  cover(clientId: string, videoId: string): Promise<string | null>
  linkUrl(clientId: string): Promise<string | null>
  brandText(clientId: string): Promise<string | null>
  copy(input: { brandText: string; playLabel: string }): Promise<{ ok: true; primaryText: string; headline: string } | { ok: false; reason: string }>
  reviewContext(clientId: string, adAccountId: string): Promise<{ accountLabel: string; review: PausedDraftReview } | null>
  issue(args: { clientId: string; draft: AdDraft; accountLabel: string; review: PausedDraftReview }): Promise<{ runId: string }>
  save(plan: AssemblyPlan, state: AssemblyState): Promise<void>
}

export interface AccountFacts {
  clientAccountId: string | null
  spendAccountId: string | null
  pageId: string | null
  unreadable: boolean
}

export interface StepAssembly {
  planId: string
  stepId: string
  status: 'issued' | 'blocked'
  reason?: string
  runId?: string
}

interface Shared {
  plays: AdPlay[] | null
  accounts: AccountFacts
  pool: CreativePoolEntry[] | null
}

interface StepCtx {
  clientId: string
  plan: AssemblyPlan
  phase: PromoPhase
  step: AdsStep
  shared: Shared
  state: AssemblyState
  deps: AssemblyDeps
}

interface GateOk {
  ok: true
  kind: DraftKind
  play: AdPlay
  set: AdDraftAdSet
  days: number
  expansion: DraftExpansionSwitches
}

interface AssetOk {
  ok: true
  creatives: AdDraftCreative[]
}

type Stop = { ok: false; reason: string }

export function emptyAssemblyState(): AssemblyState {
  return { copies: {}, steps: {} }
}

export async function assemblePausedDraftsForClient(
  clientId: string,
  deps?: AssemblyDeps,
): Promise<{ steps: StepAssembly[] }> {
  const resolved = deps ?? (await import('./plan-to-draft-io')).productionDeps()
  const plans = await resolved.loadPlans(clientId)
  const steps: StepAssembly[] = []
  for (const plan of plans) steps.push(...await assemblePlan(clientId, plan, resolved))
  return { steps }
}

export async function afterAssetPooled(
  pooled: boolean,
  clientId: string,
  assemble: (clientId: string) => Promise<unknown> = assemblePausedDraftsForClient,
): Promise<void> {
  if (!pooled) return
  try {
    await assemble(clientId)
  } catch (err) {
    console.error('[plan-to-draft] after pool failed', err instanceof Error ? err.message : 'error')
  }
}

async function assemblePlan(clientId: string, plan: AssemblyPlan, deps: AssemblyDeps): Promise<StepAssembly[]> {
  const parsed = parsePromoSpec(plan.promo)
  if (!parsed.ok) return [blocked(plan.id, plan.id, '推广计划读不懂，没有出卡。')]
  const shared = await loadShared(clientId, plan, deps)
  const state = cloneState(plan.state)
  const out: StepAssembly[] = []
  for (const phase of parsed.spec.phases) {
    for (const step of phase.steps) {
      if (step.kind !== 'ads_campaign') continue
      const prior = state.steps[step.id]
      if (prior?.status === 'issued') {
        out.push({ planId: plan.id, stepId: step.id, status: 'issued', ...(prior.cardRunId ? { runId: prior.cardRunId } : {}) })
        continue
      }
      const result = await assembleStep({ clientId, plan, phase, step, shared, state, deps })
      state.steps[step.id] = noteOf(result, deps.now())
      out.push(result)
    }
  }
  await deps.save(plan, state)
  return out
}

async function loadShared(clientId: string, plan: AssemblyPlan, deps: AssemblyDeps): Promise<Shared> {
  const accounts = await deps.accounts(clientId)
  const pool = await deps.pool(clientId)
  const plays = plan.prescriptionId ? await deps.loadPlays(clientId, plan.prescriptionId) : null
  return { plays, accounts, pool }
}

async function assembleStep(ctx: StepCtx): Promise<StepAssembly> {
  const gate = gateStep(ctx)
  if (!gate.ok) return blocked(ctx.plan.id, ctx.step.id, gate.reason)
  const assets = await readyCreatives(ctx, gate)
  if (!assets.ok) return blocked(ctx.plan.id, ctx.step.id, assets.reason)
  const extras = await leadAndLink(ctx, gate)
  if (!extras.ok) return blocked(ctx.plan.id, ctx.step.id, extras.reason)
  const copy = await copyFor(ctx, gate.play)
  if (!copy.ok) return blocked(ctx.plan.id, ctx.step.id, copy.reason)
  const draft = buildDraft(ctx, gate, assets.creatives, extras, copy)
  const problem = draftProblem(draft)
  if (problem) return blocked(ctx.plan.id, ctx.step.id, problem)
  return issueDraft(ctx, draft)
}

function gateStep(ctx: StepCtx): GateOk | Stop {
  const playStop = playGate(ctx)
  if (!playStop.ok) return playStop
  const shape = shapeGate(ctx)
  if (!shape.ok) return shape
  const read = readPromoPhaseAdSets(ctx.plan.promo, ctx.phase.id, ctx.step.id)
  const set = read.adSets?.length === 1 ? read.adSets[0] : undefined
  if (!set || read.problems.length > 0) {
    return { ok: false, reason: read.problems[0]?.message ?? '这一步读不成一个广告组，没有出卡。' }
  }
  const days = flightDays(ctx.phase.start_date, ctx.phase.end_date)
  if (!days.ok) return days
  const flight = plannedFlightSchedule({ startDate: ctx.phase.start_date, endDate: ctx.phase.end_date }, days.days, ctx.deps.now().getTime())
  if (!flight.ok) return { ok: false, reason: `${flight.reason}没有出卡。` }
  const expansion = expansionForAudiences(hasAudiences(set))
  if (!expansion.ok) return expansion
  return { ok: true, kind: playStop.kind, play: playStop.play, set, days: days.days, expansion: expansion.expansion }
}

function playGate(ctx: StepCtx): { ok: true; kind: DraftKind; play: AdPlay } | Stop {
  if (!ctx.plan.prescriptionId) return { ok: false, reason: '这份计划没有对应的广告打法，没有出卡。' }
  if (!ctx.shared.plays) return { ok: false, reason: '广告打法没读到，没有出卡。' }
  const play = playForStep(ctx.shared.plays, ctx.step.id)
  if (!play) return { ok: false, reason: '这一步没有对应的广告打法，没有出卡。' }
  const kind = kindForPlay(play.play)
  if (!kind) return { ok: false, reason: '这个打法还不能拼成暂停草稿，没有出卡。' }
  if (kind === 'messenger_conversation') {
    return { ok: false, reason: '私信广告要标明文案语言，计划里没有，没有出卡。' }
  }
  return { ok: true, kind, play }
}

function shapeGate(ctx: StepCtx): { ok: true } | Stop {
  const settings = ctx.step.settings
  if (settings.placements.length > 0) return { ok: false, reason: '这一步写了版位，这一轮不按版位建，没有出卡。' }
  if (settings.paused_ranges.length > 0) return { ok: false, reason: '这一步写了暂停区间，这一轮不按暂停区间建，没有出卡。' }
  if (ctx.shared.accounts.unreadable) return { ok: false, reason: '广告账户没读到，没有出卡。' }
  const account = accountBlockReason(
    settings.ad_account_id,
    ctx.shared.accounts.clientAccountId,
    ctx.shared.accounts.spendAccountId,
  )
  if (account) return { ok: false, reason: account }
  if (!ctx.shared.accounts.pageId) return { ok: false, reason: '客户没有设置 Facebook 主页，没有出卡。' }
  return { ok: true }
}

async function readyCreatives(ctx: StepCtx, gate: GateOk): Promise<AssetOk | Stop> {
  if (!ctx.shared.pool) return { ok: false, reason: '素材池读不出来，素材还没准备好。' }
  const chosen = await refsForStep(ctx, ctx.shared.pool)
  if (!chosen.ok) return chosen
  const today = nzToday(ctx.deps.now().getTime())
  const use = { start: ctx.phase.start_date, end: ctx.phase.end_date }
  const creatives: AdDraftCreative[] = []
  for (let i = 0; i < chosen.refs.length; i += 1) {
    const ref = chosen.refs[i]
    if (!ref) return { ok: false, reason: '素材还没准备好。' }
    const one = await oneCreative(ctx, gate, ref, i, today, use, chosen.linked)
    if (!one.ok) return one
    creatives.push(one.creative)
  }
  return { ok: true, creatives }
}

async function refsForStep(
  ctx: StepCtx,
  pool: CreativePoolEntry[],
): Promise<{ ok: true; refs: string[]; linked: ReadonlySet<string> } | Stop> {
  const linked = await ctx.deps.promotionWorkOrders(ctx.clientId, ctx.plan.prescriptionId)
  const named = ctx.step.settings.creative_refs
  if (named.length > 0) {
    if (linked.unreadable && named.some((ref) => {
      const entry = pool.find((row) => row.ref === ref)
      return Boolean(entry) && entry?.promo_window === undefined
    })) {
      return { ok: false, reason: '推广素材的关联读不到，没有出卡。' }
    }
    return { ok: true, refs: named, linked: new Set(linked.ids) }
  }
  if (linked.unreadable) return { ok: false, reason: '推广素材的关联读不到，没有出卡。' }
  const refs = linked.ids.filter((id) => pool.some((row) => row.ref === id && row.status === 'approved'))
  if (refs.length > 0) return { ok: true, refs, linked: new Set(linked.ids) }
  if (linked.ids.length > 0) return { ok: false, reason: '这条推广的素材还没入池，素材还没准备好。' }
  return { ok: false, reason: '这一步没有指定素材，素材还没准备好。' }
}

async function oneCreative(
  ctx: StepCtx,
  gate: GateOk,
  ref: string,
  index: number,
  today: string,
  use: { start: string; end: string },
  linked: ReadonlySet<string>,
): Promise<{ ok: true; creative: AdDraftCreative } | Stop> {
  const entry = ctx.shared.pool?.find((row) => row.ref === ref)
  if (!entry || entry.status !== 'approved') return { ok: false, reason: '素材还没准备好。' }
  const window = creativeReadyReason(entry, today, use, linked.has(entry.ref))
  if (window) return { ok: false, reason: window }
  const video = videoIdFromPool(entry)
  if (!video.ok) return video
  const creative: AdDraftCreative = {
    name: `${ctx.step.id}-${index + 1}`,
    primaryText: '',
    headline: '',
    videoId: video.videoId,
  }
  if (gate.kind !== 'lead_form') return { ok: true, creative }
  const cover = await ctx.deps.cover(ctx.clientId, video.videoId)
  if (!cover || !cover.startsWith('https://')) return { ok: false, reason: '表单广告的视频没有封面，没有出卡。' }
  return { ok: true, creative: { ...creative, thumbnailUrl: cover } }
}

async function leadAndLink(
  ctx: StepCtx,
  gate: GateOk,
): Promise<{ ok: true; leadFormId?: string; linkUrl?: string } | Stop> {
  const lead = await leadFormIdFor(ctx, gate.kind)
  if (!lead.ok) return lead
  if (gate.kind !== 'video_thruplay') return { ok: true, leadFormId: lead.id }
  const linkUrl = await ctx.deps.linkUrl(ctx.clientId)
  if (!linkUrl) return { ok: false, reason: '看完视频广告没有可用的官网链接，没有出卡。' }
  return { ok: true, leadFormId: lead.id, linkUrl }
}

async function leadFormIdFor(ctx: StepCtx, kind: DraftKind): Promise<{ ok: true; id?: string } | Stop> {
  if (kind !== 'lead_form') return { ok: true }
  const pageId = ctx.shared.accounts.pageId
  if (!pageId) return { ok: false, reason: '客户没有设置 Facebook 主页，没有出卡。' }
  const forms = await ctx.deps.forms(ctx.clientId, pageId)
  if (!forms.ok) return { ok: false, reason: '表单名单没读到，需要选定一个已经存在的表单。' }
  const chosen = chooseLeadForm({
    namedId: ctx.step.settings.lead_form_id,
    namedName: ctx.step.settings.lead_form_name,
    forms: forms.forms,
  })
  if (!chosen.ok) return chosen
  return { ok: true, id: chosen.id }
}

async function copyFor(ctx: StepCtx, play: AdPlay): Promise<{ ok: true; primaryText: string; headline: string } | Stop> {
  const cached = ctx.state.copies[ctx.step.id]
  if (cached?.primaryText.trim() && cached.headline.trim()) return { ok: true, ...cached }
  const brandText = await ctx.deps.brandText(ctx.clientId)
  if (!brandText) return { ok: false, reason: '没有品牌资料，广告文案没有写出来。' }
  const written = await ctx.deps.copy({ brandText, playLabel: PLAY_CATALOG[play.play].label })
  if (!written.ok) return written
  ctx.state.copies[ctx.step.id] = { primaryText: written.primaryText, headline: written.headline }
  return written
}

function buildDraft(
  ctx: StepCtx,
  gate: GateOk,
  creatives: AdDraftCreative[],
  extras: { leadFormId?: string; linkUrl?: string },
  copy: { primaryText: string; headline: string },
): AdDraft {
  const set = gate.set
  const title = ctx.plan.title.trim() || ctx.step.id
  const stepKey = canonicalHashOfInput({ planId: ctx.plan.id, stepId: ctx.step.id }).slice(0, 16)
  return {
    kind: gate.kind,
    clientId: ctx.clientId,
    campaignName: `ME-${stepKey} · ${title} · ${ctx.step.id}`.slice(0, 180),
    adSetName: set.name,
    dailyBudget: set.dailyBudget ?? 0,
    durationDays: gate.days,
    plannedFlight: { startDate: ctx.phase.start_date, endDate: ctx.phase.end_date },
    geoCountries: set.geoCountries,
    ...(set.geoCityKeys ? { geoCityKeys: set.geoCityKeys } : {}),
    ...(set.ageMin !== undefined ? { ageMin: set.ageMin } : {}),
    ...(set.ageMax !== undefined ? { ageMax: set.ageMax } : {}),
    ...(set.audienceIds?.length ? { audienceIds: set.audienceIds } : {}),
    ...(set.excludedAudienceIds?.length ? { excludedAudienceIds: set.excludedAudienceIds } : {}),
    pageId: ctx.shared.accounts.pageId ?? '',
    ...(extras.leadFormId ? { leadFormId: extras.leadFormId } : {}),
    ...(extras.linkUrl ? { linkUrl: extras.linkUrl } : {}),
    expansion: gate.expansion,
    creatives: creatives.map((creative) => ({
      ...creative,
      primaryText: copy.primaryText,
      headline: copy.headline,
    })),
  }
}

function draftProblem(draft: AdDraft): string | null {
  const problems = reviewDraftForBuild(draft)
  if (problems.length > 0) return problems[0]?.message ?? '草稿复核没通过，没有出卡。'
  return draftNotYetBuildable(draft)
}

async function issueDraft(ctx: StepCtx, draft: AdDraft): Promise<StepAssembly> {
  const context = await ctx.deps.reviewContext(ctx.clientId, ctx.step.settings.ad_account_id)
  if (!context) return blocked(ctx.plan.id, ctx.step.id, '确认卡需要的账户资料没读到，没有出卡。')
  try {
    const card = await ctx.deps.issue({
      clientId: ctx.clientId,
      draft,
      accountLabel: context.accountLabel,
      review: context.review,
    })
    return { planId: ctx.plan.id, stepId: ctx.step.id, status: 'issued', runId: card.runId }
  } catch (err) {
    const message = err instanceof Error ? err.message : ''
    if (message.includes('已经在建或已经送审')) {
      return { planId: ctx.plan.id, stepId: ctx.step.id, status: 'issued' }
    }
    return blocked(ctx.plan.id, ctx.step.id, '确认卡没有发出。')
  }
}

function hasAudiences(set: AdDraftAdSet): boolean {
  return (set.audienceIds?.length ?? 0) > 0 || (set.excludedAudienceIds?.length ?? 0) > 0
}

function blocked(planId: string, stepId: string, reason: string): StepAssembly {
  return { planId, stepId, status: 'blocked', reason }
}

function noteOf(result: StepAssembly, now: Date) {
  return {
    status: result.status,
    ...(result.reason ? { reason: result.reason } : {}),
    ...(result.runId ? { cardRunId: result.runId } : {}),
    at: now.toISOString(),
  }
}

function cloneState(state: AssemblyState): AssemblyState {
  return { copies: { ...state.copies }, steps: { ...state.steps } }
}
