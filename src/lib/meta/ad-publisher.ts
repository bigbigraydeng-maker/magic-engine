/**
 * 把一份草案在 Meta 上**建成暂停状态**。
 *
 * ── 为什么一律 PAUSED，没有「直接开」这个选项 ────────────────────────────
 * 因为闸门只有在建完之后才查得出东西：Meta 自动加的问候语、自动放宽的人群、
 * 自动挂上的相似人群，传参时都不存在。要么建完再查，要么永远查不到。
 * 所以流程是 建（暂停）→ 回读 → 人点头 → 才开。
 *
 * 这个模块**不判对错**，只负责建。判在 `ads-strategy/launch-readback.ts`。
 *
 * ── 建到一半失败要能收拾 ────────────────────────────────────────────────
 * 新建整棵树是四次写操作（系列 / 组 / 创意 / 广告）。带了已有系列编号就跳过系列。
 * 任何一步都可能失败。半成品留在账户里比失败更糟：它会出现在后台、会被人误开。
 * 所以失败时按这次新建的逆序删回去，不删原来就有的系列。删不掉的如实报出来。
 */

import type { AdDraft, AdDraftCreative } from '@/lib/ads-strategy/ad-draft'
import { metaTripletFor, MESSENGER_CTA_TYPE } from '@/lib/ads-strategy/ad-draft'
import { isPlaybackGoal, PLAYBACK_REQUIRED_PLATFORMS } from '@/lib/ads-strategy/launch-readback'
import { assertOwnedByAccount, isMetaObjectId } from './owned-ad-object'

const GRAPH_BASE = 'https://graph.facebook.com/v21.0'

/** 单次写请求的上限。不设的话一次卡死就能把整个建广告请求拖过平台的超时线。 */
const WRITE_TIMEOUT_MS = 15_000
/** 回滚时单次删除的上限：回滚是在赶时间，别让它自己也卡住。 */
const DELETE_TIMEOUT_MS = 8_000

/** 时间预算。全部可选 —— 不给就是不限（现有调用方行为不变）。时间点是 `now()` 的毫秒数。 */
export interface PublishOptions {
  /** 过了这个点不再发起新的写：停手、回滚、报失败。 */
  stopWritingAt?: number
  /** 回滚时过了这个点就不再试删，没来得及删的 id 全部进 `orphans`。 */
  giveUpRollbackAt?: number
  now?: () => number
}

export interface PublishedDraft {
  campaignId: string
  adSetId: string
  adIds: string[]
  /** 建到一半失败、又没删干净的东西 —— 必须有人去 Meta 后台手动删。 */
  orphans: string[]
  /** 这次没有新建系列。补暂停和以后开投都不能去改它的开关。 */
  reusedCampaign?: boolean
  /** 这次没有新建广告组。补暂停和以后开投都不能去改它的开关。 */
  reusedAdSet?: boolean
}

export interface PublishFailure {
  ok: false
  step: 'campaign' | 'adset' | 'creative' | 'ad'
  error: string
  orphans: string[]
}

export type PublishResult = ({ ok: true } & PublishedDraft) | PublishFailure

/** `ambiguous`：请求没有得到明确答复（超时 / 断网 / 回执读不懂），Meta 那边**可能已经建成**。 */
type GraphCreateResult = { id: string } | { error: string; ambiguous: boolean }

async function graphPost(
  path: string,
  body: Record<string, string>,
  accessToken: string,
): Promise<GraphCreateResult> {
  let res: Response
  try {
    res = await fetch(`${GRAPH_BASE}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...body, access_token: accessToken }).toString(),
      signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
    })
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err), ambiguous: true }
  }
  const text = await res.text().catch(() => '')
  // 5xx（502 / 504 网关超时）可能是 Meta 建成之后才超时，和「明确拒绝」不是一回事。
  if (!res.ok) return { error: `HTTP ${res.status}: ${text.slice(0, 400)}`, ambiguous: res.status >= 500 }
  try {
    const json = JSON.parse(text) as { id?: unknown }
    if (typeof json.id !== 'string') {
      return { error: `返回里没有 id：${text.slice(0, 200)}`, ambiguous: true }
    }
    return { id: json.id }
  } catch {
    return { error: `返回不是 JSON：${text.slice(0, 200)}`, ambiguous: true }
  }
}

/**
 * 改一个已存在对象的字段。
 *
 * 跟 `graphPost` 分开是因为返回形状不同：建东西回 `{id}`，改东西回
 * `{"success":true}`。用同一个函数会把每次成功的修改读成失败。
 */
async function graphUpdate(
  id: string,
  body: Record<string, string>,
  accessToken: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  let res: Response
  try {
    res = await fetch(`${GRAPH_BASE}/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...body, access_token: accessToken }).toString(),
      signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
    })
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return { ok: false, error: `HTTP ${res.status}: ${text.slice(0, 400)}` }
  }
  return { ok: true }
}

