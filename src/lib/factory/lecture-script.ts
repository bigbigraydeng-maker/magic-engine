// 讲课式文案 — 把一个选题写成「上课件 + 下真人数字人口播」讲课短视频的结构化脚本。
// 输出：开场钩子 + 2-4 个教学要点(每个带 口播词 + 课件 slide 标题/要点) + 结尾 CTA。
// 铁律：第一人称人设 / 禁词 / 不编数字用【】/ 不带货 / 口播能一口气念。
// v2(PM「太水」返工)：要点必须是可操作步骤(真实工具名+怎么做)，禁口号；CTA 按平台分两版本，
// 小红书版绝不导流私信(限流红线)，口播 CTA 用平台通用安全版(只说关注/合集)。

import { callClaudeChat, parseJsonResponse } from '@/lib/anthropic/client'
import { getActiveBrief, formatBriefForPrompt } from '@/lib/content/brief-injector'

export interface LectureSection {
  spoken: string        // 这一段口播词(真人/数字人念)
  slideTitle: string    // 课件 slide 大标题
  slidePoints: string[] // 课件 slide 要点(每条短）
}

export interface LectureCtaVariants {
  fbTiktok: string      // FB/TikTok 发布正文 CTA：留言关键词 → 私信送资料
  xiaohongshu: string   // 小红书发布正文 CTA：关注 + 主页合集(禁私信导流)
}

export interface LectureScript {
  title: string         // 视频标题
  hookSpoken: string    // 开场钩子口播
  sections: LectureSection[]
  ctaSpoken: string     // 结尾口播 CTA(平台通用安全版：只说关注/主页合集，不提私信)
  ctaVariants?: LectureCtaVariants // 发布正文按平台两版本
}

// 小红书导流红线词(严格版，只用于纯 CTA 字段)：出现任何一个 = 有限流风险，判不合格。
const XHS_BANNED = ['私信', '加微', '微信', 'vx', 'wx', 'whatsapp', '扣1', '扣 1', 'dd我', '滴滴我']

// 口播导流句式(宽松版，用于钩子/要点/结尾口播)：只拦「冲观众喊」的导流，
// 不误杀正当教学内容(如「用 Manychat 自动私信发问卷」「以前获客靠微信朋友圈」)。
const SPOKEN_DIVERSION = ['私信我', '私我', '加我微信', '加微信', '加个微信', '加v', '扣1', '扣 1', 'dd我', '滴滴我']

/** 检查小红书 CTA 是否踩导流红线，返回命中的词(空数组 = 安全)。 */
export function xhsCtaViolations(text: string): string[] {
  const lower = text.toLowerCase()
  return XHS_BANNED.filter((w) => lower.includes(w.toLowerCase()))
}

/** 检查口播是否有冲观众喊的导流句式(同片发小红书会限流)。 */
export function spokenDiversionViolations(text: string): string[] {
  const lower = text.toLowerCase()
  return SPOKEN_DIVERSION.filter((w) => lower.includes(w.toLowerCase()))
}

const SYSTEM = `你是短视频「讲课式文案」编剧。把一个选题写成「上课件 + 下真人口播」的讲课短视频脚本。

结构(固定)：
1. 开场钩子(hookSpoken)：3 秒抓人的一句，口播，制造好奇或戳痛点。
2. 2-4 个教学要点(sections)：每个要点给
   - spoken：这段口播词(口语、短句、能一口气念，约 30-60 字)
   - slideTitle：课件大标题(≤10 字，抓这段核心)
   - slidePoints：课件要点 2-3 条(每条 ≤14 字)
3. 结尾(ctaSpoken)：一句行动号召口播。
4. ctaVariants：发布正文的 CTA，按平台两版本(见下)。

内容必须「实」(违反 = 整篇失败)：
- 每个要点必须是听完就能上手的具体做法：说清用什么工具(写真实工具名，如 ChatGPT / Canva / Google Maps)、
  第一步打开哪里、输入什么、能得到什么。观众记笔记能照着做。
- 禁止口号式空话(「AI 是趋势」「让 AI 为你打工」这类)。形容词堆砌 = 水。
- slidePoints 同样要实：写步骤和工具名，不写形容词。
- 每讲至少给 1 个能直接抄走的例子(如一句可以直接复制的 AI 提示词、一个具体操作路径)。
- 整篇口播(钩子→各要点→结尾)连起来必须是一篇能一口气念完的完整讲稿：
  段与段自然衔接(上一段结尾顺进下一段开头)，别让每段都像重新开头——客户是一条录到底的。

要点之间必须「各是各的」(违反 = 整篇失败)：
- 每个要点是一件**不同的事**。判断标准三条全不许重合：用的工具、观众要做的动作、做完东西落到哪里。
  三条里有两条一样(例:两个要点都是「打开 ChatGPT 粘提示词 → 结果贴进同一个页面」)= 观众听着就是同一件事，必须合并成一个要点，空出来的位置换一件真正不同的事。
- 步骤顺序必须符合真实先后：后面步骤需要的东西，不能在更后面才教怎么拿
  (例:不能第二步就要求「描述里带关键词」，第三步才教怎么找关键词——找词必须在写描述之前，或者干脆合成一步)。
- 多个要点若都在同一个页面/后台里操作，只保留一个要点讲「怎么把它填好」，其余要点换到别的战场
  (例:主页填好之后 → 转向「怎么持续更新」「怎么把词用到别处」)。

CTA 规则(违反 = 失败)：
- ctaSpoken(口播，视频里念出来的)：平台通用安全版，只引导「关注 + 主页合集看全系列」。
  绝不能出现「私信」「加微信」等任何导流词——同一条片要发小红书，念了就会被限流。
- ctaVariants.fbTiktok(FB/TikTok 发布正文)：引导「留言【一个跟本讲相关的关键词】，我私信发你 XX」。
- ctaVariants.xiaohongshu(小红书发布正文)：只引导「关注 + 主页合集看全系列」，
  绝不出现 私信/加微/微信/vx/whatsapp/扣1 等任何导流词。

铁律(违反即失败)：
- 全程第一人称，严格按客户 master_brief 的人设 / 语气 / 支柱 / 禁词。禁词一个都不能出现。
- 绝不编造客户的业务数字或事实。任何具体数字用【】占位(如【填真实数字】)，让客户自己填。
- 教的是「怎么用 AI」，客户不带货，别写成卖货。
- 全部口播加起来 60-90 秒的量(讲清楚步骤比压时长重要)。
- 输出必须是严格 JSON，前后无多余文字、不带 markdown 代码围栏。`

