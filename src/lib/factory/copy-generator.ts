// P21.J A2 — 广告文案生成(后端,品牌接地)。架构整理:把「脑子」从仓外 worker 收回 ME 后端。
// worker 以前硬编「CTS Tours / ctstours.co.nz」,只能服务一个客户。这里改成读 master_brief 的
// 品牌名/网址/VI(复用 brief-injector.formatBriefForPrompt),多客户通用、品牌准确。
// best-effort:LLM 失败走品牌接地的模板 fallback(用 brand_name/website,绝不硬编任何客户)。

import { callClaudeChat, parseJsonResponse } from '@/lib/anthropic/client'
import { formatBriefForPrompt } from '@/lib/content/brief-injector'
import type { MasterBrief } from '@/types/magic-engine'
import type { AdCopy, VerifiedOffer } from './types'

type Role = 'hook' | 'middle' | 'cta'

/**
 * B3(诸葛亮硬验收):文案 CTA 意图必须导向工单圈定的 Goal 北极星,别自嗨。
 * expected_metric(来自 brief.attribution)→ 一句 CTA 战略意图喂进生成 prompt。
 */
export function ctaIntentFor(metric: string | null | undefined): string {
  switch (metric) {
    case 'brand_search_volume':
      return 'CTA 目标=拉品牌搜索:引导观众"记住品牌名并去搜索它"(Search "<brand>"),不是直接卖货。'
    case 'monthly_revenue':
      return 'CTA 目标=直接转化/营收:限时优惠、清仓抢购式紧迫感,引导立刻购买/到店。'
    case 'leads_count':
      return 'CTA 目标=拿线索:引导留资/咨询/报名(Enquire / Sign up / Talk to us)。'
    case 'organic_traffic':
      return 'CTA 目标=引流上站:引导访问官网了解更多(Visit our site)。'
    case 'ai_visibility_score':
      return 'CTA 目标=品牌权威露出:强化专业身份与品类权威,引导认知不强推销。'
    default:
      return 'CTA 目标=品牌认知:清晰品牌行动号召,不编价格。'
  }
}

/**
 * B4 钩子craft:hook 段是信息流广告的生死线,按 Goal 北极星给「前 3 秒该怎么抓人」的战略意图。
 * 板桥硬约束:hook 不是品牌介绍,是让刷手指的人停下的狠话。
 */
export function hookIntentFor(metric: string | null | undefined): string {
  switch (metric) {
    case 'monthly_revenue':
      return 'Hook 目标=清仓/促销紧迫感:前 3 秒用稀缺/限时戳动作(while stocks last / final clearance / limited stock),制造"现在不看就没了"。不编具体价格/折扣数字。'
    case 'brand_search_volume':
      return 'Hook 目标=品牌记忆:前 3 秒抛一个反常识或痛点问题,让观众记住并想去搜品牌名。'
    case 'leads_count':
      return 'Hook 目标=勾留资动机:前 3 秒点破一个"不解决会后悔"的痛点,引出免费咨询/报价。'
    case 'organic_traffic':
      return 'Hook 目标=勾好奇:前 3 秒抛一个"看完才知道答案"的信息缺口,引导上站。'
    case 'ai_visibility_score':
      return 'Hook 目标=权威开场:前 3 秒用专业断言/品类洞察立住权威身份。'
    default:
      return 'Hook 目标=停手指:前 3 秒一句戳中痛点或反常识的狠话,别用"品牌名+定位"式平淡开场。'
  }
}

/**
 * 红线硬拦(魏征 B4-P1):prompt 口头禁数字不够,LLM 可能无视吐出「$29/m²」「40% off」。
 * 这类编造的价格/折扣一旦上客户可见成片 = 踩「绝不凭空注入客户业务数据」红线(Oztop 编过假数字事故)。
 * output 侧扫描,命中即判定整条 LLM 结果不可信 → 落模板 fallback(零数字,已测试守护)。
 * 红线由数据事实守护,不靠 prompt 措辞。(未来 verified_offer 录入的真数字将走白名单豁免——板桥,下一 PR)
 */
// 数字提取(支持千分位逗号;normNum 再去逗号归一,魏征 B4-P1:"$1,299" 不被断成 1/299)。
const NUM_RE = /\d[\d,]*(?:\.\d+)?/g
// 价格/折扣片段(best-effort 尽量宽以拦编造价格;$50 人工审片是最后兜底)。覆盖:货币前缀($/A$/NZ$/AUD/￥)、
// 百分比/off/dollars/bucks 后缀、per-unit 裸价(/m²、/sqm、per m)、"X for Y"(魏征 B4-P1:裸价系统性漏网)。
const PRICE_DISCOUNT_RE =
  /(?:\$|a\$|nz\$|\baud\b|￥)\s*\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s*(?:%|\boff\b|\bdollars?\b|\bbucks\b|\/\s*m²|\/\s*m2|\/\s*sqm|\bper\s*m²?)|\d[\d,]*\s*\bfor\b\s*\d/gi

