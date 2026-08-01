# Production Package — Engineering RFC

> **状态**：草案已收敛,**未开工**。登记为 Phase 13(详见 ROADMAP § Phase 13)。
> **最后更新**:2026-05-19
> **作者讨论记录**:PM × Claude Code(architectural review session)

---

## 1. 一句话定位

`ProductionPackage` = **六维诊断后的统一生产订单层**,把分散在 `content_posts / blog_posts / reels_drafts / visual_assets` 的产物,按维度 + 上下文聚合成可审核、可追溯、可归因的批次。

不替代现有内容生成器,只补一层**聚合 + 状态汇总 + 上下文快照**。

---

## 2. 核心心智

```text
Master Brief    = 品牌 DNA(长期稳定)
Diagnostic      = 发现问题(六维)
Prescription    = 决定做什么
Execution Item  = 单个动作
Production Package = 把一组动作的产物打包成"生产订单"
Production Item    = 订单里的具体产物
Flywheel        = 结果回收和下一轮优化
```

### 2.1 六维上下文规则(派生,不存)

```ts
seo / social / ads               -> campaign_bound  (campaign_id 强烈建议补齐)
ai_visibility / competitor / reputation -> dna_bound (campaign_id 通常为空)
```

**不**在 DB 里存 `context_mode` 字段,**由 `dimension` 派生**。UI 分组需要时用 SQL view 或前端 derive。

### 2.2 与 flywheel 的关系

`flywheel_name` enum(`seo/geo/ads/social`,4 元组)≠ `diagnostic_dimension` enum(6 元组)。

Package 只存 `diagnostic_dimension`,需要 flywheel 时**通过 `execution_items.execution_target` 推导**,不在 package 上冗余存储。

---

## 3. 已确认的工程决策

| 决策 | 选择 | 否决方案 | 理由 |
|---|---|---|---|
| `dimension` 字段类型 | 复用 `diagnostic_dimension` enum | `TEXT NOT NULL + CHECK` | 单一真相源,避免 enum 漂移 |
| `context_mode` 字段 | **不存**,从 dimension 派生 | 持久化字段 | 冗余字段会带来一致性风险 |
| `production_items` 关联模式 | 多 FK(`content_post_id` / `blog_post_id` / `reels_draft_id` / `visual_asset_id`) | 多态 `target_type + target_id` | Postgres 无多态 FK,会丢约束和级联 |
| `production_item_assets` 关联表 | **MVP 不做** | 一次到位 | 过度设计;真出现 asset 多对多再加 |
| 现有内容表只加 `production_item_id` | 单列 FK | 同时加 `production_package_id` | 两列冗余会不一致;通过 item 反查包 |
| `campaign_id` 约束 | 应用层校验(approved/scheduled/published 前补齐) | DB 硬约束 NOT NULL | 草稿态需要灵活;ad-hoc 帖子也属于 social 维度 |
| `source_*` 字段(MVP 阶段) | 只保留 `source_payload jsonb` + 核心 FK | `source_keyword_id` / `source_video_url` / `manual_topic` 一次性建好 | MVP Social-only 用不到这些,加 jsonb 占位,后续提升为 typed 字段 |
| 现有 `execution_items.content_post_id` | 保留 | 删除 | 1:1 链路依然有效;Package 是 N:1 聚合层,不冲突 |
| `campaign_briefs` schema 扩展 | **MVP 不做** | strengthen migration 加 10 字段 | Reels drift 应**改 Reels 代码**适配现有 schema,不是反过来 |
| ExecutionPackage 表 | 不做 | 新表 | `prescriptions + execution_items` 已经是 execution layer |

---

## 4. MVP Schema(Phase 13.A — Social-only)

### 4.1 新增 `production_packages`

