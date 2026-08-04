# Social Plan Generator — 开发规格文档

> **版本**：v1.0  
> **日期**：2026-05-23  
> **阶段**：Phase 12 — Campaign Factory  
> **交付物**：2 个新文件，0 张新表，0 处现有文件改动

---

## 1. 背景与目标

### 现状

Magic Engine 已具备所有零件：
- `brief-injector.ts` — Master Brief 品牌 DNA 注入
- `campaign-injector.ts` — Campaign Brief 推广上下文注入
- `batch-generate/route.ts` — GPT 生成 + 质量审核 + 写库
- `brief/jina.ts` — 抓取行程网页为 Markdown
- `publer/client.ts` + `create-post/route.ts` — 发布到 Facebook
- `reels_drafts` 表 — 存储 Reels 草稿（含 `opening_frame_prompt`、`i2v_video_prompt`）

### 缺口

没有「总装线」：无法一次性把「Campaign + 行程网页」转换成完整的社媒内容计划（Reels + Posts + Stories），并把 storyboard prompt 和 Seedance I2V prompt 一并写入数据库。

### 目标

新增 2 个文件，把现有零件串起来，实现：

```
POST /api/clients/{id}/campaign/{campaignId}/social-plan
  → 抓取行程页
  → 注入 MB + CB
  → 生成文案（Posts / Stories）
  → 生成 storyboard prompt（Reels）
  → 生成 Seedance I2V prompt（Reels）
  → 写入 content_posts（Posts / Stories）
  → 写入 reels_drafts（Reels）
  → 返回摘要
```

---

## 2. 交付文件清单

| 文件 | 类型 | 说明 |
|------|------|------|
| `src/lib/content/social-plan-templates.ts` | 新建 | GPT prompt 模板 + 日期偏移计算 |
| `src/app/api/clients/[id]/campaign/[campaignId]/social-plan/route.ts` | 新建 | 总装线 API 路由 |

**严禁改动**：`brief-injector.ts`、`campaign-injector.ts`、`batch-generate/route.ts`、`jina.ts`、任何现有类型文件。

---

## 3. 文件 1：`src/lib/content/social-plan-templates.ts`

### 3.1 职责

- 按内容格式（Reels / Post / Story）返回对应 GPT system + user prompt
- 提供 storyboard 9 格提示词生成逻辑
- 提供 Seedance I2V prompt 生成逻辑
- 计算发布日期偏移（Week 1 / Week 2 / Week 3…）

### 3.2 完整代码规格

```typescript
// src/lib/content/social-plan-templates.ts
// GPT prompt templates for Reels / Post / Story content formats
// Used by social-plan/route.ts — do NOT import from batch-generate

// ── 类型 ────────────────────────────────────────────────────────────────────

export type SocialFormat = 'reels' | 'post' | 'story'

export interface FormatTemplate {
  systemPrompt: string     // 完整 system prompt（已含 briefText + campaignText）
  userPrompt: string       // 针对该格式的 user prompt
}

export interface ReelsAssets {
  fb_caption: string
  opening_frame_prompt: string    // 9-panel storyboard ChatGPT Image prompt
  i2v_video_prompt: string        // Seedance 2.0 I2V prompt
}

export interface PostDraft {
  title: string
  caption: string
  hashtags: string[]
  visual_brief: string
}

export interface StoryDraft {
  title: string
  caption: string
  hashtags: string[]
  visual_brief: string
}

// ── Global visual style（所有格式共用）────────────────────────────────────

export const GLOBAL_VISUAL_STYLE =
  'cinematic travel photography, warm heritage tones with deep shadows, elegant and timeless. ' +
  'Ultra high resolution, 9:16 vertical. No text, no watermarks, no logos, no tourists, no crowds.'

// End card spec（Reels 第 9 格固定）
export const END_CARD_SPEC =
  'Final panel: #1a1a1a background, CTS logo in gold center, ' +
  '#d4af37 thin horizontal divider, white text "NZ Passport — Visa-Free Entry to China", ' +
  'small text "Est. 1928 · China specialists".'

// ── 主要导出函数 ───────────────────────────────────────────────────────────

/**
 * 生成指定格式的 GPT prompt 模板
 * @param format - 内容格式
 * @param briefText - formatBriefForPrompt() 的输出
 * @param campaignText - formatCampaignForPrompt() 的输出
 * @param tourContext - Jina 抓取的行程 Markdown（已截断）
 * @param itemIndex - 同格式第几条（0-based），用于差异化角度提示
 * @param tourName - 行程名称，用于 storyboard 标题
 */
export function getFormatTemplate(
  format: SocialFormat,
  briefText: string,
  campaignText: string,
  tourContext: string,
  itemIndex: number,
  tourName: string
): FormatTemplate

/**
 * 生成 Reels 的 storyboard 9格 ChatGPT Image 提示词
 * 输出的 prompt 直接粘贴到 ChatGPT Image 2.0 即可渲染
 */
export function buildStoryboardPrompt(
  tourName: string,
  briefText: string,
  campaignText: string,
  tourContext: string,
  reelsTheme: string      // 本条 Reels 的主题角度（从 GPT 生成结果中提取）
): string

/**
 * 生成 Seedance 2.0 I2V 提示词
 * 描述镜头运动、节奏、色调，不包含场景内容（内容由图片提供）
 */
export function buildSeedancePrompt(
  tourName: string,
  reelsTheme: string,
  viMood?: string | null    // CampaignBrief.vi_mood（可选）
): string

/**
 * 根据 Campaign 起始日期计算每条内容的发布时间
 * @param campaignStartDate - 'YYYY-MM-DD'，从 campaign.valid_from 读取
 * @param format - 内容格式
 * @param itemIndex - 同格式第几条（0-based）
 * @returns ISO 8601 字符串，可直接写入 scheduled_at
 */
export function calcPublishDate(
  campaignStartDate: string,
  format: SocialFormat,
  itemIndex: number
): string
```

