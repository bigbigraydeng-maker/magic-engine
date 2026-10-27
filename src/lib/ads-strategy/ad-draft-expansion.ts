/**
 * 广告草稿扩展（S9）：多个广告组、系列预算、受众扩量开关、按钮、网址参数、首评。
 *
 * 只检查 ME 自己手里的草稿。不读 Meta，不写 Meta，不删除已有广告。
 * 现在的发布器表达不了的字段，由 `draftNotYetBuildable` 在建之前拦住。
 */
import type { AccountCapFacts, BudgetCheck } from '@/lib/marketing-plan/promo/budget-caps'
import { checkAdsBudget } from '@/lib/marketing-plan/promo/budget-caps'
import { parsePromoSpec, type AdsStep } from '@/lib/marketing-plan/promo/spec'
import {
  AUDIENCE_ID,
  MAX_AD_SETS,
  MAX_AUTO_DAILY_BUDGET,
  MESSENGER_CTA_TYPE,
  audienceListProblems,
  creativeProblems,
  isKnownDraftKind,
  messengerCreativeProblems,
  registerExpandedDraftProblems,
  validateDraft,
  type AdDraft,
  type AdDraftAdSet,
  type DraftExpansionSwitches,
  type DraftKind,
  type DraftProblem,
} from './ad-draft'
import { audienceReadinessError, type AudienceFact } from './draft-audiences'

const CTA_FOR_KIND: Readonly<Record<DraftKind, string>> = {
  lead_form: 'SIGN_UP',
  video_thruplay: 'LEARN_MORE',
  messenger_conversation: MESSENGER_CTA_TYPE,
}

const URL_TAGS = /^[A-Za-z0-9_.~\-]+=[A-Za-z0-9_.~\-]+(?:&[A-Za-z0-9_.~\-]+=[A-Za-z0-9_.~\-]+)*$/

export interface DraftBuildReviewContext {
  adAccountId?: string
  accounts?: readonly AccountCapFacts[]
  clientCapCents?: number | null
  /** 不传这个键 = 这次不核。传 null = 读过但没有数，必须写出来，不能当成通过。 */
  minDailyBudget?: { minor: number; currency: string } | null
  /** 不传这个键 = 这次不核。传 null = 名单没读到。地图里要是这个账户的受众。 */
  audienceFacts?: ReadonlyMap<string, AudienceFact> | null
}

export interface PromoPhaseAdSets {
  problems: DraftProblem[]
  budgetMode?: 'ad_set'
  /** 这一阶段各广告步骤的日预算合计，单位元。 */
  dailyBudget?: number
  adSets?: AdDraftAdSet[]
}

/** 发布器今天建不出来、或者建出来会和草稿不一致的，返回给人看的原因。建得了返回 null。 */
export function draftNotYetBuildable(d: AdDraft): string | null {
  const reasons: string[] = []
  if (d.adSets !== undefined) reasons.push('多个广告组')
  if (d.budgetMode === 'campaign' || d.campaignDailyBudget !== undefined) reasons.push('系列预算')
  if (d.budgetMode !== undefined && d.budgetMode !== 'ad_set' && d.budgetMode !== 'campaign') {
    reasons.push('看不懂的预算方式')
  }
  if (expansionBlocksBuild(d.expansion)) reasons.push('打开的受众扩量')
  if (Array.isArray(d.adSets)) {
    for (const set of d.adSets) {
      if (isAdSet(set) && expansionBlocksBuild(set.expansion)) reasons.push('打开的受众扩量')
    }
  }
  if (d.urlTags !== undefined || d.firstComment !== undefined) reasons.push('网址参数或首评')
  if (ctaBlocksBuild(d)) reasons.push('和广告类型不一致的按钮')
  if (reasons.length === 0) return null
  const unique = [...new Set(reasons)]
  return `这份草稿写了${unique.join('、')}。现在的建草稿程序只会建单个广告组、预算放在组上，并且不会按草稿去改已经存在的广告，所以这次没建。`
}

