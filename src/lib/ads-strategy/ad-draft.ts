/**
 * 广告草案 —— ME 想发的那条广告，在它变成真钱之前的样子。
 *
 * ── 为什么草案是一个独立的类型，而不是直接调 Meta ─────────────────────────
 * 因为「发广告」这件事在 ME 里被拆成三步，中间那步必须有个东西可以被检查：
 *   1. ME 起草            ← 本文件
 *   2. 建成**暂停**状态 → 回读 → 过闸门     ← publisher + launch-readback
 *   3. 人看完买家会读到的每一句，点头才开    ← 审批页
 *
 * 第 2 步不能省成「建之前先检查草案」：Meta 自动加的东西（问候语、自动放宽
 * 人群、自动挂相似人群）在传参时**根本不存在**，只有建完回读才看得见。
 * 2026-08-04 得罪 Boris / Richard / Jude 那次，根因就是这一步不存在。
 *
 * ── 一个草案 = 一个打法 ──────────────────────────────────────────────────
 * 打法名不是标签，是**约束**：选了 `lead_form_harvest` 就必须给表单 id，
 * 选了 `thruplay_pool_build` 就必须给视频。校验在 `validateDraft`，
 * 不合规的草案连建都建不出来。
 */

import type { PlayKey } from './play-vocabulary'
import { dominantScript } from './launch-readback'

/** 目前 ME 会发的三种广告。要加第四种，先在 PLAY_CATALOG 里有对应打法。 */
export type DraftKind = 'lead_form' | 'video_thruplay' | 'messenger_conversation'

/** 打法 → 这个草案要走哪套 Meta 参数。两边必须对得上，别各自加。 */
export const DRAFT_PLAY: Readonly<Record<DraftKind, PlayKey>> = {
  lead_form: 'lead_form_harvest',
  video_thruplay: 'thruplay_pool_build',
  messenger_conversation: 'messenger_direct',
}

export function isKnownDraftKind(k: unknown): k is DraftKind {
  return typeof k === 'string' && Object.prototype.hasOwnProperty.call(DRAFT_PLAY, k)
}

/**
 * ME 的「开」按钮允许开哪些类型 —— **白名单**。
 *
 * 私信广告不在里面：它一开就是真花钱、真产生对话，而「开」之前该有的 PM 授权、
 * 每日总预算检查、紧急开关还没做（检查报告第 2 步）。第 2 步上线时把它加进来。
 * 用白名单而不是「私信类型除外」的黑名单：账本里 `kind` 缺失或写了陌生值的旧记录，
 * 黑名单会放行，白名单会拒。
 */
export const APPROVABLE_KINDS: ReadonlySet<DraftKind> = new Set<DraftKind>([
  'lead_form',
  'video_thruplay',
])

export function isApprovableKind(k: unknown): boolean {
  return isKnownDraftKind(k) && APPROVABLE_KINDS.has(k)
}

/**
 * 私信广告的按钮类型。单独一个常量：D13 实测过审的是 GET_QUOTE，MESSAGE_PAGE +
 * 接口建 在本仓还没有实测记录；当场试跑第一步就验它，被 Meta 拒就改这一处。
 */
export const MESSENGER_CTA_TYPE = 'MESSAGE_PAGE'

export interface AdDraftCreative {
  /** 广告名 —— 只给内部人看。 */
  name: string
  /** 正文。买家读到的第一句话在这里。 */
  primaryText: string
  /** 大标题（Meta 的 headline）。 */
  headline: string
  /** 描述。给不出就不给，别塞占位文字。 */
  description?: string
  /**
   * 素材。表单广告给图，视频广告给视频。
   * 已经上传到 Meta 的 id —— 上传是另一步（ads_creative_upload_*），不在这里做。
   */
  imageHash?: string
  videoId?: string
  /**
   * 视频封面。Meta 的 `video_data` 要求给封面。**没有「缺了就用首帧」这回事** ——
   * publisher 只在给了值时才传。私信类型缺封面直接被 `validateDraft` 拒。
   * 两个都给时以 `thumbnailImageHash` 为准（链接可能是会过期的签名链接）。
   */
  thumbnailUrl?: string
  thumbnailImageHash?: string
  /**
   * 这条创意的文案是什么语言（如 `en` / `zh`）。私信类型必填，且同一组必须一致 ——
   * 光靠文字体系判不出「英文 vs 毛利语 / 越南语」（都是拉丁字母）。
   */
  language?: string
}