### 3.3 发布日期偏移规则

```
Reels:   每周 1 条，从 campaignStartDate + 0 天开始，每隔 7 天一条
Post:    每周 3 条，从 campaignStartDate + 1 天开始，间隔 2 天
Story:   每周 7 条（每天），从 campaignStartDate + 0 天开始，间隔 1 天
```

示例（campaignStartDate = 2026-08-01）：
- Reels[0] → 2026-08-01T09:00:00+12:00（NZST 早 9 点）
- Reels[1] → 2026-08-08T09:00:00+12:00
- Post[0]  → 2026-08-02T10:00:00+12:00
- Post[1]  → 2026-08-04T10:00:00+12:00
- Story[0] → 2026-08-01T08:00:00+12:00（早 8 点）
- Story[1] → 2026-08-02T08:00:00+12:00

所有时间固定为 NZST（UTC+12），不接受运行时覆盖。

### 3.4 GPT Prompt 设计原则

**Reels GPT 输出结构**（JSON）：
```json
{
  "title": "15秒Reels主题标题",
  "theme": "本条Reels的核心叙事角度（1句话）",
  "fb_caption": "Facebook 发布文案，150-200字，含CTA，含3-5个hashtag",
  "scene_beats": [
    "Scene 1（0-2s）：...",
    "Scene 2（2-4s）：...",
    "Scene 3（4-6s）：...",
    "Scene 4（6-8s）：...",
    "Scene 5（8-10s）：...",
    "Scene 6（10-12s）：...",
    "Scene 7（12-14s）：...",
    "Scene 8（14-15s）：..."
  ]
}
```

注意：`scene_beats` 只有 8 个（Panel 9 固定为品牌 End Card，由 `END_CARD_SPEC` 硬编码追加）。

**Post GPT 输出结构**（JSON）：
```json
{
  "title": "内容标题",
  "caption": "Facebook 发布文案，150-250字，含CTA",
  "hashtags": ["#tag1", "#tag2", ...],
  "visual_brief": "配图描述（英文），用于图片生成指令"
}
```

**Story GPT 输出结构**（JSON）：
```json
{
  "title": "Story 主题",
  "caption": "Story 文案，50-80字，强CTA",
  "hashtags": ["#tag1", "#tag2"],
  "visual_brief": "竖版配图描述（英文），9:16"
}
```

### 3.5 Storyboard Prompt 格式规范

`buildStoryboardPrompt()` 的输出必须是可直接粘贴到 ChatGPT Image 2.0 的提示词，格式如下：

```
Create a professional video production storyboard document. 
Layout: 3×3 grid, 9 panels total, each panel in 9:16 vertical orientation.
Global style: {GLOBAL_VISUAL_STYLE}

Panel 1: {scene_beats[0] translated to English visual description}
Panel 2: {scene_beats[1] translated to English visual description}
...
Panel 8: {scene_beats[7] translated to English visual description}
Panel 9: {END_CARD_SPEC}

Annotation rules: English only. Each panel has a small label at bottom (P1–P9) and a 1-line scene note. No human faces. No text overlays on imagery panels.
```

