/**
 * 「按房子看客人」这一页的纯逻辑 —— 中介在手机上一屏读完、一下改完。
 *
 * 为什么单独一个模块：这页要回答的两件事都容易被写成「看起来合理但其实是编的」，
 * 所以判定全部收在这里、用测试钉死，路由只负责取数：
 *
 *   1. 「谁带来的」—— 只能顺着证据往下退，退到没有就**留空**。
 *      绝不把「他从 Facebook 私信进来」写成「Facebook 广告带来的」——
 *      私信读接口拿不到 CTWA 归因（见 lib/crm/attribution.ts 的实测记录），
 *      硬标一个平台会把「哪条广告有效」的分母算脏。
 *
 *   2. 「系统建议改到哪一步」—— 只在**人还没标过**、且 AI 明确读到高意向时才给，
 *      而且建议的那一档必须是这个客户真实配置里存在的。中介点一下就落库，
 *      建议错了比没有建议更贵。
 *
 * 纯函数：不 import supabase、不读环境变量，server / client 都能引。
 */

/** 客户配置里的一档（只取这页要用的字段）。 */
export interface BoardStage {
  stageKey: string
  label: string
}

/** AI 简报里这页会用到的部分。 */
export type BriefIntent = 'high' | 'medium' | 'low' | 'unknown'

/**
 * 渠道大类的人话名字。key 与 lib/crm/attribution.ts 的 ATTRIBUTION_PLATFORMS 一致。
 *
 * `manual` 说的是「员工自己录进来的」，这是事实（不知道他从哪来），不是来源猜测。
 */
const PLATFORM_LABEL: Record<string, string> = {
  meta: 'Facebook / Instagram 广告',
  google: 'Google 广告',
  email: '邮件',
  web: '网站表单',
  organic_social: '社媒（非广告）',
  referral: '别人介绍',
  manual: '同事手工录的',
}

/** 触点渠道的人话名字。这只说明「他怎么找上门」，不等于哪条广告。 */
const CHANNEL_LABEL: Record<string, string> = {
  messenger: 'Facebook 私信',
  meta_lead_form: 'Facebook 表单',
  web_form: '网站表单',
  phone: '电话打进来',
  email: '邮件',
  sms: '短信',
  whatsapp: 'WhatsApp',
  note: '同事记的一笔',
}

/**
 * 一行「谁带来的」。confidence 让界面能把三种把握度分开显示 —— 中介一眼能分清
 * 「这是那条广告带来的」和「只知道他从私信进来」。
 */
export interface SourceLine {
  text: string
  confidence: 'ad' | 'channel' | 'entry'
}

export interface SourceInput {
  /** contacts.attr_ad_name，或最早那条触点上的 attr_ad_name。 */
  adName: string | null
  /** contacts.attr_platform。 */
  platform: string | null
  /** 最早一条触点的 channel（只在完全没有归因时才退到这里）。 */
  firstChannel: string | null
}

/**
 * 证据链：广告名 → 渠道大类 → 怎么进来的 → 没有就是 null。
 *
 * 返回 null 时界面必须留空（写「来源没记录」这类说明可以，编一个来源不行）。
 */
export function sourceLine(input: SourceInput): SourceLine | null {
  const adName = input.adName?.trim()
  if (adName) return { text: adName, confidence: 'ad' }

  const platform = input.platform?.trim()
  if (platform) {
    return { text: PLATFORM_LABEL[platform] ?? platform, confidence: 'channel' }
  }

  const channel = input.firstChannel?.trim()
  if (channel) {
    return { text: CHANNEL_LABEL[channel] ?? channel, confidence: 'entry' }
  }

  return null
}

/** 系统给的一条建议：改到哪一档、为什么。 */
export interface StageSuggestion {
  toStage: string
  label: string
  why: string
}

/**
 * AI 读到高意向 → 建议标成「真买家」。
 *
 * 三道闸，缺一不可：
 *   · 人已经标过了 → 不给建议（人的判断永远压过 AI，也免得一直跳同一条）
 *   · 意向不是 high → 不给建议（medium/low/unknown 都太容易读错，宁可不说）
 *   · 客户配置里没有这一档 → 不给建议（阶段是每客户可配的，硬塞会写进一个不存在的值）
 */
const QUALIFIED_STAGE_KEY = 'qualified'

export function suggestStage(args: {
  currentStage: string | null
  intent: BriefIntent | null
  stages: BoardStage[]
}): StageSuggestion | null {
  if (args.currentStage) return null
  if (args.intent !== 'high') return null

  const stage = args.stages.find((s) => s.stageKey === QUALIFIED_STAGE_KEY)
  if (!stage) return null

  return {
    toStage: stage.stageKey,
    label: stage.label,
    why: '这段对话里他问得很具体，系统看着像真买家',
  }
}

/**
 * 分组排序：有房子的按地址排在前，「还没挂到房子上」永远垫底。
 *
 * 中介一开页看到的应该是他正在卖的那几套房，而不是一堆没归位的人。
 */
export function compareGroups(
  a: { listingId: string | null; title: string },
  b: { listingId: string | null; title: string },
): number {
  if (a.listingId === null && b.listingId !== null) return 1
  if (a.listingId !== null && b.listingId === null) return -1
  return a.title.localeCompare(b.title, 'zh-Hans')
}

/**
 * 人在组内的排序：最近有往来的排前面，完全没往来的垫底。
 * 手机上只看得到最上面三四个人，排错了等于没做。
 */
export function compareByRecency(
  a: { lastTouchAt: string | null },
  b: { lastTouchAt: string | null },
): number {
  const ta = a.lastTouchAt ? new Date(a.lastTouchAt).getTime() : 0
  const tb = b.lastTouchAt ? new Date(b.lastTouchAt).getTime() : 0
  if (Number.isNaN(ta) || Number.isNaN(tb)) return 0
  return tb - ta
}