/** `validateDraft` 里多出来的那部分。旧草稿一个新字段都没有时，返回空。 */
export function expandedDraftProblems(d: AdDraft): DraftProblem[] {
  return [...budgetProblems(d), ...(Array.isArray(d.adSets) ? adSetListProblems(d) : singleSetExtraProblems(d))]
}

/**
 * S9 交接：草稿形状，加上建前复核。
 * 单个旧草稿如果挂了受众却没写扩量开关，这里会拦 —— 没写不等于关掉。
 * `validateDraft` 本身仍放行那种旧草稿，避免把已经合入的单组起草入口拦住。
 */
export function reviewDraftForBuild(d: AdDraft, ctx?: DraftBuildReviewContext): DraftProblem[] {
  const problems = [...validateDraft(d)]
  if (!Array.isArray(d.adSets)) {
    problems.push(...missingExpansionProblem(d.audienceIds, d.excludedAudienceIds, d.expansion, 'expansion'))
  }
  if (ctx) problems.push(...reviewContext(d, ctx))
  return problems
}

/** 用现成的预算上限检查。只看这份草稿每天要花多少，不读账户、不写账户。 */
export function reviewDraftAgainstCaps(
  d: AdDraft,
  adAccountId: string,
  accounts: readonly AccountCapFacts[],
  clientCapCents: number | null,
): BudgetCheck {
  if (adAccountId.trim() === '') {
    return { verdict: 'unknown', reasons: ['没给出广告账户，预算上限核不成'], per_account_cents: {}, notes: [] }
  }
  const steps = budgetSteps(d, adAccountId)
  if (!steps) {
    return { verdict: 'unknown', reasons: ['日预算不是能核对的正数'], per_account_cents: {}, notes: [] }
  }
  return checkAdsBudget(steps, accounts, clientCapCents)
}

/**
 * 从一个已经能被 `parsePromoSpec` 读懂的计划里，取出某一个阶段的广告步骤，变成广告组。
 * 计划里每个广告步骤自带日预算，所以这里的预算方式是组预算，不是系列预算。
 * 受众引用不是数字编号、或没有投放地区时，不返回广告组，也不猜一个国家。
 * 文案不在计划步骤里，返回的广告组文案是空的，调用方补上之后才能通过 `validateDraft`。
 */
export function readPromoPhaseAdSets(raw: unknown, phaseId: string): PromoPhaseAdSets {
  const parsed = parsePromoSpec(raw)
  if (!parsed.ok) return { problems: parsed.issues.map((i) => ({ field: i.path || 'promo', message: i.message })) }
  const phase = parsed.spec.phases.find((p) => p.id === phaseId)
  if (!phase) return { problems: [{ field: 'phaseId', message: `计划里没有这个阶段：${phaseId}` }] }
  const steps = phase.steps.filter((s) => s.kind === 'ads_campaign')
  if (steps.length === 0) return { problems: [{ field: 'adSets', message: '这个阶段没有广告步骤' }] }
  const problems: DraftProblem[] = []
  const adSets: AdDraftAdSet[] = []
  let cents = 0
  steps.forEach((step, i) => {
    const built = adSetFromPromoStep(step, i, problems)
    if (!built) return
    adSets.push(built.set)
    cents += built.cents
  })
  if (problems.length > 0) return { problems }
  return { problems: [], budgetMode: 'ad_set', dailyBudget: cents / 100, adSets }
}

function missingExpansionProblem(
  audienceIds: string[] | undefined,
  excludedAudienceIds: string[] | undefined,
  expansion: DraftExpansionSwitches | undefined,
  field: string,
): DraftProblem[] {
  const hasAudiences = (audienceIds?.length ?? 0) > 0 || (excludedAudienceIds?.length ?? 0) > 0
  if (!hasAudiences || expansion !== undefined) return []
  return [{ field, message: '挂了受众但没写受众扩量开关。没写不等于关掉，建前复核过不了' }]
}