```sql
CREATE TABLE production_packages (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id             UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  master_brief_id       UUID NOT NULL REFERENCES master_briefs(id) ON DELETE RESTRICT,

  dimension             diagnostic_dimension NOT NULL,

  -- 显式来源 FK (核心)
  campaign_id           UUID REFERENCES campaign_briefs(id)   ON DELETE SET NULL,
  diagnostic_run_id     UUID REFERENCES diagnostic_runs(id)   ON DELETE SET NULL,
  diagnostic_finding_id UUID REFERENCES diagnostic_findings(id) ON DELETE SET NULL,
  prescription_id       UUID REFERENCES prescriptions(id)     ON DELETE SET NULL,
  execution_item_id     UUID REFERENCES execution_items(id)   ON DELETE SET NULL,

  -- 非结构化来源(MVP 唯一 source 字段)
  source_payload        JSONB NOT NULL DEFAULT '{}',

  -- 生成时的上下文快照(可追溯,不会跟着 master brief / campaign 漂移)
  generation_context_snapshot JSONB NOT NULL DEFAULT '{}',

  title                 TEXT NOT NULL,
  brief                 TEXT,

  status                TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','generating','ready_for_review','revision_requested',
                      'approved','scheduled','published','measured','archived','failed')),

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pkg_client_dim     ON production_packages(client_id, dimension);
CREATE INDEX idx_pkg_status         ON production_packages(client_id, status);
CREATE INDEX idx_pkg_campaign       ON production_packages(campaign_id) WHERE campaign_id IS NOT NULL;
CREATE INDEX idx_pkg_execution_item ON production_packages(execution_item_id) WHERE execution_item_id IS NOT NULL;

ALTER TABLE production_packages ENABLE ROW LEVEL SECURITY;
-- (RLS policies 按现有项目惯例 client_team 鉴权)
```

**注**:
- `review_status` / `publish_status` / `feedback_status` / `next_action` 等聚合字段 **MVP 不做**,从 `production_items` 聚合;真需要 denormalize 再加。
- `package_type` 字段 **MVP 不做**(见 §6 隐藏陷阱)。

### 4.2 新增 `production_items`

```sql
CREATE TABLE production_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id      UUID NOT NULL REFERENCES production_packages(id) ON DELETE CASCADE,
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  dimension       diagnostic_dimension NOT NULL,

  item_type       TEXT NOT NULL
    CHECK (item_type IN ('social_post','blog_post','reel','image','video','avatar',
                         'ad_copy','landing_copy','faq','battlecard','review_response')),
  channel         TEXT,

  -- 多 FK (各内容表一对一指针)
  content_post_id UUID REFERENCES content_posts(id)  ON DELETE SET NULL,
  blog_post_id    UUID REFERENCES blog_posts(id)     ON DELETE SET NULL,
  reels_draft_id  UUID REFERENCES reels_drafts(id)   ON DELETE SET NULL,
  visual_asset_id UUID REFERENCES visual_assets(id)  ON DELETE SET NULL,

  title           TEXT,
  status          TEXT NOT NULL DEFAULT 'planned'
    CHECK (status IN ('planned','generating','draft','ready_for_review',
                      'changes_requested','approved','scheduled','published','measured','failed')),

  sort_order      INTEGER NOT NULL DEFAULT 0,
  metadata        JSONB NOT NULL DEFAULT '{}',

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_item_package ON production_items(package_id, sort_order);
CREATE INDEX idx_item_content ON production_items(content_post_id) WHERE content_post_id IS NOT NULL;

ALTER TABLE production_items ENABLE ROW LEVEL SECURITY;
```

### 4.3 ALTER 现有表

```sql
ALTER TABLE content_posts   ADD COLUMN production_item_id UUID REFERENCES production_items(id) ON DELETE SET NULL;
ALTER TABLE blog_posts      ADD COLUMN production_item_id UUID REFERENCES production_items(id) ON DELETE SET NULL;
ALTER TABLE reels_drafts    ADD COLUMN production_item_id UUID REFERENCES production_items(id) ON DELETE SET NULL;
ALTER TABLE visual_assets   ADD COLUMN production_item_id UUID REFERENCES production_items(id) ON DELETE SET NULL;

CREATE INDEX idx_content_posts_item   ON content_posts(production_item_id)   WHERE production_item_id IS NOT NULL;
CREATE INDEX idx_blog_posts_item      ON blog_posts(production_item_id)      WHERE production_item_id IS NOT NULL;
CREATE INDEX idx_reels_drafts_item    ON reels_drafts(production_item_id)    WHERE production_item_id IS NOT NULL;
CREATE INDEX idx_visual_assets_item   ON visual_assets(production_item_id)   WHERE production_item_id IS NOT NULL;
```

**注**:**不**加 `production_package_id` 列;通过 item 反查包,避免两列冗余。

---

## 5. MVP 落地步骤(6 个 commit,目标 1 个 sprint)

