// P21.J A2 — 广告文案生成(后端,品牌接地)。架构整理:把「脑子」从仓外 worker 收回 ME 后端。
// worker 以前硬编「CTS Tours / ctstours.co.nz」,只能服务一个客户。这里改成读 master_brief 的
// 品牌名/网址/VI(复用 brief-injector.formatBriefForPrompt),多客户通用、品牌准确。
// best-effort:LLM 失败走品牌接地的模板 fallback(用 brand_name/website,绝不硬编任何客户)。

import { callClaudeChat, parseJsonResponse } from '@/lib/anthropic/client'
import { formatBriefForPrompt } from '@/lib/content/brief-injector'
import type { MasterBrief } from '@/types/magic-engine'
import type { AdCopy } from './types'

type Role = 'hook' | 'middle' | 'cta'

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
}): Promise<AdCopy> {
  const { brief, angle, rationale, segmentRoles } = params
  const brand = brief.brand_name || 'our brand' // 英文中性词,不让中文串进 AU/NZ 英文广告(魏征 A2-§6)
  const url = brief.website || ''

  try {
    const systemPrompt =
      `你为「${brand}」写 9:16 竖屏视频广告文案。严格遵守下面的品牌约束,` +
      `AU/NZ 英语拼写,不编造价格/数字。只返回 JSON,不要解释。\n\n${formatBriefForPrompt(brief)}`
    const user =
      `角度(必须溯源品牌主线): ${angle}\n为什么做这条: ${rationale}\n` +
      `段落顺序(${segmentRoles.length} 段): ${segmentRoles.join(', ')}\n\n` +
      `返回 JSON:{"segments":[{"role":"hook|middle|cta","title_main"?,"title_sub"?,"caption"?,"vo"?}],` +
      `"endcard":{"cta","offer":["..."],"url":"${url}","vo"?}}\n` +
      `规则:每个文本字段 ≤ 6 词;英语;无把握的价格用「Talk to us」式 CTA;` +
      `endcard.url 固定填 "${url}";segments 数量 = ${segmentRoles.length}。`

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
      return parsed
    }
  } catch {
    // 落模板 fallback
  }

  // 品牌接地模板 fallback(不硬编任何客户名/网址)
  return {
    segments: segmentRoles.map((role, i) =>
      i === 0
        ? { role, title_main: brand.toUpperCase().slice(0, 24), title_sub: angle }
        : { role, caption: angle },
    ),
    endcard: { cta: `Discover ${brand}`, offer: ['Talk to us today'], url },
  }
}
