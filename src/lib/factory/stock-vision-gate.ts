/**
 * 视觉相关性闸 —— 看图判断素材跟客户业务对不对,不看标题。
 *
 * 🔴 存在理由(2026-07-26 事故,同一个错犯了两次):
 * 第一次:CTS(中国游)抓回意大利/巴黎/希腊,我加了**标题黑名单 + 禁区词**。
 * 第二次:成片里又出现地中海小镇 —— 因为那张原图**没有标题**,标题闸一律放行。
 * 查库确认:10 张改图里 7 张的原图无标题。**只看标题的闸,对无标题图完全失效**。
 *
 * 而 Pinterest 大量好图恰恰没标题(标题是发布者随手填的,不是内容描述)。
 * 所以唯一可靠的办法是**看图本身**。
 *
 * 成本:gpt-4o-mini vision 每张约 $0.0002,比抓一张图($0.002)还便宜一个量级,
 * 更远低于「错图进成片」的代价(误导客户 = 踩 CLAUDE.md 业务事实红线)。
 */

import { callOpenAIVision } from './stock-vision-client'

export interface VisionVerdict {
  /** 是否跟客户业务相关 */
  relevant: boolean
  /** 画面里是什么(用于日志和溯源) */
  subject: string
  /** 不相关时的原因 */
  reason: string | null
}

/**
 * 判定提示词。
 *
 * 刻意做成**二选一 + 必须说出画面内容**:让模型先描述再判断,
 * 比直接问「相关吗」准得多(直接问容易一律答 yes)。
 */
export function buildVisionGatePrompt(businessContext: string): string {
  return (
    `You are screening stock imagery for a specific business. ` +
    `Business: ${businessContext}\n\n` +
    `Look at the image and answer STRICTLY as JSON:\n` +
    `{"subject":"<what is actually shown, max 10 words>",` +
    `"relevant":<true|false>,` +
    `"reason":"<if false, why it does not fit this business, max 15 words>"}\n\n` +
    `Mark relevant=false when the image shows a place, product category or setting ` +
    `that does not belong to this business — for example a different country or region ` +
    `than the business serves, or an unrelated product category. ` +
    `When in doubt, answer false: showing the wrong place to customers is worse than ` +
    `having fewer images.`
  )
}

/** 解析模型返回(容错:格式不对一律判为不相关,fail-closed) */
export function parseVisionVerdict(raw: string): VisionVerdict {
  try {
    const clean = raw.replace(/^```json\s*|\s*```$/g, '').trim()
    const d = JSON.parse(clean) as Record<string, unknown>
    return {
      // 只有明确 true 才算通过 —— 缺字段/非布尔一律拦
      relevant: d.relevant === true,
      subject: typeof d.subject === 'string' ? d.subject.slice(0, 80) : '(unknown)',
      reason: typeof d.reason === 'string' && d.reason.trim() ? d.reason.slice(0, 120) : null,
    }
  } catch {
    return { relevant: false, subject: '(parse failed)', reason: '模型返回无法解析,保守判为不相关' }
  }
}

/**
 * 看一张图,判断跟业务相不相关。
 * 调用失败 → 判为不相关(fail-closed:宁可少一张,也不让错图进成片)。
 */
export async function screenImage(
  imageUrl: string,
  businessContext: string,
): Promise<VisionVerdict> {
  try {
    const raw = await callOpenAIVision(imageUrl, buildVisionGatePrompt(businessContext))
    return parseVisionVerdict(raw)
  } catch (e) {
    return {
      relevant: false,
      subject: '(vision failed)',
      reason: `视觉判定失败: ${e instanceof Error ? e.message.slice(0, 80) : e}`,
    }
  }
}
