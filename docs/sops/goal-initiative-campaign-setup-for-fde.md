# FDE SOP — Goal / Initiative / Campaign 设置指南

> **谁看这份文档**：FDE（Frontline Deployment Engineer）在新客户 onboarding 或老客户 Goal 重新对齐时使用
> **首次提炼来源**：2026-06-05 CTS Tours NZ + oztop 双客户真实业务架构对齐工作（11 处 DB 调整）
> **核心原则**：先看真实业务，再建结构。结构服从业务，不是反过来。

---

## 1. 三层模型 — 一句话总览

```
Goal（战略目标）
  ├── Initiative（怎么实现这个目标）
  │     └── Campaign（具体推广活动 / 产品系列 / 时段）
  │           ├── Marketing Plan（campaign 下的具体规划）
  │           ├── Social Plan（campaign 下的社媒帖子）
  │           └── Production Package（campaign 下的内容产出包）
```

每层的角色：

| 层级 | 回答什么问题 | 例子（CTS） |
|------|-------------|-----------|
| **Goal** | "客户想达成什么？" | 2026 Best of China 团报名询盘 30 个 |
| **Initiative** | "用什么策略达成？" | Facebook + Google Ads 投放（fast 姿态、70% 预算） |
| **Campaign** | "围绕什么具体产品/时段推？" | Oct 2026 Spotlight — Three Tours |
| **Plan / Post / Package** | "campaign 下具体做什么？" | 36 个 social post + 2 个 marketing plan + 2 个 production package |

---

## 2. 第一步：建 Goal —— 指标选择是关键

### 2.1 主指标必须从这份白名单选

**ME 当前 auto-fetch 支持的 metric_key**（current_value 会自动填，FDE 不用手填）：

| metric_key | 含义 | 数据来源 | 适用 intent |
|-----------|------|---------|-----------|
| `organic_traffic` | 自然搜索流量（28 天 sessions） | GA4 snapshot | awareness, acquisition |
| `brand_search_volume` | 品牌词搜索量（28 天 GSC clicks） | GSC + brand_aliases | awareness |
| `ai_visibility_score` | AI 提及覆盖率（top-3 占比 × 100） | industry AI visibility daily cron | awareness |
| `form_submissions` | GA4 表单提交数 | GA4 conversions | acquisition |
| `leads_count` | 询盘数（hybrid: GA4 + FDE 手填） | GA4 + Submit Verdict | acquisition |

**其他指标（需要 FDE 手填，current_value 永远空）**：

| metric_key | 何时用 |
|-----------|--------|
| `orders_count` | 订单 / 团报名数 —— ME 读不到客户订单系统 |
| `monthly_revenue` | 月营收 —— ME 读不到销售数据 |
| `inventory_units_remaining` | 库存剩余 —— 天生手填 |
| `media_mentions` | 媒体提及次数 —— FDE 跟踪后填 |

### 2.2 指标选择的三条铁律

#### 🔴 铁律 1：选客户真正在乎的指标，不是"ME 能自动填的指标"

**反例（错配指标）**：
> CTS 一开始建了 3 个 Goal：orders_count / brand_search_volume / inventory_units —— 但客户真实诉求是「2026 团报名」和「2027 蓄水」。指标对不上诉求。

**正例**：
> "客户想多卖 Walnut 地板" → 主指标 `monthly_revenue`（接受手填），不是因为方便 auto-fetch 就选 `organic_traffic`。

#### 🔴 铁律 2：auto-fetch 不支持 ≠ 不该选

很多 FDE 一看到「current_value 永远空」就觉得"这个指标不能用"。**错。** ME 的 Goal 是给客户和 FDE 共同看的仪表盘 —— 即便 FDE 每周手填一次，也比"为了能自动填而选不相关指标"强 10 倍。

#### 🔴 铁律 3：指标必须从 master_brief 或 clients 表能溯源

CLAUDE.md 强约束⭐⭐："绝不凭空注入客户业务数据"。建 Goal 前先：
- 查 `master_briefs.{brand_name, core_proposition, target_audience, content_pillars, keyword_seeds}` 拿真实业务方向
- 查 `clients.primary_keywords` 拿 PM 配的真实主关键词
- 不能从对话/记忆/直觉假设

### 2.3 Goal 向导操作要点（针对当前产品 bug 的临时绕过）

**已知 bug（待修）**：Goal 向导 Step 2 的「精确匹配吃掉通用候选」会导致选某些 sub-type 后看不到 organic_traffic 等通用指标。

**绕过办法**：
- Intent = Awareness 时，**选 sub-type「地理扩张 Geographic Expansion」**（这是当前 4 个 awareness sub-type 里唯一没被任何 metric 精确匹配的，会走 fallback 返回全部 4 个候选）
- 然后能看到 brand_search_volume / media_mentions / ai_visibility_score / **organic_traffic** 4 个候选

