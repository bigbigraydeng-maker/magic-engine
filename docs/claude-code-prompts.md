# Claude Code 实施提示词

> 使用方式：按顺序执行两段提示词。第一段完成并通过 `npm run build` 后，再执行第二段。

---

## 提示词 1：创建 `social-plan-templates.ts`

```
你正在为 Magic Engine（Next.js 14 + TypeScript strict mode）新建一个纯函数库文件。

项目路径：magic-engine/
目标文件：src/lib/content/social-plan-templates.ts

【任务】
新建此文件。不修改任何现有文件。

【文件职责】
为 Reels / Post / Story 三种社媒格式提供：
1. GPT prompt 模板生成函数
2. Storyboard 9格 ChatGPT Image 提示词构建函数
3. Seedance I2V 提示词构建函数
4. 发布日期偏移计算函数

【类型定义】

export type SocialFormat = 'reels' | 'post' | 'story'

export interface FormatTemplate {
  systemPrompt: string
  userPrompt: string
}

export interface ReelsGPTResult {
  title: string
  theme: string
  fb_caption: string
  scene_beats: string[]   // 8 条，对应 Panel 1-8
}

export interface PostGPTResult {
  title: string
  caption: string
  hashtags: string[]
  visual_brief: string
}

export interface StoryGPTResult {
  title: string
  caption: string
  hashtags: string[]
  visual_brief: string
}

【常量】

export const GLOBAL_VISUAL_STYLE =
  'cinematic travel photography, warm heritage tones with deep shadows, elegant and timeless. ' +
  'Ultra high resolution, 9:16 vertical. No text, no watermarks, no logos, no tourists, no crowds.'

export const END_CARD_SPEC =
  'Final panel: #1a1a1a background, CTS logo in gold center, ' +
  '#d4af37 thin horizontal divider, white text "NZ Passport — Visa-Free Entry to China", ' +
  'small text "Est. 1928 · China specialists".'

【函数 1：getFormatTemplate】

export function getFormatTemplate(
  format: SocialFormat,
  briefText: string,
  campaignText: string,
  tourContext: string,
  itemIndex: number,
  tourName: string
): FormatTemplate

实现要求：
- systemPrompt 必须包含：briefText + campaignText + tourContext + 输出格式要求
- tourContext 先截断到 3000 字符再拼入（防止 token 超限）
- Reels userPrompt：要求输出 JSON，含 title / theme / fb_caption / scene_beats（8 条）
  - scene_beats 每条格式："Scene N（Xs-Ys）：[英文视觉描述，无人脸，无文字]"
  - fb_caption：150-200 字英文，含 CTA，含 3-5 个 hashtag
- Post userPrompt：要求输出 JSON，含 title / caption / hashtags / visual_brief
  - caption：150-250 字英文，含 CTA
  - hashtags：8-12 个
- Story userPrompt：要求输出 JSON，含 title / caption / hashtags / visual_brief
  - caption：50-80 字英文，强 CTA
  - hashtags：3-5 个
- itemIndex 用于变化角度：偶数 = educational，奇数 = inspirational
- 所有 system prompt 末尾加：'Output ONLY valid JSON. No markdown fences. No explanation.'

【函数 2：buildStoryboardPrompt】

export function buildStoryboardPrompt(
  tourName: string,
  sceneBe ats: string[],   // 来自 ReelsGPTResult.scene_beats（8 条）
  viMood?: string | null
): string

实现要求：
输出一段完整的 ChatGPT Image 2.0 提示词，格式如下（英文）：

"Create a professional video production storyboard document.
Layout: 3×3 grid, 9 panels total. Each panel in 9:16 vertical orientation.
Tour: {tourName}
Global visual style: {GLOBAL_VISUAL_STYLE}
{viMood ? `Mood: ${viMood}` : ''}

Panel 1: {sceneBe ats[0]}
Panel 2: {sceneBe ats[1]}
...
Panel 8: {sceneBe ats[7]}
Panel 9: {END_CARD_SPEC}

Rules: English annotations only. Each panel has label P1–P9 at bottom-left and a 1-line scene note below the thumbnail. No human faces in any panel except the end card. No text overlays on imagery panels. Ultra-clean professional layout on white background."

【函数 3：buildSeedancePrompt】

export function buildSeedancePrompt(
  tourName: string,
  reelsTheme: string,
  viMood?: string | null
): string

实现要求：
输出 Seedance 2.0 I2V 提示词，描述「运镜 + 节奏 + 色调」，不描述具体场景内容（内容由图片提供）。

模板：
"15-second vertical travel film. {tourName}. Theme: {reelsTheme}.
Camera: slow push-in opening (0-3s), gentle pan left-to-right mid-section (3-10s), slow pull-back reveal (10-13s), static hold on end card (13-15s).
Pacing: elegant and unhurried. No fast cuts. Smooth transitions only.
Color grade: warm golden hour tones, deep shadows, high contrast highlights. {viMood ? viMood : 'Timeless cinematic feel.'}
Audio sync: assume soft ambient travel music. No voiceover space needed.
Output: seamless, loopable if needed."

【函数 4：calcPublishDate】

export function calcPublishDate(
  campaignStartDate: string,   // 'YYYY-MM-DD'
  format: SocialFormat,
  itemIndex: number            // 0-based
): string                      // ISO 8601 with NZST offset

发布日期偏移规则：
- Reels：从 campaignStartDate 起，每隔 7 天一条，发布时间 09:00 NZST
- Post：从 campaignStartDate + 1 天起，每隔 2 天一条，发布时间 10:00 NZST
- Story：从 campaignStartDate 起，每天一条，发布时间 08:00 NZST
- NZST = UTC+12，返回格式：'2026-08-01T09:00:00+12:00'
- 不使用第三方日期库，只用原生 Date 计算

【代码规范】
- TypeScript strict mode，无 any
- 纯函数，无副作用，无 async
- 文件 < 200 行
- 每个函数加 JSDoc 注释

完成后运行 npm run build，确认无 TypeScript 错误后停止。
```

