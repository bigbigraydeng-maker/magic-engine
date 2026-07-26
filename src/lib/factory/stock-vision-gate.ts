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

/** 闸拦下的原因,分开记好排查(相关性问题要换搜索词,文字问题要改改图指令) */
export type VisionReject = 'off_topic' | 'has_text'

export interface VisionVerdict {
  /**
   * 🔴 是否真的拿到了判定。false = 调用挂了/返回解析不了,**不是**「模型说不相关」。
   *
   * 事故(2026-07-26,当天第三次栽在同一类错上):调用层因环境问题全部失败,
   * 而失败一律返回 relevant:false,调用方把「不相关」等同于「该下架」——
   * 7 张好图被一次性误下架。**调用失败不是证据。**
   * 所以:ok=false 时只能「这一轮别用」,绝不能据此下架或做任何不可逆动作。
   */
  ok: boolean
  /** 是否可用 = 相关 **且** 画面上没有烧死的文字(仅当 ok=true 才有意义) */
  relevant: boolean
  /**
   * 🔴 画面上有没有文字/水印。
   *
   * 实测(2026-07-26):一张上海豫园的图改完仍带着原图烧死的
   * 「Hidden gem in Shanghai 🇨🇳」+ 表情符号,一路过闸进了池子 ——
   * 因为闸只问「跟业务相不相关」,而它**确实相关**。带字的图会跟装配层
   * 压上去的字幕直接打架,必须单独判一条。
   */
  hasText: boolean
  /** 画面里是什么(用于日志和溯源) */
  subject: string
  /** 拦下时的原因分类 */
  reject: VisionReject | null
  /** 拦下时的原因(人话) */
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
    `"has_text":<true|false>,` +
    `"reason":"<if either check fails, why, max 15 words>"}\n\n` +
    `relevant=false when the image shows a place, product category or setting ` +
    `that does not belong to this business — for example a different country or region ` +
    `than the business serves, or an unrelated product category.\n` +
    `has_text=true when ANY readable writing is burned into the picture: captions, ` +
    `headlines, signage, watermarks, logos, emoji or sticker graphics. ` +
    `This image will get its own captions added later, so any existing text ruins it. ` +
    `Look carefully at the top and bottom edges — overlay captions usually sit there.\n` +
    `When in doubt on either answer, fail it: showing the wrong place, or a picture ` +
    `with someone else's caption on it, is worse than having fewer images.`
  )
}

/** 解析模型返回(拿不到完整判定 → ok:false,只跳过不下架) */
export function parseVisionVerdict(raw: string): VisionVerdict {
  const dead = (subject: string, reason: string): VisionVerdict => ({
    ok: false, relevant: false, hasText: false, subject, reject: null, reason,
  })
  try {
    const clean = raw.replace(/^```json\s*|\s*```$/g, '').trim()
    const d = JSON.parse(clean) as Record<string, unknown>
    // 两条都必须是真布尔才算「拿到判定」;缺字段 = 返回不完整 = 当调用失败处理,不据此下架
    if (typeof d.relevant !== 'boolean') return dead('(no verdict)', '模型没给出 relevant 布尔值')
    if (typeof d.has_text !== 'boolean') return dead('(no verdict)', '模型没给出 has_text 布尔值')

    const subject = typeof d.subject === 'string' ? d.subject.slice(0, 80) : '(unknown)'
    const reason = typeof d.reason === 'string' && d.reason.trim() ? d.reason.slice(0, 120) : null
    // 相关性先判:两条都不过时,报「跑题」比报「有字」更能指导下一步(该换搜索词)
    const reject: VisionReject | null = !d.relevant ? 'off_topic' : d.has_text ? 'has_text' : null
    return {
      ok: true,
      // relevant 这里是「能不能用」:相关且没字才算过
      relevant: reject === null,
      hasText: d.has_text,
      subject,
      reject,
      reason: reason ?? (reject === 'has_text' ? '画面上有烧死的文字,会跟字幕打架' : null),
    }
  } catch {
    return dead('(parse failed)', '模型返回无法解析')
  }
}

/**
 * 看一张图,判两件事:跟业务相不相关、画面上有没有烧死的文字。
 *
 * 调用失败 → `ok:false`(这一轮别用这张图),**不是**「判定为不相关」。
 * 调用方必须看 ok 再决定要不要做下架这类不可逆动作(见 VisionVerdict.ok 的事故注解)。
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
      ok: false,
      relevant: false,
      hasText: false,
      subject: '(vision failed)',
      reject: null,
      reason: `视觉判定失败: ${e instanceof Error ? e.message.slice(0, 80) : e}`,
    }
  }
}