function reviewContext(d: AdDraft, ctx: DraftBuildReviewContext): DraftProblem[] {
  const problems: DraftProblem[] = []
  if ('minDailyBudget' in ctx) problems.push(...minBudgetProblems(d, ctx.minDailyBudget ?? null))
  if ('audienceFacts' in ctx) problems.push(...audienceFactProblems(d, ctx.audienceFacts ?? null))
  if (ctx.accounts) {
    const accountId = ctx.adAccountId ?? ''
    const budget = reviewDraftAgainstCaps(d, accountId, ctx.accounts, ctx.clientCapCents ?? null)
    if (budget.verdict !== 'ok') {
      for (const reason of budget.reasons) problems.push({ field: 'dailyBudget', message: reason })
    }
  }
  return problems
}

function minBudgetProblems(d: AdDraft, min: { minor: number; currency: string } | null): DraftProblem[] {
  if (!min) return [{ field: 'minDailyBudget', message: '账户最低日预算没读到，这一项没核，不能当成已经通过' }]
  const rows = budgetRows(d)
  const problems: DraftProblem[] = []
  for (const row of rows) {
    if (row.cents === null || row.cents >= min.minor) continue
    const shown = (min.minor / 100).toFixed(2)
    problems.push({
      field: row.field,
      message: `每天预算 ${row.major} ${min.currency} 低于这个广告账户要求的最低日预算 ${shown} ${min.currency}`,
    })
  }
  return problems
}

function audienceFactProblems(d: AdDraft, facts: ReadonlyMap<string, AudienceFact> | null): DraftProblem[] {
  const sets = listedSets(d)
  const anyIds = sets.some((s) => (s.audienceIds?.length ?? 0) > 0 || (s.excludedAudienceIds?.length ?? 0) > 0)
  if (!anyIds) return []
  if (!facts) return [{ field: 'audienceIds', message: '受众名单没读到，核实不了归属和人数，不能当成已经通过' }]
  const problems: DraftProblem[] = []
  for (const set of sets) {
    const error = audienceReadinessError(set.audienceIds ?? [], set.excludedAudienceIds ?? [], facts)
    if (error) problems.push({ field: `${set.fieldPrefix}audienceIds`, message: error })
  }
  return problems
}

function budgetProblems(d: AdDraft): DraftProblem[] {
  const mode = d.budgetMode
  const hasSets = Array.isArray(d.adSets)
  if (mode === undefined && d.campaignDailyBudget === undefined && !hasSets) return []
  if (mode !== 'ad_set' && mode !== 'campaign') {
    return [{ field: 'budgetMode', message: '多个广告组或系列预算必须写明预算放在系列上还是每个广告组上' }]
  }
  if (mode === 'campaign') return campaignBudgetProblems(d)
  return adSetBudgetProblems(d)
}

function campaignBudgetProblems(d: AdDraft): DraftProblem[] {
  const p: DraftProblem[] = []
  const campaign = d.campaignDailyBudget
  if (!Number.isFinite(campaign) || (campaign ?? 0) <= 0) {
    p.push({ field: 'campaignDailyBudget', message: '系列预算必须是大于 0 的数' })
    return p
  }
  if (cents(campaign as number) !== cents(d.dailyBudget)) {
    p.push({ field: 'campaignDailyBudget', message: '系列日预算要和草稿上的每天预算是同一个数' })
  }
  if ((campaign as number) > MAX_AUTO_DAILY_BUDGET) {
    p.push({ field: 'campaignDailyBudget', message: `每天 ${campaign} 超过自动发布上限 ${MAX_AUTO_DAILY_BUDGET}` })
  }
  if (!Array.isArray(d.adSets)) return p
  let minSum = 0
  d.adSets.forEach((set, i) => {
    if (!isAdSet(set)) return
    p.push(...spendLimitProblems(set, i, campaign as number))
    if (set.dailyBudget !== undefined) {
      p.push({ field: `adSets[${i}].dailyBudget`, message: '系列预算时，不要再给每个广告组写日预算' })
    }
    if (typeof set.minDailyBudget === 'number') minSum += set.minDailyBudget
  })
  if (minSum > (campaign as number)) {
    p.push({ field: 'campaignDailyBudget', message: '各组每天至少要花的加起来，超过了系列日预算' })
  }
  return p
}

