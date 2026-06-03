# Magic Engine SEO SOP — 实施设计文档

> 作者：子牙（Opus 4.8）
> 日期：2026-06-04
> 状态：**设计阶段，未写代码**
> 适用客户：CTS Tours NZ、Oztop Building Supplies（及后续所有客户）
> 设计原则：**计算放后台，前台简化到点鼠标**

---

## 0. 这份文档要解决什么

把 Iris 那篇《32,000 impressions in 30 days》文章里的"每日 SEO 巡逻 SOP"，**翻译成 ME 体系内能照着建的设计**。

不是写一份给人看的操作手册（那种已经有了，见 `clients/oztop/wp-me-seo-sop-2026-06-03.md`），而是回答一个工程问题：

> **ME 系统内部，这套 SOP 的每一步分别由谁执行、跑在哪、数据怎么流、FDE 点哪个按钮？**

---

## 1. 核心设计判断（三条铁律）

### 铁律 1：不新建页面，SEO 走现有执行看板（Kanban）

执行看板（`/dashboard/clients/[id]/execution`）已经有一列叫"SEO 内容 📝"（`buildDimensionGroups()` 的固定维度之一）。

FDE 的"每日 SEO"= 早上打开看板 → SEO 列里**已经躺着系统昨夜算好的今日推荐 actions** → 逐个点。

不做独立 SEO Dashboard。理由：你已经定调"沿用现有 Kanban"，且新建页面会割裂 FDE 的统一工作入口。

### 铁律 2：采集 + 诊断全自动；生成要点；发布必确认

| 阶段 | 自动化程度 | 谁做 | FDE 介入点 |
|------|-----------|------|-----------|
| 数据采集 | **全自动**（已在跑）| 后台 cron | 无 |
| 诊断 + 算今日 3 件事 | **全自动**（待建）| 后台 cron + 诸葛亮 | 无 |
| 生成博客草稿 | **半自动** | 博客生成器 | 点「生成」|
| 内容质量评分 | **全自动**（待建）| 李白 | 无（看评分结果）|
| 发布到网站 | **手动** | 鲁班 | 点「发布」+ 预览 |
| 提交 Google 收录 | **全自动**（发布后）| 鲁班 | 无 |

### 铁律 3：action 上看板只有一条合法链路 —— 必须经诸葛亮

代码事实：execution_items 的写入唯一入口是 `persistZhugeActions()`（`src/lib/zhuge/action-persister.ts`），调用方是诸葛亮。

这意味着：**SEO 每日巡逻发现的"今天该做什么"，不能由李白/张骞/华佗直接塞上看板，必须经诸葛亮决策后写入。**

这不是限制，是保护——保证所有上看板的 action 都经过统一的优先级排序、去重、与 Goal/Initiative 绑定逻辑。

---

## 2. ME 已经有的地基（不用建）

核实后发现，后台采集层比预想完整。**以下全部已在 Render 上按时跑：**

| Cron | 频率（render.yaml）| 采集什么 | 写入表 |
|------|------|---------|--------|
| `google-data-pullback-daily` | 每天 3am UTC | GSC（clicks/impressions/avg_position）+ GA4（sessions/users/pageviews）| `gsc_performance_snapshots`、`ga4_traffic_snapshots`、`flywheel_metrics`（`seo.gsc.*` / `seo.ga4.*`）|
| `keyword-snapshots-weekly` | 周一 2am UTC | DataForSEO 排名 + KD + 搜索量 | `seo_keyword_snapshots` |
| `attribution` | 每 6 小时 | 归因（baseline/after/verdict + GSC 归因到文章）| `flywheel_outcomes` |
| `ai-tracker-weekly` | 周一 1am UTC | AI 可见度（品牌在 ChatGPT/AI Overview 提及率）| `ai_visibility_snapshots` |
| `anomaly-detector` | 每天 5am UTC | 扫 metrics 异动 → 诸葛亮判断 → 写 pending action | `anomaly_signals` + `execution_items` |

**关键结论：Iris 文章里"每天查 GSC + DataForSEO"这一步，ME 已经在自动做了。** 我们要建的不是采集，而是**把已采集的数据加工成"今日 SEO 3 件事"并推上看板**。

同样，Kanban 的"SEO 列"已存在，李白的评分标准（SEO/GEO 双路径，<60 打回）已在 `docs/agents/70-libai.md` 定义好。

---

## 3. ME 还缺什么（这份设计的真正交付物）

对照 Iris SOP，ME 的三个缺口：