/** 归一化数字串:去千分位逗号 + 去尾零("35.50"→"35.5","1,299"→"1299")。 */
function normNum(n: string): string {
  const f = parseFloat(n.replace(/,/g, ''))
  return Number.isFinite(f) ? String(f) : n
}

function collectTexts(copy: AdCopy): string[] {
  const texts: Array<string | undefined> = []
  for (const s of copy.segments ?? []) texts.push(s.title_main, s.title_sub, s.caption, s.vo)
  texts.push(copy.endcard?.cta, copy.endcard?.vo, ...(copy.endcard?.offer ?? []))
  return texts.filter((t): t is string => typeof t === 'string')
}

/**
 * verified_offer 里的价格数字 = 红线白名单(客户确认的真数字可用,其余一律视为 AI 编造)。
 * 魏征 B4-P0:**只从 price/was/discount 提数字,排除 offer_expiry**——日期天然含小整数(31 号/月份/年份),
 * 一旦进白名单就给 AI 一批"合法价格弹药"(offer_expiry:"31 July" → AI 可写 "$31/m²")。截止日以 "Ends 31 July"
 * 出现,不匹配 PRICE_DISCOUNT_RE(无 $/%/裸价单位),本就不会被拦,无需进白名单。
 */
export function allowedNumbersFrom(offer: VerifiedOffer | null | undefined): Set<string> {
  const allowed = new Set<string>()
  if (!offer) return allowed
  for (const v of [offer.price_from, offer.was_price, offer.discount]) {
    if (typeof v === 'string') for (const n of v.match(NUM_RE) ?? []) allowed.add(normNum(n))
  }
  return allowed
}

/**
 * 红线硬拦(魏征 B4-P1 + 板桥 verified_offer):扫 output 价格/折扣片段,任一片段的数字不在白名单
 * (verified_offer 的真数字)→ 判定 AI 编造 → 整条落模板。无 verified_offer = 白名单空 = 禁一切价格/折扣数字。
 */
function hasInventedNumber(copy: AdCopy, allowed: Set<string>): boolean {
  for (const t of collectTexts(copy)) {
    for (const frag of t.match(PRICE_DISCOUNT_RE) ?? []) {
      const nums = frag.match(NUM_RE) ?? []
      if (nums.some((n) => !allowed.has(normNum(n)))) return true
    }
  }
  return false
}

/** copy 生成同步塞在信号入口链路(persistDecision),Sonnet 卡住会拖满入口(魏征 A2-§4)。
 *  硬超时 → 走模板 fallback,不拖垮 signals POST(maxDuration 60s)。 */
const COPY_GEN_TIMEOUT_MS = 8000

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('copy gen timeout')), ms)
    p.then(
      (v) => { clearTimeout(t); resolve(v) },
      (e) => { clearTimeout(t); reject(e) }, // 显式接住 p 的 rejection,不泄漏 unhandled + 清定时器
    )
  })
}

/**
 * 按 master_brief 生成一条成片的广告文案。endcard.url 强制锁 master_brief.website
 * (防 LLM 乱填别的域名 —— 客户业务页只能挂客户自己域名,CLAUDE.md 红线精神)。
 */