bug 修复后此绕过作废 —— 届时直接按真实 sub-type 选即可。

### 2.4 Goal Activate 状态的意义

| 状态 | 谁会扫到它 | 何时用 |
|------|----------|--------|
| **draft** | 前端打开 Goal 详情页时 fetch | Goal 还在 review，未确认 |
| **active** | 每日 03:00 UTC cron + 前端 fetch | 正式开始追踪 |
| **archived** | 不进任何 cron / 不显示在主页 | Goal 结束 / 错配 / 被新 Goal 取代 |

⚠️ **draft 不会进每日 cron** —— 想让 ME 无人值守持续刷新 current_value，必须 **Activate Goal**。

---

## 3. 第二步：建 Initiative —— 让 Goal 不再空转

### 3.1 一个 Goal 应该挂 1–5 个 Initiative

- **0 个 initiative** = Goal 只是仪表盘，没有任何战略动作（**这是错的状态**）
- **1 个 initiative** = 单线推进（OK，简单清晰）
- **2–5 个 initiative** = 多管齐下（推荐，覆盖不同 posture / tier）
- **> 5 个** = 太散，考虑合并

### 3.2 Initiative 的关键字段

| 字段 | 含义 | 推荐取值 |
|------|------|---------|
| `initiative_type` | 战略类型 | demand_generation / conversion_optimization / awareness_campaign / reputation_management / unassigned |
| `tier` | 战略层级 | terminal（直接驱动 Goal）/ supporting（辅助）/ structural（基建）|
| `posture` | 推进姿态 | **fast**（短期冲量、高频 burn）/ **slow**（长期蓄水、持续产出）|
| `budget_percent` | 预算占比 | 多个 initiative 总和不必 = 100，可以留空 |
| `campaign_ids[]` | 关联 campaign | 见下节 |

### 3.3 Initiative 命名原则

**好的命名格式**：`{战略动作} — {时间/品类范围}`

- ✅ "Facebook + Google Ads — October 2026 Tours"（清楚说明动作 + 范围）
- ✅ "SEO + Content — China Visa-Free Travel NZ"（清楚说明渠道 + 主题）
- ✅ "2027 Silk Road 提前蓄水"（清楚说明时间 + 战略姿态）
- ❌ "Marketing"（太空）
- ❌ "做点 SEO"（没范围）

---

## 4. 第三步：关联 Campaign —— 挂"具体推广产品"那层

### 4.1 Campaign 才是"真正推广的东西"

CTS 真实业务里"团"在哪？—— 在 campaign 层（`campaign_briefs`）。Initiative 只是"用什么策略"，campaign 才是"围绕哪个具体团/产品系列推"。

**例子**：
- Campaign **"Oct 2026 Spotlight — Three Tours"** = 真实的 3 个 10/11 月发团（Beijing-Xi'an / Shanghai / etc）
- Campaign **"2027 Silk Road Discovery"** = 18 天西安→乌鲁木齐丝路团

挂法（通过 `initiatives.campaign_ids[]` UUID 数组）：

```
Initiative: "Facebook + Google Ads — Oct 2026 Tours"
  campaign_ids: [Oct 2026 Spotlight UUID]

Initiative: "2027 Silk Road 提前蓄水"
  campaign_ids: [Silk Road Discovery UUID]
```

### 4.2 战线拆分原则 ⭐（CTS 案例淬出的核心规则）

**当客户同时跑多条独立战线时（如 CTS 的 2026 + 2027），不要混挂。**

✅ **正确**：每条战线一组（Goal + Initiative + Campaign）

```
🟦 2026 Best of China 战线
  Goal: 2026 团报名询盘
  └── Initiative: Ads (fast/70%)
       └── Campaign: Oct 2026 Spotlight

🟨 2027 Silk Road 战线
  Goal: 品牌搜索量提升（因为本质是 awareness 蓄水）
  └── Initiative: 2027 Silk Road 提前蓄水 (slow)
       └── Campaign: Silk Road Discovery
```

❌ **错误**（这是今晚最初挂错的样子）：
- Ads initiative（标题"Oct 2026 Tours"）→ 挂 Silk Road campaign（时间和系列都对不上）
- SEO+Visa initiative（通用流量）→ 挂 Oct 2026 Spotlight campaign（流量蓄水不该绑具体团）

**判断标准**：Initiative 的标题/动作时间 必须和 Campaign 的产品/时间 匹配。一旦发现不匹配，就是挂错了。

### 4.3 不该挂 Campaign 的 Initiative

不是所有 initiative 都必须挂 campaign：