| 缺口 | Iris 文章对应 | 现状 |
|------|--------------|------|
| **缺口 A：没有"每日 SEO 诊断"把数据变成 action** | "每天 diagnose → pick 3 actions" | metrics 在库里躺着，没人每天把它翻译成"今天补这篇的内链" |
| **缺口 B：李白评分没真正卡住发布** | "always validate before celebrating" | 评分标准是纸上的，发布流程不强制走李白 |
| **缺口 C：CTR 低效标题无触发机制** | "rewrote 23 titles by CTR rubric" | GSC 有 CTR、DataForSEO 有排名，但没逻辑合并出"P3 但 CTR 低 → 改标题" |

**这份文档的核心就是设计补这三个缺口的方案。**

---

## 4. 核心设计：每日 SEO 巡逻 Cron（补缺口 A + C）

### 4.1 范本：照抄 `anomaly-detector` 的两步流水线

`anomaly-detector` 已经验证了这个模式可行：

```
Step 1（规则引擎，无 AI，快）：扫 metrics → 发现异动 → 写 signals
Step 2（诸葛亮 Haiku，便宜）：读 signals → 判断该不该建 action → 写 pending execution_items
```

SEO 每日巡逻**完全复刻这个结构**，新建 `seo-patrol-daily` cron：

```
GET /api/cron/seo-patrol-daily   (Bearer CRON_SECRET，每天 4am UTC，在采集 cron 之后)

Step 1 · SEO 诊断引擎（纯规则，无 AI）
  对每个有 domain 的客户：
    读 seo_keyword_snapshots（本周 vs 上周）+ gsc_performance_snapshots
    应用诊断规则（见 4.2），产出 SeoPatrolFinding[]
    写入 seo_patrol_findings 表（新建，status='fresh'）

Step 2 · 诸葛亮决策（Claude Haiku，便宜）
  仅当 Step 1 有 fresh findings 时执行：
    读 fresh findings → 调诸葛亮 → 决定哪些值得建 action（最多每客户 3 条）
    经 persistZhugeActions() 写入 execution_items（dimension='seo', status='pending', source='seo_patrol'）
    更新 findings.status → 'actioned' | 'dismissed'
```

**为什么是 4am UTC**：采集 cron 3am 跑完，4am 数据已就绪，FDE（NZST/AEST 上午）打开看板时 actions 已躺好。

### 4.2 SEO 诊断规则（Step 1 纯规则引擎，对应 Iris 的 diagnose 步骤）

每条规则输入已采集的数据，输出一个 finding。**无 AI，纯计算，放后台。**

| 规则 ID | 触发条件（用已有数据算）| 产出 finding | 对应 action_type |
|---------|----------------------|-------------|-----------------|
| `R1_low_ctr_title` | 关键词排名 P2-P3 且 GSC CTR < 该排名基准的 60% | "X 排名第 N 但点击率偏低，建议改标题" | `seo.refresh_blog`（标题）|
| `R2_missing_internal_link` | 某文章有 GSC 曝光但归因显示无内链指向产品页 | "X 有流量但无内链导流" | `seo.refresh_blog`（内链）|
| `R3_stale_content` | 文章排名近 30 天下滑 >3 位 | "X 排名下滑，建议刷新" | `seo.refresh_blog` |
| `R4_keyword_opportunity` | DataForSEO 有高量低 KD 词，客户未覆盖 | "机会词 X（量 N / KD M）建议写新文" | `seo.publish_blog` |
| `R5_not_indexed` | GSC 显示 "discovered not indexed" 超 7 天 | "X 未收录，建议重新提交" | `seo.refresh_blog`（重提收录）|

**CTR 基准表**（内置常量，已在 `intent-strategy.ts` 有雏形）：

```
P1=28%  P2=15%  P3=10%  P4=7%  P5=6%  P6=5%  P7=4%  P8=3.5%  P9=3%  P10=2.5%
```

实际 CTR < 基准 × 0.6 → 触发 R1。

### 4.3 数据流图

```
[已有] google-data-pullback-daily (3am) → gsc/ga4 snapshots + flywheel_metrics
[已有] keyword-snapshots-weekly (周一) → seo_keyword_snapshots
                          ↓
[新建] seo-patrol-daily (4am)
   Step 1 规则引擎 → seo_patrol_findings (fresh)
                          ↓
   Step 2 诸葛亮 Haiku → persistZhugeActions()
                          ↓
[已有] execution_items (dimension='seo', status='pending', source='seo_patrol')
                          ↓
[已有] 执行看板 SEO 列 ← FDE 早上打开就看到今日推荐
```

**新建的只有：1 个 cron（`seo-patrol-daily`）+ 1 张表（`seo_patrol_findings`）+ 诊断规则库。** 其余全部复用。

---

## 5. 前台设计：FDE 在看板上点什么（鼠标完成）

