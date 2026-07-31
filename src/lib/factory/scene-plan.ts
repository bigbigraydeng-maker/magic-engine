// 分镜 — 把一条逐字稿切成几段镜头，每段定好：旁白(念什么) / 屏幕字幕(短句大字) / 画面(氛围空镜) / 运镜。
// 做片管道第 2 块。产出喂给：画面(gpt-image→Muapi i2v)、配音(MiniMax)、拼片(ffmpeg)。
// 铁律：旁白只从原逐字稿切分，不新增业务事实/数字；画面只做氛围 b-roll，绝不冒充客户真实产品。

import { callClaudeChat, parseJsonResponse } from '@/lib/anthropic/client'
import { getActiveBrief, formatBriefForPrompt } from '@/lib/content/brief-injector'

export interface Scene {
  index: number
  voText: string        // 这一段旁白（从原稿切来，逐字念，含【】占位）
  captionText: string   // 屏幕字幕：短句大字，≤6 词，抓这段的钩子
  imagePrompt: string   // gpt-image 画面提示（英文，竖屏氛围空镜，不含真实产品/logo）
  motionPrompt: string  // i2v 运镜提示（英文，轻微自然运动）
}

export interface ScenePlan {
  scenes: Scene[]
}

const SYSTEM = `你是短视频"分镜师"。把一条口播逐字稿切成 4-6 段镜头，每段给旁白、屏幕字幕、画面、运镜。

铁律（违反即失败）：
1. 旁白(voText)只能从原逐字稿切分重组，逐字用原话，绝不新增任何业务事实或数字。原稿里的【】占位原样保留。
2. 屏幕字幕(captionText)是大字短句，≤6 个词/字，抓这一段最抓人的一句，配合客户禁词（一个禁词都不能出现）。
3. 画面(imagePrompt)只做氛围/概念空镜（人在电脑前、城市、抽象科技感等），英文，竖屏 9:16。绝不描述客户的真实产品、门店、价格、logo——那些只能用客户自己拍的素材，AI 画面只烘托气氛。
4. 运镜(motionPrompt)英文，轻微自然运动（缓慢推近/平移/景深变化），不夸张。
5. 段落顺序 = 原稿顺序；所有段的 voText 顺次拼起来应约等于原稿。
6. 输出严格 JSON，无多余文字、无 markdown 围栏。`

/** 把逐字稿切成分镜方案。 */
export async function planScenes(params: {
  clientId: string
  title: string
  script: string
}): Promise<ScenePlan> {
  const { clientId, title, script } = params
  if (!script.trim()) throw new Error('script is empty')

  const brief = await getActiveBrief(clientId)
  const briefBlock = brief
    ? formatBriefForPrompt(brief)
    : '（该客户暂无 master_brief，按通用中文口播人设，务必保守，绝不编造任何事实与数字）'

  const userMsg = [
    '# 目标客户人设（master_brief，取语气/禁词，别照搬进画面）',
    briefBlock,
    '',
    `# 标题\n${title}`,
    '',
    '# 逐字稿（切它，别改字、别加事实）',
    script,
    '',
    '# 输出（严格 JSON，无多余文字）',
    '{"scenes":[{"voText":"这一段念的原话","captionText":"大字短句≤6词","imagePrompt":"vertical 9:16 ambient b-roll, English, no product/logo","motionPrompt":"slow push-in, English"}]}',
  ].join('\n')

  const result = await callClaudeChat({
    systemPrompt: SYSTEM,
    messages: [{ role: 'user', content: userMsg }],
    maxOutputTokens: 3000,
  })

  const parsed = parseJsonResponse<{ scenes: Omit<Scene, 'index'>[] }>(result.text)
  const raw = Array.isArray(parsed?.scenes) ? parsed.scenes : []
  if (raw.length === 0) throw new Error('scene plan returned no scenes')

  const scenes: Scene[] = raw.map((s, i) => ({
    index: i,
    voText: String(s.voText ?? '').trim(),
    captionText: String(s.captionText ?? '').trim(),
    imagePrompt: String(s.imagePrompt ?? '').trim(),
    motionPrompt: String(s.motionPrompt ?? '').trim(),
  })).filter((s) => s.voText.length > 0)

  if (scenes.length === 0) throw new Error('scene plan produced only empty scenes')
  return { scenes }
}