export async function generateAdCopy(params: {
  brief: MasterBrief
  angle: string
  rationale: string
  segmentRoles: Role[]
  /** B3:工单归因桩的北极星指标,塑造 CTA 战略意图(诸葛亮硬验收) */
  expectedMetric?: string | null
  /** B4:PM 录入的客户真实促销事实,真数字可合法进钩子(红线白名单,其余数字仍拦) */
  verifiedOffer?: VerifiedOffer | null
}): Promise<AdCopy> {
  const { brief, angle, rationale, segmentRoles, expectedMetric, verifiedOffer } = params
  const brand = brief.brand_name || 'our brand' // 英文中性词,不让中文串进 AU/NZ 英文广告(魏征 A2-§6)
  const url = brief.website || ''
  const allowed = allowedNumbersFrom(verifiedOffer) // 红线白名单:仅这些真数字放行

  try {
    const offerFacts = verifiedOffer
      ? ([
          ['现价', verifiedOffer.price_from],
          ['原价', verifiedOffer.was_price],
          ['折扣', verifiedOffer.discount],
          ['截止', verifiedOffer.offer_expiry],
        ] as Array<[string, string | undefined]>)
          .filter(([, v]) => v)
          .map(([k, v]) => `${k}=${v}`)
          .join('、')
      : ''
    const systemPrompt =
      `你为「${brand}」写 9:16 竖屏**信息流短视频广告**(Facebook/Instagram Reels)文案。` +
      `这是刷到就要在前 3 秒留住观众的广告,不是品牌宣传片——第一段(hook)是全片生死线。` +
      `严格遵守下面的品牌约束,AU 英语拼写。**除下方"客户已确认真实促销事实"明确给出的数字外,不编造任何价格/折扣/数字**` +
      `(没依据的 $X、X% off 一律不写;无促销数字时紧迫感用 clearance / while stocks last / limited stock 这类真实表达)。` +
      `只返回 JSON,不要解释。\n\n${formatBriefForPrompt(brief)}`
    const user =
      `角度(必须溯源品牌主线): ${angle}\n为什么做这条: ${rationale}\n` +
      (offerFacts
        ? `客户已确认真实促销事实(这些真数字可以且应该用进钩子做紧迫感,例:把现价当 hook 主视觉): ${offerFacts}。除这些外禁止编造任何其他价格/折扣数字。\n`
        : '') +
      `${hookIntentFor(expectedMetric)}\n${ctaIntentFor(expectedMetric)}\n` +
      `段落顺序(${segmentRoles.length} 段): ${segmentRoles.join(', ')}\n\n` +
      `要求:\n` +
      `- hook 段(第一段)必须是能让刷手指的人停下的狠话:戳痛点/反常识/紧迫,禁止"品牌名+定位"式平淡开场。\n` +
      `- 每个文本字段 ≤ 6 词;AU 英语;无把握的价格/折扣改用「Free measure & quote」「Talk to us」式表达,绝不编数字。\n` +
      `- endcard.url 固定填 "${url}";segments 数量 = ${segmentRoles.length};CTA 体现上面的 CTA 目标。\n\n` +
      `返回 JSON:{"segments":[{"role":"hook|middle|cta","title_main"?,"title_sub"?,"caption"?,"vo"?}],` +
      `"endcard":{"cta","offer":["..."],"url":"${url}","vo"?}}`

    const { text } = await withTimeout(
      callClaudeChat({
        systemPrompt,
        messages: [{ role: 'user', content: user }],
        maxOutputTokens: 1024,
      }),
      COPY_GEN_TIMEOUT_MS,
    )
    const parsed = parseJsonResponse<AdCopy>(text)
    if (
      parsed &&
      Array.isArray(parsed.segments) &&
      parsed.segments.length >= segmentRoles.length &&
      parsed.endcard
    ) {
      parsed.endcard.url = url // 硬锁品牌网址,不信 LLM 填的
      if (!Array.isArray(parsed.endcard.offer)) parsed.endcard.offer = []
      // 红线硬拦:LLM 吐的价格/折扣数字不在 verified_offer 白名单 → 编造 → 整条不可信,落模板(不 return)
      if (!hasInventedNumber(parsed, allowed)) return parsed
    }
  } catch {
    // 落模板 fallback
  }

  // 品牌接地模板 fallback(LLM 挂时用,不硬编任何客户名/网址)。
  // B4:有 verified_offer 真价 → 把真价当钩子 + 截止紧迫感(真数字来自 PM 录入,红线安全,本地无 LLM 也能出真数字片)。
  const price = verifiedOffer?.price_from
  if (price) {
    const urgency = verifiedOffer?.offer_expiry ? `Ends ${verifiedOffer.offer_expiry}` : 'While stocks last'
    const wasLine = verifiedOffer?.was_price ? `Was ${verifiedOffer.was_price}` : angle
    return {
      segments: segmentRoles.map((role, i) =>
        i === 0
          ? { role, title_main: price, title_sub: angle } // 真价当 hook 主视觉
          : i === segmentRoles.length - 1
            ? { role, caption: urgency }
            : { role, caption: wasLine },
      ),
      endcard: { cta: 'Shop now', offer: [urgency], url },
    }
  }
  // 无 verified_offer:绝不编数字。CTA 按 Goal 微调但绝对安全(魏征 B4-P1:不硬编行业专属服务承诺)。
  const isConversion = expectedMetric === 'monthly_revenue' || expectedMetric === 'leads_count'
  return {
    segments: segmentRoles.map((role, i) =>
      i === 0
        ? { role, title_main: brand.toUpperCase().slice(0, 24), title_sub: angle }
        : { role, caption: angle },
    ),
    endcard: isConversion
      ? { cta: 'Enquire now', offer: ['Talk to us today'], url }
      : { cta: `Discover ${brand}`, offer: ['Talk to us today'], url },
  }
}
