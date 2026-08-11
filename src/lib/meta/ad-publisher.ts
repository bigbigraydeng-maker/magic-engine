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
 * 建广告是四次写操作（系列 / 组 / 创意 / 广告），任何一步都可能失败。半成品
 * 留在账户里比失败更糟：它会出现在后台、会被人误开、会进第二天的扫描。
 * 所以失败时按创建的**逆序**删回去，删不掉的如实报出来让人处理。
 */

import type { AdDraft, AdDraftCreative } from '@/lib/ads-strategy/ad-draft'
import { metaTripletFor } from '@/lib/ads-strategy/ad-draft'

const GRAPH_BASE = 'https://graph.facebook.com/v21.0'

export interface PublishedDraft {
  campaignId: string
  adSetId: string
  adIds: string[]
  /** 建到一半失败、又没删干净的东西 —— 必须有人去 Meta 后台手动删。 */
  orphans: string[]
}

export interface PublishFailure {
  ok: false
  step: 'campaign' | 'adset' | 'creative' | 'ad'
  error: string
  orphans: string[]
}

export type PublishResult = ({ ok: true } & PublishedDraft) | PublishFailure

async function graphPost(
  path: string,
  body: Record<string, string>,
  accessToken: string,
): Promise<{ id: string } | { error: string }> {
  let res: Response
  try {
    res = await fetch(`${GRAPH_BASE}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ ...body, access_token: accessToken }).toString(),
    })
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
  const text = await res.text().catch(() => '')
  if (!res.ok) return { error: `HTTP ${res.status}: ${text.slice(0, 400)}` }
  try {
    const json = JSON.parse(text) as { id?: unknown }
    if (typeof json.id !== 'string') return { error: `返回里没有 id：${text.slice(0, 200)}` }
    return { id: json.id }
  } catch {
    return { error: `返回不是 JSON：${text.slice(0, 200)}` }
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
    })
    return res.ok
  } catch {
    return false
  }
}

function targetingFor(d: AdDraft): Record<string, unknown> {
  const geo: Record<string, unknown> = { countries: d.geoCountries }
  if (d.geoCityKeys && d.geoCityKeys.length > 0) {
    geo.cities = d.geoCityKeys.map((key) => ({ key, radius: 10, distance_unit: 'kilometer' }))
  }
  return {
    geo_locations: geo,
    age_min: d.ageMin ?? 25,
    age_max: d.ageMax ?? 65,
    // 明确关掉 Meta 的自动放宽。**这不代表它一定关着** —— Meta 可能照样开，
    // 所以建完还要回读一遍（这正是闸门存在的理由）。
    targeting_automation: { advantage_audience: 0 },
  }
}

function creativeSpec(d: AdDraft, c: AdDraftCreative): Record<string, string> {
  const storySpec: Record<string, unknown> = { page_id: d.pageId }

  if (d.kind === 'video_thruplay') {
    storySpec.video_data = {
      video_id: c.videoId,
      message: c.primaryText,
      title: c.headline,
      ...(c.description ? { link_description: c.description } : {}),
      ...(c.thumbnailUrl ? { image_url: c.thumbnailUrl } : {}),
      call_to_action: { type: 'LEARN_MORE', value: { link: d.linkUrl ?? '' } },
    }
  } else {
    storySpec.link_data = {
      message: c.primaryText,
      name: c.headline,
      ...(c.description ? { description: c.description } : {}),
      ...(c.imageHash ? { image_hash: c.imageHash } : {}),
      ...(c.videoId ? { video_id: c.videoId } : {}),
      link: d.linkUrl ?? `https://facebook.com/${d.pageId}`,
      call_to_action: {
        type: 'SIGN_UP',
        value: { lead_gen_form_id: d.leadFormId },
      },
    }
  }

  return { name: c.name, object_story_spec: JSON.stringify(storySpec) }
}

/**
 * 建。全程 `status: PAUSED`。
 *
 * @param adAccountId `act_<digits>`
 */
export async function publishDraftPaused(
  d: AdDraft,
  adAccountId: string,
  accessToken: string,
): Promise<PublishResult> {
  const t = metaTripletFor(d.kind)
  const created: string[] = []
  /** 出错时按逆序删回去；删不掉的如实返回。 */
  const rollback = async (): Promise<string[]> => {
    const stuck: string[] = []
    for (const id of [...created].reverse()) {
      if (!(await graphDelete(id, accessToken))) stuck.push(id)
    }
    return stuck
  }

  // ── 1. 广告系列 ──────────────────────────────────────────────────────
  const campaign = await graphPost(
    `${adAccountId}/campaigns`,
    {
      name: d.campaignName,
      objective: t.objective,
      status: 'PAUSED',
      special_ad_categories: JSON.stringify([]),
    },
    accessToken,
  )
  if ('error' in campaign) return { ok: false, step: 'campaign', error: campaign.error, orphans: [] }
  created.push(campaign.id)

  // ── 2. 广告组 ────────────────────────────────────────────────────────
  const start = new Date()
  const end = new Date(start.getTime() + d.durationDays * 86_400_000)
  const adSetBody: Record<string, string> = {
    name: d.adSetName,
    campaign_id: campaign.id,
    status: 'PAUSED',
    billing_event: t.billingEvent,
    optimization_goal: t.optimizationGoal,
    // Meta 收的是最小货币单位（分）。传元会变成 1/100 的预算，静默跑不出量。
    daily_budget: String(Math.round(d.dailyBudget * 100)),
    start_time: String(Math.floor(start.getTime() / 1000)),
    end_time: String(Math.floor(end.getTime() / 1000)),
    targeting: JSON.stringify(targetingFor(d)),
    promoted_object: JSON.stringify(
      d.kind === 'lead_form'
        ? { page_id: d.pageId }
        : { page_id: d.pageId },
    ),
  }
  if (t.destinationType) adSetBody.destination_type = t.destinationType

  const adSet = await graphPost(`${adAccountId}/adsets`, adSetBody, accessToken)
  if ('error' in adSet) {
    return { ok: false, step: 'adset', error: adSet.error, orphans: await rollback() }
  }
  created.push(adSet.id)

  // ── 3+4. 每条创意 → 每条广告 ─────────────────────────────────────────
  const adIds: string[] = []
  for (const c of d.creatives) {
    const creative = await graphPost(
      `${adAccountId}/adcreatives`,
      creativeSpec(d, c),
      accessToken,
    )
    if ('error' in creative) {
      return { ok: false, step: 'creative', error: creative.error, orphans: await rollback() }
    }
    created.push(creative.id)

    const ad = await graphPost(
      `${adAccountId}/ads`,
      {
        name: c.name,
        adset_id: adSet.id,
        creative: JSON.stringify({ creative_id: creative.id }),
        status: 'PAUSED',
      },
      accessToken,
    )
    if ('error' in ad) {
      return { ok: false, step: 'ad', error: ad.error, orphans: await rollback() }
    }
    created.push(ad.id)
    adIds.push(ad.id)
  }

  return { ok: true, campaignId: campaign.id, adSetId: adSet.id, adIds, orphans: [] }
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
): Promise<{ ok: true } | { ok: false; error: string }> {
  for (const id of [...p.adIds, p.adSetId, p.campaignId]) {
    // 改状态走的是另一种返回（`{"success":true}`，没有 id），不能复用 graphPost。
    const r = await graphUpdate(id, { status: 'ACTIVE' }, accessToken)
    if (!r.ok) return { ok: false, error: `开 ${id} 失败：${r.error}` }
  }
  return { ok: true }
}