### 5.1 SEO 列卡片长什么样

执行看板 SEO 列里，每张 action 卡片（已有 `ItemWithLogs` 结构）展示：

```
┌─────────────────────────────────────┐
│ 📝 改标题：SPC Flooring Brisbane     │  ← title
│ 排名 #3 但 CTR 仅 2.1%（基准 10%）   │  ← description（诊断理由，诸葛亮 why_now）
│ [生成优化标题]  [跳过]               │  ← 一个主按钮 + 跳过
└─────────────────────────────────────┘
```

FDE 看到的不是数据，是**结论 + 一个动作**。计算（"P3 基准 10%，实际 2.1%，低于阈值"）已在后台完成。

### 5.2 三类 SEO action 的前台交互

| action_type | 卡片主按钮 | 点击后 |
|-------------|-----------|--------|
| `seo.publish_blog` | 「生成这篇」 | 跳 Blog Studio，关键词已预填 → 生成 → 李白评分 → 发布 |
| `seo.refresh_blog`（内链/标题）| 「生成优化版」 | 调 refine → 李白评分 → 推 WP 更新 |
| `seo.refresh_blog`（重提收录）| 「提交收录」 | 直接调 `/gsc/index-request`（这步可全自动，但放按钮让 FDE 知情）|

**「点鼠标完成」的兑现**：FDE 不需要判断"这个词排名多少、该不该改"——系统已经判断完，FDE 只需对推荐结果点「生成」或「跳过」。

### 5.3 北极星数字放哪

Iris SOP 的灵魂是"每天看一个数字：今天几个词在第一页"。

**设计**：看板 SEO 列的列头（column header）显示：

```
📝 SEO 内容    Page-1 关键词：12 个 ↑2
```

这个数字从 `seo_keyword_snapshots` 实时算（position ≤ 10 的 distinct 关键词数），对比上周。**不新建页面，就嵌在已有列头里。**

---

## 6. 缺口 B：李白评分接入发布流程

### 6.1 现状问题

博客生成完 → FDE 直接能点 Publish → 李白的 SEO/GEO 双路径评分（<60 打回）**没有真正拦截**。

### 6.2 设计

在 Blog Studio 发布按钮前插入李白评分关卡：

```
FDE 点「发布到网站」
      ↓
[新建] 调李白评分 (src/lib/blog 内新增 scoreContent())
      ↓
  SEO 路径得分 + GEO 路径得分（双路径，标准已在 70-libai.md 定义）
      ↓
  ┌─ 两路径都 ≥ 60 → 正常进发布预览
  └─ 任一 < 60 → 卡片显示警告 + 具体缺什么（如"内链仅 1 条，需 ≥2"）
                  FDE 可选：① 点「重新生成」② 知情后强制发布（记录 override）
```

**李白评分边界**（重申，与上次评估一致）：李白只评分，不发布。发布权在鲁班 + FDE 确认。李白无写权限、无付费 API 调用，符合现有架构。

### 6.3 评分项（直接用 70-libai.md 已定义的表，无需重新设计）

- SEO：主关键词位置 / meta 长度 / 字数 ≥1500 / AU-NZ 拼写 / FAQ ≥3 / 内链 ≥2
- GEO：品牌出现 ≥3 / 隐藏 GEO 块 / FAQ 覆盖 AI 问题 / 地域信号 / 差异化陈述

**这块是纯计算，全放后台，FDE 只看红/绿 + 缺什么。**

---

## 7. 客户专属配置（CTS / Oztop 落地差异）

诊断规则通用，但**触发参数和默认目标按客户配置**。建议存在 `clients` 表或独立配置：

### CTS Tours NZ

| 配置项 | 值 |
|--------|-----|
| 地区参数 | DataForSEO `location_code=2554`（NZ），`gl=nz` |
| 平台 | Next.js（无 Yoast）→ 发布走 GitHub/直接部署，Schema 直出 HTML |
| 关键词重心 | 场景词（"guided tours" / "day trips"）优先于产品词 |
| 内链默认目标 | 行程详情页、booking 页 |
| GEO 触发词 | "best tours in New Zealand" / "things to do in Christchurch" |
| 北极星 | Page-1 关键词（NZ 市场）|

### Oztop Building Supplies

| 配置项 | 值 |
|--------|-----|
| 地区参数 | DataForSEO `location_code=2036`（AU），Brisbane > Logan > Gold Coast |
| 平台 | WordPress + Yoast → 发布走 Create Draft → Publish |
| 关键词重心 | SPC/Hybrid Flooring 场景词 |
| 内链默认目标 | `/product-category/flooring/spc-wpc-hybrid-flooring/` 等 |
| GEO 触发词 | "best flooring for Brisbane homes" |
| CTA 默认 | Book Free Measure / Talk to Oztop |
| 北极星 | Page-1 关键词（AU 市场）|

