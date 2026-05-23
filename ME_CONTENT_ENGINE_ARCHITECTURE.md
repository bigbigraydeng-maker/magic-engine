# Magic Engine — Content Engine Architecture
> 起草日期：2026-05-23 | 状态：架构决策文档（非实现指南）
> 本文记录 2026-05-23 session 中确立的内容引擎核心架构决策。

---

## 1. 现状诊断：内容策略层缺失

### 已有能力（管道已通）

| 层 | 组件 | 状态 |
|---|---|---|
| 输入层 | `brief-injector.ts` · `campaign-injector.ts` · `video-analyzer.ts` · `quality-rubric.ts` | ✅ 已有 |
| 视觉生产层 | `reels/generator.ts` · `visual-brief-generator.ts` · WaveSpeed Flux-dev · Seedance 2.0 | ✅ 已有（Reels only）|
| 发布层 | `facebook-publisher.ts` · Publer 草稿 | ✅ 已有 |

### 完全缺失：内容策略层

```
输入层 → ??? → 视觉生产层 → 发布层
              ↑
        策略层完全缺失
```

缺失组件：

| 组件 | 职责 |
|---|---|
| `fb-channel-strategist` | Reels : Post : Story 比例决策（本周应该发什么组合） |
| `fb-reels-script` | Hook 结构 · 脚本 · 情绪弧设计 |
| `fb-post-generator` | SEO 优化 · 关键词密度 · 评论引导结构 |
| `fb-story-generator` | 紧迫感 · Link 按钮 · DM 引导 |

### 需要新增的两个文件

```
src/lib/social/social-plan-templates.ts   ← 三类内容的结构化模板定义
src/app/api/social-plan/route.ts          ← 策略决策 + 内容生成入口
```

半自动流程设计：

```
Brand Brief + Campaign Brief
         ↓
  fb-channel-strategist
  (决定本周 Reels:Post:Story 比例)
         ↓
  ┌──────────────────────────────┐
  │  Reels Script Generator      │  → fb_caption + storyboard 触发点
  │  Post Generator              │  → 完整 FB 帖子文案
  │  Story Generator             │  → 每日 Story 图卡文案
  └──────────────────────────────┘
         ↓
  Quality Rubric（含各格式专属维度）
         ↓
  视觉生产层（Reels 走图片→视频管道）
         ↓
  发布层（Facebook Graph API + Publer）
```

---

## 2. 波浪式发布模型（Wave-Based Marketing）

### 核心原则

**不使用平摊分发**（把 X 条内容均分到 Y 天）— 这是错误的做法。

数字营销的本质是：先测试，等数据回流，再放大赢家，最后用稀缺性关单。

### 三波浪模型

```
Wave 1：测试波（内容验证）
  ├─ 天数：第 1–7 天（活动启动周）
  ├─ 发布量：少量（约 30% 总内容）
  ├─ 内容组合：Reels 1 + Post 1 + Story 每日基础轮播
  ├─ 目标：验证哪个角度有效（价格攻击 / 速度攻击 / 情感攻击）
  └─ 结束条件：收到 7 天数据

        ↓ Analysis Gate（数据决策关卡）
        
        判断标准：
        - 完播率 >40% → 该 Reels 是赢家
        - 评论 >15 条 → 该 Post 是赢家
        - DM 数量 >5 → Story 有效

Wave 2：放大波（规模化）
  ├─ 天数：第 8–21 天
  ├─ 策略：复制 Wave 1 赢家的结构和角度，换素材重新发
  ├─ 投放：开始 Boost 赢家内容（付费放大）
  └─ 内容量：Wave 1 的 2–3 倍

Wave 3：关单波（稀缺性收尾）
  ├─ 天数：最后 7 天（促销截止前）
  ├─ 主题：倒计时 · 剩余库存 · 最后机会
  ├─ 频率：Story 每日强推，Post 隔天一条
  └─ 目标：转化漏斗底部的观望者
```

### 与 ME 飞轮的接线

Wave 绩效数据必须回流到飞轮表：

```
flywheel_actions   ← 记录每条内容发布动作（format / wave / campaign_id）
flywheel_metrics   ← 记录 7 天数据快照（reach / plays / comments / dm_count）
flywheel_outcomes  ← Analysis Gate 决策结果（winner / loser / boost_recommended）
```

**`social-plan/route.ts` 的正确输出**：不是"38 天内容日历"，而是：
- Wave 1 完整内容包（含 Reels 脚本 + Post 正文 + Story 文案）
- Analysis Gate 判断标准（针对该 campaign 的具体阈值）
- Wave 2/3 框架（空白模板 + 触发条件 + 等数据再填）

