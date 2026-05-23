# Spec: Social Plan Generator — Phase A (Wave 1)
> 版本：V1 | 起草：2026-05-23 | 负责人：Claude Code
> 关联架构文档：ME_CONTENT_ENGINE_ARCHITECTURE.md

---

## 目标

补全 ME 内容策略层的缺口。当前系统有输入层（Brief/Campaign）、视觉生产层（Reels）、发布层，但**完全没有内容策略层**。

本 Phase A 新增两个文件，让 ME 能够：
1. 根据 Brand Brief + Campaign Brief 决定本周 Reels/Post/Story 的发布比例
2. 生成 Wave 1 完整内容包（Reels 脚本 + Post 正文 + Story 文案）
3. 输出 Analysis Gate 判断标准（等 7 天数据后告诉 FDE 怎么决策）

**不在 Phase A 范围内**（不要碰）：
- Wave 2/3 自动触发逻辑
- Analysis Gate 自动化
- Flywheel 表写入（Phase B）
- Instagram / TikTok 其他平台
- 视觉生产（storyboard / Seedance）集成

---

## 新增文件

### 文件 1：`src/lib/social/social-plan-templates.ts`

**职责**：类型定义 + Prompt 模板 + 内容结构定义

### 文件 2：`src/app/api/clients/[id]/social-plan/route.ts`

**职责**：策略决策 + Wave 1 内容生成 API

---

## TypeScript 接口定义

```typescript
// ─── Input ────────────────────────────────────────────────────────────────────

export interface SocialPlanRequest {
  campaign_brief_id: string           // 必填 — 哪个 Campaign
  wave_1_duration_days?: number       // 默认 7 天
  platform?: 'facebook'               // Phase A 仅 Facebook，默认 'facebook'
}

// ─── Channel Strategy ─────────────────────────────────────────────────────────

export interface ChannelStrategy {
  reels_count: number                 // Wave 1 期间发布几条 Reels
  post_count: number                  // Wave 1 期间发布几条 Post
  story_days: number                  // Wave 1 期间每天发 Story（天数 = wave_1_duration_days）
  rationale: string                   // Strategy Engine 的策略依据（1–2 句）
  primary_angle: string               // 本波主打角度（如"价格攻击"/"速度攻击"）
}

// ─── Reels Script ─────────────────────────────────────────────────────────────

/**
 * scene_structure 格式规则（9条，直接兼容 storyboard-image-prompt v2 skill）：
 *
 * Panels 1–8（场景面板）每条格式：
 *   "Thumbnail: 9:16 vertical — [photorealistic, no faces, 20-25 words] |
 *    STORY: [8-12 words] |
 *    CAMERA: [shot type + movement, 6-10 words] |
 *    MOOD: [3-6 words]"
 *
 * Panel 9（品牌面板，固定最后一条）格式：
 *   "BRAND PANEL: [brand color] background. [Brand Name] in large serif.
 *    [Anchor 1]. [Anchor 2]. [Anchor 3]. No faces. Minimal and premium."
 *
 * 强制约束：
 * - 所有描述必须英文，不含中文
 * - 所有缩略图描述 9:16 vertical 方向
 * - 任何缩略图描述不得出现人脸（no faces, no people, hands/feet/objects only）
 * - Panel 9 永远是品牌面板，不可替换
 */
export interface ReelsScript {
  hook_line: string                   // 前 1.5 秒台词（英文，max 15 words，数字开头或制造意外感）
  scene_structure: string[]           // 长度严格 = 9（Panels 1–8 场景 + Panel 9 品牌，见上方格式注释）
  caption: string                     // FB Caption 正文（含价格/offer + Licensed & Insured（如适用）+ DM CTA）
  angle_tag: 'price_attack' | 'speed_attack' | 'trust_attack' | 'pet_floor' | 'scarcity' | 'seasonal'
  storyboard_brief: string            // 给 storyboard skill 的一句话摘要，格式：
                                      // "[Brand] [angle] — [key visual elements], no faces"
                                      // 例："Oztop price attack — timber floor close-ups, price comparison reveal,
                                      //       warehouse supply chain, professional installation details, no faces"
}

// ─── Post Content ─────────────────────────────────────────────────────────────

export interface PostContent {
  opening_line: string                // 第一句话（最重要，必须包含核心关键词）
  body: string                        // 正文（含数字/证据/逻辑链）
  closing_cta: string                 // 结尾行动号召（问题或指令）
  angle_tag: string                   // 内容角度标签
  seo_keywords: string[]              // 2–4 个 FB 搜索优化关键词
}

// ─── Story Content ────────────────────────────────────────────────────────────

export interface StoryContent {
  day: number                         // 第几天（1 = Wave 1 第一天）
  headline: string                    // 大字标题（max 8 words）
  sub_text: string                    // 副文字（价格 / 截止日期 / 数量）
  cta_label: string                   // 按钮文字（"DM us" / "Learn More" / "Book Now"）
  story_type: 'countdown' | 'proof' | 'urgency' | 'interactive' | 'price'
}

// ─── Analysis Gate ────────────────────────────────────────────────────────────

export interface AnalysisGate {
  check_after_days: number            // 几天后看数据（= wave_1_duration_days）
  reels_winner_threshold: string      // 判断赢家标准：完播率
  post_winner_threshold: string       // 判断赢家标准：评论数
  story_winner_threshold: string      // 判断赢家标准：DM 数
  wave_2_signal: string               // 如果达标，Wave 2 应该做什么（一句话）
  wave_2_no_signal: string            // 如果未达标，Wave 2 应该调整什么（一句话）
}

// ─── Output ───────────────────────────────────────────────────────────────────

export interface SocialPlanOutput {
  client_id: string
  campaign_id: string
  generated_at: string                // ISO timestamp
  platform: 'facebook'
  wave_number: 1
  wave_duration_days: number
  channel_strategy: ChannelStrategy
  reels_scripts: ReelsScript[]        // length = channel_strategy.reels_count
  posts: PostContent[]                // length = channel_strategy.post_count
  stories: StoryContent[]             // length = wave_1_duration_days（每天一条）
  analysis_gate: AnalysisGate
  quality_scores: {                   // 对每条 Post 跑 quality-rubric
    post_index: number
    overall_score: number
    pass: boolean
  }[]
}
```