| 场景 | 挂 Campaign？ | 例子 |
|------|------------|-----|
| 围绕具体产品/团/时段推 | ✅ 必挂 | "Oct 2026 Tours Ads" → Spotlight campaign |
| 通用流量/品类蓄水 | ❌ 不挂 | "SEO + Visa-Free Travel" 是通用流量入口，不绑具体团 |
| 内部基建（迁移、清理） | ❌ 不挂 | "[Migration] Unassigned Backlog" |

---

## 5. 完整流程图（FDE 标准操作）

```
┌──────────────────────────────────────────────────────────────┐
│ 1. 摸底：查 master_brief + clients.primary_keywords         │
│    确认客户真实业务方向、品类、推广产品/团                       │
└──────────────────────────────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────────┐
│ 2. 战线拆分：客户跑几条独立战线？                                 │
│    每条战线一组（Goal + Initiative + Campaign）                  │
└──────────────────────────────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────────┐
│ 3. 建 Goal：每条战线选客户在乎的主指标                            │
│    auto-fetch 支持优先，但不为方便牺牲业务相关性                     │
│    Activate 后才进每日 cron                                       │
└──────────────────────────────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────────┐
│ 4. 建 Initiative：1–5 个，命名清晰，标 posture + tier              │
│    挂到对应 Goal（goal_id）                                       │
└──────────────────────────────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────────┐
│ 5. 关联 Campaign：通过 campaign_ids[] 数组                       │
│    战线必须对齐：initiative 时间 = campaign 时间                   │
│    通用 initiative 不挂 campaign                                  │
└──────────────────────────────────────────────────────────────┘
                          ↓
┌──────────────────────────────────────────────────────────────┐
│ 6. 验证：打开 Goal 详情页确认                                     │
│    - current_value 自动填？（auto-fetch 指标）                    │
│    - Initiative 卡片能展开？关联 campaign 数 ≥ 1？                 │
│    - 看板 / 月报能看到这个 Goal 的进度？                            │
└──────────────────────────────────────────────────────────────┘
```

---

## 6. 错误自查清单

每次建完 Goal 体系后，自查：

- [ ] 主指标是客户**真在乎**的，不是因为"方便 auto-fetch"选的
- [ ] Goal 已 **Activate**（不是 draft）
- [ ] 每个 Goal 下至少有 **1 个 Initiative**（不是空仪表盘）
- [ ] Initiative 命名格式为 `{动作} — {时间/范围}`
- [ ] 标了 `posture`（fast / slow）和 `tier`（terminal / supporting）
- [ ] **多战线客户**：每条战线独立成组，**没有混挂**
- [ ] 围绕具体产品推的 initiative 已**关联 campaign**（campaign_ids[] 不空）
- [ ] Initiative 时间和 Campaign 时间**匹配**（不是 2026 ads 挂 2027 campaign）
- [ ] Goal 的 `fde_reasoning` 字段填了一句话（90 天后回看用）

---

## 7. 真实案例参考（2026-06-05 CTS 调整）

### 调整前（错误状态）
- 6 个 Goal 主指标全错配（orders / revenue / inventory / placeholder）
- 3 个 真活儿 initiative 全挂在已 archived 的 Goal 上（孤儿）
- 4 个 campaign 部分野生（38 个 social post + 3 plan 没归属）
- 5 层执行链路（153 execution_items）跟新 Goal 体系**完全断开**

### 调整后（正确状态）
- CTS 4 个 active Goal：自然流增长 / 品牌搜索量 / AI 可见度 / **2026 Best of China 团报名**
- 2 条独立战线清晰分开：
  - 🟦 2026: 团报名 Goal → Ads initiative → Oct 2026 Spotlight campaign
  - 🟨 2027: 品牌搜索量 Goal → Silk Road 蓄水 initiative → Silk Road campaign
- 通用流量入口：自然流增长 Goal → SEO+Visa initiative（不挂 campaign）

### 关键纠错（指导未来 FDE）
今晚最初挂钩犯了一个**典型错误**：把 "Oct 2026 Ads" initiative 挂到 "2027 Silk Road" campaign 上 —— 时间和系列都对不上。**判断方法**：Initiative 标题里的时间 / 关键词必须和 Campaign 名称对得上，对不上就是挂错。

---

## 8. 相关文档

- [`brand-aliases-setup-for-gsc.md`](./brand-aliases-setup-for-gsc.md) —— brand_search_volume 指标的 brand_aliases 配置
- [`ga4-lead-gen-key-event-setup.md`](./ga4-lead-gen-key-event-setup.md) —— leads_count / form_submissions 指标的 GA4 key event 配置
- [`client-onboarding-access-requirements.md`](./client-onboarding-access-requirements.md) —— 新客户 onboarding 流程
- `ROADMAP.md § 9` —— 2026-06-05 Goal/Initiative/Campaign 业务架构对齐记录
- `CLAUDE.md § 开发约定` —— 强约束⭐⭐「绝不凭空注入客户业务数据」
