# 内容工厂 · Meta Ads 创意自动闭环 — Spec v0.1(审签修订版)

- **文档状态**:v0.1 审签修订版(子牙起草 → 魏征代码挑刺审 15 条 + 板桥客户视角审 10 条 → 全部处置完毕,见文末「审签记录」。涉及花钱动作与 migration,**merge / apply / 首发投放均须 PM 显式 go**)
- **日期**:2026-07-11
- **登记归属**:Phase 21(AI Content Factory)新增子阶段 **P21.J — Meta Ads 创意自动闭环**(遵循 Phase 管理原则:不新建顶层 Phase;与 P21.F Content-to-Ad Bridge 互补,见 §10)
- **试点客户**:CTS Tours NZ(`c0000000-0000-0000-0000-000000000000`,Meta 账户 `act_2775766642787274`)

---

## 1. 背景与目标

CTS 的 Meta 广告运营已经跑出了清晰的手工闭环:看数据 → 发现广告疲劳/赢家 → 想角度 → 出素材 → 剪片 → 上广告 → 再看数据。这个链条里每一环都已经被单独验证过:muapi Kling 2.1 I2V 出 clip($0.225/条)、OpenMontage 本地混剪出成片、Meta API 直连投放、meta_ads_snapshots 回流表现。**唯一没有的是把它们串成不需要人推动的流水线。**

本 spec 定义 v1 流水线:

> **信号(广告疲劳/放大赢家/新 campaign/素材缺口)→ 系统自动决策该不该做、做什么 → 生成内容工单 → 本地 worker 生产成片 → 人工只审最终成片(唯一人工关卡)→ 发 Meta Ads → 表现回流 → 赢家自动拆片入 Winner 库 → 反哺下一轮。**

三个 PM 已拍板决策(本 spec 不再讨论):
1. **触发全自动**:信号来自「CTS Meta Ads」工作流(另一窗口设计中),本 spec 提案契约,标注开放项。
2. **决策全自动**:该不该做/做什么由系统决定;人只在发布前审成片。
3. **先广告渠道**:Meta Ads 先行,社媒后续。

**v1 成功标准**:CTS 一条真实疲劳信号,72 小时内在 Meta 广告账户里跑起一条系统自产的替换创意,且投放期结束后表现数据自动回流并完成 winner 判定 —— 全程 FDE 只点了一次「过审」。

---

## 2. DAPE 对齐声明