const OUTPUT_SHAPE =
  '{"title":"视频标题","hookSpoken":"开场钩子口播","sections":[{"spoken":"这段口播词","slideTitle":"课件标题","slidePoints":["要点1","要点2"]}],"ctaSpoken":"结尾口播(只说关注+合集)","ctaVariants":{"fbTiktok":"FB/TK正文CTA(留言关键词→私信)","xiaohongshu":"小红书正文CTA(关注+合集，禁导流词)"}}'

async function briefBlockOf(clientId: string): Promise<string> {
  const brief = await getActiveBrief(clientId)
  return brief
    ? formatBriefForPrompt(brief)
    : '（该客户暂无 master_brief，按通用中文口播人设，务必保守，绝不编造任何事实与数字）'
}

function validateScript(parsed: LectureScript | null): LectureScript {
  if (!parsed?.hookSpoken || !Array.isArray(parsed.sections) || parsed.sections.length === 0) {
    throw new Error('lecture script incomplete')
  }
  // 每段口播必须非空——空段会让做片时课件和口播错位一页
  if (parsed.sections.some((s) => !s.spoken?.trim() || !s.slideTitle?.trim())) {
    throw new Error('lecture section has empty spoken/slideTitle')
  }
  // 纯 CTA 字段走严格名单；口播只拦冲观众喊的导流句式(同一条片的音轨要发小红书)
  const spokenAll = [parsed.hookSpoken, ...parsed.sections.map((s) => s.spoken)]
  const violations = [
    ...xhsCtaViolations(parsed.ctaVariants?.xiaohongshu ?? ''),
    ...xhsCtaViolations(parsed.ctaSpoken ?? ''),
    ...spokenAll.flatMap((t) => spokenDiversionViolations(t)),
  ]
  if (violations.length > 0) {
    throw new Error(`口播/小红书 CTA 踩导流红线：${violations.join('、')}`)
  }
  return parsed
}

/** 生成一条讲课式短视频的结构化文案。 */
export async function planLectureScript(params: {
  clientId: string
  topic: string          // 选题(标题或一句话主题，来自爆款选题)
  reference?: string     // 可选：参考的爆款内容(抄结构/钩子)
}): Promise<LectureScript> {
  const { clientId, topic, reference } = params
  if (!topic.trim()) throw new Error('topic is empty')

  const userMsg = [
    '# 客户人设(master_brief)',
    await briefBlockOf(clientId),
    '',
    `# 选题\n${topic}`,
    reference ? `\n# 爆款参考(抄它的结构 / 钩子，不抄字)\n${reference}` : '',
    '',
    '# 输出(严格 JSON，无多余文字)',
    OUTPUT_SHAPE,
  ]
    .filter(Boolean)
    .join('\n')

  const result = await callClaudeChat({
    systemPrompt: SYSTEM,
    messages: [{ role: 'user', content: userMsg }],
    maxOutputTokens: 3000,
  })

  return validateScript(parseJsonResponse<LectureScript>(result.text))
}

/** 只重写脚本里的某一段(段落重做)：保留全篇上下文，产出替换用的新段。 */
export async function redoLectureSection(params: {
  clientId: string
  lecture: LectureScript
  sectionIndex: number
  instruction?: string   // 可选：PM 打回时写的一句话要求(如「步骤再具体点」)
}): Promise<LectureSection> {
  const { clientId, lecture, sectionIndex, instruction } = params
  const target = lecture.sections[sectionIndex]
  if (!target) throw new Error(`section ${sectionIndex} 不存在`)

  const userMsg = [
    '# 客户人设(master_brief)',
    await briefBlockOf(clientId),
    '',
    `# 整篇脚本(上下文)\n${JSON.stringify(lecture, null, 2)}`,
    '',
    `# 任务\n只重写第 ${sectionIndex + 1} 个教学要点(sections[${sectionIndex}])，其余不动。`,
    '新版本必须换一个讲法(不是改几个字)，且比原版更实：具体工具名 + 可照做的步骤 + 能抄走的例子。',
    instruction ? `\n# 客户的重做要求\n${instruction}` : '',
    '',
    '# 输出(严格 JSON，只输出这一段，无多余文字)',
    '{"spoken":"这段口播词","slideTitle":"课件标题","slidePoints":["要点1","要点2"]}',
  ]
    .filter(Boolean)
    .join('\n')

  const result = await callClaudeChat({
    systemPrompt: SYSTEM,
    messages: [{ role: 'user', content: userMsg }],
    maxOutputTokens: 1200,
  })

  const parsed = parseJsonResponse<LectureSection>(result.text)
  if (!parsed?.spoken || !parsed.slideTitle || !Array.isArray(parsed.slidePoints)) {
    throw new Error('redo section incomplete')
  }
  return parsed
}