export interface AdDraft {
  kind: DraftKind
  clientId: string
  /** 广告系列名 —— 会出现在 Meta 后台，写人看得懂的。 */
  campaignName: string
  adSetName: string
  /** 每天多少钱，**整数、客户账户的货币单位**（NZD/AUD 元，不是分）。 */
  dailyBudget: number
  /** 跑几天。到期自动停 —— 不设终点的广告没人会记得去关。 */
  durationDays: number
  /** 投放地区。空数组会被 `validateDraft` 拒掉：投给全世界不是一个决定。 */
  geoCountries: string[]
  /** 具体到城市/区（Meta 的 geo key）。给不出就只按国家投。 */
  geoCityKeys?: string[]
  /** 年龄下限/上限。 */
  ageMin?: number
  ageMax?: number
  /** 表单广告必给：Meta 的即时表单 id。 */
  leadFormId?: string
  /** 落地页 —— 表单广告的隐私政策/后续跳转用。 */
  linkUrl?: string
  /** 广告主页 id。 */
  pageId: string
  /** 一个草案下可以有多条创意；**同一个组里语言必须一致**（闸门会查）。 */
  creatives: AdDraftCreative[]
  /** 包含的自定义受众编号（Meta 自定义受众的数字 id）。给了就等于声明这个广告组是重定向。 */
  audienceIds?: string[]
  /** 排除的自定义受众编号。只给排除不算重定向。 */
  excludedAudienceIds?: string[]
}

/** 每天最多敢自动花多少 —— 超过这个数不是 ME 该自己决定的事。 */
export const MAX_AUTO_DAILY_BUDGET = 50

/** 一次最少跑几天（Meta：每日预算的广告组时长必须超过 24 小时）。 */
export const MIN_DURATION_DAYS = 2

/** 一次最多跑多久 —— 再长的投放应该是续，不是一次性下注。 */
export const MAX_DURATION_DAYS = 30

/** 私信组里最多几条创意：写操作次数和等转码的总时间都随它涨，要有顶。 */
export const MAX_MESSENGER_CREATIVES = 4

/** 包含与排除两个受众列表各自最多几个。 */
export const MAX_AUDIENCES_PER_LIST = 10

/**
 * 包含受众的最小人数下限（Meta 自定义受众投放最小规模的保守取值）。
 * docs/specs/2026-09-06-me-ads-audience-capability-spec.md:56 的 100 是相似人群种子门槛，口径不同；
 * 本值待线上试跑核实，改数字前先核。
 */
export const MIN_INCLUDED_AUDIENCE_SIZE = 100

export interface DraftProblem {
  field: string
  message: string
}

/**
 * 草案能不能拿去建。
 *
 * 这里**只查 ME 自己能确定的事**（缺字段、超预算、打法和参数对不上）。
 * 买家会看到什么、Meta 会自动加什么，一律等建完回读 —— 那些在这里查不出来。
 */
export function validateDraft(d: AdDraft): DraftProblem[] {
  // 请求体是 `body as AdDraft`，形状没人保证过 —— 先挡住会让后面直接抛 500（且不留账）的输入。
  if (!isKnownDraftKind(d.kind)) {
    return [{ field: 'kind', message: `不认识的广告类型：${String(d.kind)}` }]
  }
  if (!Array.isArray(d.creatives) || d.creatives.some((c) => !isCreativeShape(c))) {
    return [{ field: 'creatives', message: '广告文案格式不对（每条都要有文字的正文和标题）' }]
  }
  return [
    ...validateCommon(d),
    ...(d.kind === 'messenger_conversation' ? validateMessenger(d) : []),
  ]
}