**实现方式**：诊断规则读客户配置决定参数，不为每个客户写死逻辑。CTS/Oztop 只是两组配置值。

---

## 8. 需要新建的东西（工程清单 + 优先级）

| 编号 | 待建项 | 类型 | 复用了什么 | 优先级 |
|------|--------|------|-----------|--------|
| **S1** | 李白评分接入发布流程（`scoreContent()` + 发布前关卡）| 后端 + 前端 | 评分标准已定义，只缺接入 | **P1** |
| **S2** | `seo-patrol-daily` cron（两步流水线）| 后端 cron | 照抄 `anomaly-detector` 结构 | **P1** |
| **S3** | `seo_patrol_findings` 表 + 诊断规则库（R1-R5）| 数据库 + 后端 | 数据源已采集 | **P1** |
| **S4** | 看板 SEO 列头显示 Page-1 北极星数字 | 前端 | 数据已在 `seo_keyword_snapshots` | **P2** |
| **S5** | SEO action 卡片主按钮交互（生成/优化/收录）| 前端 | 卡片结构已有 | **P2** |
| **S6** | 客户 SEO 配置（CTS/Oztop 参数表）| 数据库 + 后端 | clients 表扩展 | **P2** |
| **S7** | Schema 自动验证（Rich Results Test API）| 后端 | 全新 | **P3** |
| **S8** | CTS 专项 SOP 文档落文件 | 文档 | - | **P2** |

### 里程碑切分（参照 Phase 12 协议）

- **M1（地基）**：S3 表 + 诊断规则建好，`npm run build` 通过，Supabase 能看到 `seo_patrol_findings` 表
- **M2（第一条 finding）**：S2 cron 本地能跑 Step 1，对 CTS 真实数据产出至少 1 条 finding
- **M3（端到端）**：S2 Step 2 跑通 → CTS 看板 SEO 列出现 1 条系统推荐 action → FDE 点「生成」走通到发布
- **M4（质量关）**：S1 李白评分接入，发布前能拦截低分草稿

---

## 9. 架构合规检查（防止偏离现有设计）

| 检查项 | 是否合规 | 说明 |
|--------|---------|------|
| action 上看板走 `persistZhugeActions()` | ✅ | 不绕过诸葛亮 |
| 李白无执行权 / 无付费 API | ✅ | 只评分 |
| 数据采集不重复建 | ✅ | 全复用现有 cron |
| Kanban 不新建页面 | ✅ | 用现有 SEO 列 |
| 诊断与决策分离（规则引擎 vs 诸葛亮）| ✅ | 照抄 anomaly-detector |
| 飞轮词表已注册 `seo.*` action_type | ✅ | `vocabulary.ts` 已有 publish_blog/refresh_blog |
| 新 source 类型 `seo_patrol` 需登记 | ⚠️ | execution_items.source 枚举需加 `seo_patrol`（小改 schema）|
| UI 封装名（不露第三方真名）| ✅ | 卡片不显示 DataForSEO/SEMrush |

**唯一 schema 改动**：`execution_items.source` 枚举加一个值 `seo_patrol`（或复用现有 `proactive_signal`，二选一，建 M1 时定）。

---

## 10. 一句话总结

> **ME 的 SEO SOP 实施 = 复刻 anomaly-detector 模式建一个 `seo-patrol-daily` cron：后台规则引擎把已采集的 GSC/DataForSEO 数据诊断成"今日 3 件事"，经诸葛亮推上现有看板 SEO 列，FDE 早上打开点「生成」即可。李白在发布前做质量关卡。FDE 永远只看结论 + 点按钮，所有计算在后台。**

后台地基（采集 + 看板列 + 评分标准）已具备，真正要建的是中间那层"诊断 → 推荐"加工，以及李白评分的接入。工作量集中在 P1 三项（S1/S2/S3），其余是前台简化和配置。

---

## 附录：与现有文档的关系

- 本文件管**工程实施设计**（谁建什么、数据怎么流）
- `clients/oztop/wp-me-seo-sop-2026-06-03.md` 管 **FDE 手动操作手册**（当 ME 自动化未建完时的人工流程）
- `docs/agents/70-libai.md` 管**李白评分标准**（本文件 §6 引用它）
- `docs/agents/00-architecture.md` 管**agent 总架构**（本文件 §9 据它做合规检查）

待 P1 建完，本文件的"待建"标记逐项消除，FDE 手动手册可逐步退役为 fallback。