| 顺序 | 任务 | Commit tag | 说明 |
|---|---|---|---|
| 1 | 修 Reels schema drift | `fix(reels): align with campaign_briefs schema` | 改 Reels 代码读 `title/description/parsed_content/semrush_keywords`,**不扩** `campaign_briefs` |
| 2 | 建 `production_packages` 表 | `feat(package): create production_packages [P13.A.1]` | migration + RLS |
| 3 | 建 `production_items` 表 | `feat(package): create production_items [P13.A.2]` | migration + RLS |
| 4 | 现有内容表加 `production_item_id` | `feat(package): link content tables to items [P13.A.3]` | 4 张表各加一列 + index |
| 5 | Social 生成链路写 package | `feat(package): wire social route-a/c into packages [P13.A.4]` | Route A/C 接收 `production_package_id`,生成时创建 item |
| 6 | Package Detail Page 只读 | `feat(package): production package detail page [P13.A.5]` | `/dashboard/clients/[id]/production/[packageId]` 只读视图 |

**验收标准**:
- 一条 Social post 能归属到一个 production item
- 一个 production item 能归属到一个 package
- Package Detail Page 能展示:`dimension` / `campaign`(可空)/ `execution_item`(可空)/ 关联 items 列表 / `generation_context_snapshot` JSON
- 现有 ContentHub 不破坏;旧 Social post 没 `production_item_id` 也能正常显示

---

## 6. 隐藏陷阱(动手前必读)

> 如果 `ai_visibility / competitor / reputation` 三个维度的产物本质都是 `content_posts` 或 `blog_posts`(只是 Schema/FAQ 区不同),那"By Dimension"视角和"By tag"没有区别。

**Phase 13.A 启动前必做**:
1. 各拉一份 AI Visibility / Competitor / Reputation 产物的草稿原型
2. 确认三者**形态是否真的不同**(entity fact sheet 是否需要独立表 vs 只是 blog_post 加 metadata)
3. 如果三者本质都是普通博客 + tag,则 `production_packages.package_type` 字段**永久不加**,只保留 `dimension`

不先验证这一步,后面 Phase 13.B/13.C 会发现"维度视角"是个假需求。

---

## 7. 后续 Phase 规划(预告,**未排期**)

| Phase | 内容 | 触发条件 |
|---|---|---|
| **13.A** | Social-only MVP(本文档) | PM 拍板启动 |
| 13.B | SEO + AI Visibility 接入 | 13.A 验收通过 + §6 陷阱已验证 |
| 13.C | Reels + Visual 接入 | 13.B 完成 |
| 13.D | Ads + Competitor + Reputation 接入 | 13.C 完成 |
| 13.E | Flywheel feedback 闭环(package → flywheel_actions → outcomes) | 13.D 完成 |

---

## 8. 不做清单(明确划界)

MVP **不做**以下事项,避免 scope creep:

- ❌ 改写任何现有内容生成器(Route A/B/C / blog / reels / visual 都保持原状,只加 package 关联)
- ❌ 统一 generation queue
- ❌ 内容质量自动 review / retry 闭环(单独 Phase,见上一轮 review 第 6 节)
- ❌ Master Brief 自动更新
- ❌ Campaign Brief schema 扩展
- ❌ `package_type` 字段
- ❌ `production_item_assets` 关联表
- ❌ DB 层 `campaign_id` 硬约束
- ❌ `review_status / publish_status / feedback_status` 聚合字段

---

## 9. 参考

- [ROADMAP.md § Phase 13](./ROADMAP.md) — 任务登记
- [supabase/migrations/20260513000001_diagnostic_engine.sql](../supabase/migrations/20260513000001_diagnostic_engine.sql) — `diagnostic_dimension` enum 定义
- [supabase/migrations/20260517000001_flywheel_data_skeleton.sql](../supabase/migrations/20260517000001_flywheel_data_skeleton.sql) — `flywheel_name` enum + `execution_items.execution_target`
- [supabase/migrations/20260518000003_execution_content_link.sql](../supabase/migrations/20260518000003_execution_content_link.sql) — 现有 `execution_items ↔ content_posts` 1:1 链路
- [docs/flywheel-architecture.md](./flywheel-architecture.md) — 飞轮数据闭环架构(Phase 12 产物)