function adSetBudgetProblems(d: AdDraft): DraftProblem[] {
  const p: DraftProblem[] = []
  if (d.campaignDailyBudget !== undefined) {
    p.push({ field: 'campaignDailyBudget', message: '预算放在每个广告组上时，不要再写系列预算' })
  }
  if (!Array.isArray(d.adSets)) return p
  let sum = 0
  let sumOk = true
  d.adSets.forEach((set, i) => {
    if (!isAdSet(set)) return
    if (!Number.isFinite(set.dailyBudget) || (set.dailyBudget ?? 0) <= 0) {
      p.push({ field: `adSets[${i}].dailyBudget`, message: '每个广告组的日预算必须是大于 0 的数' })
      sumOk = false
      return
    }
    sum += set.dailyBudget as number
    if (set.minDailyBudget !== undefined || set.maxDailyBudget !== undefined) {
      p.push({ field: `adSets[${i}].minDailyBudget`, message: '组预算时不要写每组的最低或最高花费，那是系列预算才用的' })
    }
  })
  if (sumOk && cents(sum) !== cents(d.dailyBudget)) {
    p.push({ field: 'dailyBudget', message: '每天预算要等于各广告组日预算加起来' })
  }
  return p
}

function spendLimitProblems(set: AdDraftAdSet, index: number, campaign: number): DraftProblem[] {
  const p: DraftProblem[] = []
  const min = set.minDailyBudget
  const max = set.maxDailyBudget
  if (min !== undefined && (!Number.isFinite(min) || min <= 0 || min > campaign)) {
    p.push({ field: `adSets[${index}].minDailyBudget`, message: '这一组每天至少要花的，必须大于 0，且不能超过系列日预算' })
  }
  if (max !== undefined && (!Number.isFinite(max) || max <= 0 || max > campaign)) {
    p.push({ field: `adSets[${index}].maxDailyBudget`, message: '这一组每天最多能花的，必须大于 0，且不能超过系列日预算' })
  }
  if (typeof min === 'number' && typeof max === 'number' && min > max) {
    p.push({ field: `adSets[${index}].maxDailyBudget`, message: '这一组每天至少要花的，比最多能花的还多' })
  }
  return p
}

function adSetListProblems(d: AdDraft): DraftProblem[] {
  const sets = d.adSets
  if (!Array.isArray(sets)) return [{ field: 'adSets', message: '广告组格式不对' }]
  if (sets.length === 0) return [{ field: 'adSets', message: '一个广告组都没有' }]
  if (sets.length > MAX_AD_SETS) return [{ field: 'adSets', message: `一份草稿最多 ${MAX_AD_SETS} 个广告组` }]
  const p = rootLeftoverProblems(d)
  const names: string[] = []
  sets.forEach((set, i) => p.push(...oneSetProblems(d, set, i, names)))
  return p
}

function oneSetProblems(d: AdDraft, set: unknown, index: number, names: string[]): DraftProblem[] {
  if (!isAdSet(set)) return [{ field: `adSets[${index}]`, message: '这个广告组格式不对' }]
  const prefix = `adSets[${index}].`
  const p: DraftProblem[] = []
  if (set.name.trim() === '') p.push({ field: `${prefix}name`, message: '广告组没有名字' })
  if (names.includes(set.name)) p.push({ field: `${prefix}name`, message: `广告组名字重复：${set.name}` })
  names.push(set.name)
  p.push(...placeProblems(set, prefix))
  p.push(...ageProblems(set.ageMin, set.ageMax, prefix))
  p.push(...audienceListProblems(set.audienceIds, set.excludedAudienceIds, prefix))
  p.push(...switchProblems(set.expansion, hasAudienceIds(set), `${prefix}expansion`, true))
  p.push(...creativeProblems(d.kind, set.creatives, prefix))
  if (d.kind === 'messenger_conversation') p.push(...messengerCreativeProblems(set.creatives, prefix))
  if (set.creatives.length === 0) p.push({ field: `${prefix}creatives`, message: '一条广告文案都没有' })
  p.push(...ctaProblems(d.kind, set.ctaType, `${prefix}ctaType`))
  p.push(...urlTagProblems(set.urlTags, `${prefix}urlTags`))
  p.push(...firstCommentProblems(set.firstComment, `${prefix}firstComment`))
  return p
}

