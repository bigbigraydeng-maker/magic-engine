/**
 * 把**已核实的事实**拼成一份广告草案。这是「ME 发广告」那条链路缺的上游。
 *
 * ── 为什么是模板拼装，不是让 AI 写文案 ──────────────────────────────────
 * 铁律 8：绝不凭空注入客户业务数据。房价、房型、战绩这些东西编错一个字，
 * 就是拿客户的执照冒险。所以这里**没有自由文本入口** —— 每一句买家会读到的话
 * 都是由 `ListingFacts` / `AgentFacts` 的字段拼出来的，字段里没有的东西，
 * 拼不出来。编造在结构上不可能，而不是靠一层检查。
 *
 * 事实从哪来：调用方负责，且必须带 `sourceUrl`。房源信息只认客户官网／房源系统，
 * 不认 master_brief（brief 给方向，不含房源细节 —— CTS 长城日出那次事故）。
 *
 * ── 一个草案 = 一种语言 ────────────────────────────────────────────────
 * 私信/表单广告里混语言会让买家收到看不懂的自动问候语（2026-08-04 一次得罪 5 人）。
 * 闸门会拦，但更该在源头就不产生：要两种语言就要两份草案，各投各的。
 */

import type { AdDraft, AdDraftCreative } from './ad-draft'
import { scanRedlineHits } from '@/lib/factory/worker-guard'

export type AdLang = 'en' | 'zh'

/** 一套真实房源事实。每个字段都必须能在 `sourceUrl` 上找到原文。 */
export interface ListingFacts {
  /** 门牌 + 街道，官网怎么写就怎么写。 */
  address: string
  suburb: string
  /** 官网标的房型数。拿不到就留空 —— 不许推测。 */
  bedrooms?: number
  /**
   * 价格**原样字符串**（`$885,000` / `Nego.` / `$619,800 Plus GST`）。
   * 刻意不用数字类型：官网写 `Nego.` 就是 `Nego.`，转成数字要么丢信息要么造假。
   */
  priceLabel?: string
  /** 官网上的状态原文（`For Sale` / `On Sale` / `Off-Market`）。 */
  status: string
  /** 这些事实是从哪一页读到的。缺这个 = 事实不可溯 = 不许拿去投放。 */
  sourceUrl: string
}

/** 中介本人的事实。战绩一律原文引用，不改写不四舍五入。 */
export interface AgentFacts {
  displayName: string
  /** 官网原文的战绩句子，例如 `No.1 Listing Agent | Royal Heights Branch 2022-2023`。 */
  achievements: string[]
  /** 服务区域原文。 */
  serviceArea?: string
  phone?: string
  sourceUrl: string
}

export interface BuildOptions {
  clientId: string
  pageId: string
  lang: AdLang
  dailyBudget: number
  durationDays: number
  geoCountries: string[]
  geoCityKeys?: string[]
  ageMin?: number
  ageMax?: number
  /** 表单广告必给（运行时从 Meta 解析，别写死）。 */
  leadFormId?: string
  /** 视频广告必给。 */
  videoId?: string
  linkUrl?: string
  /** 图片素材（表单广告用）。 */
  imageHash?: string
  /**
   * 这个客户的禁用词（`master_briefs.avoid_words` + `clients.brand_redline_phrases`）。
   * 调用方负责查库带进来 —— 这里不查库，规则才能纯函数可测。
   */
  bannedPhrases?: string[]
}

export class NotGroundedError extends Error {}

/**
 * 禁用词命中 —— 广告线**直接拒绝出稿**，不是标红让人审。
 *
 * 跟出片那条线（`scanRedlineHits` 命中只写 `redline_hits` 标红）故意不同口径。
 * 理由：出片有人工审核那一关兜底，而且误杀会挡住整条产线；广告不一样 ——
 * 它是**付费对外**的，一旦印上去就是花钱把错误推给几千个陌生人看。
 *
 * 2026-08-05 的真实场景：Roman 从 Barfoot & Thompson Royal Heights 转到
 * Ray White Mission Bay，而他自己官网上还全是旧行的资料。任何直接抓官网
 * 生成的广告都会把**前东家的品牌印在他自己的付费物料上**。
 */