---

## 3. 三层规则引擎（Content Intelligence Rules）

### 层级结构

```
┌─────────────────────────────────────────────────────────┐
│  Layer 1: Universal Rules（外部爆款分析）                 │
│  来源：TikTok / Facebook 平台普遍规律                     │
│  内容：Hook 公式 · 完播率模式 · 评论触发词 · 格式规范      │
│  更新频率：每月由 FDE 或 ME 系统从 VLM 分析中提炼          │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│  Layer 2: Inspiration Library（灵感素材库）               │
│  来源：Ray / FDE 手动粘贴的 TikTok / Facebook 链接         │
│  内容：每条链接 → VLM 分析 → 7 维风格向量 → 存入向量库     │
│  检索方式：生成内容时用 campaign 语义 cosine 相似度查询     │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│  Layer 3: Client Performance Data（客户自有数据）          │
│  来源：该客户历史发布内容的飞轮回流数据                    │
│  内容：哪类 Hook 在此客户受众中有效 · 最佳发布时段          │
│  积累周期：需 3–6 个月才有足够样本量                       │
└─────────────────────────────────────────────────────────┘
```

### 运作逻辑

新客户（Layer 1 + 2 驱动）：
```
Universal Rules + Inspiration Library → 生成 Wave 1 内容
```

成熟客户（三层叠加）：
```
Layer 3 数据发现："$35.50" 价格点在 Brisbane 受众中触发评论率最高
→ Layer 2 查询：找最相似的价格攻击 Reel（cosine 相似度前 3）
→ Layer 1 校验：Hook 结构符合平台普遍规律
→ 输出：高置信度的 Reels 脚本
```

---

## 4. 视频 URL 摄取功能（Video URL Ingestion）

### 场景

Ray 或 FDE 在刷 TikTok / Facebook 时看到一条感觉很强的视频，想让 ME 学习它的风格。

### 流程

```
用户粘贴 URL（TikTok / Facebook / Instagram）
        ↓
ME 后端：下载视频帧（取前3帧 + 中间帧 + 最后帧）
        ↓
VLM 分析（Gemini 2.0 Flash）
  - 输出：7 维风格向量（energy / luxury / authenticity /
           emotional / humor / urgency / offer_signal）
  - 输出：Hook 结构识别（前 1.5 秒做了什么）
  - 输出：视觉风格标签（色调 / 节奏 / 场景类型）
  - 成本：约 $0.03 / 条
        ↓
存入 Inspiration Library（pgvector）
  - inspiration_id
  - source_url
  - style_scores: JSONB（7 维）
  - hook_pattern: text
  - visual_tags: text[]
  - added_by: user_id
  - created_at
        ↓
UI 展示：已收录 N 条灵感素材
```

### UI 入口位置

推荐：社媒内容工作台 → 顶部"灵感素材库"面板 → 粘贴链接 → 一键收录

---

## 5. FDE 角色定义与 Magic Lab Class 管线

### FDE（Field Delivery Expert）是什么

FDE 是运行 Magic Engine 的人类操作员——不是纯粹的技术执行者，而是"内容决策层"。

FDE 的职责：
- 判断 Analysis Gate（哪条内容值得放大）
- 选择本周用哪些灵感素材
- 做客户沟通（报告数据 · 调整方向 · 管理预期）
- 把客户反馈转化为 ME 规则更新

FDE 不做的事：
- 不写代码
- 不做创意（创意由 ME 生成）
- 不做发布（发布由 ME 自动化）

### Magic Lab Class → FDE 管线

```
Magic Lab Class（培训项目）
  ├─ 内容：教学员如何使用 ME 完整工作流
  │         Brand Brief 填写 → Campaign 策划 → 内容审核 → 数据解读
  ├─ 时长：建议 4–6 周
  └─ 产出：结业后学员具备独立操作 1–2 个客户的能力

         ↓ 筛选（结业项目质量 + 客户模拟测试）

Magic Lab FDE 网络
  ├─ 顶级学员成为付费 FDE（按客户数量分成）
  ├─ 中级学员成为候补 FDE（协助正式 FDE）
  └─ 普通结业学员：使用 ME 服务自己的业务

         ↓ 运营模式

ME + FDE 服务交付模型
  ├─ ME 提供：数据 · 内容生成 · 发布自动化 · 报告
  ├─ FDE 提供：判断 · 沟通 · 本地化知识 · 客户关系
  └─ 客户付费：买的是"ME + FDE"整体服务，不知道背后是谁
```

### 为什么系统会越来越聪明