function singleSetExtraProblems(d: AdDraft): DraftProblem[] {
  return [
    ...switchProblems(d.expansion, hasAudienceIds(d), 'expansion', false),
    ...ctaProblems(d.kind, d.ctaType, 'ctaType'),
    ...urlTagProblems(d.urlTags, 'urlTags'),
    ...firstCommentProblems(d.firstComment, 'firstComment'),
  ]
}

function rootLeftoverProblems(d: AdDraft): DraftProblem[] {
  const p: DraftProblem[] = []
  if (d.adSetName !== '') p.push({ field: 'adSetName', message: '多个广告组时，组名写在每个广告组上，系列这一层不要再写组名' })
  if ((d.geoCountries?.length ?? 0) > 0 || (d.geoCityKeys?.length ?? 0) > 0) {
    p.push({ field: 'geoCountries', message: '多个广告组时，投放地区写在每个广告组上' })
  }
  if (d.creatives.length > 0) p.push({ field: 'creatives', message: '多个广告组时，文案写在每个广告组上' })
  if (d.audienceIds !== undefined || d.excludedAudienceIds !== undefined) {
    p.push({ field: 'audienceIds', message: '多个广告组时，受众写在每个广告组上' })
  }
  if (d.ageMin !== undefined || d.ageMax !== undefined) {
    p.push({ field: 'ageMin', message: '多个广告组时，年龄写在每个广告组上' })
  }
  if (d.expansion !== undefined || d.ctaType !== undefined || d.urlTags !== undefined || d.firstComment !== undefined) {
    p.push({ field: 'adSets', message: '多个广告组时，扩量开关、按钮、网址参数和首评写在每个广告组上' })
  }
  return p
}

function placeProblems(set: AdDraftAdSet, prefix: string): DraftProblem[] {
  const countries = set.geoCountries
  const cities = set.geoCityKeys ?? []
  if (!Array.isArray(countries) || countries.some((c) => typeof c !== 'string' || c.trim() === '')) {
    return [{ field: `${prefix}geoCountries`, message: '投放地区格式不对' }]
  }
  if (cities.some((c) => typeof c !== 'string' || c.trim() === '')) {
    return [{ field: `${prefix}geoCityKeys`, message: '城市格式不对' }]
  }
  if (countries.length === 0 && cities.length === 0) {
    return [{ field: `${prefix}geoCountries`, message: '没说投给哪里 —— 投给全世界不是一个决定，是漏了一步' }]
  }
  if (countries.length > 0 && cities.length > 0) {
    return [{ field: `${prefix}geoCityKeys`, message: '国家和城市不能同时填：一起写时城市范围会失效。要按城市投就只填城市' }]
  }
  return []
}

function ageProblems(ageMin: number | undefined, ageMax: number | undefined, prefix: string): DraftProblem[] {
  const p: DraftProblem[] = []
  if (ageMin !== undefined && ageMin < 18) p.push({ field: `${prefix}ageMin`, message: 'Meta 不允许投给 18 岁以下' })
  if (ageMin !== undefined && ageMax !== undefined && ageMin > ageMax) {
    p.push({ field: `${prefix}ageMax`, message: '年龄下限比上限还大' })
  }
  return p
}