---

## 4. 文件 2：`src/app/api/clients/[id]/campaign/[campaignId]/social-plan/route.ts`

### 4.1 职责

串联所有现有服务，执行完整的社媒计划生成流程，写入数据库，返回摘要。

### 4.2 Request Schema

```typescript
interface SocialPlanRequest {
  tour_urls: string[]           // 必填，1-4 个 CTS 行程网页 URL
  publish_start_date?: string   // 'YYYY-MM-DD'，可选（默认用 campaign.valid_from）
  reels_count?: number          // 默认 3，最大 10
  post_count?: number           // 默认 5，最大 20
  story_count?: number          // 默认 7，最大 30
  dry_run?: boolean             // true = 只生成不写库，用于预览
}
```

### 4.3 Response Schema

```typescript
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
  reels: Array<{
    id: string                    // reels_drafts.id（dry_run 时为 null）
    title: string
    fb_caption: string
    opening_frame_prompt: string  // storyboard prompt（给 ChatGPT Image）
    i2v_video_prompt: string      // Seedance prompt
    scheduled_at: string
  }>
  posts: Array<{
    id: string                    // content_posts.id（dry_run 时为 null）
    title: string
    caption: string
    hashtags: string[]
    visual_brief: string
    scheduled_at: string
  }>
  stories: Array<{
    id: string
    title: string
    caption: string
    scheduled_at: string
  }>
  error?: string
}
```

### 4.4 执行流程（伪代码）

```
POST /api/clients/{id}/campaign/{campaignId}/social-plan

1. 解析并验证请求体
   - tour_urls: 1-4 个，必须是 https://
   - reels_count / post_count / story_count：范围校验
   - 总量不超过 50（防止超时）

2. 并行加载上下文
   - getActiveBrief(clientId)          → briefText
   - getCampaignById(clientId, campaignId) → campaign + campaignText
   - fetchMultipleUrls(tour_urls)       → tourMarkdown（合并多个页面，截断到 4000 字）
   若 brief 或 campaign 不存在 → 400 返回

3. 确定 publish_start_date
   优先级：请求体 > campaign.valid_from > 今天 + 7 天

4. 并行生成三种格式（最多 5 并发）
   a. Reels（写入 reels_drafts）：
      - 调用 GPT 生成 title / theme / fb_caption / scene_beats
      - 调用 buildStoryboardPrompt() 生成 opening_frame_prompt
      - 调用 buildSeedancePrompt() 生成 i2v_video_prompt
      - calcPublishDate(publishStart, 'reels', i) → scheduled_at
      - 写入 reels_drafts（dry_run 时跳过）

   b. Posts（写入 content_posts）：
      - 调用 GPT 生成 title / caption / hashtags / visual_brief
      - calcPublishDate(publishStart, 'post', i) → scheduled_at
      - 写入 content_posts（dry_run 时跳过）

   c. Stories（写入 content_posts，platforms=['facebook_story']）：
      - 调用 GPT 生成 title / caption / hashtags / visual_brief
      - calcPublishDate(publishStart, 'story', i) → scheduled_at
      - 写入 content_posts（dry_run 时跳过）

5. 汇总结果，返回 SocialPlanResponse
```

### 4.5 数据库写入规格

**reels_drafts 写入字段**：
```typescript
{
  client_id:                    clientId,
  campaign_brief_id:            campaignId,
  opening_frame_prompt:         buildStoryboardPrompt(...),
  i2v_video_prompt:             buildSeedancePrompt(...),
  fb_caption:                   gptResult.fb_caption,
  status:                       'draft',
  generation_context_snapshot:  { tour_urls, publish_start_date, model: 'gpt-4o-mini' },
}
```

注意：`scheduled_at` 字段**不**写入 `reels_drafts`（该表无此字段）。发布时间记录在返回的 response 中，由前端存储或在发布时传给 Publer。

**content_posts 写入字段（Posts）**：
```typescript
{
  client_id:     clientId,
  campaign_id:   campaignId,
  route:         'route_c',
  platforms:     ['facebook'],
  title:         gptResult.title,
  caption:       gptResult.caption,
  hashtags:      gptResult.hashtags,
  visual_brief:  gptResult.visual_brief,
  script:        '',                    // Posts 无 script
  content_mode:  'campaign',
  status:        'draft',
  scheduled_at:  calcPublishDate(...),
  source_brief_id: brief.id,
  generation_context_snapshot: { ... },
}
```