/** 删一个刚建出来的东西。删不掉就返回 false —— 由调用方如实上报，不假装干净。 */
async function graphDelete(id: string, accessToken: string): Promise<boolean> {
  try {
    const res = await fetch(`${GRAPH_BASE}/${id}?access_token=${encodeURIComponent(accessToken)}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(DELETE_TIMEOUT_MS),
    })
    return res.ok
  } catch {
    return false
  }
}

/**
 * 🔴 城市和国家不能同时塞进 `geo_locations` —— Meta 按并集生效
 * （`NZ ∪ 北岸10km半径` = 整个 NZ），城市半径形同虚设。给了城市就只用城市，
 * 不再带国家（2026-08-04 事故：北岸 $1.25M 的房源投给了整个新西兰）。
 */
function targetingFor(d: AdDraft): Record<string, unknown> {
  const geo: Record<string, unknown> =
    d.geoCityKeys && d.geoCityKeys.length > 0
      ? { cities: d.geoCityKeys.map((key) => ({ key, radius: 10, distance_unit: 'kilometer' })) }
      : { countries: d.geoCountries }
  const targeting: Record<string, unknown> = {
    geo_locations: geo,
    age_min: d.ageMin ?? 25,
    age_max: d.ageMax ?? 65,
    // 看完类视频必须手动锁版位，否则 Meta 把钱导向 Audience Network 奖励视频（PITFALLS D9）。
    ...(isPlaybackGoal(metaTripletFor(d.kind).optimizationGoal)
      ? { publisher_platforms: [...PLAYBACK_REQUIRED_PLATFORMS] }
      : {}),
    // 明确关掉 Meta 的自动放宽。**这不代表它一定关着** —— Meta 可能照样开，
    // 所以建完还要回读一遍（这正是闸门存在的理由）。
    targeting_automation: { advantage_audience: 0 },
  }

  if (d.audienceIds && d.audienceIds.length > 0) {
    targeting.custom_audiences = d.audienceIds.map((id) => ({ id }))
    // 明确不放宽名单：不扩展到名单以外的人，也不自动加相似人群。
    targeting.targeting_relaxation_types = { custom_audience: 0, lookalike: 0 }
  }
  if (d.excludedAudienceIds && d.excludedAudienceIds.length > 0) {
    targeting.excluded_custom_audiences = d.excludedAudienceIds.map((id) => ({ id }))
  }

  return targeting
}

function assertNever(x: never): never {
  throw new Error(`不认识的广告类型：${String(x)}`)
}

/** 视频封面：hash 优先（链接可能是会过期的签名链接）。 */
function thumbnailFields(c: AdDraftCreative): Record<string, string> {
  if (c.thumbnailImageHash) return { image_hash: c.thumbnailImageHash }
  if (c.thumbnailUrl) return { image_url: c.thumbnailUrl }
  return {}
}

/**
 * 创意。**对 `kind` 穷举**：加新类型漏改这里会编译不过，而不是静默建成别的东西。
 *
 * 私信类型 🔴 **不写任何 link**（PITFALLS D13，2026-09-26 实测）：用接口建「点了开
 * Messenger」的素材时，带 `fb.com/messenger_doc/` 这个界面内部占位链接会被 Meta 当场
 * 报 1815765 拒收；一次过审的写法是 `app_destination: MESSENGER` 且不带 link。
 */
function creativeSpec(d: AdDraft, c: AdDraftCreative): Record<string, string> {
  const storySpec: Record<string, unknown> = { page_id: d.pageId }

  switch (d.kind) {
    case 'video_thruplay':
      storySpec.video_data = {
        video_id: c.videoId,
        message: c.primaryText,
        title: c.headline,
        ...(c.description ? { link_description: c.description } : {}),
        ...(c.thumbnailUrl ? { image_url: c.thumbnailUrl } : {}),
        call_to_action: { type: 'LEARN_MORE', value: { link: d.linkUrl ?? '' } },
      }
      break
    case 'messenger_conversation':
      storySpec.video_data = {
        video_id: c.videoId,
        message: c.primaryText,
        title: c.headline,
        ...(c.description ? { link_description: c.description } : {}),
        ...thumbnailFields(c),
        call_to_action: { type: MESSENGER_CTA_TYPE, value: { app_destination: 'MESSENGER' } },
      }
      break
    case 'lead_form': {
      if (c.videoId) {
        // 视频留资：实测过审的写法是 video_data（读回来是 object_type VIDEO），不是把 video_id 塞进 link_data
        // （同类实测见 docs/PITFALLS.md D13 与 Meta 广告手册 §30）。封面必给（validateDraft 查）。
        // CTA value 只写表单 id：10-09 真建成的上海那条（docs/clients/cts/2026-10-09-shanghai-ads-paused-build.md §2.3）
        // 的 CTA 里只有 lead_gen_form_id，落地页由表单结束页承载。Meta 视频留资示例的 value 里带 link（fb.me），
        // 带不带都有依据；这里取「有实测的那种」。
        storySpec.video_data = {
          video_id: c.videoId,
          message: c.primaryText,
          title: c.headline,
          ...(c.description ? { link_description: c.description } : {}),
          ...thumbnailFields(c),
          call_to_action: { type: 'SIGN_UP', value: { lead_gen_form_id: d.leadFormId } },
        }
      } else {
        storySpec.link_data = {
          message: c.primaryText,
          name: c.headline,
          ...(c.description ? { description: c.description } : {}),
          ...(c.imageHash ? { image_hash: c.imageHash } : {}),
          // 留资文档：link_data.link 只能是 https://fb.me/（真正的落地页在表单结束页）
          link: 'https://fb.me/',
          call_to_action: { type: 'SIGN_UP', value: { lead_gen_form_id: d.leadFormId } },
        }
      }
      break
    }
    default:
      return assertNever(d.kind)
  }

  return { name: c.name, object_story_spec: JSON.stringify(storySpec) }
}

function campaignBody(d: AdDraft): Record<string, string> {
  return {
    name: d.campaignName,
    objective: metaTripletFor(d.kind).objective,
    status: 'PAUSED',
    special_ad_categories: JSON.stringify([]),
    // ⚠️ 将来若走系列预算（CBO）路径，这个字段应随草案决定，不能照抄 'false'。
    // 预算放在广告组（不用系列预算）时，Meta 现在要求明确写 is_adset_budget_sharing_enabled
    // （否则报 100/4834011）。false = 各组预算互不共享，与我们每组独立日预算的做法一致。
    // 2026-10-26 $1 试跑第一次真跑 ads.create_ad 时撞上。
    is_adset_budget_sharing_enabled: 'false',
  }
}

function adSetBodyFor(d: AdDraft, campaignId: string, nowMs: number): Record<string, string> {
  const t = metaTripletFor(d.kind)
  const end = nowMs + d.durationDays * 86_400_000
  const body: Record<string, string> = {
    name: d.adSetName,
    campaign_id: campaignId,
    status: 'PAUSED',
    billing_event: t.billingEvent,
    optimization_goal: t.optimizationGoal,
    // 不用系列预算时，竞价策略要在组上明说；最低成本（不设上限）= Meta 自动出价，不需要 bid_amount。
    // 2026-10-26 $1 试跑第二次真跑撞上（100/2490487）。
    bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    // Meta 收的是最小货币单位（分）。传元会变成 1/100 的预算，静默跑不出量。
    daily_budget: String(Math.round(d.dailyBudget * 100)),
    start_time: String(Math.floor(nowMs / 1000)),
    end_time: String(Math.floor(end / 1000)),
    targeting: JSON.stringify(targetingFor(d)),
    // 三种类型都只需要主页；留成一个函数是为了以后哪种需要别的时有个明确的落点。
    promoted_object: JSON.stringify({ page_id: d.pageId }),
  }
  if (t.destinationType) body.destination_type = t.destinationType
  return body
}

type MadeOrFailed = { id: string } | PublishFailure

/**
 * 一次「建」的运行状态：记下建出来的东西，出错时按逆序收拾。
 *
 * 为什么要有「可能已建成」这个单子：请求超时 / 断网时我们不知道 Meta 有没有建成，
 * 拿不到 id 就删不了。把名字记下来，让人去后台按名字核对 —— 比假装没这回事强。
 */
function newRun(accessToken: string, opts: PublishOptions) {
  const now = opts.now ?? Date.now
  const created: string[] = []
  const possible: string[] = []

  const rollback = async (): Promise<string[]> => {
    const stuck: string[] = []
    for (const id of [...created].reverse()) {
      if (opts.giveUpRollbackAt !== undefined && now() > opts.giveUpRollbackAt) {
        stuck.push(id) // 没时间了：不试，如实交给人。
        continue
      }
      if (!(await graphDelete(id, accessToken))) stuck.push(id)
    }
    return stuck
  }

  const fail = async (step: PublishFailure['step'], error: string): Promise<PublishFailure> => ({
    ok: false, step, error, orphans: [...(await rollback()), ...possible],
  })

  const make = async (
    step: PublishFailure['step'],
    label: string,
    name: string,
    path: string,
    body: Record<string, string>,
  ): Promise<MadeOrFailed> => {
    if (opts.stopWritingAt !== undefined && now() > opts.stopWritingAt) {
      return fail(step, '整次请求有时间上限，时间不够了，已停手并回滚')
    }
    const r = await graphPost(path, body, accessToken)
    if ('error' in r) {
      if (r.ambiguous) possible.push(`未确认是否已建成：${label}「${name}」，请去 Meta 后台按名字核对`)
      return fail(step, r.error)
    }
    created.push(r.id)
    return r
  }

  return { make, now }
}

type Run = ReturnType<typeof newRun>

/** 每条创意 → 每条广告。 */
async function publishCreatives(
  d: AdDraft,
  adAccountId: string,
  adSetId: string,
  run: Run,
): Promise<string[] | PublishFailure> {
  const adIds: string[] = []
  for (const c of d.creatives) {
    const creative = await run.make(
      'creative', '创意', c.name, `${adAccountId}/adcreatives`, creativeSpec(d, c),
    )
    if ('ok' in creative) return creative
    const ad = await run.make('ad', '广告', c.name, `${adAccountId}/ads`, {
      name: c.name,
      adset_id: adSetId,
      creative: JSON.stringify({ creative_id: creative.id }),
      status: 'PAUSED',
    })
    if ('ok' in ad) return ad
    adIds.push(ad.id)
  }
  return adIds
}

async function resolveCampaignId(
  d: AdDraft,
  adAccountId: string,
  accessToken: string,
  run: Run,
): Promise<string | PublishFailure> {
  if (!d.existingCampaignId) {
    const campaign = await run.make('campaign', '广告系列', d.campaignName, `${adAccountId}/campaigns`, campaignBody(d))
    if ('ok' in campaign) return campaign
    return campaign.id
  }
  const owned = await assertOwnedByAccount(d.existingCampaignId, adAccountId, accessToken, 'id,account_id')
  if (!owned.ok) return { ok: false, step: 'campaign', error: owned.error, orphans: [] }
  return d.existingCampaignId
}

async function publishAdSetAndAds(
  d: AdDraft,
  adAccountId: string,
  campaignId: string,
  run: Run,
): Promise<PublishResult> {
  const adSet = await run.make(
    'adset', '广告组', d.adSetName, `${adAccountId}/adsets`, adSetBodyFor(d, campaignId, run.now()),
  )
  if ('ok' in adSet) return adSet
  const adIds = await publishCreatives(d, adAccountId, adSet.id, run)
  if (!Array.isArray(adIds)) return adIds
  return {
    ok: true,
    campaignId,
    adSetId: adSet.id,
    adIds,
    orphans: [],
    ...(d.existingCampaignId ? { reusedCampaign: true } : {}),
  }
}

async function publishOnExistingAdSet(
  d: AdDraft,
  adAccountId: string,
  accessToken: string,
  run: Run,
): Promise<PublishResult> {
  if (d.existingCampaignId) {
    return { ok: false, step: 'adset', error: '加组和加广告要分成两张卡，没有去建。', orphans: [] }
  }
  const adSetId = d.existingAdSetId ?? ''
  const owned = await assertOwnedByAccount(adSetId, adAccountId, accessToken, 'id,account_id,campaign_id')
  if (!owned.ok) return { ok: false, step: 'adset', error: owned.error, orphans: [] }
  const campaignId = owned.body.campaign_id
  if (!isMetaObjectId(campaignId)) {
    return { ok: false, step: 'adset', error: '读不到这个广告组属于哪个系列，没有去建。', orphans: [] }
  }
  const adIds = await publishCreatives(d, adAccountId, adSetId, run)
  if (!Array.isArray(adIds)) return adIds
  return {
    ok: true, campaignId, adSetId, adIds, orphans: [], reusedCampaign: true, reusedAdSet: true,
  }
}

/**
 * 建。这次新建的对象都是 `status: PAUSED`。
 * 已有系列只挂新组；已有广告组只加新广告。原来的对象不新建，也不改开关。
 *
 * @param adAccountId `act_<digits>`
 */
export async function publishDraftPaused(
  d: AdDraft,
  adAccountId: string,
  accessToken: string,
  opts: PublishOptions = {},
): Promise<PublishResult> {
  const run = newRun(accessToken, opts)
  if (d.existingAdSetId) return publishOnExistingAdSet(d, adAccountId, accessToken, run)
  const campaignId = await resolveCampaignId(d, adAccountId, accessToken, run)
  if (typeof campaignId !== 'string') return campaignId
  return publishAdSetAndAds(d, adAccountId, campaignId, run)
}

/**
 * 人点头之后：把整条广告开起来。
 *
 * 三层都要开 —— 只开广告、组还暂停着，钱一分不会花，而界面上看着像开了。
 * 顺序从下往上：广告 → 组 → 系列，任何一层失败都如实返回，不吞。
 */
export async function activatePublished(
  p: Pick<PublishedDraft, 'campaignId' | 'adSetId' | 'adIds'>,
  accessToken: string,
  opts: { skipIds?: readonly string[] } = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  const skip = new Set(opts.skipIds ?? [])
  for (const id of [...p.adIds, p.adSetId, p.campaignId]) {
    if (skip.has(id)) continue
    // 改状态走的是另一种返回（`{"success":true}`，没有 id），不能复用 graphPost。
    const r = await graphUpdate(id, { status: 'ACTIVE' }, accessToken)
    if (!r.ok) return { ok: false, error: `开 ${id} 失败：${r.error}` }
  }
  return { ok: true }
}

/**
 * 补一刀暂停：回读发现有东西不是暂停的时候用（`created-as-expected` 的 `not_paused`）。
 *
 * 三层都试，**不在第一个失败时停** —— 此时的目标是尽量多地让钱停下来，不是保持顺序。
 * 失败的 id 如实返回，由调用方记账让人看见。
 */
export async function pausePublished(
  p: Pick<PublishedDraft, 'campaignId' | 'adSetId' | 'adIds' | 'reusedCampaign' | 'reusedAdSet'>,
  accessToken: string,
  opts: { deadlineAt?: number; now?: () => number } = {},
): Promise<{ ok: boolean; failed: string[] }> {
  const now = opts.now ?? Date.now
  const skip = new Set<string>()
  if (p.reusedCampaign || p.reusedAdSet) skip.add(p.campaignId)
  if (p.reusedAdSet) skip.add(p.adSetId)
  // 同时发：此刻的目标是尽快让钱停下来，不是保持顺序；串行最坏 (N+2)×15 秒。
  const results = await Promise.all(
    [...p.adIds, p.adSetId, p.campaignId].filter((id) => !skip.has(id)).map(async (id): Promise<string | null> => {
      // 有顶：整次请求不能因为补暂停拖过平台的超时线。没来得及的如实报出来。
      if (opts.deadlineAt !== undefined && now() > opts.deadlineAt) {
        return `${id}：整次请求的时间用完了，没来得及`
      }
      const r = await graphUpdate(id, { status: 'PAUSED' }, accessToken)
      return r.ok ? null : `${id}：${r.error}`
    }),
  )
  const failed = results.filter((x): x is string => x !== null)
  return { ok: failed.length === 0, failed }
}