function switchProblems(
  expansion: DraftExpansionSwitches | undefined,
  hasAudiences: boolean,
  field: string,
  requireWhenAudiences: boolean,
): DraftProblem[] {
  if (expansion === undefined) {
    if (requireWhenAudiences && hasAudiences) {
      return [{ field, message: '挂了受众但没写受众扩量开关。没写不等于关掉，建前复核过不了' }]
    }
    return []
  }
  if (!isSwitchShape(expansion)) {
    return [{ field, message: '受众扩量开关读不懂（三项都要是开或关）。读不懂不等于关掉' }]
  }
  const opened = expansion.advantageAudience || expansion.customAudienceRelaxed || expansion.lookalikeRelaxed
  if (hasAudiences && opened) {
    return [{ field, message: '挂了受众时不能打开优势受众、名单外扩量或相似人群。开着就会投到名单以外' }]
  }
  if (opened && (typeof expansion.source !== 'string' || expansion.source.trim() === '')) {
    return [{ field: `${field}.source`, message: '打开了受众扩量，但没写这个决定从哪来' }]
  }
  return []
}

function ctaProblems(kind: DraftKind, cta: unknown, field: string): DraftProblem[] {
  if (cta === undefined) return []
  if (!isKnownDraftKind(kind) || cta !== CTA_FOR_KIND[kind]) {
    const expected = isKnownDraftKind(kind) ? CTA_FOR_KIND[kind] : '和广告类型一致的按钮'
    return [{ field, message: `按钮必须是 ${expected}。不写就沿用这种广告现在的按钮，不要写别的` }]
  }
  return []
}

function urlTagProblems(tags: unknown, field: string): DraftProblem[] {
  if (tags === undefined) return []
  if (typeof tags !== 'string' || tags.length > 200 || !URL_TAGS.test(tags)) {
    return [{ field, message: '网址参数要是不含问号、不含空格的键值对，例如 utm_medium=paid' }]
  }
  return []
}

function firstCommentProblems(text: unknown, field: string): DraftProblem[] {
  if (text === undefined) return []
  if (typeof text !== 'string' || text.trim().length === 0 || text.length > 500) {
    return [{ field, message: '首评要是 1 到 500 个字的一段文字。不写就表示不发首评' }]
  }
  return []
}

function expansionBlocksBuild(expansion: unknown): boolean {
  if (expansion === undefined) return false
  if (!isSwitchShape(expansion)) return true
  return expansion.advantageAudience || expansion.customAudienceRelaxed || expansion.lookalikeRelaxed
}

function ctaBlocksBuild(d: AdDraft): boolean {
  if (!isKnownDraftKind(d.kind)) return false
  if (d.ctaType !== undefined && d.ctaType !== CTA_FOR_KIND[d.kind]) return true
  if (!Array.isArray(d.adSets)) return false
  return d.adSets.some((set) => isAdSet(set) && set.ctaType !== undefined && set.ctaType !== CTA_FOR_KIND[d.kind])
}

function budgetSteps(d: AdDraft, adAccountId: string): AdsStep[] | null {
  const rows = budgetRows(d)
  if (rows.length === 0 || rows.some((row) => row.cents === null || row.cents <= 0)) return null
  return rows.map((row, i) => ({
    id: `budget-${i}`,
    kind: 'ads_campaign' as const,
    settings: {
      ad_account_id: adAccountId,
      daily_budget_cents: row.cents as number,
      audience_ref: '',
      creative_refs: [],
      placements: [],
      paused_ranges: [],
    },
  }))
}

function budgetRows(d: AdDraft): { field: string; major: number; cents: number | null }[] {
  if (d.budgetMode === 'campaign') {
    return [{ field: 'campaignDailyBudget', major: d.campaignDailyBudget ?? Number.NaN, cents: cents(d.campaignDailyBudget) }]
  }
  if (Array.isArray(d.adSets)) {
    return d.adSets.filter(isAdSet).map((set, i) => ({
      field: `adSets[${i}].dailyBudget`,
      major: set.dailyBudget ?? Number.NaN,
      cents: cents(set.dailyBudget),
    }))
  }
  return [{ field: 'dailyBudget', major: d.dailyBudget, cents: cents(d.dailyBudget) }]
}