---

## API Spec

**Endpoint**：`POST /api/clients/[id]/social-plan`

**Auth**：与现有路由一致（Supabase session + client ownership check）

**Request Body**：
```json
{
  "campaign_brief_id": "uuid",
  "wave_1_duration_days": 7,
  "platform": "facebook"
}
```

**Success Response** (200)：
```json
{
  "success": true,
  "plan": { /* SocialPlanOutput */ }
}
```

**Error Responses**：
- 400：无 active Brief / 无效 campaign_brief_id
- 500：AI 生成失败

---

## AI 调用设计

### 三个输入源（缺一不可）

```
输入 1：Master Brief（品牌DNA）
输入 2：Campaign Brief（本期推广）
输入 3：viral_reference_library（爆款视频分析，Phase 11 已有）
```

**重要**：social-plan 的生成必须基于 Campaign。没有 campaign_brief_id，API 直接返回 400。这是看板功能的业务规则——FDE 必须先有 Campaign，才能生成 Social Plan，才能生成 Reels/图片。

---

### Step 0 — 查询爆款参考库（Supabase，非 AI 调用）

在所有 AI 调用之前，先查 `viral_reference_library` 表：

```typescript
// 查最新 3 条已分析完成的爆款参考
const { data: viralRefs } = await supabaseAdmin
  .from('viral_reference_library')
  .select('style_scores, style_tags, style_description, key_techniques, persona_fit')
  .eq('analysis_status', 'done')
  .order('analyzed_at', { ascending: false })
  .limit(3)
  // 查询失败时静默降级 — 不阻塞主流程
```

格式化为 `viralInsightsText`，注入 Reels 脚本 prompt：

```
VIRAL REFERENCE INSIGHTS (study these — mirror what works):
Ref 1: [style_description]. Techniques: [key_techniques join]. Style: [style_tags join].
Ref 2: ...
Ref 3: ...
```

查询失败时 `viralInsightsText = ''`（静默降级，不报错）。

---

### Step 1 — Channel Strategy（Claude Sonnet，Strategy Engine）

用 Anthropic Claude Sonnet 做策略决策：
- 读取 Brand Brief + Campaign Brief
- 输出：`reels_count` / `post_count` / `story_days` / `rationale` / `primary_angle`
- 根据 campaign 时长和促销力度动态决定（促销越强，Reels 占比越高）
- Response format：JSON