**content_posts 写入字段（Stories）**：
```typescript
{
  // 同 Posts，但：
  platforms:  ['facebook_story'],
  script:     '',
}
```

### 4.6 错误处理规则

| 场景 | 处理方式 |
|------|---------|
| Jina 抓取失败（部分 URL） | 非致命：用空字符串替代，继续生成，在 summary 中记录 `tour_urls_failed` |
| GPT 单条生成失败 | 非致命：跳过该条，继续，在 summary 中记录 `*_failed` 计数 |
| 全部生成失败 | 致命：返回 500 |
| brief / campaign 不存在 | 致命：返回 400 |
| DB 写入失败（部分） | 非致命：继续，在 summary 中统计 |
| 超时（单条 GPT > 30s） | 单条超时跳过，非致命 |

### 4.7 SDK 初始化规则（遵循 Magic Engine 规范）

```typescript
// ✅ 正确：在 handler 内部初始化
export async function POST(req, { params }) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  // ...
}

// ❌ 错误：模块顶层初始化
const openai = new OpenAI(...)  // 禁止
```

---

## 5. 现有代码依赖关系

```
social-plan/route.ts
  ├── src/lib/content/brief-injector.ts          → getActiveBrief, formatBriefForPrompt
  ├── src/lib/content/campaign-injector.ts        → getCampaignById, formatCampaignForPrompt
  ├── src/lib/brief/jina.ts                       → fetchMultipleUrls
  ├── src/lib/content/social-plan-templates.ts    → getFormatTemplate, buildStoryboardPrompt,
  │                                                   buildSeedancePrompt, calcPublishDate
  ├── src/lib/supabase                            → supabaseAdmin
  └── next/server                                 → NextRequest, NextResponse
```

`social-plan-templates.ts` 是纯函数库，**不**依赖任何 Supabase 或 Next.js 模块。

---

## 6. 测试步骤

### 6.1 本地 Dev Server 测试

启动：`npm run dev`（端口 3001）

测试 curl（dry_run 模式，不写库）：
```bash
curl -X POST http://localhost:3001/api/clients/c0000000-0000-0000-0000-000000000000/campaign/{CAMPAIGN_ID}/social-plan \
  -H "Content-Type: application/json" \
  -d '{
    "tour_urls": [
      "https://www.chinachina-travel.co.nz/beijing-xian-tour",
      "https://www.chinachina-travel.co.nz/shanghai-tour"
    ],
    "publish_start_date": "2026-08-01",
    "reels_count": 2,
    "post_count": 3,
    "story_count": 3,
    "dry_run": true
  }'
```

### 6.2 验收标准

- [ ] dry_run=true 时，response 包含完整的 reels / posts / stories 数组，数据库无新记录
- [ ] dry_run=false 时，Supabase `reels_drafts` 表出现新行，`status='draft'`，`opening_frame_prompt` 非空
- [ ] `content_posts` 出现新行，`campaign_id` 正确，`scheduled_at` 按日期偏移规则排列
- [ ] Jina 抓取失败时，不影响整体生成（graceful degradation）
- [ ] `npm run build` 无 TypeScript 错误

### 6.3 CTS Campaign ID

在 Supabase `campaign_briefs` 表中查询 `client_id = 'c0000000-0000-0000-0000-000000000000'`，取 `status='active'` 的记录 ID 用于测试。

---

## 7. 不需要做的事（防止过度工程）

- ❌ 不需要新建任何数据库表
- ❌ 不需要修改任何现有文件
- ❌ 不需要写前端 UI（API 先行）
- ❌ 不需要集成 Atlas 图片生成（图片在 ChatGPT 外部生成）
- ❌ 不需要集成 Seedance（视频在 Seedance 外部生成）
- ❌ 不需要写 Publer 发布逻辑（现有 `create-post/route.ts` 已覆盖）
- ❌ 不需要质量审核（`auditSocialPost`）——社媒计划是整批生成，审核在 UI 层人工完成

---

## 8. 文件大小限制

按 Magic Engine 规范：
- `social-plan-templates.ts`：目标 < 200 行
- `social-plan/route.ts`：目标 < 250 行（超出则拆子函数到 templates.ts）

---

*文档完。2 个文件，总估算工时：2-3 小时。*
