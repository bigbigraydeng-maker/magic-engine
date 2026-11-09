// P21.J 成片文案品控(2026-09-20 Jev 评估,子牙+魏征设计复审后定案)。
//
// 存在理由:现有品牌红线闸(strategist.ts containsPhrase / worker-guard.ts
// scanRedlineHits)是静态短语黑名单,查不出两类真实发生过的语义缺陷 ——
//   A. 角度/上屏 hook 把第三方竞品品牌当自己卖点(Oztop "mapei brisbane"/"karndean brisbane")
//   B. 上屏字幕是内部内容分类标签冒充真实文案,尤其跨段完全重复
//      (Oztop/CTS 多单每段字幕字面就是 "Customer Stories & Community" 这类内部标签)
//   (原 C 类「人称口吻不符简报」检测已于 2026-10-16 取消:PM 取消了「必须第一人称」要求)
//
// 定位:跟 scanRedlineHits 同一个口径 —— 命中不打回,写标记转人工(工单本来就
// 100% 进 in_review,这里只是让审核人有的放矢,不是新增一道拦截)。fail-closed
// 的对象是"漏判"而不是"发布":Jev 调用失败/超时一律计为需要人工重点复核,
// 绝不能因为拿不到 AI 判断就悄悄放行、也绝不能让这次检查本身拖垮或搞崩
// completeWorkOrder 的主链路(worker /complete route maxDuration=60s,已经在
// 做多表写入)—— 因此这里的任何异常都必须在本模块内部吞掉。
//
// A 检测的定位说明(魏征复审要求写清楚):strategist.ts pickAngle 已经把
// "keyword_seeds 当广告角度"这个具体根因堵死(angle 现在只来自 content_pillars +
// core_proposition),所以这里防的是残余风险 —— FDE 手填 content_pillars 时手滑
// 打进竞品名,或 copy-generator 的 LLM 在生成阶段自由发挥带出竞品名 —— 不是重复
// 修同一个 bug。

import { callJev, type JevQuestion } from '@/lib/jev/client'
import {
  factoryQualityGuardEnabled,
  FACTORY_QUALITY_GUARD_MIN_REPEATS,
  FACTORY_QUALITY_GUARD_MIN_REPEAT_LEN,
  FACTORY_QUALITY_GUARD_THRESHOLD,
} from './constants'

export type QualityFlagCategory =
  | 'competitor_brand'
  | 'placeholder_caption'
  | 'quality_check_unavailable'

export interface QualityFlag {
  category: QualityFlagCategory
  detail: string
}

function normalizeCaption(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * 确定性检测(零成本,不用等 Jev):同一非平凡字幕跨 >= FACTORY_QUALITY_GUARD_MIN_REPEATS
 * 段完全重复 → 判定命中。短字幕(如两段都写 "Shop now")是正常 CTA 复用,不算信号 ——
 * 只有长度 >= FACTORY_QUALITY_GUARD_MIN_REPEAT_LEN 的重复才算。
 * 这只是 B 类的机械子情形;非精确重复但仍"读起来像内部标签"的情况靠下面的 Jev 判断。
 */
export function findRepeatedCaption(texts: string[]): { text: string; count: number } | null {
  const counts = new Map<string, { original: string; count: number }>()
  for (const t of texts) {
    if (typeof t !== 'string') continue
    const norm = normalizeCaption(t)
    if (norm.length < FACTORY_QUALITY_GUARD_MIN_REPEAT_LEN) continue
    const entry = counts.get(norm)
    if (entry) entry.count += 1
    else counts.set(norm, { original: t.trim(), count: 1 })
  }
  let best: { text: string; count: number } | null = null
  for (const { original, count } of counts.values()) {
    if (count >= FACTORY_QUALITY_GUARD_MIN_REPEATS && (!best || count > best.count)) {
      best = { text: original, count }
    }
  }
  return best
}

export interface ContentQualityScanParams {
  brandName: string
  /** 工单角度(content_work_orders.angle / strategist pickAngle 的产出)。 */
  angleLabel: string | null
  /** hook 段上屏的主视觉文字(如价格钩子 "$35.50/m²")。 */
  onScreenHook: string | null
  /** 成片最终字幕面(caption + 各段 text_overlay),即 scanRedlineHits 复扫的同一份文本。 */
  captions: string[]
}

const QUESTION_COMPETITOR: JevQuestion = {
  type: 'noul',
  instructions:
    "The ad's on-screen headline or angle names or is built around a DIFFERENT company's " +
    "product/brand (a competitor or third-party supplier) rather than the advertiser's own " +
    'brand or product category.',
}

const QUESTION_PLACEHOLDER: JevQuestion = {
  type: 'noul',
  instructions:
    'The on-screen captions look like an internal content-planning category label (e.g. a ' +
    'generic content-pillar name) rather than real, specific marketing copy meant for a ' +
    'customer to read. A strong signal: the exact same generic phrase repeats verbatim across ' +
    'multiple segments.',
}

/**
 * 两类语义品控的编排入口。绝不抛异常 —— 任何内部失败(Jev 网络/超时/解析)一律
 * 收敛成 quality_check_unavailable 标记返回,调用方(complete-work-order.ts)不需要
 * 再包一层 try/catch 也不会影响主链路。
 */
export async function scanContentQualityFlags(params: ContentQualityScanParams): Promise<QualityFlag[]> {
  const { brandName, angleLabel, onScreenHook, captions } = params
  const flags: QualityFlag[] = []
  const cleanCaptions = captions.filter((c): c is string => typeof c === 'string' && c.trim().length > 0)

  const repeated = findRepeatedCaption(cleanCaptions)
  if (repeated) {
    flags.push({
      category: 'placeholder_caption',
      detail: `字幕跨 ${repeated.count} 段完全重复:"${repeated.text}"`,
    })
  }

  if (!factoryQualityGuardEnabled()) return flags

  const hasAngleText = Boolean((angleLabel ?? '').trim() || (onScreenHook ?? '').trim())
  const hasCaptions = cleanCaptions.length > 0

  const questions: Record<string, JevQuestion> = {}
  if (hasAngleText) questions.competitor_angle = QUESTION_COMPETITOR
  if (hasCaptions) questions.placeholder_leak = QUESTION_PLACEHOLDER

  if (Object.keys(questions).length === 0) return flags

  const state: Record<string, unknown> = { brand: brandName }
  if (hasAngleText) {
    state.on_screen_hook = onScreenHook ?? ''
    state.angle_label = angleLabel ?? ''
  }
  if (hasCaptions) state.captions = cleanCaptions

  try {
    const result = await callJev(state, questions)
    if (questions.competitor_angle && (result.answers.competitor_angle?.noul ?? 0) >= FACTORY_QUALITY_GUARD_THRESHOLD) {
      flags.push({
        category: 'competitor_brand',
        detail: `角度/hook 疑似把第三方品牌当卖点:"${angleLabel ?? onScreenHook}"`,
      })
    }
    if (questions.placeholder_leak && (result.answers.placeholder_leak?.noul ?? 0) >= FACTORY_QUALITY_GUARD_THRESHOLD) {
      flags.push({
        category: 'placeholder_caption',
        detail: '字幕疑似内部内容分类标签冒充真文案',
      })
    }
  } catch (e) {
    flags.push({
      category: 'quality_check_unavailable',
      detail: `品控 AI 检测暂不可用(${e instanceof Error ? e.message : String(e)}),请人工重点核对竞品名/占位字幕`,
    })
  }

  return flags
}