典型输出示例（地板清仓 7 天 Wave 1）：
```json
{
  "reels_count": 1,
  "post_count": 2,
  "story_days": 7,
  "rationale": "Clearance sale with strong price signal — Reels leads with hook, Posts build trust with logic, Stories maintain daily pressure.",
  "primary_angle": "price_attack"
}
```

---

### Step 2 — Content Generation（GPT-4o-mini，Content Engine）

每种内容类型分别调用，**并发执行**（`Promise.all`）：
- `generateReelsScripts(count, briefText, campaignText, strategy, viralInsightsText)`
- `generatePosts(count, briefText, campaignText, strategy)`
- `generateStories(days, briefText, campaignText, strategy)`

**注意**：`viralInsightsText` 只传给 `generateReelsScripts`，Post/Story 不需要。

每个函数**在函数内部初始化 OpenAI client**（遵守现有约定）。

---

### Step 3 — Quality Check（质检，Post 内容）

对每条 Post 跑 `quality-rubric.ts` 的 `evaluate()`，传入：
- `platform: 'facebook'`
- `contentType: 'social_a'`（Post 格式）
- 注入 brief + campaign context
- 失败时 `.catch()` 静默，不阻塞主流程

---

### Step 4 — 写库（必须，之前 Spec 错误标注为"不写库"）

生成完成后写入 `social_plans` 表：

```sql
-- 需要新建这张表（migration 一起做）
CREATE TABLE social_plans (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    UUID NOT NULL REFERENCES clients(id),
  campaign_id  UUID NOT NULL REFERENCES campaign_briefs(id),
  platform     TEXT NOT NULL DEFAULT 'facebook',
  wave_number  INT  NOT NULL DEFAULT 1,
  plan_data    JSONB NOT NULL,          -- 完整 SocialPlanOutput JSON
  created_at   TIMESTAMPTZ DEFAULT now(),
  created_by   UUID                     -- Supabase auth user id（可选）
);
CREATE INDEX ON social_plans(client_id, campaign_id);
```

API 在写库成功后返回 `{ success: true, plan: SocialPlanOutput, plan_id: uuid }`。

---

## Prompt 设计要点

### Channel Strategy Prompt（Claude Sonnet）

```
You are a Facebook content strategist for AU/NZ small businesses.

BRAND CONTEXT:
{briefText}

CAMPAIGN CONTEXT:
{campaignText}

Wave duration: {days} days.

Decide the Wave 1 content mix. Rules:
- Reels: 1–3 (test phase — don't over-produce)
- Posts: 1–3 (each must have a distinct angle — price / trust / scarcity)
- Stories: run every day of the wave
- If campaign has a hard deadline within 30 days, increase urgency_angle weighting

Return JSON only:
{"reels_count": N, "post_count": N, "story_days": N, "rationale": "...", "primary_angle": "..."}
```

### Reels Script Prompt（GPT-4o-mini）

关键约束（必须写进 system prompt）：
- Hook line: max 15 words, starts with a number or unexpected statement
- `scene_structure` must be an array of exactly 9 strings
- Panels 1–8 format: "Thumbnail: 9:16 vertical — [description] | STORY: [text] | CAMERA: [text] | MOOD: [text]"
- Panel 9 is ALWAYS the brand logo panel: "BRAND PANEL: [color] background. [Brand] in large serif. [Anchor 1]. [Anchor 2]. [Anchor 3]. No faces. Minimal and premium."
- All scene descriptions: English only, no Chinese characters
- All thumbnails: 9:16 vertical orientation — specify this explicitly
- No real human faces in any thumbnail (hands, feet, objects, spaces are OK)
- Caption: must include price/offer, Licensed & Insured (if applicable), DM CTA
- `storyboard_brief` format: "[Brand] [angle] — [key visual elements list], no faces"
- `angle_tag` must be one of: `price_attack | speed_attack | trust_attack | pet_floor | scarcity | seasonal`