---

## 提示词 2：创建 `social-plan/route.ts`

> 前置条件：提示词 1 已执行，`social-plan-templates.ts` 已存在，`npm run build` 通过。

```
你正在为 Magic Engine（Next.js 14 App Router + TypeScript strict mode）新建一个 API 路由。

项目路径：magic-engine/
目标文件：src/app/api/clients/[id]/campaign/[campaignId]/social-plan/route.ts

参考文件（只读，不修改）：
- src/lib/content/brief-injector.ts         → getActiveBrief, formatBriefForPrompt
- src/lib/content/campaign-injector.ts      → getCampaignById, formatCampaignForPrompt
- src/lib/brief/jina.ts                     → fetchMultipleUrls
- src/lib/content/social-plan-templates.ts  → getFormatTemplate, buildStoryboardPrompt, buildSeedancePrompt, calcPublishDate, GLOBAL_VISUAL_STYLE
- src/lib/supabase.ts                       → supabaseAdmin
- src/types/magic-engine.ts                 → ReelsDraft, ContentPost 等类型

【任务】
新建此 API 路由。不修改任何现有文件。

【Request Schema】

interface SocialPlanRequest {
  tour_urls: string[]        // 必填，1-4 个行程网页 URL
  publish_start_date?: string // 'YYYY-MM-DD'，可选
  reels_count?: number        // 默认 3，最大 10
  post_count?: number         // 默认 5，最大 20
  story_count?: number        // 默认 7，最大 30
  dry_run?: boolean           // true = 只生成不写库
}

【Response Schema】

interface SocialPlanResponse {
  success: boolean
  summary: {
    reels_generated: number
    posts_generated: number
    stories_generated: number
    reels_failed: number
    posts_failed: number
    stories_failed: number
    tour_urls_fetched: number
    tour_urls_failed: number
    publish_start_date: string
  }
  reels: ReelItem[]
  posts: PostItem[]
  stories: StoryItem[]
  error?: string
}

interface ReelItem {
  id: string | null           // reels_drafts.id，dry_run 时为 null
  title: string
  fb_caption: string
  opening_frame_prompt: string
  i2v_video_prompt: string
  scheduled_at: string
}

interface PostItem {
  id: string | null
  title: string
  caption: string
  hashtags: string[]
  visual_brief: string
  scheduled_at: string
}

interface StoryItem {
  id: string | null
  title: string
  caption: string
  scheduled_at: string
}

【执行流程】

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; campaignId: string } }
)

流程如下（严格按此顺序）：

1. 解析请求体，验证参数：
   - tour_urls：数组，1-4 个，每个必须以 'https://' 开头
   - reels_count：1-10，默认 3
   - post_count：1-20，默认 5
   - story_count：1-30，默认 7
   - 总量（reels + post + story）不超过 50，否则 400

2. 并行加载（Promise.all）：
   a. getActiveBrief(clientId) → brief
   b. getCampaignById(clientId, campaignId) → campaign
   c. fetchMultipleUrls(tour_urls) → { results: jinaResults, errors: jinaErrors }
   若 brief 为 null → 400 返回 "No active Master Brief"
   若 campaign 为 null → 404 返回 "Campaign not found"

3. 准备上下文：
   - briefText = formatBriefForPrompt(brief)
   - campaignText = formatCampaignForPrompt(campaign)
   - tourContext = jinaResults 的 markdown 拼接，截断到 4000 字符
   - tourName = jinaResults[0]?.title ?? campaign.title
   - publishStart = publish_start_date ?? campaign.valid_from ?? （今天 + 7 天，'YYYY-MM-DD' 格式）

4. 在 handler 内部初始化 OpenAI：
   const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

5. 定义 GPT 调用辅助函数（handler 内部）：
   async function generateWithGPT<T>(
     format: SocialFormat,
     itemIndex: number
   ): Promise<T | null>
   
   - 调用 getFormatTemplate(format, briefText, campaignText, tourContext, itemIndex, tourName)
   - 调用 openai.chat.completions.create，model: 'gpt-4o-mini', temperature: 0.85
   - JSON.parse 结果（去掉 markdown fence）
   - 失败返回 null（不抛出）

6. 并行生成（最多 5 并发，用 Promise.allSettled）：
   
   a. Reels（reels_count 条）：
      - generateWithGPT<ReelsGPTResult>('reels', i)
      - 若成功：
        - opening_frame_prompt = buildStoryboardPrompt(tourName, result.scene_beats, campaign.vi_mood)
        - i2v_video_prompt = buildSeedancePrompt(tourName, result.theme, campaign.vi_mood)
        - scheduled_at = calcPublishDate(publishStart, 'reels', i)
      - 若 dry_run=false：写入 reels_drafts 表（见下方字段规格）
   
   b. Posts（post_count 条）：
      - generateWithGPT<PostGPTResult>('post', i)
      - scheduled_at = calcPublishDate(publishStart, 'post', i)
      - 若 dry_run=false：写入 content_posts 表（见下方字段规格）
   
   c. Stories（story_count 条）：
      - generateWithGPT<StoryGPTResult>('story', i)
      - scheduled_at = calcPublishDate(publishStart, 'story', i)
      - 若 dry_run=false：写入 content_posts 表，platforms=['facebook_story']

7. 汇总并返回 SocialPlanResponse

【数据库写入字段规格】

reels_drafts 写入：
{
  client_id:                     clientId,
  campaign_brief_id:             campaignId,
  opening_frame_prompt:          opening_frame_prompt,
  i2v_video_prompt:              i2v_video_prompt,
  fb_caption:                    result.fb_caption,
  status:                        'draft',
  generation_context_snapshot:   {
    tour_urls,
    publish_start_date: publishStart,
    model: 'gpt-4o-mini',
    tour_name: tourName,
  },
}

content_posts 写入（Posts）：
{
  client_id:     clientId,
  campaign_id:   campaignId,
  route:         'route_c',
  platforms:     ['facebook'],
  title:         result.title,
  caption:       result.caption,
  hashtags:      result.hashtags,
  visual_brief:  result.visual_brief,
  script:        '',
  content_mode:  'campaign',
  status:        'draft',
  scheduled_at:  scheduled_at,
  source_brief_id: brief.id,
  generation_context_snapshot: {
    tour_urls,
    publish_start_date: publishStart,
    model: 'gpt-4o-mini',
  },
}

content_posts 写入（Stories）：
同上，但 platforms: ['facebook_story']

【错误处理规则】
- Jina 失败：非致命，tourContext 降级为空字符串，summary.tour_urls_failed 计数
- 单条 GPT 失败：非致命，跳过，summary.*_failed 计数
- 全部 GPT 失败：致命，返回 500
- DB 写入单条失败：非致命，console.error，跳过（不影响返回已生成内容）
- 任何未捕获错误：返回 500，message: err.message

【代码规范（严格遵守）】
- TypeScript strict mode，无 any
- OpenAI SDK 必须在 handler 内部初始化，不在模块顶层
- 文件 < 250 行（超出则把辅助函数移到 social-plan-templates.ts）
- 每个数据库操作加 try/catch，失败不中断主流程
- 不引入任何新的 npm 依赖

完成后运行 npm run build，确认无 TypeScript 错误后停止。
如果有 TypeScript 错误，先修复再报告结果。
```

---

## 执行顺序

1. 在 magic-engine 项目目录打开 Claude Code
2. 粘贴 **提示词 1**，等待执行完毕
3. 确认 `npm run build` 通过
4. 粘贴 **提示词 2**，等待执行完毕
5. 确认 `npm run build` 通过
6. 用 curl 或 Postman 测试（dry_run=true 先跑）

## 快速测试命令

```bash
# 替换 CAMPAIGN_ID 为实际值（从 Supabase campaign_briefs 表查）
curl -X POST http://localhost:3001/api/clients/c0000000-0000-0000-0000-000000000000/campaign/CAMPAIGN_ID/social-plan \
  -H "Content-Type: application/json" \
  -d '{
    "tour_urls": ["https://www.chinachina-travel.co.nz/beijing-xian-tour"],
    "publish_start_date": "2026-08-01",
    "reels_count": 1,
    "post_count": 2,
    "story_count": 2,
    "dry_run": true
  }'
```

预期：返回 JSON，`summary.reels_generated=1`，`reels[0].opening_frame_prompt` 非空，数据库无新记录。