export class BannedPhraseError extends Error {
  constructor(public readonly hits: string[]) {
    super(`文案里出现了这个客户的禁用词：${hits.join('、')} —— 不出稿`)
  }
}

function assertNoBanned(creative: AdDraftCreative, banned: string[] | undefined): void {
  if (!banned || banned.length === 0) return
  const hits = scanRedlineHits(
    [creative.primaryText, creative.headline, creative.description],
    banned,
    [],
  )
  if (hits.length > 0) throw new BannedPhraseError(hits)
}

/** 事实不完整就不许往下走 —— 半份事实拼出来的广告比没有广告危险。 */
function assertFacts(l: ListingFacts): void {
  if (!l.sourceUrl) throw new NotGroundedError(`「${l.address}」没给来源链接，事实不可溯，不能拿去投放`)
  if (!l.address.trim() || !l.suburb.trim()) {
    throw new NotGroundedError('房源缺地址或区域')
  }
  if (!l.status.trim()) throw new NotGroundedError(`「${l.address}」没给在售状态`)
}

/** 房型那半句 —— 拿不到房型数就整句不出现，不写「多房」这种含糊话。 */
function bedroomsPhrase(l: ListingFacts, lang: AdLang): string {
  if (!l.bedrooms || l.bedrooms <= 0) return ''
  return lang === 'zh' ? `${l.bedrooms} 房` : `${l.bedrooms}-bedroom`
}

/** 价格那半句 —— 原样带出，不加「仅」「起」这类修饰。 */
function pricePhrase(l: ListingFacts, lang: AdLang): string {
  if (!l.priceLabel?.trim()) return ''
  return lang === 'zh' ? `价格：${l.priceLabel}` : `Price: ${l.priceLabel}`
}

/**
 * 买家留资广告。
 *
 * 正文只说三件官网上写着的事：在哪、什么房型、什么价。
 * CTA 那句是行为邀请（「留个联系方式」），不是对房子的描述 —— 不构成事实主张。
 */
export function buildBuyerLeadDraft(
  listing: ListingFacts,
  agent: AgentFacts,
  o: BuildOptions,
): AdDraft {
  assertFacts(listing)
  if (!o.leadFormId) {
    throw new NotGroundedError('留资广告没有表单 id —— 它收不到任何联系方式，不许建')
  }
  // 素材缺失在这里就拦掉。产出一份注定过不了校验的草案，等于把问题推到下游，
  // 那边报的错还看不出是「素材没传」。
  if (!o.imageHash && !o.videoId) {
    throw new NotGroundedError('留资广告既没有图也没有视频 —— 素材要先传到 Meta 才有 id')
  }

  const beds = bedroomsPhrase(listing, o.lang)
  const price = pricePhrase(listing, o.lang)

  const primaryText =
    o.lang === 'zh'
      ? [`${listing.suburb} · ${listing.address}`, beds, price, '想了解详情，留个联系方式，我发给你。']
          .filter(Boolean)
          .join('\n')
      : [
          `${listing.address}, ${listing.suburb}`,
          beds ? `${beds} home` : '',
          price,
          'Leave your details and I will send you the full information.',
        ]
          .filter(Boolean)
          .join('\n')

  const headline =
    o.lang === 'zh'
      ? `${listing.suburb}${beds ? ` · ${beds}` : ''}`
      : `${listing.suburb}${beds ? ` · ${beds}` : ''}`

  const creative: AdDraftCreative = {
    name: `${listing.suburb} · ${o.lang === 'zh' ? '中文' : 'EN'}`,
    primaryText,
    headline,
    ...(o.imageHash ? { imageHash: o.imageHash } : {}),
    ...(o.videoId ? { videoId: o.videoId } : {}),
  }
  assertNoBanned(creative, o.bannedPhrases)

  return {
    kind: 'lead_form',
    clientId: o.clientId,
    campaignName: `${agent.displayName} · ${listing.suburb} 留资 · ${o.lang}`,
    // 组名如实说明它在做什么 —— 名字骗人是 2026-08-04「暖池重定向」那次的起点。
    adSetName: `${listing.suburb} · 表单留资 · ${o.lang === 'zh' ? '中文' : '英文'}`,
    dailyBudget: o.dailyBudget,
    durationDays: o.durationDays,
    geoCountries: o.geoCountries,
    geoCityKeys: o.geoCityKeys,
    ageMin: o.ageMin,
    ageMax: o.ageMax,
    leadFormId: o.leadFormId,
    linkUrl: o.linkUrl ?? listing.sourceUrl,
    pageId: o.pageId,
    creatives: [creative],
  }
}