**示例 scene_structure 输出（Oztop 价格攻击）**：
```json
[
  "Thumbnail: 9:16 vertical — Close-up hand placing premium walnut timber plank on clean white surface, warm natural wood grain texture, no face visible | STORY: $35.50 — let me show you what that looks like | CAMERA: Extreme close-up product shot. Slow push in. | MOOD: Confident. Direct.",
  "Thumbnail: 9:16 vertical — Full living room viewed through doorway, entire floor covered in warm walnut timber, natural light from tall windows, no people | STORY: Full room. Same price. Let that land. | CAMERA: Wide doorway frame. Slow push in. | MOOD: Aspirational. Spacious.",
  "Thumbnail: 9:16 vertical — Extreme close-up of engineered timber grain surface, wood pores and texture filling entire vertical frame, warm side lighting | STORY: 15mm. Real timber. Not laminate. | CAMERA: Macro close-up. Very slow slide across surface. | MOOD: Quality. Tactile.",
  "Thumbnail: 9:16 vertical — Bare feet stepping onto warm timber floor, lower legs only visible, soft morning light from side window, no face | STORY: This is what $35.50 feels like. | CAMERA: Low angle ground level. Slow tilt up legs. | MOOD: Comfort. Real.",
  "Thumbnail: 9:16 vertical — Bold price comparison graphic — large red $55-70 crossed out on left, large white $35.50 on right, dark background, clean typography | STORY: Retail chains charge $55–70. We don't. | CAMERA: Static graphic panel. Hold steady. | MOOD: Impactful. Undeniable.",
  "Thumbnail: 9:16 vertical — Interior warehouse aisle with stacked timber flooring boxes on metal shelves, industrial lighting from above, forklift visible in background, no people | STORY: Own warehouse. Own supply chain. No markup. | CAMERA: Wide warehouse aisle. Slow forward track. | MOOD: Honest. Industrial. Direct.",
  "Thumbnail: 9:16 vertical — Close-up of professional flooring installation — gloved hands pressing plank into place, precision tools nearby, timber floor edge visible, no face | STORY: Licensed tradespeople. Same-day quote. Two weeks in. | CAMERA: Close-up of hands and tools. Slow push in. | MOOD: Professional. Trustworthy.",
  "Thumbnail: 9:16 vertical — Countdown graphic on dark background — '2,000m² available. Ends June 30.' in clean white bold typography, subtle gold accent line | STORY: 2,000m² won't last. June 30 is the wall. | CAMERA: Static graphic panel. Hold steady. | MOOD: Urgent. Final.",
  "BRAND PANEL: Deep charcoal (#1a1a1a) background. 'Bigpanda Flooring' in large clean white serif font, centered. Gold divider line. 'Licensed & Insured' in white below. 'Own supply chain — no middleman markup' in gold smaller text. 'Same-day quote · Brisbane + Gold Coast' smallest. No faces. No photography. Minimal and premium."
]
```

### Post Prompt（GPT-4o-mini）

关键约束：
- Opening line must contain the primary search keyword
- Body uses logic/numbers/evidence — not emotional fluff
- Each post must have a DISTINCT angle from others (no repeating the same message)
- Include `seo_keywords` array: 2–4 terms that Facebook users actually search

### Story Prompt（GPT-4o-mini）

关键约束：
- Each story headline ≤ 8 words
- Must include: a number OR a deadline OR both
- Distribute `story_type` variety across 7 days (don't make all 7 the same type)
- Day 1: establish offer | Days 2–5: vary proof/urgency/interactive | Day 6–7: heavy urgency

---

## 数据库

**Phase A 不写数据库**（返回 JSON，前端或 FDE 手动处理）。

Phase B 再讨论是否需要 `social_plans` 表存储结果。

---

## 文件约束（遵守现有规范）

- TypeScript strict mode，无 `any`
- `social-plan-templates.ts` < 400 行
- `social-plan/route.ts` < 400 行（超出则把 generator 函数抽到 `src/lib/social/`）
- SDK（OpenAI、Anthropic）**在 handler / 函数内部初始化**，不在模块顶层
- Airtable 写回（如果有）用 `.catch()` 静默失败
- 错误处理模式与 `reels/generate/route.ts` 保持一致

---

## 验收标准

1. `POST /api/clients/[id]/social-plan` 返回 200 + 有效 JSON
2. 对 Oztop（client_id 已知）+ Oztop 清仓 Campaign，能生成：
   - ≥1 条 Reels 脚本，scene_structure 严格为 9 条，格式符合 storyboard skill v2 规范（英文、9:16、无人脸、Panel 9 为品牌面板）
   - ≥2 条 Post（各有不同 angle_tag）
   - 7 条 Story（7 种不同 story_type 分布）
   - 1 个 analysis_gate（含具体阈值数字）
3. `npm run build` 通过（无 TypeScript 错误）
4. Post quality_scores 至少 1 条 `pass: true`

---

## Commit 格式

```
feat(social): add Wave 1 social plan generator — strategy + content generation [Phase-A]
```

---

*Spec 起草：Claude PM · 2026-05-23*