const OPTIONAL_TEXT_FIELDS = [
  'description', 'videoId', 'imageHash', 'thumbnailUrl', 'thumbnailImageHash', 'language',
] as const

/** 请求体里每条创意：正文和标题必须是字符串，其余字段有就必须是字符串（数字会让后面的 `.trim()` 抛 500）。 */
function isCreativeShape(c: unknown): boolean {
  if (typeof c !== 'object' || c === null) return false
  const o = c as Record<string, unknown>
  if (typeof o.primaryText !== 'string' || typeof o.headline !== 'string') return false
  return OPTIONAL_TEXT_FIELDS.every((k) => o[k] === undefined || typeof o[k] === 'string')
}

function validateCommon(d: AdDraft): DraftProblem[] {
  const p: DraftProblem[] = []

  if (!d.clientId) p.push({ field: 'clientId', message: '没说是哪个客户' })
  if (!d.pageId) p.push({ field: 'pageId', message: '没说用哪个主页发' })

  if (!Number.isFinite(d.dailyBudget) || d.dailyBudget <= 0) {
    p.push({ field: 'dailyBudget', message: '每天预算必须是大于 0 的数' })
  } else if (d.dailyBudget > MAX_AUTO_DAILY_BUDGET) {
    p.push({
      field: 'dailyBudget',
      message: `每天 ${d.dailyBudget} 超过自动发布上限 ${MAX_AUTO_DAILY_BUDGET} —— 这个量级要人自己决定`,
    })
  }

  if (!Number.isInteger(d.durationDays) || d.durationDays <= 0) {
    p.push({ field: 'durationDays', message: '必须说跑几天 —— 不设终点的广告没人会记得关' })
  } else if (d.durationDays < MIN_DURATION_DAYS) {
    p.push({
      field: 'durationDays',
      message: `至少 ${MIN_DURATION_DAYS} 天：Meta 只允许跑超过 24 小时的广告组使用每日预算，1 天会被拒`,
    })
  } else if (d.durationDays > MAX_DURATION_DAYS) {
    p.push({ field: 'durationDays', message: `一次最多 ${MAX_DURATION_DAYS} 天` })
  }

  if (!d.geoCountries || d.geoCountries.length === 0) {
    p.push({ field: 'geoCountries', message: '没说投给哪里 —— 投给全世界不是一个决定，是漏了一步' })
  }

  if (d.creatives.length === 0) {
    p.push({ field: 'creatives', message: '一条广告文案都没有' })
  }
  d.creatives.forEach((c, i) => {
    if (!c.primaryText.trim()) p.push({ field: `creatives[${i}].primaryText`, message: '正文是空的' })
    if (!c.headline.trim()) p.push({ field: `creatives[${i}].headline`, message: '标题是空的' })
    if ((d.kind === 'video_thruplay' || d.kind === 'messenger_conversation') && !c.videoId) {
      p.push({ field: `creatives[${i}].videoId`, message: '视频广告没给视频' })
    }
    if (d.kind === 'lead_form' && !c.imageHash && !c.videoId) {
      p.push({ field: `creatives[${i}].imageHash`, message: '表单广告没给图也没给视频' })
    }
    // 视频留资走 video_data，Meta 要封面（没有「缺了用首帧」这回事）。
    if (d.kind === 'lead_form' && c.videoId && !hasThumbnail(c)) {
      p.push({ field: `creatives[${i}].thumbnail`, message: THUMBNAIL_MISSING })
    }
  })

  if (d.kind === 'lead_form' && !d.leadFormId) {
    p.push({ field: 'leadFormId', message: '留资广告没挂表单 —— 那它收不到任何联系方式' })
  }

  if (d.ageMin !== undefined && d.ageMin < 18) {
    p.push({ field: 'ageMin', message: 'Meta 不允许投给 18 岁以下' })
  }
  if (d.ageMin !== undefined && d.ageMax !== undefined && d.ageMin > d.ageMax) {
    p.push({ field: 'ageMax', message: '年龄下限比上限还大' })
  }

  p.push(...validateAudiences(d))

  return p
}