/**
 * 卖家向的视频养受众（ThruPlay）。
 *
 * 这条**不收联系方式**，目的只有一个：把看完视频的人攒成一个池子，以后能再投给他们。
 * 所以正文里不出现任何房源价格 —— 它不是在卖某一套房。
 *
 * 战绩原文照抄。改写战绩（把「Royal Heights 分行第一」写成「奥克兰第一」）
 * 是最容易发生、后果最严重的那种编造。
 */
export function buildSellerThruPlayDraft(agent: AgentFacts, o: BuildOptions): AdDraft {
  if (!o.videoId) {
    throw new NotGroundedError('养受众广告没有视频 —— 没视频就没有完播，这条草案没有意义')
  }
  if (!agent.sourceUrl) throw new NotGroundedError('中介事实没给来源链接，不可溯')

  const creds = agent.achievements.slice(0, 2)

  const primaryText =
    o.lang === 'zh'
      ? [
          '在想今年要不要把房子放出来？',
          ...creds,
          agent.serviceArea ? agent.serviceArea : '',
          '看完这条视频，你会知道现在这个市场值不值得动。',
        ]
          .filter(Boolean)
          .join('\n')
      : [
          'Thinking about putting your place on the market this year?',
          ...creds,
          agent.serviceArea ?? '',
          'Watch this before you decide.',
        ]
          .filter(Boolean)
          .join('\n')

  const creative: AdDraftCreative = {
    name: `卖家向 · ${o.lang === 'zh' ? '中文' : 'EN'}`,
    primaryText,
    headline: o.lang === 'zh' ? '现在是不是放盘的时候' : 'Is now the time to sell?',
    videoId: o.videoId,
  }
  assertNoBanned(creative, o.bannedPhrases)

  return {
    kind: 'video_thruplay',
    clientId: o.clientId,
    campaignName: `${agent.displayName} · 卖家养池子 · ${o.lang}`,
    adSetName: `卖家向 · 视频完播攒池子 · ${o.lang === 'zh' ? '中文' : '英文'}`,
    dailyBudget: o.dailyBudget,
    durationDays: o.durationDays,
    geoCountries: o.geoCountries,
    geoCityKeys: o.geoCityKeys,
    ageMin: o.ageMin ?? 30,
    ageMax: o.ageMax ?? 65,
    linkUrl: o.linkUrl ?? agent.sourceUrl,
    pageId: o.pageId,
    creatives: [creative],
  }
}

/**
 * 把这份草案里每一句买家会读到的话，逐句标出可溯来源。
 *
 * 这是交付物的一部分，不是调试功能：客户内容红线要求发布前逐句标「官网可溯 /
 * brief 可溯 / 未证实」。模板拼装保证了只有两种可能 —— 事实字段（可溯）或
 * 固定的行为邀请句（不含事实主张）。
 */
export function traceClaims(
  draft: AdDraft,
  sources: { listing?: ListingFacts; agent: AgentFacts },
): { line: string; source: string }[] {
  const factValues = [
    sources.listing?.address,
    sources.listing?.suburb,
    sources.listing?.priceLabel,
    sources.listing?.status,
    ...(sources.agent.achievements ?? []),
    sources.agent.serviceArea,
  ].filter((v): v is string => typeof v === 'string' && v.trim().length > 0)

  const out: { line: string; source: string }[] = []
  for (const c of draft.creatives) {
    for (const line of [c.primaryText, c.headline, c.description ?? ''].filter(Boolean)) {
      for (const seg of line.split('\n')) {
        if (!seg.trim()) continue
        const hit = factValues.find((f) => seg.includes(f))
        out.push({
          line: seg,
          source: hit
            ? `官网可溯（${sources.listing?.sourceUrl ?? sources.agent.sourceUrl}）`
            : '固定话术 · 不含事实主张',
        })
      }
    }
  }
  return out
}