| 维度 | 对齐 |
|---|---|
| **DAPE 段** | **E(Execution)为主体**。信号消费自 A 段(CTS Meta Ads 工作流的分析产出);winner 判定与拆片属 E→A 回流边界,通过 `flywheel_metrics`/`flywheel_outcomes` 回灌,不越权做 A 段评分 |
| **6 支柱** | **广告**(v1)→ 社媒(v2,复用同一工单/素材库,只换发布端) |
| **双轨** | **FDE 月付轨**(CTS)。self-serve 轨不暴露本系统任何 UI;MTC 计费 v1 占位不扣(见 §10 开放项) |
| **Memory 层** | **Layer 1 客户级**:①正向 — `winner_structures.win_reason_tags` + 工单 outcome 经 `flywheel_outcomes` → 每周 `agent-learning-rollup` cron 回灌 `client_learned_preferences.winning_reel_patterns`(与 P21.F 登记的同一字段,不另起炉灶);②**负向 — 打回工单的 `reject_category` + 打回意见 tag 同批回灌 `client_learned_preferences.rejected_creative_patterns`(新键),strategist 每轮决策读取,打回教训永久生效不失忆**(板桥 #3 修订)。Layer 2 行业级 v2 再接 |
| **战略地基硬闸** | 工单生成必过 `master_briefs`(active)+ `goals`(active)校验,**且角度必须正向溯源到 brief 具体条目**(见 §5.1 闸 1),承接「绝不凭空注入客户业务数据」红线 |
| **对外文案** | 分两层(板桥 #10 修订):①**FDE/ME 内部**可用「内容工厂」;②**客户可见叙事**(工作日志/月报/portal)一律说「我们监测到广告疲劳,团队为你更新了创意」——自动化是 ME 内部效率,不是客户价值,「工厂/自动生成」字眼不进客户文案。DAPE 字眼、muapi/OpenMontage 真名不出现在任何客户可见界面(muapi/Kling → **Video Studio**;OpenMontage → **Edit Engine**,内部代号)。**存储层痕迹同样受此约束**:客户可见字段不裸露 `*.supabase.co` URL(板桥 #5) |

---

## 3. 信号契约提案:`content_demand_signal`

> **⚠️ 开放项:本节整体待与「CTS Meta Ads」窗口对齐后冻结(截止 M1 开工前)。** 下面是子牙的单一提案版本,对齐会上以此为底稿改,不从零谈。

### 3.1 JSON Schema(v0.1)

```json
{
  "schema_version": "0.1",
  "signal_type": "creative_fatigue | scale_winner | new_campaign | asset_gap",
  "client_id": "uuid",
  "source": "cts-meta-ads-operator",
  "dedupe_key": "fatigue:act_2775766642787274:ad_1202xxx:2026-07-11",
  "confidence": 0.85,
  "evidence": {
    "ad_account_id": "act_2775766642787274",
    "campaign_id": "1202...",
    "adset_id": "1202...",
    "ad_id": "1202...",
    "metrics_window_days": 7,
    "metrics": {
      "frequency": 2.8,
      "ctr": 0.009,
      "ctr_baseline": 0.015,
      "cpl": 12.4,
      "cpl_baseline": 5.5,
      "cost_per_thruplay": 0.041,
      "spend": 210.5
    }
  },
  "request": {
    "desired_variant_count": 2,
    "reuse_winner_structure": true,
    "target_campaign_id": "1202...",
    "daily_budget_usd": 10,
    "duration_days": 3,
    "notes": "Reborn winner frequency 2.8, CPL 爬升 45%, 需同题材新皮肤"
  },
  "expires_at": "2026-07-14T00:00:00Z"
}
```

### 3.2 四种 `signal_type` 语义

| 类型 | 语义 | 典型 evidence | 工厂默认响应 |
|---|---|---|---|
| `creative_fatigue` | 在跑广告 frequency > 2.5 或 CTR/CPL 恶化超阈值 | frequency + 指标对比 baseline | 同 winner 骨架 × 新 clip 皮肤,替换投放 |
| `scale_winner` | 赢家表现好、预算已倾斜、需要变体分摊疲劳 | 表现数据 + budget_share | 出 2-3 条变体,同 adset 新 Ad |
| `new_campaign` | 新 campaign/新团品上线,零创意 | campaign_id + 主推产品 | 全新角度工单(过 brief 硬闸最严:角度溯源强制,见 §5.1 闸 1) |
| `asset_gap` | Clip 库某场景/运镜储备低于水位 | scene_tag + 当前库存数 | 只出 clip 生成工单,不出成片 |

### 3.3 传输方式(子牙拍板)

**HTTP push**:CTS Meta Ads 工作流 `POST /api/factory/signals`,Bearer `INTERNAL_API_KEY`。理由:两个系统解耦,信号方不需要知道工厂内部表结构。ME 侧同步落库、异步触发决策。

**去重双层设计(魏征 F6 修订)**:
1. **字符串层**:`dedupe_key` 唯一索引,拦同 source 重发(幂等,重发安全);
2. **语义层(真正的闸)**:strategist 接受任何信号前,查该 `evidence.ad_id` 是否已存在 `status NOT IN ('closed','archived','dead_letter','superseded')` 的开放工单 —— 有则 reject,`reject_reason='duplicate_open_order'`。**内外双源(外部工作流 + §8.4 工厂内部自发)对同一 ad 发疲劳信号,只会出一张工单**。字符串 key 拦不住不同拼法,语义层必拦。

**待对齐清单**(开放项,逐条打勾才冻结):① 阈值归属 —— frequency>2.5 / CTR 恶化幅度由信号方定,工厂不重复判断;② `dedupe_key` 命名规范;③ `request` 字段哪些是 hint 哪些是强约束(**预算类字段一律是 hint,工厂绝对硬顶说了算**,见 §8.1);④ `asset_gap` 是信号方发还是工厂自查库存自发(子牙倾向:工厂自发,信号方只管广告侧);⑤ **内部自发信号的 `dedupe_key` 与外部方共用同一拼法规范**(魏征 F6)。

---

## 4. 数据模型

> **🔴 强制声明:以下 migration(7 表 + clients 1 列 + 1 claim RPC + 1 bucket)必须 PM 拍板后才 apply,worker 严禁自行 `apply_migration`(W4/W5 事故教训)。** 所有表 RLS 一律 service-role 模板,migration 写完必 grep `workspace_id|client_team|auth\.uid|auth\.jwt` 确认零命中。claim RPC 一并登记进 M1 migration,一次拍板,避免二轮(魏征 F13 修订)。

### 4.0 RLS 统一模板(每张新表都附加,下文不重复)

```sql
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY "service_role_full" ON <table> FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
```

### 4.1 `content_demand_signals`(信号落库)

```sql
CREATE TABLE content_demand_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id),
  signal_type text NOT NULL CHECK (signal_type IN
    ('creative_fatigue','scale_winner','new_campaign','asset_gap')),
  source text NOT NULL DEFAULT 'cts-meta-ads-operator',
  dedupe_key text,
  confidence numeric,
  evidence jsonb NOT NULL DEFAULT '{}',
  request jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'received' CHECK (status IN
    ('received','evaluating','accepted','rejected','expired')),
  reject_reason text,
  work_order_id uuid,            -- 接受后回填
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX idx_cds_dedupe ON content_demand_signals(dedupe_key)
  WHERE dedupe_key IS NOT NULL;
CREATE INDEX idx_cds_client_status ON content_demand_signals(client_id, status);
```

**`expired` 的执行者(魏征 F15 修订)**:strategist 评估的**第一步**就是 `expires_at < now()` 检查,过期 → 转 `expired`、不出工单(三天前的疲劳信号对应的广告可能早被人工换掉了,评估陈旧信号 = 花钱做已失效的事)。

### 4.2 `video_clips`(① Clip 库 · 视频原子素材)

```sql
CREATE TABLE video_clips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id),
  title text,
  scene_tag text NOT NULL,          -- A 轨: 具体景点/实物 'great_wall','li_river','shop_interior'
                                    -- B 轨: 仅抽象氛围 'sunset_mood','texture_detail','water_reflection'
  motion_type text,                 -- 运镜: 'push_in','orbit','drone_rise','first_last_frame'
  duration_seconds numeric NOT NULL,
  track text NOT NULL CHECK (track IN ('a_real','b_generated')),
  -- 🔴 A/B 轨治理红线: a_real=真实像素运镜, b_generated=生成式。物理分离,见 §4.7 Storage
  source_meta jsonb NOT NULL DEFAULT '{}',  -- {source_image_url, muapi_task_id, prompt, model, idempotency_key}
  storage_url text NOT NULL,        -- Supabase Storage 永久公开 URL
  aspect_ratio text NOT NULL DEFAULT '9:16',
  usage_count int NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  generation_cost_usd numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived','quarantined')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_vc_pick ON video_clips(client_id, scene_tag, track, status);
```

**B 轨 scene_tag 收敛红线(板桥 #8 修订)**:B 轨(生成式)clip 的 `scene_tag` **只允许**抽象氛围类白名单(常量 `FACTORY_B_TRACK_SCENE_TAGS`,如 `sunset_mood / texture_detail / aerial_abstract / water_reflection`),**具体地标/景点/门店/产品 tag 一律 A 轨实拍**。理由:旅游客户用 AI 生成的"漓江/长城"投广告,游客到现场发现景观失实 = 品牌信任层面的货不对板,比 Meta AI 标注合规更伤客户。校验实现点:worker `complete` handler 的 `new_clips` 入库校验(§6.1)+ strategist 素材选取(§5.1 步骤 5)。

### 4.3 `winner_structures`(② Winner 结构库 · hook/middle/CTA 骨架)

```sql
CREATE TABLE winner_structures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id),
  source_ad_id text,                -- Meta ad id(拆片来源)
  source_work_order_id uuid,        -- 自产成片回流时指向原工单
  entry_channel text NOT NULL DEFAULT 'auto' CHECK (entry_channel IN ('auto','manual_intake')),
  hook_segment jsonb NOT NULL,      -- {clip_id, duration_s, text_overlay, description}
  middle_segment jsonb NOT NULL,
  cta_segment jsonb NOT NULL,
  win_reason_tags text[] NOT NULL DEFAULT '{}',  -- 赢因: 'price_hook','scenery_first','urgency_cta'
  performance jsonb NOT NULL DEFAULT '{}',
  cost_per_thruplay numeric,        -- 提列常用指标便于排序
  ctr numeric,
  budget_share_pct numeric,         -- 预算倾斜占比
  current_frequency numeric,        -- 疲劳追踪(与 P21.F active_ad_winners 概念对齐,见 §10)
  times_reused int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','fatigued','retired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ws_pick ON winner_structures(client_id, status, cost_per_thruplay);
```

**历史 winner 手工录入路径(魏征 F11 / 板桥 #2 修订,明确唯一路径)**:非自产历史 winner(如 Reborn)由 FDE 通过 **`ME Factory Ops` 内部 Airtable base 的 `Winner Intake` 表单**录入(hook/middle/cta 三段描述 + 赢因 tag + 表现数字),`factory-review-sweeper`(§7.2)顺路拉取入库,`entry_channel='manual_intake'`。**FDE 全程不碰 Supabase Studio、不跑 SQL** —— 符合 CLAUDE.md「FDE 配置类数据必须有 UI」强约束。M2 验收项含此表单跑通。

### 4.4 `content_work_orders`(工单 · 兼 job queue)

```sql
CREATE TABLE content_work_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id),
  signal_id uuid REFERENCES content_demand_signals(id),
  goal_id uuid NOT NULL REFERENCES goals(id),               -- ③战略地基只读引用
  master_brief_id uuid NOT NULL REFERENCES master_briefs(id), -- ③战略地基只读引用
  winner_structure_id uuid REFERENCES winner_structures(id), -- 组装骨架(可空=全新角度)
  order_type text NOT NULL CHECK (order_type IN
    ('variant_from_winner','fresh_angle','clip_generation')),
  angle text NOT NULL,              -- 创意角度短语,去重用
  angle_source jsonb NOT NULL,      -- 🔴 正向溯源(板桥 #1): {type:'content_pillar'|'keyword_seed'|'core_proposition'|'winner_structure', ref_id, ref_text}
  rationale_one_liner text NOT NULL, -- 🔴 人话理由(板桥 #4): 模板化生成,贯穿审核卡/工作日志/客户报告
  brief jsonb NOT NULL,             -- worker 完整生产说明(见 §6.2, 含 max_new_clips 硬数)
  budget_cap_usd numeric NOT NULL DEFAULT 2.00,   -- 单工单生成成本上限
  actual_cost_usd numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN
    ('queued','claimed','producing','rendered','in_review',
     'review_rejected','approved','publishing','publish_failed',
     'published','measuring','closed','failed','dead_letter',
     'archived','superseded')),
  claimed_by text,                  -- worker 实例 id
  claimed_at timestamptz,
  heartbeat_at timestamptz,
  attempt_count smallint NOT NULL DEFAULT 0,      -- 仅 worker 主动 fail / 打回重开消耗
  reclaim_count smallint NOT NULL DEFAULT 0,      -- sweeper 超时收回计数,不消耗 attempt(魏征 F10)
  max_attempts smallint NOT NULL DEFAULT 2,
  publish_attempt_count smallint NOT NULL DEFAULT 0, -- 发布重试独立计数(魏征 F2)
  output jsonb NOT NULL DEFAULT '{}',   -- {video_url, caption, utm, segments_json_url, srt_url, publish_intent, redline_hits}
  review_ref jsonb NOT NULL DEFAULT '{}', -- {airtable_record_id, reviewed_at, reviewer_note, reviewer_email}
  reject_category text CHECK (reject_category IN
    ('brand_redline','quality','wrong_angle','budget','other')), -- 结构化打回(板桥 #3/#9)
  reject_reason text,
  published_ad_id text,             -- Meta ad id,回流锚点
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_cwo_queue ON content_work_orders(status, created_at);
CREATE INDEX idx_cwo_client ON content_work_orders(client_id, status);
```

**`rationale_one_liner` 生成规则(板桥 #4)**:按 `signal_type` 模板化填充,**不许 AI 自由发挥**。例(creative_fatigue):「你的王牌广告看腻了(观众平均看到 {frequency} 次),我们用同一套获客结构换了新画面」。此字段三处透出:审核卡(FDE 秒懂)、M3 自动工作日志(格式即以此为主体)、未来客户报告。**模板填不出这句话的工单,strategist 直接 reject —— 说不出人话理由的工单本身就不该做。**

### 4.5 `content_work_order_clips`(工单 ↔ clip 关联)

```sql
CREATE TABLE content_work_order_clips (
  work_order_id uuid NOT NULL REFERENCES content_work_orders(id) ON DELETE CASCADE,
  clip_id uuid NOT NULL REFERENCES video_clips(id),
  segment_role text NOT NULL CHECK (segment_role IN ('hook','middle','cta')),
  position smallint NOT NULL DEFAULT 0,
  PRIMARY KEY (work_order_id, clip_id, segment_role)
);
```

### 4.6 新增:`factory_angle_blocklist` + `factory_balance_ledger` + `clients.brand_redline_phrases`

**角度负面清单(魏征 F4 修订 —— 原稿去重逻辑自相矛盾,已重写)**:

```sql
CREATE TABLE factory_angle_blocklist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id),
  angle text NOT NULL,
  reason text,
  source_work_order_id uuid,
  permanent boolean NOT NULL DEFAULT false,   -- brand_redline 类打回 = true,永不过期
  expires_at timestamptz,                     -- 非 permanent 默认 now()+14d
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_fab_client ON factory_angle_blocklist(client_id, angle);
```

**muapi 成本记账(魏征 F7③ 修订 —— 原稿只有一句备注,现给 schema)**:

```sql
CREATE TABLE factory_balance_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_type text NOT NULL CHECK (entry_type IN ('topup','spend','adjustment')),
  amount_usd numeric NOT NULL,      -- topup 正数, spend 负数
  work_order_id uuid,
  clip_id uuid,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
```
若 M2 spike 确认 muapi 有余额 API 则此表仅作对账镜像;无 API 则此表即余额事实源(充值由 PM 在 ME 后台记一笔 `topup`),护栏 8 逻辑不变。

**品牌红线库(魏征 F3② / 板桥 #2 修订 —— 原稿引用了不存在的数据源,现落地)**:migration 给 `clients` 表加列 `brand_redline_phrases text[] NOT NULL DEFAULT '{}'`,并 **seed CTS 已知红线**(`'Auckland since 1928'` 等,来源:agent memory「CTS 1928 vs NZ 25 年」)。FDE 写入路径 = **复用 `CompetitorDomainsPanel` chip pattern 的 `BrandRedlinesPanel`** + `/api/clients/[id]/brand-redlines` 对称 GET/PATCH,M2 交付。

**claim RPC(魏征 F13 修订)**:`FOR UPDATE SKIP LOCKED` 走 PostgREST 做不到,M1 migration 一并登记 `factory_claim_work_order(worker_id text)` SQL function(SECURITY DEFINER,照抄 `20260626000006_mtc_atomic_deduct_rpc.sql` pattern),杜绝「先 SELECT 再 UPDATE」竞态版本。

**③ 战略地基不建新表**:`goals` + `master_briefs` 只读引用(FK),工厂对它们零写入。

### 4.7 Storage(子牙拍板)

- **Bucket 命名**:单一 bucket **`content-factory`**,路径前缀做物理分离:
  - `clips/a-real/{client_id}/...` — A 轨真实素材
  - `clips/b-generated/{client_id}/...` — B 轨生成素材(**A/B 轨路径分离 = 治理红线的物理实现**,`video_clips.track` 必须与路径前缀一致,**校验实现点 = worker `complete` handler**,见 §6.1)
  - `renders/{client_id}/{work_order_id}/final.mp4` + `segments.json` + `captions.srt`
- 全部 `supabaseAdmin.storage.from('content-factory').getPublicUrl()` 永久公开 URL,复用 `src/lib/visual/storage.ts` pattern。
- **🔴 Dropbox 禁止进自动化链路**(token 4h 过期已两次卡死流程);Dropbox 仅可作人工看片镜像,由人手动放,系统永不读写。

---

## 5. 策略 agent 决策逻辑

**归属**:E 段执行 agent 鲁班名下,新模块 `src/lib/factory/strategist.ts`(纯函数决策核 + handler 内初始化 AI client)。**触发**:`POST /api/factory/signals` 落库后异步触发;`factory-strategist-sweeper` cron(`*/10`)兜底扫 `status='received'` 超 10 分钟的信号。

### 5.1 决策流(顺序执行,任一硬闸不过即 `rejected`)

```
信号 → [闸0 时效+语义去重] → [闸1 战略地基:正向溯源+黑名单+fail-closed] → [闸2 成本]
     → [角度去重] → [骨架选取] → [素材选取+A/B分流] → [rationale 模板生成] → 出工单
```

0. **闸 0 · 时效 + 语义去重(魏征 F6/F15 修订)**:
   - `expires_at < now()` → 信号转 `expired`,不评估;
   - `evidence.ad_id` 已有开放工单(`status NOT IN ('closed','archived','dead_letter','superseded')`)→ reject `duplicate_open_order`。
1. **闸 1 · 战略地基硬闸(只读,魏征 F3 + 板桥 #1 修订 —— 字段名冻结为实库真实列名,黑名单升级为「黑名单 + 正向溯源」双重)**:
   - **正向溯源(主闸,板桥 #1)**:工单 `angle` 必须落库 `angle_source`,指向 `master_briefs.content_pillars / keyword_seeds / core_proposition` 的**具体条目**(`ref_text` 存原文)或 `winner_structures` 来源。**溯源不到 → reject `angle_not_traceable`**。`fresh_angle` / `new_campaign`(编造风险最高的两类)强制 `angle_source.type ∈ {content_pillar, keyword_seed, core_proposition}` —— 这才是「绝不凭空注入客户业务数据」的机器化执行:两次历史事故(CTS inbound 假设 / Oztop 编品类)都不是撞黑名单,是编了 brief 里不存在的方向,**黑名单永远列不全没发生过的编造,只有正向溯源防得住**;
   - **黑名单(副闸)**:master_brief 判定 `status='active'`(兼容双轨旧行:`status IS NULL AND is_active=true`);avoid 源 = **`excluded_topics`**(实库真实列,20260611 migration);品牌红线源 = **`clients.brand_redline_phrases`**(§4.6,实表实列);命中任一 → reject;
   - `goals` 存在 `status='active'` 且 intent 与广告支柱相关的 Goal;工单必须挂上 `goal_id`;
   - **🔴 fail-closed 明文规定(魏征 F3③)**:闸 1 引用的任何字段缺失、查询异常、返回空 → **一律 reject**(`reject_reason='gate_data_unavailable'`+ digest 告警),**绝不放行**。查不到红线 ≠ 没有红线;
   - 找不到 active brief 或 goal → reject `no_active_brief_or_goal` + digest 告警。
2. **闸 2 · 成本护栏(魏征 F7 修订 —— 报账制改预扣制)**:
   - strategist 在此闸算好 **`max_new_clips` 硬数**写进 brief(预估成本 = max_new_clips × $0.225 + 10% margin ≤ `budget_cap_usd` 默认 $2.00);worker 端提交 muapi 前**本地强制 check 已提交数 < max_new_clips**,超即自行 abort —— **预扣制**;heartbeat 的 `abort:true`(§6.1)降级为第二道防线;
   - **余额停机**:决策前查余额(muapi API 或 `factory_balance_ledger` 结余,§4.6),低于 `FACTORY_MIN_BALANCE_USD`(默认 $10)→ 全客户停发新工单,`reject_reason='balance_low'` + Resend 即时告警;
   - **客户日上限**:单客户每日新工单 ≤ 3、日生成成本 ≤ $5(常量 `FACTORY_DAILY_ORDER_CAP` / `FACTORY_DAILY_COST_CAP_USD`);
   - **M2 spike 必答题**:muapi 按提交计费还是按成功计费、失败任务是否扣费 —— 直接决定重试成本模型,答案回写本节。
3. **角度去重(魏征 F4 修订 —— 原稿「排除 archived」与打回闭环自相矛盾,已反转)**:查该客户近 14 天**全部**工单 `angle`(**包含** `review_rejected` / `archived` —— 打回记录正是最强负样本)+ `factory_angle_blocklist`(含 `permanent=true` 的品牌红线类,永不过期),语义重复 → 换角度;同时对齐 P21.F 防撞逻辑 —— 角度撞当前 `winner_structures(status='active')` 题材且该 winner `current_frequency ≤ 2.5` → 不做;`> 2.5` → 解锁(续命场景);另读 `client_learned_preferences.rejected_creative_patterns` 作软性负向信号(板桥 #3)。
4. **骨架选取**:`request.reuse_winner_structure=true` → 取 `winner_structures` 中 `status='active'`、按 `cost_per_thruplay asc` 排序的最优骨架;`fresh_angle` → 不挂骨架,brief 里给三段式默认模板(hook ≤3s / middle 6-9s / CTA 3s + endcard)。
5. **素材选取 + A/B 轨分流**:
   - 按 `scene_tag` 匹配角度,`order by usage_count asc, last_used_at asc nulls first`(冷素材优先,防审美疲劳);
   - **A/B 轨路由红线**:brief 里涉及真实产品/门店/实拍人物/具体地标的段 → 只允许 `track='a_real'`;B 轨仅限抽象氛围白名单 `FACTORY_B_TRACK_SCENE_TAGS`(§4.2,板桥 #8);
   - 库存不足 → 在同一工单 brief 里附 `clip_generation_plan`(源图 + prompt + 运镜 + **`idempotency_key` = `{work_order_id}:{segment_role}:{position}`**,魏征 F10③:重试先按 key 查 `video_clips.source_meta`,命中则复用不重烧 $0.225);
6. **rationale 生成 + 出工单**:按模板生成 `rationale_one_liner`(§4.4);写 `content_work_orders`(status `queued`)+ `content_work_order_clips` + 回填 `signal.work_order_id`,信号转 `accepted`。

### 5.2 护栏总表(实现时逐条对照,一条都不能少)

| # | 护栏 | 实现点 |
|---|---|---|
| 1 | 只从已批准素材库取材(`video_clips.status='active'`) | strategist 查询条件 |
| 2 | **角度正向溯源到 master_brief 具体条目,溯源不到 reject** | 闸 1 主闸 + `angle_source` NOT NULL |
| 3 | 黑名单副闸:`excluded_topics` + `clients.brand_redline_phrases`(实库真实列) | 闸 1 |
| 4 | **闸 1 fail-closed:字段缺失/查询异常一律 reject** | 闸 1 |
| 5 | active Goal 硬闸,工单必挂 goal_id | 闸 1 + NOT NULL FK |
| 6 | A/B 轨治理:实拍/地标必 A 轨,B 轨限抽象氛围白名单;存储路径物理分离 | 闸 5 + §4.7 + complete handler |
| 7 | 14 天角度去重**含打回/归档工单** + blocklist(红线类永久) + 防撞 active winner | 步骤 3 |
| 8 | 单工单生成成本上限 $2,**预扣制**(brief 下发 max_new_clips 硬数,worker 提交前本地 check) | 闸 2 + worker |
| 9 | 客户日上限:3 工单 / $5 | 闸 2 |
| 10 | 余额 < $10 全线停机 + 告警(API 或 ledger 记账) | 闸 2 + §4.6 |
| 11 | **同一 ad_id 只允许一张开放工单**(语义去重,拦内外双源) | 闸 0 |
| 12 | **人工审成片 = 发布前唯一且必经关卡**,无任何旁路;审核人白名单校验 | §7 状态机 |
| 13 | **发布预算绝对硬顶**:日 ≤ `FACTORY_MAX_DAILY_BUDGET_USD`($15)、总 ≤ `FACTORY_MAX_TOTAL_SPEND_USD`($50),超限钳到上限并在审核卡标注 | §8.1 |
| 14 | **发布幂等**:publish_intent 先落库,重试先查 Meta 侧再决定建不建 | §8.1 |
| 15 | caption + text_overlay 成片级红线复扫,命中在审核卡标红 | §6.1 complete |
| 16 | worker 上传 URL 前缀强校验 + client 白名单 + track/路径一致性 | §6.1 |
| 17 | 客户可见界面只出现封装名(Video Studio / Edit Engine),不裸露 supabase 域名 | UI 层 + §7.1 |
| 18 | 所有指标数字只来自 `meta_ads_snapshots` / Graph API,禁止 AI 编造 | strategist prompt + 落库校验 |
| 19 | 每工单必有模板化 `rationale_one_liner`,生成失败即 reject | 步骤 6 |

---

## 6. 生产 worker 接口(v1 本地 Mac)

**架构拍板**:v1 生产 worker 跑在本地 Mac(OpenMontage 在 `~/Documents/OpenMontage`,渲染本地零成本),ME 只做编排。`content_work_orders` 表即 job queue,不引入新队列组件 —— 复用 ME 现有「API 后台异步 + sweeper 兜底」模式,理由:量级(日 ≤3 单)完全不需要真队列,少一个依赖少一个故障面。

### 6.1 Worker API(`src/app/api/factory/worker/`)

鉴权(魏征 F9 修订):专用 env `FACTORY_WORKER_TOKEN`(Bearer),**不复用** `INTERNAL_API_KEY` —— 本地 Mac 泄露面大,专 token 可独立轮换;worker 不持有 Supabase service-role key。**追加三道收权**:
1. **client 白名单**:env `FACTORY_WORKER_CLIENT_IDS`(v1 = CTS only),claim 只发白名单客户工单;
2. **上传 URL 前缀强校验**:`complete` 的三件套 URL 必须前缀匹配 `content-factory/renders/{client_id}/{work_order_id}/`,`new_clips` 的 `storage_url` 必须前缀匹配 `clips/{a-real|b-generated}/{client_id}/` 且与 `track` 字段一致 —— **任意外部 URL 一律拒**(校验实现点 = complete handler,这是审核流/素材库注入面的正门);
3. 本条触碰安全核心,**实施后按审查矩阵补狄仁杰攻击验证**。

| Endpoint | 方法 | 契约 |
|---|---|---|
| `/api/factory/worker/claim` | POST | 调 `factory_claim_work_order` RPC(`FOR UPDATE SKIP LOCKED`,§4.6)认领最老 `queued` 工单,置 `claimed` + `claimed_by/claimed_at`;响应含完整 brief(含 `max_new_clips` 硬数)+ clip URL 清单 + **Storage signed upload URLs**(成片/segments/srt 三个) |
| `/api/factory/worker/[id]/heartbeat` | POST | 刷 `heartbeat_at`;body 可带 `{stage, cost_so_far_usd}`,实时累计 `actual_cost_usd`(超 cap 返回 `abort:true` —— 第二道防线,第一道是 worker 本地 max_new_clips 预扣 check) |
| `/api/factory/worker/[id]/complete` | POST | body `{video_url, segments_json_url, srt_url, caption, actual_cost_usd, new_clips:[...]}`;**先跑 F9 前缀/track 校验 + 红线复扫**(下述),通过才置 `rendered`,新 clip 批量入 `video_clips`(带 idempotency_key);随后自动转 `in_review` + 推 Airtable(§7) |
| `/api/factory/worker/[id]/fail` | POST | body `{error, retryable}`;retryable → `queued` + `attempt_count+1`;不可重试或超 `max_attempts=2` → `dead_letter` + digest 告警 |

**成片级红线复扫(板桥 #7 修订)**:`complete` handler 对 `caption` + brief 全部 `text_overlay` 跑 `clients.brand_redline_phrases` + `excluded_topics` 词面扫描 —— 闸 1 只扫过「角度」层,而「Auckland since 1928」这类真实红线恰恰是**文案级措辞**问题。命中**不自动打回**(避免误杀),但写入 `output.redline_hits`,审核卡标红「含疑似红线词:XXX」,让人审有的放矢而不是靠肉眼扫全片。

**心跳纪律与误判防御(魏征 F10 修订)**:
- worker 每 60s heartbeat;`factory-worker-sweeper` cron(`*/5`)把 `heartbeat_at` 超 10 分钟的 `claimed/producing` 工单收回 `queued`;
- **sweeper 收回记 `reclaim_count+1`,不消耗 `attempt_count`** —— Mac 合盖睡眠是「超时」不是「失败」,原稿两次睡眠即 dead_letter 是误判;`reclaim_count ≥ 5` 才升 digest 告警(症状:机器长期不在线);
- **离线报警器**:daily digest 加两条 —— `queued` 工单积压 > 2 小时;全局无任何 heartbeat > 6 小时(产线停摆不能靠 3 天后看积压才发现);
- **dead_letter 人工复活路径**:ME 后台工单列表(M2 极简版)提供「重置回 queued」按钮(attempt 清零,FDE 可用,不碰 DB);
- **clip 生成幂等**:重试 claim 到同一工单时,worker 按 brief 里的 `idempotency_key` 先查已入库 clip,命中直接复用(§5.1 步骤 5)。

### 6.2 Worker 侧生产现实约束(brief 契约必须承载)

```jsonc
// content_work_orders.brief 结构
{
  "segments": [
    {"role":"hook","clip_id":"uuid|null","clip_generation":{"source_image_url":"...","prompt":"...","motion":"push_in","idempotency_key":"wo123:hook:0"},"duration_s":3,"text_overlay":"..."},
    {"role":"middle","clip_id":"uuid","duration_s":8,"text_overlay":"..."},
    {"role":"cta","clip_id":"uuid","duration_s":3,"text_overlay":"..."}
  ],
  "max_new_clips": 4,          // 闸 2 预扣硬数,worker 提交 muapi 前本地强制 check
  "brandkit":"cts",            // OpenMontage brandkit + endcard
  "caption_directive":{"tone":"...","must_include":[],"utm":{...}},  // 见 §8.2
  "output":{"ratio":"9:16","max_duration_s":15}
}
```

- **裁剪顺序铁律**:源图必须**先裁 9:16 再喂** muapi Kling 2.1 720p I2V($0.225/条,5s,产出后可裁 3s)—— 已实测,顺序反了出片构图报废;
- 剪辑走 OpenMontage segments JSON + brandkit + endcard,本地渲染;
- 成片、segments JSON、srt 三件套用 claim 时下发的 signed URL 直传 `content-factory` bucket;**segments JSON 必须回传** —— 它是 §8.4 winner 自动拆片的零成本前提。

---

## 7. 人工审核流(唯一人工关卡)

### 7.1 界面拍板:v1 用独立内部 Airtable base(魏征 F5 / 板桥 #5 修订)

**单一推荐:新建独立 Airtable base `ME Factory Ops`(仅 ME 内部协作者白名单),含 `Factory Review` + `Winner Intake` 两张表。** 原稿放 CTS 日常内容 base 的方案**作废** —— 那个 base 协作者名单可能含非 FDE 甚至客户侧人员,而「通过」字段的语义是「确认花真金白银」,一次误触/一个越权协作者 = 未授权投放;且内部预算标注、打回意见原文若客户可见即裸奔。保留 Airtable 路线的原理由不变:①FDE 已有 Airtable 日常习惯,行为迁移成本低;②ME 审核页从零 3-4 天,Airtable 镜像半天;③是「中期 Airtable↔ME 同步」的天然第一步。

字段(**人话化命名**,板桥 #5):`编号`(工单短 id)/ `客户` / `为什么做这条`(= `rationale_one_liner`,板桥 #4)/ `成片`(**Attachment 字段** —— API 写入 URL 后 Airtable 自动抓取,**卡片内直接播放**,不用逐条开标签页,且客户即便看到也不见 supabase 域名;板桥 #6)/ `画面来源标注`(逐段标注哪些段为「Video Studio 生成」,FDE 知道重点核真实性;板桥 #8)/ `疑似红线提示`(`output.redline_hits`,有则标红;板桥 #7)/ `Caption` / `投放预算`(如 "$10/天 × 3 天,总 $30")/ `状态`(单选:待审/通过/打回)/ `打回类型`(单选:品牌红线/画面质量/角度不对/预算不对/其他;板桥 #3)/ `打回意见` / `修正预算`(仅「预算不对」用;板桥 #9)/ `系统已收到`(ME 回写回执;板桥 #6)。

### 7.2 同步机制

- ME → Airtable:工单转 `in_review` 时经 Airtable REST 建 record,`record_id` 存 `review_ref`;
- **🔴 写失败不许静默(魏征 F12 修订)**:Airtable record 在这里不是锦上添花,是审核流**唯一入口**,写失败 = 成片永远没人看到。显式区分两类写:「写回类(可丢,沿 `.catch()` 惯例)」vs「**流程类(不可丢)**」—— 本处属后者。`factory-review-sweeper` cron(`*/5`)加一条:扫 `in_review` 且 `review_ref.airtable_record_id` 为空 / 建卡超 30 分钟的工单 → 重推 Airtable;连续 3 次失败 → digest 告警;
- Airtable → ME:同一 sweeper 轮询 `状态` 字段变更(v1 不做 webhook,5 分钟延迟可接受);读到变更后**回写 `系统已收到` 回执字段**(FDE 有确认感,板桥 #6);
- **审核人鉴权(魏征 F5 修订)**:sweeper 取 record 的 last modified by(Airtable API 可取),**必须 ∈ env `FACTORY_REVIEWER_EMAILS` 白名单**,否则不执行状态变更 + digest 告警「非白名单人员操作审核字段」;
- **无人审提醒**:`in_review` 超 24h 无人动 → digest/Resend 提醒,否则 §1 的 72 小时成功标准会卡死在「没人知道有片要审」(板桥 #6)。

### 7.3 过/打回状态机

```
in_review ──通过──→ approved ──→ publishing ──→ published(§8)
    │                               └─失败─→ publish_failed(§8.1,独立收敛,不回生产线)
    │
    └─打回──→ review_rejected ──按「打回类型」分流:
        ├─ 预算不对: sweeper 读「修正预算」→ 过绝对硬顶钳制 → 更新工单预算 → 回 in_review
        │            (不重开生产、不消耗 attempt —— 片子没问题只是钱不对;板桥 #9)
        ├─ 品牌红线: 旧工单 → archived;angle 写入 factory_angle_blocklist(permanent=true);
        │            digest 提醒 FDE 到 BrandRedlinesPanel 把该措辞固化为红线词(板桥 #3)
        ├─ 画面质量/角度不对(有意见且 attempt < max):
        │            旧工单 → superseded;复制新工单(brief 注入 revision note)→ queued
        └─ 其他/超 attempt: → archived;angle 进 blocklist(14 天)
```

- **「通过」的语义 = 同时确认成片质量 + 确认按工单标注的预算花钱**。这样既满足「人只审成片」(决策 2),又满足 P21.F 的 PM 强约束「boost = 花钱必须人工 confirm」;**且 v1 通过 `FACTORY_MAX_TOTAL_SPEND_USD = $50` 绝对硬顶保证单次确认的风险上界 —— 任何工单总预算不可能超 $50;未来若上调硬顶,超 $50 的工单强制走 ME 端二次确认,不能只靠 Airtable 单选**(魏征 F5③);
- **终态语义(魏征 F4③)**:`superseded` = 被重开工单取代;`archived` = 彻底放弃。二者都进 14 天角度去重窗口(§5.1 步骤 3 不排除它们);
- 所有打回的 `reject_category` + 意见 tag 经每周 `agent-learning-rollup` 回灌 `client_learned_preferences.rejected_creative_patterns`(§2,板桥 #3)—— 打回不是短期记忆,是负样本资产。

---

## 8. 发布与回流

### 8.1 发布路径(`src/lib/factory/publisher.ts`)

`approved` 后由 `factory-publisher` 逻辑执行(sweeper 内联,不单开 cron):

- `creative_fatigue` / `scale_winner`:在信号指向的既有 `target_campaign_id`/adset 下**新建 Ad**(上传视频 → AdCreative → Ad),不动 campaign 结构;
- `new_campaign`:复用既有 `boostPagePost()` 链(Campaign → AdSet → AdCreative → Ad,REACH,AU/NZ 受众,`src/lib/meta/client.ts`);
- **预算护栏(魏征 F1 修订 —— 原稿引用 ±20% guardrail 对新建 Ad 数学上不成立,已替换)**:实仓 `checkBudgetWithinSafeRange()` 语义是「相对现有日预算 ±20%」且 current≤0 恒 false —— 新建 Ad 没有 current,套用它要么恒阻塞要么恒放行。**新建 Ad 场景改绝对硬顶**:`FACTORY_MAX_DAILY_BUDGET_USD`(默认 $15)+ `FACTORY_MAX_TOTAL_SPEND_USD`(daily × duration,默认 $50);信号 `request.daily_budget_usd` 一律视为 hint,超限**钳到上限**并在审核卡预算字段标注「已按系统上限调整」。±20% guardrail 仅保留给未来「调整既有 Ad 预算」场景;
- **发布幂等 + 失败收敛(魏征 F2 修订)**:发布是三步远程调用,任何一步失败/超时都不能变成双花钱:
  1. 发布前先在 `output.publish_intent` 落库(含 creative/ad name = `wo_{id_short}`、预算、target ids)—— **intent 先于动作**;
  2. 任何重试**先按 name / `utm_content=wo_{id_short}` 查 Meta 侧是否已存在**,存在则只回填 `published_ad_id` 不重建(堵最险的 crash 窗口:Meta 已建 Ad 但 id 未落库);
  3. 失败 → **`publish_failed`**(独立于生产 `failed`),`publish_attempt_count+1`;`factory-worker-sweeper` 同时扫超 15 分钟的 `publishing`(僵死)转 `publish_failed`;重试超 `max_attempts` → `dead_letter` + digest 告警,不无限重试;
- 鉴权:既有 `META_SYSTEM_USER_TOKEN`(System User 长效 token,SOP 已有);
- 发布成功 → `published_ad_id` 回填 + 写 `flywheel_actions`(`flywheel='ads'`, `action_type='ads.launch_creative'`, `vendor='meta'`, payload 带 `work_order_id` + `rationale_one_liner` + before/after,沿用 execute route 审计模式)。

### 8.2 UTM 规范(沿用 CTS 既有拍板,不新造)

- 落地页:**一律引 china-tours 主列表**,不绑单团详情页(PM 已拍板);
- `utm_source=facebook&utm_medium=paid&utm_campaign={campaign_slug}&utm_content=wo_{work_order_id_short}` —— `utm_content` 带工单短 id,归因粒度到条,**同时兼任发布幂等锚点**(§8.1)。

### 8.3 表现回流(魏征 F14 修订 —— 单一事实源)

- **唯一数据链**:既有 `meta-ads/sync` → `meta_ads_snapshots`。新增 cron **`factory-performance-daily`**(`30 6 * * *`)**从 `meta_ads_snapshots` 读**(不直打 Graph API,避免双链路重复消耗 rate limit + `flywheel_metrics` 双计),按 `published_ad_id` 取 ad-level 数据写 `flywheel_metrics`(`ads.factory.{ctr,cost_per_thruplay,cpl,spend,frequency}` —— 此前缀仅用于工厂自产 ad,与既有 `seo.ga4.*` 等前缀互不重叠,下游聚合以 `ads.factory.*` 为工厂口径唯一来源);
- **前置 spike(M3 第一天)**:验证 `meta_ads_snapshots` 是否已含 ad-level 粒度;缺则先给既有 sync 补粒度,仍保持单链路,**不允许 factory cron 自开旁路直打 Graph API**;
- **时间线(魏征 F8 修订 —— 原稿 3 天/14 天/判定窗口三者打架,现画清)**:
  - `published` → 投放期(`duration_days`,默认 3 天)内每日回流,状态 `measuring`;
  - 投放期结束 + 1 天数据缓冲 → 跑 winner 判定(§8.4)→ 写 `flywheel_outcomes` → 转 `closed`。**取消原稿的 14 天 measuring 窗口**(3 天投放 + 11 天零花费只会稀释指标);入库 winner 的长期表现由 `winner_structures.current_frequency` 持续回流追踪,与工单生命周期解耦;
- **卡死防御(魏征 F15② 修订)**:FDE 在 Ads Manager 手动关/删 ad 后 insights 拉不到 → `measuring` 工单连续 3 天无数据,用已有数据强制结算转 `closed`(`flywheel_outcomes.note='ad_removed_externally'`),回流不缺席,memory 层拿得到 outcome。

### 8.4 Winner 自动拆片入库(触发条件)

投放期结束后判定,**v1 阈值(魏征 F8 修订 —— spend 绝对值 $30 恰好压默认总预算线,Meta 欠花 5-10% 常态下永不触发,改相对制)**:

```
spend ≥ total_budget × 0.8  AND  ctr ≥ 0.012  AND  (cost_per_thruplay ≤ 0.03 OR cpl ≤ baseline × 0.8)
```

(阈值为工程常量 env `FACTORY_WINNER_*`,标注开放项:待与 CTS Meta Ads 窗口用真实账户 baseline 对齐;跑满 10 条工单后用真实分布校准。样本少期间宁严勿松 —— 少入库不误入库。)

- 达标 → **零成本自动拆片**:自产成片的 `segments.json` 就是装配配方,直接按 hook/middle/cta 三段生成 `winner_structures` 行(段内挂 `clip_id`),表现数据 + AI 打赢因标签(`win_reason_tags`,Strategy Engine 短 prompt;**赢因 tag 仅描述结构,表现数字一律取自 snapshots,AI 不碰数字**);这就是「拆片入库」不需要视觉分析的原因 —— **我们留着图纸,不需要逆向工程**;
- 非自产的历史 winner(如 Reborn)v1 由 FDE 经 **`Winner Intake` Airtable 表单**录入(§4.3,不碰 DB),不做自动视觉拆解(v2 再议);
- 已入库 winner `frequency > 2.5`(来自回流)→ `status='fatigued'` + **工厂内部自发一条 `creative_fatigue` 信号**(dedupe_key 拼法与外部方共用同一规范,§3.3 第⑤条;且必过 §5.1 闸 0 语义去重 —— 若外部工作流已对同一 ad 发过信号且工单开放,内部信号被拦,不双开)—— 闭环咬合点。

---

## 9. 分期交付(M1/M2/M3,每关 PM 验收不过不往下 —— 继承 Phase 12 强约束)

| 里程碑 | 范围 | PM 能看见什么(验收标准) | 预估 |
|---|---|---|---|
| **M1 地基** | migration:7 表 + `clients.brand_redline_phrases` 列(seed CTS 红线)+ claim RPC + `content-factory` bucket(**一次 PM 拍板 apply**);`POST /api/factory/signals`;strategist 全闸(0/1/2 + 溯源 + fail-closed)+ 工单生成 | ①Supabase 后台看到 7 张新表;②手工 POST 一条模拟 fatigue 信号 → `content_work_orders` 出现一条带完整 brief + `angle_source` 溯源 + 人话 `rationale_one_liner` 的工单;③POST 一条撞 CTS 品牌红线的信号 → `rejected` + 人话 reject_reason;④POST 一条**溯源不到 brief 条目**的 new_campaign 信号 → `rejected('angle_not_traceable')`;⑤对同一 ad_id 连发两条信号 → 第二条 `rejected('duplicate_open_order')` | 1 周 |
| **M2 生产线** | 本地 worker(claim RPC/heartbeat/complete/fail + 预扣 check + URL 前缀校验 + 红线复扫)+ muapi + OpenMontage 接入;**独立 base `ME Factory Ops`**(Factory Review + Winner Intake)+ 双向 sweeper + 审核人白名单;`BrandRedlinesPanel` chip UI + API;dead_letter 复活按钮;**muapi 计费模式 + 视频上传权限双 spike(开工第一天)** | ①PM 在 Airtable 看到一条真实 CTS 成片(**Attachment 卡片内可直接播放**、9:16、brandkit、endcard)+ 人话理由 + 生成段标注 + 预算标注;②点「打回·画面质量」写意见 → 工单转 `review_rejected` 且重开工单 brief 里有该意见;③点「打回·预算不对」填 $5 → 工单**不重生产**、预算更新回 `in_review`;④点「通过」→ `approved` + `系统已收到` 回执出现;⑤**确认 base 协作者白名单**(验收项);⑥在 BrandRedlinesPanel 加/删一条红线词,strategist 下一单生效;⑦Winner Intake 表单录一条 Reborn → `winner_structures` 出现 `manual_intake` 行 | 1.5-2 周 |
| **M3 闭环** | 发布(绝对硬顶 + publish_intent 幂等 + publish_failed 收敛)+ UTM + 回流(读 snapshots 单链路,含粒度 spike)+ winner 判定(相对阈值)+ 内部自发疲劳信号 | ①过审成片真实出现在 CTS Meta 账户($10/天 × 3 天小预算,**PM 显式 go 后才首发**);②投放期内 `flywheel_metrics` 每日有该 ad 数据(`ads.factory.*`);③投放期结束次日跑 winner 判定,达标则 `winner_structures` 出现带 segments 配方的新行;④人为把一次发布打断在中途 → 工单落 `publish_failed`、重试**不产生第二条 Ad**(幂等验收);⑤CTS 工作日志自动记一条,**主体即 `rationale_one_liner` 人话叙事,无「工厂/自动生成」字眼** | 1-2 周 |

---

## 10. 风险与开放问题

| # | 项 | 现状与处置 |
|---|---|---|
| 1 | **信号契约对齐**(最高优先) | §3 为子牙单方提案;M1 开工前必须与「CTS Meta Ads」窗口过一次 §3.3 待对齐清单(现 5 条,含内部信号 dedupe_key 规范)。契约不冻结,M1 只能用模拟信号验收(可接受,不阻塞) |
| 2 | **OpenMontage 上云与否** | v1 本地 Mac = 单点(Mac 关机产线停),PM 已接受。风险缓释(F10 加固后):sweeper 收回超时工单不消耗 attempt、积压/无心跳双告警、dead_letter 一键复活 —— 不丢单只延迟且**停摆当天可见**。迁移路径:Render background worker + ffmpeg 容器化,M3 验收后评估,**不在 v1 范围** |
| 3 | **Airtable↔ME 同步时机** | v1 单向镜像 + 5 分钟轮询 + 流程类写失败重推;双向字段同步、ME 审核页归中期(已有 ROADMAP 登记),触发条件:第二个客户接入内容工厂时 |
| 4 | **winner 阈值标定** | §8.4 相对制阈值(spend ≥ 0.8×总预算)是冷启动值(参考 Reborn CPL $5.50 baseline);跑满 10 条工单后用真实分布校准。**阈值为全局工程常量 env,校准由工程改 env —— 不属 FDE 客户级配置,不触发「必须有 UI」强约束**(见审签记录 F11③) |
| 5 | **Meta 视频广告上传权限** | System User Token 需验证 `ads_management` scope 覆盖 video upload —— **M2 开工第一天做 spike**(与 muapi 计费模式 spike 同批),不通则 M3 前走 Meta App 权限补申请 |
| 6 | **muapi 余额与计费模式** | M2 spike 必答:①有无余额 API;②按提交还是按成功计费、失败是否扣费。无余额 API → `factory_balance_ledger`(§4.6,schema 已给)即事实源,PM 充值在 ME 后台记 `topup`。**已升级为 M2 验收项**,护栏 10 逻辑不变 |
| 7 | **B 轨内容广告合规 + 货不对板** | Meta 对 AI 生成内容的广告标注政策在收紧;B 轨已双重收敛:仅抽象氛围白名单 scene_tag(§4.2)+ 审核卡逐段标注生成来源(§7.1)。发布时按平台要求打 AI 标注,**狄仁杰审此条 + F9 worker 注入面,实施后一并补刀** |
| 8 | **与 P21.F 的表合并** | `winner_structures.current_frequency` 与 P21.F 登记的 `active_ad_winners` 概念重叠。子牙倾向:P21.F 开工时**合并为一张表**(winner_structures 是超集),届时出小 migration;v1 不等 P21.F |
| 9 | **MTC 计费** | FDE 月付轨 v1 不扣 MTC;`brief` 内预留 `mtc_service_key` 占位。self-serve 轨接入时定价(业务决策,届时上 PM) |
| 10 | **社媒渠道扩展** | 工单/素材库/审核流全渠道通用,发布端换 Publer adapter 即可;归 v2,与 P21.F Reel 评分联动 |
| 11 | **打回→红线自动固化** | v1:品牌红线类打回 → blocklist(permanent)+ digest 提醒 FDE 到 chip panel 固化措辞;「自动生成待确认红线条目 + FDE 一键确认」交互归 v2(见审签记录 板桥 #3) |

---

## 审签记录

> 处置规则:P0/P1 必须吸收;P2 可吸收或写明不采纳理由。魏征 15 条:15/15 吸收(其中 F11③ 部分不采纳,理由见下)。板桥 10 条:10/10 吸收(其中 #3 部分延后 v2)。

### 魏征 findings 处置

| # | 级别 | 处置 | 落点 |
|---|---|---|---|
| F1 ±20% guardrail 对新建 Ad 不成立 | P0 | **已修订**:新建 Ad 改绝对硬顶 `FACTORY_MAX_DAILY_BUDGET_USD`($15)/`FACTORY_MAX_TOTAL_SPEND_USD`($50),超限钳到上限 + 审核卡标注;±20% 仅留给未来调整既有 Ad 场景 | §8.1、护栏 13 |
| F2 发布非幂等 + publishing 无失败分支 | P0 | **已修订**:新增 `publish_failed` 状态 + `publish_attempt_count`;publish_intent 先落库;重试先按 `wo_{id_short}` name/utm 查 Meta 再决定建不建;sweeper 扫僵死 publishing;超限进 dead_letter | §8.1、§4.4、M3 验收④ |
| F3 闸 1 字段漂移 + 红线库不存在 + 可能 fail-open | P0 | **已修订**:字段冻结为实库真实列(`status='active'` 兼容双轨 + `excluded_topics`);红线落地为 `clients.brand_redline_phrases`(migration seed CTS 红线)+ M2 chip UI;闸 1 明文 **fail-closed** | §5.1 闸 1、§4.6、护栏 3/4 |
| F4 打回角度去重自相矛盾 | P0 | **已修订**:去重查询**不再排除** review_rejected/archived;新增 `factory_angle_blocklist` 表(红线类 permanent);新增 `superseded` 终态区分「被取代」与「彻底放弃」 | §5.1 步骤 3、§4.6、§7.3 |
| F5 Airtable「通过」= 花钱按钮无 authz | P0 | **已修订**:独立内部 base `ME Factory Ops` + 协作者白名单(M2 验收项);sweeper 校验 last modified by ∈ `FACTORY_REVIEWER_EMAILS` 否则不执行 + 告警 + `系统已收到` 回执;v1 靠 $50 绝对硬顶保证单次确认风险上界,未来上调硬顶时超 $50 强制 ME 端二次确认 | §7.1、§7.2、§7.3 |
| F6 内外双源双工单 | P1 | **已修订**:dedupe 升级为双层 —— 字符串 key 之上加语义闸(同 ad_id 有开放工单即 reject);内部信号 dedupe_key 规范进 §3.3 待对齐第⑤条 | §3.3、§5.1 闸 0、护栏 11 |
| F7 成本事后自报 | P1 | **已修订**:改预扣制 —— brief 下发 `max_new_clips` 硬数,worker 提交前本地强制 check;heartbeat abort 降为第二道;记账 schema 落地 `factory_balance_ledger`,muapi 计费模式列为 M2 spike 必答 + 验收项 | §5.1 闸 2、§6.2、§4.6、风险 6 |
| F8 winner 阈值压线 + 三窗口打架 | P1 | **已修订**:`spend ≥ total_budget × 0.8` 相对制;winner 判定 = 投放期结束 + 1 天缓冲;取消 14 天 measuring 窗口,长期追踪与工单生命周期解耦,时间线画清 | §8.3、§8.4 |
| F9 worker token 全权 + complete 任意 URL | P1 | **已修订**:client 白名单 env + complete 三件套 URL 前缀强校验 + new_clips track/路径一致性校验落点明确为 complete handler;实施后狄仁杰补刀已登记 | §6.1、风险 7 |
| F10 Mac 离线静默 + 睡眠误判 dead_letter + clip 无幂等 | P1 | **已修订**:积压/无心跳双告警;sweeper 收回记 `reclaim_count` 不消耗 attempt;dead_letter 一键复活按钮;clip `idempotency_key` 复用机制 | §6.1、§4.4、§5.1 步骤 5 |
| F11 三处 FDE 配置无 UI | P1 | **①②已修订**:winner 手工录入 = `Winner Intake` Airtable 表单 + sweeper 入库(路径唯一明确);红线库 = `BrandRedlinesPanel` chip UI + 对称 API,M2 交付。**③部分不采纳**:winner 判定阈值是**全局工程常量**(env),不是 FDE 在客户级别填的字段 —— CLAUDE.md 强约束的判断标准是「字段被 FDE 工作流读则写入路径必须是 UI」,阈值由工程校准、FDE 不读不写,改 env 属工程操作不属运营碰数据库。若未来阈值需按客户差异化,届时按强约束补 UI | §4.3、§4.6、风险 4 |
| F12 Airtable 写失败静默成孤儿 | P1 | **已修订**:显式区分「写回类(可丢)」vs「流程类(不可丢)」;sweeper 扫无 record_id / 超 30 分钟的 in_review 重推,连续失败告警 | §7.2 |
| F13 claim 需 RPC 未登记 | P2 | **已吸收**:`factory_claim_work_order` RPC 进 M1 migration 清单一次拍板(照抄 mtc_atomic_deduct pattern) | §4.6、M1 范围 |
| F14 回流双链路 | P2 | **已吸收**:factory cron 改从 `meta_ads_snapshots` 读(单一事实源),粒度缺失走补 sync 不开旁路;`ads.factory.*` 前缀边界写明 | §8.3 |
| F15 expired 无执行者 + measuring 卡死 | P2 | **已吸收**:strategist 首步 expires 检查转 `expired`;measuring 连续 3 天无数据强制结算 closed + `ad_removed_externally` | §4.1、§5.1 闸 0、§8.3 |

### 板桥 findings 处置

| # | 级别 | 处置 | 落点 |
|---|---|---|---|
| 1 黑名单防不住编造型跑偏 | 🔴 高 | **已修订**:闸 1 重构为「正向溯源(主闸)+ 黑名单(副闸)」双重 —— `angle_source` NOT NULL 必须指向 master_briefs 具体条目或 winner 来源,溯源不到 reject;fresh_angle/new_campaign 强制溯源 brief 三字段;M1 验收④专测此闸 | §4.4、§5.1 闸 1、护栏 2 |
| 2 FDE 手工录入无 UI + 红线库无落点 | 🔴 高 | **已修订**(与魏征 F11 合并处置):Winner Intake 表单 + BrandRedlinesPanel chip UI,FDE 全程不碰 DB;M2 验收⑥⑦覆盖 | §4.3、§4.6、M2 验收 |
| 3 打回学习闭环缺失 | 🔴 高 | **已修订(主体)+ 部分延后 v2**:①打回原因结构化(`reject_category` 五选一 + 意见);②品牌红线类打回 → blocklist permanent + digest 提醒 FDE 到 chip panel 固化;③全部打回 tag 经 agent-learning-rollup 回灌 `client_learned_preferences.rejected_creative_patterns`,strategist 每轮读取。**延后 v2 的部分**:「自动生成待确认红线条目 + FDE 一键确认」的交互 —— v1 用 blocklist(机器立即生效)+ digest 提醒(人工固化措辞)达成同等防再犯效果,专门的确认交互属锦上添花,登记风险 11 | §4.4、§7.3、§2、风险 11 |
| 4 可解释性缺失 | 🔴 高 | **已修订**:`rationale_one_liner` 一等字段,模板化生成不许 AI 自由发挥,生成失败即 reject;贯穿审核卡/自动工作日志(M3 验收⑤明确格式)/未来客户报告 | §4.4、§7.1、护栏 19、M3 验收⑤ |
| 5 供应商/内部信息泄露面 | 🟡 中 | **已修订**:审核看板改独立内部 base(与魏征 F5 合并);字段人话化(「编号」等);成片走 Attachment 字段不裸露 supabase 域名;客户可见字段禁裸露存储域名写入 §2 对外文案行 | §7.1、§2、护栏 17 |
| 6 看片体验 + 无回执 + 无人审 | 🟡 中 | **已修订**:Attachment 字段卡片内直接播放;ME 回写「系统已收到」回执;in_review 超 24h digest/Resend 提醒 | §7.1、§7.2 |
| 7 成片文案无红线复扫 | 🟡 中 | **已修订**:complete handler 对 caption + 全部 text_overlay 跑红线/excluded 词面扫描,命中不自动打回但审核卡标红「含疑似红线词」 | §6.1、§7.1、护栏 15 |
| 8 B 轨货不对板 | 🟡 中 | **已修订**:B 轨 scene_tag 收敛为抽象氛围白名单 `FACTORY_B_TRACK_SCENE_TAGS`,具体地标一律 A 轨;审核卡逐段标注「Video Studio 生成」 | §4.2、§5.1 步骤 5、§7.1 |
| 9 「通过」捆绑两个决定 | 🟢 低 | **已吸收**:打回类型新增「预算不对」独立分流 —— 只改预算(仍过绝对硬顶)回 in_review 二次确认,不重开生产、不消耗 attempt;M2 验收③专测 | §7.3、M2 验收③ |
| 10 「内容工厂」对老板叙事风险 | 🟢 低 | **已吸收**:对外文案分两层写入 §2 —— 「内容工厂」仅限 ME 内部/FDE 侧;客户可见叙事统一「我们监测到广告疲劳,团队为你更新了创意」;M3 验收⑤明确工作日志无「工厂/自动生成」字眼 | §2、M3 验收⑤ |

---

*— 子牙 · 2026-07-11 · 魏征 15 条 + 板桥 10 条全部处置完毕。下一步:提交 PM 拍板(migration apply + M3 首发投放两个显式 go 点),PM go 后升 v0.2 冻结。*
---

## 附录 A — PM 拍板记录(2026-07-11,spec 定稿后)

1. **开工批准**:PM 批准 P21.J 按本 spec 开工。migration apply / 首发投放仍需逐次显式 go(不变)。
2. **B 轨地标 clip 进广告 — PM 显式接受风险,覆盖板桥 #8 红线**:现有 15 条 Kling 生成地标 clip **允许进付费广告**(PM 原话:「照投,接受风险」)。工程侧保留两道缓冲:①投放时 Meta 后台勾选 AI-generated 标注(平台合规,Meta 对写实类 AI 内容有披露要求);②§4.2 的 B 轨 scene_tag 白名单机制保留,但对 CTS 以客户级配置放开地标类(`allow_b_track_landmark_ads=true`),其他客户默认仍收紧。
3. **Airtable 可视流水线(观测层)已建**:PM 要求"肉眼看到流水线,为 ME 融合做准备"。已在 CTS base `app8Hlx28jAfGabdH` 建 3 张镜像表(字段名=未来 ME 表列名契约,各带「ME 同步 ID」列):📡内容需求信号 `tblN6FsXhvqm7nBiL` / 🏭内容工单 `tblhnHiDXsM9PKsBp`(7 档状态 Kanban = PM 驾驶舱)/ 🏆Winner 结构库 `tbl6XCuNRnlwaCvch`。**分工**:CTS base 3 表=观测镜像;花钱审核闸仍按 §7.1 放独立 base `ME Factory Ops`(M2 建)。
4. **Phase 34.A 对接发现**:spec 定稿同日,PR #542(winner-reel-sync · Meta Pool Builder auto-sync)已合入 main——含疲劳暂停逻辑(CTR < 中位数 × 0.5)+ ads-manager lib + 每日 cron。**§3 信号契约的 `creative_fatigue` 信号源即它**:engine 暂停疲劳 Ad 时应发 `content_demand_signal`。对齐会以两边代码为底稿(工厂侧 §3 + 34.A 侧 `src/lib/winner-reel-sync`)。34.A 的 pause = 腾位,P21.J 的产创意 = 补位,互补不重叠。