/** 自定义受众编号：Meta 的数字 id，5 位以上纯数字。 */
const AUDIENCE_ID = /^\d{5,}$/

/**
 * 受众列表能不能用。
 *
 * 请求体是 `body as AdDraft`，`audienceIds` / `excludedAudienceIds` 可能是任何东西 ——
 * 先按 `unknown` 收窄，再查格式、数量、重复，最后查「包含」和「排除」有没有打架。
 */
function validateAudiences(d: AdDraft): DraftProblem[] {
  const p: DraftProblem[] = []
  const fields = ['audienceIds', 'excludedAudienceIds'] as const
  const valid: Partial<Record<(typeof fields)[number], string[]>> = {}

  for (const field of fields) {
    const raw: unknown = d[field]
    if (raw === undefined) continue

    if (!Array.isArray(raw) || raw.some((id) => typeof id !== 'string' || !AUDIENCE_ID.test(id))) {
      p.push({ field, message: '受众编号格式不对（要是 5 位以上的纯数字字符串）' })
      continue
    }

    const ids = raw as string[]
    valid[field] = ids

    if (ids.length > MAX_AUDIENCES_PER_LIST) {
      p.push({ field, message: `受众最多 ${MAX_AUDIENCES_PER_LIST} 个，现在有 ${ids.length} 个` })
    }

    const dupIds = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))]
    if (dupIds.length > 0) {
      p.push({ field, message: `受众编号重复：${dupIds.join('、')}` })
    }
  }

  const included = valid.audienceIds
  const excluded = valid.excludedAudienceIds
  if (included && excluded) {
    const excludedSet = new Set(excluded)
    const ids = [...new Set(included.filter((id) => excludedSet.has(id)))]
    if (ids.length > 0) {
      p.push({
        field: 'excludedAudienceIds',
        message: `受众 ${ids.join('、')} 同时出现在「包含」和「排除」里，自相矛盾`,
      })
    }
  }

  return p
}

const HTTPS_URL = /^https:\/\/\S+$/i
const THUMBNAIL_MISSING = '视频广告没有封面（要 thumbnailImageHash，或 https 开头的 thumbnailUrl）'

function hasThumbnail(c: AdDraftCreative): boolean {
  return !!c.thumbnailImageHash || (!!c.thumbnailUrl && HTTPS_URL.test(c.thumbnailUrl))
}
/** 语言代码：两位小写字母（ISO 639-1：`en` / `zh` / `mi`）。三位的 `eng` 和 `en` 会被当成两种语言，所以不收。 */
const LANG_CODE = /^[a-z]{2}$/

/** `en-NZ` / `en_AU` → `en`；不像语言代码的返回 null。 */
function primaryLanguage(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const primary = raw.trim().toLowerCase().split(/[-_]/)[0]
  return LANG_CODE.test(primary) ? primary : null
}