```
FDE 使用 ME → 内容发布 → 数据回流飞轮表
                                ↓
                    Layer 3 规则自动更新（该客户的有效模式）
                                ↓
                    下次生成内容时置信度更高
                                ↓
                    FDE 需要修改的地方越来越少
                                ↓
                    FDE 可以同时服务更多客户
```

这就是"系统变聪明"的机制：不是单次 AI 变强，而是数据飞轮让每个客户的规则库持续自优化。

---

## 6. Phase 11：创意智能引擎（7 维风格向量）

### 7 维定义

| 维度 | 含义 | 低分示例 | 高分示例 |
|---|---|---|---|
| `energy` | 视觉能量/节奏感 | 慢镜头产品展示 | 快剪 + 强音效 |
| `luxury` | 高端/精致感 | 手机随拍 | 电影级色调 + 特写 |
| `authenticity` | 真实感/UGC 感 | 精修广告片 | 无滤镜现场记录 |
| `emotional` | 情绪触发强度 | 纯产品功能展示 | 故事化叙事 |
| `humor` | 幽默/娱乐感 | 正式商务风格 | 搞笑对比 / 意外结局 |
| `urgency` | 紧迫感/稀缺感 | 品牌形象片 | 倒计时 + 限量提示 |
| `offer_signal` | 价格/优惠信号强度 | 纯情感内容 | 价格标签 + 对比展示 |

### 数据流

```
Reel 生成时（现有流程）
        ↓
style-scorer.ts（新增，Phase 11.0）
  - 输入：opening_frame_prompt + closing_frame_prompt + caption + campaign_context
  - 模型：GPT-4o-mini（轻量，每次约 $0.002）
  - 输出：7 维分数（0.0–1.0）
  - 写入：reels_drafts.style_scores (JSONB)
  - 失败处理：.catch() 静默失败，不阻塞主流程
        ↓
pgvector 嵌入（Phase 11.1，后续实现）
  - 把 7 维向量存为 vector(7) 字段
  - 支持 cosine 相似度检索
        ↓
XGBoost 预测（Phase 11.2，后续实现）
  - 训练数据：style_scores × flywheel_metrics（完播率/评论率）
  - 预测：给定 style_scores → 预测该 Reel 在此客户受众中的表现
```

### Phase 11.0 实现要点

- 迁移：`ALTER TABLE reels_drafts ADD COLUMN IF NOT EXISTS style_scores JSONB NULL;`
- Commit：`feat(reels): auto-score style vectors on generation [P11.0]`
- 评分在 Reel 生成后异步触发，`.catch()` 静默失败

---

## 7. 决策快照（本 Session 确立，不可随意推翻）

| 决策 | 内容 | 理由 |
|---|---|---|
| 发布模型 | 波浪式（Wave 1→分析→Wave 2→Wave 3），禁止平摊 | 平摊忽略数据反馈，浪费预算 |
| 规则来源 | 三层叠加（Universal + 灵感库 + 客户数据） | 单靠通用规则不够精准 |
| 灵感摄取 | 支持粘贴 TikTok/FB URL → VLM 分析 → 入库 | 人工标注太慢，VLM $0.03/条可接受 |
| FDE 定位 | 内容决策层，不写代码，不做创意，做判断和沟通 | ME 负责生成，FDE 负责质检和优化 |
| Magic Lab Class | 既是收入来源，又是 FDE 筛选漏斗 | 培训项目自带商业闭环 |
| 7 维风格向量 | energy/luxury/authenticity/emotional/humor/urgency/offer_signal | 足够区分平台内容风格，维度可扩展 |
| 策略层优先 | 先补 `social-plan-templates.ts` + `social-plan/route.ts` | 没有策略层，视觉生产层和发布层的价值打折 |

---

## 8. 待实现清单（本文档不跟踪，见 ROADMAP.md）

- [ ] `social-plan-templates.ts` — 三类内容结构化模板
- [ ] `social-plan/route.ts` — 策略决策 + Wave 1 内容生成
- [ ] Inspiration Library 数据库表（`content_inspirations`）
- [ ] Video URL Ingestion API（`/api/inspiration/ingest`）
- [ ] `style-scorer.ts`（Phase 11.0，Claude Code 已收到实现提示词）
- [ ] `reels_drafts.style_scores` 字段迁移（Phase 11.0）
- [ ] pgvector 7 维嵌入（Phase 11.1）
- [ ] Analysis Gate UI 面板

---

*文档起草：Claude PM · 2026-05-23 · 本文档反映当日架构讨论共识，实现细节见 ROADMAP.md*