interface ListedSet {
  audienceIds?: string[]
  excludedAudienceIds?: string[]
  fieldPrefix: string
}

function listedSets(d: AdDraft): ListedSet[] {
  if (Array.isArray(d.adSets)) {
    return d.adSets.filter(isAdSet).map((set, i) => ({
      audienceIds: set.audienceIds,
      excludedAudienceIds: set.excludedAudienceIds,
      fieldPrefix: `adSets[${i}].`,
    }))
  }
  return [{ audienceIds: d.audienceIds, excludedAudienceIds: d.excludedAudienceIds, fieldPrefix: '' }]
}

function adSetFromPromoStep(
  step: AdsStep,
  index: number,
  problems: DraftProblem[],
): { set: AdDraftAdSet; cents: number } | null {
  const field = `steps[${index}]`
  const settings = step.settings
  const audienceIds = audienceIdsFromRef(settings.audience_ref, field, problems)
  const excluded = excludedFromRefs(settings.targeting?.excluded_audience_refs ?? [], field, problems)
  const countries = settings.targeting?.countries ?? []
  const cities = settings.targeting?.city_keys ?? []
  if (countries.length === 0 && cities.length === 0) {
    problems.push({ field: `${field}.targeting`, message: '这一步没有投放地区。受众编号不能代替投放地区，这里不猜国家' })
  }
  if (audienceIds === null || excluded === null || (countries.length === 0 && cities.length === 0)) return null
  const set: AdDraftAdSet = {
    name: step.id,
    dailyBudget: settings.daily_budget_cents / 100,
    geoCountries: cities.length > 0 ? [] : countries,
    ...(cities.length > 0 ? { geoCityKeys: cities } : {}),
    ...(settings.targeting?.age_min !== undefined ? { ageMin: settings.targeting.age_min } : {}),
    ...(settings.targeting?.age_max !== undefined ? { ageMax: settings.targeting.age_max } : {}),
    ...(audienceIds.length > 0 ? { audienceIds } : {}),
    ...(excluded.length > 0 ? { excludedAudienceIds: excluded } : {}),
    creatives: [],
  }
  return { set, cents: settings.daily_budget_cents }
}

function audienceIdsFromRef(ref: string, field: string, problems: DraftProblem[]): string[] | null {
  const trimmed = ref.trim()
  if (trimmed === '') return []
  if (!AUDIENCE_ID.test(trimmed)) {
    problems.push({ field: `${field}.audience_ref`, message: '受众引用不是受众编号，不能写进广告草稿' })
    return null
  }
  return [trimmed]
}

function excludedFromRefs(refs: readonly string[], field: string, problems: DraftProblem[]): string[] | null {
  const ids: string[] = []
  for (const ref of refs) {
    if (!AUDIENCE_ID.test(ref)) {
      problems.push({ field: `${field}.excluded_audience_refs`, message: '排除受众引用不是受众编号，不能写进广告草稿' })
      return null
    }
    ids.push(ref)
  }
  return ids
}

function hasAudienceIds(set: { audienceIds?: string[]; excludedAudienceIds?: string[] }): boolean {
  return (set.audienceIds?.length ?? 0) > 0 || (set.excludedAudienceIds?.length ?? 0) > 0
}

function isSwitchShape(v: unknown): v is DraftExpansionSwitches {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return typeof o.advantageAudience === 'boolean'
    && typeof o.customAudienceRelaxed === 'boolean'
    && typeof o.lookalikeRelaxed === 'boolean'
    && (o.source === undefined || typeof o.source === 'string')
}

function isAdSet(v: unknown): v is AdDraftAdSet {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return typeof o.name === 'string' && Array.isArray(o.geoCountries) && Array.isArray(o.creatives)
}

function cents(major: unknown): number | null {
  if (typeof major !== 'number' || !Number.isFinite(major)) return null
  return Math.round(major * 100)
}

registerExpandedDraftProblems(expandedDraftProblems)