/** 私信类型独有的、建之前就能判的错。通用部分已在 `validateCommon` 查过。 */
function validateMessenger(d: AdDraft): DraftProblem[] {
  const p: DraftProblem[] = []
  if (d.creatives.length > MAX_MESSENGER_CREATIVES) {
    p.push({ field: 'creatives', message: `私信组最多 ${MAX_MESSENGER_CREATIVES} 条创意` })
  }

  d.creatives.forEach((c, i) => {
    if (!hasThumbnail(c)) {
      p.push({ field: `creatives[${i}].thumbnail`, message: THUMBNAIL_MISSING })
    }
  })

  // 一语言一组：自报的语言必须是代码、且全组一致。
  const langs = d.creatives.map((c) => primaryLanguage(c.language))
  if (langs.some((l) => l === null)) {
    p.push({ field: 'creatives.language', message: '每条创意都要写两位语言代码（如 en / zh / mi），不能留空，也不能写成 English / eng' })
  } else if (new Set(langs).size > 1) {
    p.push({ field: 'creatives.language', message: `同一个私信广告组只能一种语言，现在有：${[...new Set(langs)].join(' / ')}` })
  }

  // 第二道：文字体系。自报可以说谎，字不会。
  const scripts = new Set(
    d.creatives
      .map((c) => dominantScript([c.primaryText, c.headline, c.description ?? '']))
      .filter((s) => s !== null),
  )
  if (scripts.size > 1) {
    p.push({ field: 'creatives.script', message: `文案里混着 ${scripts.size} 种文字体系（${[...scripts].join(' / ')}）—— Meta 的自动问候语会照抄每条创意的语言` })
  }
  return p
}

/** Meta 的 objective / optimization_goal / destination_type 三件套，按草案类型定死。 */
export interface MetaObjectiveTriplet {
  objective: string
  optimizationGoal: string
  billingEvent: string
  destinationType?: string
}

/**
 * 打法 → Meta 参数。
 *
 * 写死不给调：这三个字段配错就是「名字叫留资、实际在买曝光」那类问题，
 * 而它在数据上看起来完全正常（2026-08-04 「暖池重定向」实测就是这么坏的）。
 */
const META_TRIPLET: Readonly<Record<DraftKind, MetaObjectiveTriplet>> = {
  lead_form: {
    objective: 'OUTCOME_LEADS',
    optimizationGoal: 'LEAD_GENERATION',
    billingEvent: 'IMPRESSIONS',
    destinationType: 'ON_AD', // 表单开在广告里，不把人带去私信
  },
  video_thruplay: {
    objective: 'OUTCOME_AWARENESS',
    optimizationGoal: 'THRUPLAY',
    billingEvent: 'IMPRESSIONS',
    // 不发 destination_type：ON_VIDEO 在 Meta 文档里标 limited beta、本仓没有实测过审记录（2026-10-26 魏征/子牙审）。
  },
  messenger_conversation: {
    objective: 'OUTCOME_ENGAGEMENT',
    optimizationGoal: 'CONVERSATIONS',
    billingEvent: 'IMPRESSIONS',
    destinationType: 'MESSENGER',
  },
}

/**
 * 用 `Record<DraftKind, …>` 而不是 if/else 兜底：以前「不是留资就当养受众」，加第三种类型时
 * 漏改这里不会有任何编译错误，只会静默把它建成别的东西。陌生类型直接抛 —— 调用方
 * 应该已经被 `validateDraft` 拦住了，走到这里说明有人绕过了它。
 */
export function metaTripletFor(kind: DraftKind): MetaObjectiveTriplet {
  if (!isKnownDraftKind(kind)) throw new Error(`不认识的广告类型：${String(kind)}`)
  return META_TRIPLET[kind]
}

/** 一句话说清这条广告在做什么 —— 审批页第一行。 */
const DRAFT_WHAT: Readonly<Record<DraftKind, string>> = {
  lead_form: '收联系方式（填表单）',
  video_thruplay: '养受众（让人看完视频，之后可以再投给他们）',
  messenger_conversation: '私信开聊（让人点广告直接进 Messenger 和我们对话）',
}

export function describeDraft(d: AdDraft): string {
  const total = d.dailyBudget * d.durationDays
  // 这一步在 `validateDraft` 之前就会被调（账本的摘要），所以 kind 可能是请求体里的任何值。
  const what = isKnownDraftKind(d.kind) ? DRAFT_WHAT[d.kind] : '（不认识的广告类型）'
  return `${what}，每天 $${d.dailyBudget}、跑 ${d.durationDays} 天，最多花 $${total}`
}
