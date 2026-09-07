# ME Travel · 团管理模块 + 下单系统 —— 产品与技术方案 v3

**状态**：设计稿 v3。**未建表、未写 migration、未实现代码。**
**风险级**：A（数据库 schema / migration；下单系统另触发鉴权）
**上游需求单**：[`2026-09-08-cts-tour-inventory-and-agent-portal-spec.md`](./2026-09-08-cts-tour-inventory-and-agent-portal-spec.md)
**Repository Fact Gate**：`git fetch origin` 已跑（2026-09-08），`origin/main` = `1ed91a314d836ad3d524a152255f4dd47f39e1f4`

> **v2 → v3 的定性变化**（PM 2026-09-08 连续三次校正）：
> 1. 这是 **ME Travel 版所有客户都用的功能**，不是 CTS 的活。
> 2. 它是**把团当商品卖的下单系统**，不是「库存表」。目前不涉及收付款。
> 3. **当务之急是「团管理模块」**——客户在 ME 后台管理自己的团（价格 / 行程 / 报名人数 / 图片 / 出发时间）。有了它，**广告、社媒、SEO、GEO、做手册**才能随时调用，不用每次去杂乱仓库里翻素材。
> 4. 管道要能装 1 个团也能装 100 个团；**卖几个团是客户的生意，不是我们的范围问题**。

---

## 0. 平台层级判定（me-platform-tier-gate · Full Report · v3）

**结论：L2 · ME 旅游版（`me-travel`）。** PM 2026-09-08 明确定性为「ME Travel 里面的一个功能，所有 Travel 客户都会用到」。

| 块 | 层级 |
|---|---|
| 团管理模块（团 → 出发 → 行程 → 图片）+ 下单系统的领域模型 | **L2 · ME 旅游版** |
| 客户的具体团 / 日期 / 价格 / 名额 / 行程文字 / 图片 / 报名人 | **L4 客户数据** |
| chinatravel 仓 `tours.ts` 的一次性导入器 | **L3 Connector**（可插拔且可缺席） |
| 素材上传 / 视觉打标 / 免登陆上传链接 | **已存在的平台能力，直接复用，不新建** |

- **不是 L1**：换行业测试 ✗。Oztop（建材）没有「出发日期 + 名额」；Roman（地产）房源是唯一件不是容量；Magic Picks（电商）是 SKU 件数不绑人头。
- **够 L2**：换旅游客户测试 ✓。第二家旅游运营商（悉尼入境游批发商 / 邮轮代理）——团 → 多次出发 → 每次有限名额 → 逐日行程 → 图片集 → 直客与同业代理下单，全部成立。
- **禁止包装成「库存智能层」/「Travel Intelligence」**（红线 1）。它是 ME Travel 的**事实底座**，不是一条新智能能力线。
- `me-travel` 已在 [`docs/registry/product-versions.md`](../registry/product-versions.md) 在册，不需新增版本。
- **候选登记：PM 2026-09-08 明确回「跳」，本轮不登记。**

### PM 拍板项

**① 产品边界冲突 —— 必须书面表态，否则「名额 + 订单」不许进 migration**（Codex round-2 复审发现）

[`ME_PRODUCT_DEFINITION.md`](../strategy/ME_PRODUCT_DEFINITION.md) 是最高优先级文档（CLAUDE.md：冲突时以它为准），其中：
- §3.2「ME 不直接负责」**逐字列出**「**旅游库存、正式报价、出票和预订后台**」，要求这些系统继续作为 Source of Truth，ME 只通过 Connector 读事实。
- §3.3「最小保存原则」明令「不应因为『以后也许有用』而复制外部系统的完整……**库存、订单**……数据」。

**冲突的范围没有覆盖全部方案，必须分清**：

| 部分 | 撞不撞边界 | 依据 |
|---|---|---|
| 团管理模块的**内容面**：行程 / 图片 / 卖点 / 价格 / 出发时间 | **不撞** | §3.1 明列 ME 负责「Campaign、Offer、内容、创意、页面……的策略与资产生产」。这就是营销资产 |
| **名额**（`seats_total` + 占用计算） | **撞** §3.2「旅游库存」 | — |
| **订单台账**（`tour_orders`） | **撞** §3.2「预订后台」+ §3.3「订单数据」 | — |

**PM 2026-09-08「这是旅游行业通用需求」定的是层级归属（L2 而非 CTS 特例），没有、也不等于修改这条产品边界。**

**技术现实（不能替 PM 做决定，但 PM 需要知道）**：已实地核对 chinatravel 仓，那是内容站，**没有座位 / 容量 / 订位数据**——今天**不存在**一个可以当 Connector 源的外部订位系统。这是本方案选择自建台账的真实原因。

PM 必须二选一：
- **(a) 显式例外**：确认「客户目前没有独立的订位后台，ME 台账本身就是 Source of Truth」，接受这是 §3.2/§3.3 的一次显式例外，并把范围（仅此客户 / 还是 ME Travel 默认）记进 [`docs/DECISIONS.md`](../DECISIONS.md)。
- **(b) 维持边界**：先接入或搭建一个外部订位系统当 Source of Truth，ME 这边降级成读它的 Connector。

**在 PM 书面答复前，「名额 + 订单」不得进入 migration 实施。团管理模块的内容面不受此条阻塞。**

**② 资金链路**：ME 要不要进代理佣金的资金链路。本方案一律**只记事实不动钱**。

---

## 1. 产品定义（PM 原话拆解）

**ME Travel 的下单系统 —— 把每个出发团当成商品来卖。**

- 有权限的人登录（**ME 管理员统一开账号**：给自己员工开，也给 agent 开）
- 挑团 → 录客人信息（**手工录，或 AI 从往来邮件里抓**）→ **生成订单**
- **收到定金才扣名额**
- 后台看每个团的报名情况和统计

**分两步走**：

| 步 | 内容 | 为什么这个顺序 |
|---|---|---|
| **第一步 · 团管理模块** | 客户在 ME 后台管理自己的团 | 没有「团」这个商品，就没有东西可挑、可下单、可扣名额；而且广告/社媒/SEO/GEO 现在就缺这个数据源 |
| **第二步 · 下单系统** | 账号 + 下单 + 扣名额 + 统计看板 | 依赖第一步 |

---

## 2. 第一步：团管理模块（当务之急）

### 2.1 客户在后台管四件事（PM 列的）

1. **价格和行程**（行程中途可能调整）
2. **报名人数**（每次出发的名额）
3. **行程里的图片介绍**
4. **出发时间**

### 2.2 数据结构

**一个团（商品）→ 挂着它的多次出发 → 挂着它的逐日行程 → 挂着它的图片。**

```sql
-- ① 团 = 商品
CREATE TABLE tour_products (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  title         TEXT NOT NULL,
  summary       TEXT,                       -- 一句话卖点，广告/社媒直接用
  destination   TEXT,                       -- 'china' / 'japan' / 'vietnam'
  duration_days INTEGER CHECK (duration_days IS NULL OR duration_days > 0),

  status        TEXT NOT NULL DEFAULT 'selling'
                  CHECK (status IN ('draft', 'selling', 'retired')),

  -- 外部内容源（一次性导入用）。手工建团时为空 —— 手工是主路径。
  source_kind   TEXT,                       -- 'chinatravel_repo' | NULL
  source_ref    TEXT,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT tour_products_source_key UNIQUE (client_id, source_kind, source_ref),
  -- 复合外键的目标列：让子表能把 (client_id, tour_product_id) 一起校验，见下方
  CONSTRAINT tour_products_client_id_unique UNIQUE (client_id, id)
);

-- ② 每次出发 = 真正的可售单元
CREATE TABLE tour_departures (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  -- 不用单列 REFERENCES tour_products(id)：那样客户 A 的 client_id 配客户 B 的
  -- tour_product_id 也能通过约束。必须用下方复合外键把两列一起钉死。
  tour_product_id   UUID NOT NULL,

  departure_date    DATE NOT NULL,
  departure_city    TEXT,                   -- 展示用，人工填，不进任何键
  duration_days     INTEGER,                -- 覆盖团级默认值（同团不同出发地天数可不同）

  price_amount_minor BIGINT CHECK (price_amount_minor IS NULL OR price_amount_minor > 0),
  price_currency     TEXT CHECK (price_currency IS NULL OR
                       (price_currency = upper(price_currency) AND length(price_currency) = 3)),

  -- 🔴 可空。NULL = 「名额未设定」，**不是 0**。见 §2.4
  seats_total       INTEGER CHECK (seats_total IS NULL OR seats_total >= 0),

  -- 'retired' = 源里已经没有这个出发日期了（§2.6 硬约束 4：标 retired，不删行）。
  -- 只有 open/closed/cancelled 时，导入遇到「团还在但这个出发日期没了」无状态可写。
  status            TEXT NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open', 'closed', 'cancelled', 'retired')),

  source_date_text  TEXT,                   -- 导入时的原文日期串，供人工对账
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT tour_departures_natural_key
    UNIQUE (client_id, tour_product_id, departure_date),

  -- 复合外键：强制这次出发的 client_id 与它所属团的 client_id 一致，
  -- 否则客户 A 的 client_id 搭客户 B 的 tour_product_id 也能建出发团。
  CONSTRAINT tour_departures_product_client_fk
    FOREIGN KEY (client_id, tour_product_id)
    REFERENCES tour_products (client_id, id) ON DELETE RESTRICT
);
ALTER TABLE tour_departures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full" ON tour_departures
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ③ 逐日行程（"具体玩什么"，可调整）
CREATE TABLE tour_itinerary_days (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  tour_product_id   UUID NOT NULL,        -- 复合外键见下，理由同 tour_departures

  day_number        INTEGER NOT NULL CHECK (day_number > 0),
  city              TEXT,
  title             TEXT NOT NULL,
  description       TEXT,
  highlights        TEXT[],                 -- 卖点数组，广告/社媒按条取用

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT tour_itinerary_days_key UNIQUE (tour_product_id, day_number),
  CONSTRAINT tour_itinerary_days_product_client_fk
    FOREIGN KEY (client_id, tour_product_id)
    REFERENCES tour_products (client_id, id) ON DELETE CASCADE
);
ALTER TABLE tour_itinerary_days ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full" ON tour_itinerary_days
  FOR ALL TO service_role USING (true) WITH CHECK (true);
```

**为什么行程挂在「团」上而不是「每次出发」上**：同一个团不同批次玩的一样。**同团不同出发城市行程真的不同时**（例如南岛出发少去一个城市），实践中官网就是把它做成两个独立的团——已实测确认（`china-icons-collection` 与 `china-icons-collection-christchurch` 是两个不同产品）。所以不为这个情况增加一层结构。

**金额一律 `*_minor BIGINT`（分/仙）**，跟已上线的 `me_sale_outcomes.amount_minor` 同一种存法。同一个仓库不许两种钱的存法。

### 2.3 ④图片：**复用已有素材管道，不新建**（铁律 0）

ME 里已经跑着一整套，是做地产房源时建的：

| 已有的东西 | 在哪 | 怎么用到团上 |
|---|---|---|
| 素材库表 `client_assets` | `20260612000001` | 加一列 `tour_product_id`（照 `listing_id` 的既有做法，含"绑定后不可更改"触发器） |
| **免登陆上传链接**（加密令牌，不带明文客户 UUID，fail-closed） | `src/lib/uploads/client-upload-token.ts` | 令牌里加 `tour_product_id` —— **一个团一条链接**（见下方"不能与 `listing_id` 同构"的说明） |
| 上传路由（图 + 视频，200MB，一次 20 个） | `src/app/api/upload/[token]/route.ts` | 不改逻辑，只多认一个归属字段 |
| AI 看图打标（每 2 分钟一轮，出 `vision_metadata` + hook/middle/cta 评分） | `src/lib/assets/vision-analyzer.ts` | 直接受益：传进来的团图自动打标、自动评分「适合做开头/中段/结尾」 |
| 素材来源与归属标记（客户自传 / 官网 / 图库 + 是否核实） | `20260803090000` | **铁律 8 靠它守**：客户真实产品画面只能用客户自己提供的素材 |

**不能与 `listing_id` 完全同构**（Codex round-3 发现）：`UploadTokenPayload` 现在解密出「第二个 UUID」时**固定**当作 `listingId` 返回（`parsePayload` 只看有没有第二段，不看它是什么类型）。团链接和房源链接的载荷形状完全一样（都是 `clientId:第二个UUID`），如果只是简单地把 `tour_product_id` 塞进同一个位置，解密端无法区分这条链接绑的是房源还是团——旧代码会把它当成 `listingId` 返回，写库时要么归错资源、要么因为 `listing_id` 在库里查不到而失败。
必须在载荷里加一段**类型标记**，例如把编码从 `clientId[:listingId]` 改成 `clientId[:kind:resourceId]`（`kind` 取 `'listing' | 'tour'`），`UploadTokenPayload` 相应拆成 `{ clientId, listingId? }` / `{ clientId, tourProductId? }` 两种可辨识形状（或加一个显式 `kind` 字段）。老的纯 `clientId` 与 `clientId:listingId`（无类型标记，视为 `listing`，向后兼容）两种格式必须继续解得出来，`roundTripOk` 与现有单测要覆盖三种载荷（客户级 / 房源级 / 团级）以及"团 UUID 不能被误判成房源 UUID"这条反例。

**这解决的正是 PM 说的那个问题**——「每次都要在一个杂乱无章的仓库里现去找素材」。以后是：**CTS 员工点一条链接把这个团的图传上来 → AI 自动打标 → 做手册/广告/reel 时按团直接调。**

可选增强（v1 不做）：图片再挂到具体某一天（`itinerary_day_id`），做手册时按天配图。先用「团级图片集」跑通。

### 2.4 名额（`seats_total`）必须连录入界面一起做

- 官网源数据 32 个团里**只有 1 个**填了人数上限（实测）。前端那个 `?? 18` 是营销文案默认值，**不是真容量，绝不许拿来当数据**（铁律 8：不凭空注入客户业务数据）。
- 所以 `seats_total` 可空，`NULL` = 「还没设」。
- 界面对 `NULL` 显示「**名额未设置**」+ 一个设置入口，**绝不显示 0**。显示 0 会让员工以为团满了。
- **出发团编辑页必须有可编辑的名额字段**（铁律 8：FDE/客户要填的字段必须连界面一起做完，绝不写「进 Supabase Studio 直填」）。

### 2.5 行程调整的处理

PM 明确「中间可能会调整行程」。而广告 / 社媒 / SEO / GEO 都在引用它，所以：

- 每次改动落一条变更记录（谁、什么时候、改了哪一天、改前改后），复用现有的审计写法。
- **已发布的下游产物不追溯改写**（已投的广告、已发的帖、已导出的手册），但变更记录能让人查到「这条广告是按哪一版行程做的」。
- v1 **不做**行程版本号 / 生效时间 / 多版本并存——没有当前调用方（Scope 闸）。真需要时再加。

### 2.6 一次性导入 chinatravel（CTS 专用加速器，不是主路径）

第二个旅游客户没有那个仓，所以**手工建团是主路径**，导入只是让 CTS 少打一遍字。

- **复用已有通道**：`src/lib/cms/github-client.ts` + `connection-store.ts` 已经在读写该仓（`src/lib/seo-meta/cts-meta-pr.ts` 每周开 PR 改它）。**不许另起一套读法。**
- **已知冲突**：`cts-meta-pr` 会自动改写 `title` 字面量，两个自动化动同一个文件，PR 里要写明先后。
- **源数据的真实情况**（实测更正需求单）：

  | 事实 | 数字 | 影响 |
  |---|---|---|
  | tour 条目 | **32 个**（需求单写 7 个，错） | — |
  | 带出发日期的 | **14 个**，约 **25 个出发团**（需求单写 8 个，错） | 18 个团只能建商品不建出发 |
  | 带人数上限的 | **只有 1 个** | 名额必须人工补，见 §2.4 |
  | 出发城市字段 | **不存在** | 不能进任何键，只能人工填 |
  | `id` 唯一性 | **不唯一**（`tour-jp-sig-1` 用了两次） | 不能当导入键 |
  | `slug` 唯一性 | **不唯一**（`highlights` 同属 japan 和 vietnam） | 必须 `(destination, slug)` |
  | `departureDates` 全是字面量？ | **否**，2 处是计算展开 | 必须 import 模块，正则会静默拿到空 |

- **五条硬约束**：
  1. 导入**只碰内容字段**，**绝不写 `seats_total`，绝不碰任何订单数据**。
  2. 日期解析失败 → 落人工待办，不静默跳过。
  3. 「有 `departureDates` 但解出 0 个」→ 同样落待办。
  4. 源里消失的团 → 标 `retired`，**不删行**。
  5. 「已 retired 但还挂着订单」→ 必须落待办说明「这个团的日期可能改了，X 个订单需要迁移」。
- **禁止 `new Date(<字符串>)`**：实测 `new Date('13 May 2027')` 在 `TZ=Pacific/Auckland` 得 `2027-05-12`、`TZ=UTC` 得 `2027-05-13`。写显式纯函数 + 时区无关单测。
- **人工待办怎么落**：`pm-todo/manual-items.ts` 是**拉取式**的（现算，不是插行）。必须先把异常持久化（建议 `tour_import_issues` 表），再加 `push*Items` 函数 + 新的 `ManualItemKind`。只写「复用 manual-items」实现者会发现无处可插。
- 若做成定时任务，**同一个 PR 内加 `render.yaml` 条目**（铁律 7）并 link 密钥环境变量组。

### 2.7 界面

| 路由 | 干什么 |
|---|---|
| `/dashboard/clients/[id]/tours` | 团列表：标题 / 目的地 / 状态 / 几次出发 / 图片数 / 名额与已订 |
| `/dashboard/clients/[id]/tours/[tourId]` | 团详情：改标题卖点、**编辑逐日行程**、**图片集 + 上传链接**、**管理出发时间与名额价格** |

**三条硬规则**：
1. 读失败**不许渲染成 0 或空**——显示「读不到，不代表没有」。
2. 名额未设置显示「未设置」，**不是 0**。
3. 未标价显示「未标价」，**不是 0**。

### 2.8 RLS

```sql
ALTER TABLE tour_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full" ON tour_products
  FOR ALL TO service_role USING (true) WITH CHECK (true);
```
**必须带 `TO service_role`**（铁律 7）。**同一模板对本方案新建的每一张表都必须单独套一遍，不是只对 `tour_products` 做一次就够**（Codex round-3 发现：v3 曾只给 `tour_products` 挂 RLS，`tour_departures` / `tour_itinerary_days` / `tour_orders` 漏挂，会让这些含出发日期、名额与联系人事实的表绕过隔离）。`tour_departures`、`tour_itinerary_days` 的 `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + `CREATE POLICY` 已内联在 §2.2 各自的 `CREATE TABLE` 语句后；`tour_orders` 与 `travel_agents` 的 RLS 内联在 §5.2。四张表缺一不可，§7 验证表的「RLS：新表用 anon key 实测读写被拒」必须四张表逐一测。

> v2 曾报「现有 CRM 表漏 `TO service_role`」——**已实测生产库（`glbdnayojixmexgofbsd`）确认是误报**，`20260803020000` 早已批量收口，`db-invariants.sql` 不变量 1 在 CI 里守着。不要报给 PM。

---

## 3. 下游怎么调用（PM 点名：广告 / 社媒 / SEO / GEO）

**一个统一读取口，谁都从这里拿，不许各自查库各自解读。**

建议 `src/lib/travel/tour-catalog.ts`，提供：
- 「这个客户在卖哪些团」
- 「这个团的行程、卖点、图（按 hook/middle/cta 评分排序）」
- 「这次出发还剩几个名额、卖没卖完」

| 谁调 | 拿什么 | 今天的问题 |
|---|---|---|
| **广告** | 团名 / 卖点 / 价格 / 出发日期 / 图 | 每次现翻仓库；**团满了没人停广告，钱还在烧** |
| **社媒** | 图 + 逐日亮点 | 做 reel 每次现找素材 |
| **SEO** | 行程文字 / 团页结构化事实 | 官网与 ME 各写一份 |
| **GEO / AI 可见度** | 团的事实（去哪几个城市、几天、多少钱） | AI 被问「新西兰去中国的团」时没有可引用的结构化事实 |
| **做手册** | 行程 + 图 + 价格 | 已有 catalogue 能力，但每次手拼 |
| **下单系统** | 挑团 / 挑出发 / 看剩余 | 还没有 |

**注意**：`tour-catalog.ts` 属 **L2 ME 旅游版共享代码**，里面**不许出现任何客户名 / 客户 ID / 具体团名**（红线 2）。

---

## 4. 与官网的关系（分两步，本方案只做第一步）

- **第一步（本方案）**：官网仍是团内容的真相源，ME 一次性导入 + 之后在 ME 里管理。**两边会漂移**，这是已知代价。
- **第二步（将来，PM 拍板）**：ME 成为真相源，官网读 ME 的接口。好处是官网能显示「仅剩 3 位」、SEO 内容和广告文案同源。代价是要动另一个仓 + 处理缓存与 CDN 刷新。**不在本方案范围。**

---

## 5. 第二步：下单系统（方案深度，暂不实施）

### 5.1 PM 已拍板的四条规则

| 问题 | PM 的答案 | 设计后果 |
|---|---|---|
| 一个订单几个人 | **AI 从订单和往来邮件里判断，人工可改** | 订单存 `pax` 数字 + `pax_source`（`ai` / `manual`）+ 原始依据；AI 判断走已有的邮箱→ME 通道 |
| 谁能开账号 | **ME 管理员统一开**，给自己员工开，也给 agent 开 | 账号发放是管理员动作，不是自助注册 —— 风险面小很多 |
| 什么时候扣名额 | **收到定金才扣** | **不需要占位/超时释放机制**，并发抢位问题基本消失（定金由客户线下收，天然串行） |
| 订单能不能改 | **agent 不能改，找管理员改** | agent 侧只有「建」和「看」，改和取消是管理员权限 |

### 5.2 表结构（草案）

**建表顺序：先 `travel_agents`，再 `tour_orders`**（Codex round-3 复审再次确认的顺序问题）：`tour_orders.agent_id` 引用 `travel_agents`，PostgreSQL 解析外键时目标 relation 必须已存在——`travel_agents` 的 `CREATE TABLE` 必须排在 `tour_orders` 之前，不能只是「同一批 migration」，顺序本身也要对。

拆法：**「代理是谁」的身份台账跟订单一起建；「代理怎么登录」留到门户期**。员工录代理订单时从这张表选或新建一条，不涉及登录。

```sql
CREATE TABLE travel_agents (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  contact_email  TEXT,
  contact_phone  TEXT,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT travel_agents_name_unique UNIQUE (client_id, name),
  -- 复合外键目标列：让订单能把 (client_id, agent_id) 一起校验
  CONSTRAINT travel_agents_client_id_unique UNIQUE (client_id, id)
);
ALTER TABLE travel_agents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full" ON travel_agents
  FOR ALL TO service_role USING (true) WITH CHECK (true);
```
门户期只需给它加一列登录关联（如 `portal_user_id`），不改已有语义，也不用重建。

```sql
CREATE TABLE tour_orders (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  contact_id      UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  departure_id    UUID NOT NULL REFERENCES tour_departures(id) ON DELETE RESTRICT,

  pax             INTEGER NOT NULL CHECK (pax > 0),
  pax_source      TEXT NOT NULL DEFAULT 'manual' CHECK (pax_source IN ('manual', 'ai')),
  pax_evidence    JSONB,                    -- AI 判断的依据（邮件 id / 原文片段），可追溯

  source_channel  TEXT NOT NULL CHECK (source_channel IN ('direct', 'agent')),
  -- 不用单列 REFERENCES：那样客户 A 的订单能引用客户 B 的代理，
  -- B 的代理门户就能查到 A 的订单与联系人。必须走下方复合外键。
  agent_id        UUID,

  -- 🔴 名额的开关。收到定金 = 占名额。ME 不经手收付，这只是"客户说收到了"的事实记录。
  deposit_received_at TIMESTAMPTZ,
  deposit_recorded_by TEXT,
  -- 收款事实本身（金额/币种）必须落在这张表里，不能只落到下游的 me_sale_outcomes——
  -- 联系人没有邮箱/电话时 buildIntakeRow 会拒收（见 §5.4），如果这两列不在这里兜底，
  -- 那笔钱的数字事实就彻底丢了，只剩一个时间戳。见 §5.4「无联系方式收款」的落点设计。
  deposit_amount_minor BIGINT CHECK (deposit_amount_minor IS NULL OR deposit_amount_minor > 0),
  deposit_currency     TEXT CHECK (deposit_currency IS NULL OR
                         (deposit_currency = upper(deposit_currency) AND length(deposit_currency) = 3)),

  status          TEXT NOT NULL DEFAULT 'open'
                    CHECK (status IN ('open', 'cancelled')),
  cancelled_at    TIMESTAMPTZ,
  cancel_reason   TEXT,

  note            TEXT,
  created_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- direct 必须 agent_id 为空、agent 必须 agent_id 非空——只挡"agent 缺 id"这一半
  -- 不够：还得挡"direct 单挂着任意 agent_id"，否则代理门户按 agent_id 收窄查询时，
  -- 一条被塞了别人 agent_id 的直客单会被那个代理读到，泄露订单与联系人。
  CONSTRAINT tour_orders_agent_channel_consistency
    CHECK (
      (source_channel = 'agent'  AND agent_id IS NOT NULL) OR
      (source_channel = 'direct' AND agent_id IS NULL)
    ),

  -- 复合外键：订单的代理必须与订单同一个 client_id。
  -- agent_id 为空时（直客单）按 Postgres 默认 MATCH SIMPLE 不校验，符合预期。
  CONSTRAINT tour_orders_agent_client_fk
    FOREIGN KEY (client_id, agent_id)
    REFERENCES travel_agents (client_id, id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX tour_orders_one_live_per_contact
  ON tour_orders (departure_id, contact_id) WHERE status <> 'cancelled';

ALTER TABLE tour_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full" ON tour_orders
  FOR ALL TO service_role USING (true) WITH CHECK (true);
```

**占用公式（单一定义，不许在别处再写一份）**：
```
occupied(departure) = Σ tour_orders.pax
                      WHERE status = 'open' AND deposit_received_at IS NOT NULL
remaining = seats_total - occupied           -- seats_total 为 NULL 时 remaining 也是 NULL
```
- **不存 `seats_taken` 计数器**。计数器一次漏改就让「还剩几个」开始骗人，而那是这功能存在的唯一目的。
- **占用是三态**：`number | null（名额未设） | 'unknown'（查询失败）`。**绝不把查询失败算成 0**——那会显示成一个看起来完全正常的满仓数字，比空列表更骗人。
- 跨表 `client_id` 一致性必须有触发器保证（否则代理传别的客户的 `departure_id` 就能跨客户写数据）。

#### 5.2.1 并发安全：记定金 / 改人数必须与余位校验同一把锁（Codex round-3 发现）

线下收款不保证串行——两个员工可能同时给同一出发团标定金，管理员也可能在已有定金后调大 `pax`。§5.1 说的「定金由客户线下收，天然串行」只覆盖了「不需要占位超时释放」，**不等于两次并发写入天然互斥**。如果 API 层只是「先 SELECT 算 occupied，再 UPDATE 写定金」，两个并发请求会读到同一个旧 occupied、都判断"没超"、都写成功，`remaining` 就会变成负数——超卖要等前台刷新才会被发现。

**校验和写入必须在同一个数据库事务里，且必须先锁住 `tour_departures` 那一行**，不能只在应用层加锁（多实例部署时应用层锁不跨进程）。落地为两个 `SECURITY DEFINER` 函数，API 层只准调它们，**不许再对 `tour_orders.deposit_received_at` / `pax` 发裸 `UPDATE`**：

```sql
CREATE OR REPLACE FUNCTION record_tour_deposit(
  p_order_id UUID,
  p_recorded_by TEXT,
  p_amount_minor BIGINT,
  p_currency TEXT
) RETURNS tour_orders
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_order      tour_orders%ROWTYPE;
  v_seats      INTEGER;
  v_occupied   INTEGER;
BEGIN
  SELECT * INTO v_order FROM tour_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tour_order_not_found';
  END IF;
  IF v_order.deposit_received_at IS NOT NULL THEN
    RAISE EXCEPTION 'tour_order_deposit_already_recorded';
  END IF;

  -- 锁住出发团这一行：同一出发团的并发定金写入在这里天然排队，
  -- 后到的事务必须等前一个提交/回滚后才能读到最新 occupied。
  SELECT seats_total INTO v_seats
    FROM tour_departures WHERE id = v_order.departure_id FOR UPDATE;

  SELECT COALESCE(SUM(pax), 0) INTO v_occupied
    FROM tour_orders
    WHERE departure_id = v_order.departure_id
      AND status = 'open' AND deposit_received_at IS NOT NULL;

  IF v_seats IS NOT NULL AND v_occupied + v_order.pax > v_seats THEN
    RAISE EXCEPTION 'tour_departure_oversold' USING ERRCODE = 'P0001';
  END IF;

  UPDATE tour_orders
    SET deposit_received_at = NOW(), deposit_recorded_by = p_recorded_by,
        deposit_amount_minor = p_amount_minor, deposit_currency = p_currency,
        updated_at = NOW()
    WHERE id = p_order_id
    RETURNING * INTO v_order;

  RETURN v_order;
END;
$$;

CREATE OR REPLACE FUNCTION update_tour_order_pax(
  p_order_id UUID,
  p_new_pax INTEGER,
  p_updated_by TEXT
) RETURNS tour_orders
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_order      tour_orders%ROWTYPE;
  v_seats      INTEGER;
  v_occupied   INTEGER;      -- 不含本订单自身
BEGIN
  SELECT * INTO v_order FROM tour_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'tour_order_not_found';
  END IF;

  SELECT seats_total INTO v_seats
    FROM tour_departures WHERE id = v_order.departure_id FOR UPDATE;

  IF v_order.deposit_received_at IS NOT NULL AND v_seats IS NOT NULL THEN
    SELECT COALESCE(SUM(pax), 0) INTO v_occupied
      FROM tour_orders
      WHERE departure_id = v_order.departure_id
        AND status = 'open' AND deposit_received_at IS NOT NULL
        AND id <> p_order_id;

    IF v_occupied + p_new_pax > v_seats THEN
      RAISE EXCEPTION 'tour_departure_oversold' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  UPDATE tour_orders
    SET pax = p_new_pax, updated_at = NOW()
    WHERE id = p_order_id
    RETURNING * INTO v_order;

  RETURN v_order;
END;
$$;

REVOKE ALL ON FUNCTION record_tour_deposit, update_tour_order_pax FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_tour_deposit, update_tour_order_pax TO service_role;
```
- `FOR UPDATE` 锁的是 `tour_departures` 那一行，不是整表——不同出发团互不阻塞。
- 未设名额（`seats_total IS NULL`）时不做超卖校验，保持 §2.4「NULL = 未设」的语义，允许无限记录（如实反映"没管起来"，不是我们伪造一个假上限）。
- 两个函数都是 `SECURITY DEFINER`，只 `GRANT` 给 `service_role`，API 路由用它们代替裸 `UPDATE`，行为与 RLS 的 service-role-only 模型一致。

### 5.3 下单系统的前置条件（不满足不开工）

1. 团管理模块上线并有真实数据。
2. **先堵 5 个鉴权放行口**：`/prospect` 分支（middleware 22-33 行无 membership 检查）、`api/mtc/checkout`（**外部账号能对客户账户发起 Stripe 付款**）、`api/mtc/balance`、`api/clients`、`api/onboard/self`（触发计费副作用）——这 5 处查 `client_portal_users` 时**都没有 access_type 过滤**。
3. **鉴权覆盖面**：`src/middleware.ts` 的 matcher **不覆盖 `/api/*`**（仓库自己在 `require-session.ts` 注释里写明）。每个订单 API 必须各自调守卫；新前缀必须进 matcher。
4. 新增 `access_type` 值要同步三处：DB CHECK、`ACCESS_TYPE_VALUES`（有测试断言同步）、`tierForAccessType`。
5. **「agent 只能看自己的客人」是全新授权层**——ME 今天完全没有客户内再按 agent 收窄的能力。不要低估。
6. 单独 PR + 子牙/魏征 2 审 + **狄仁杰安全复审**。

### 5.4 订单与 CRM / 广告的接线

- **CRM**：订单驱动联系人阶段，方向单一（订单 → 联系人，永不反向）。三条硬规则：
  1. **UPDATE 的条件要验证「当前档位是谁写的」，不能只看档位取值在不在允许集里**。只判取值不够——员工手工把人设成 `contacted` / `quoted` 这类本来就在允许集里的档位后，下一次自动派生照样命中、照样覆盖人工判断。`contact_stage_events.changed_by` 已经区分人工与系统，WHERE 必须用它：只在 (a) `stage IS NULL`，或 (b) 该联系人最近一条阶段事件的 `changed_by` **属于「系统 actor 集合」**时才允许写。
     **不能只比较字面量 `'system'`**——实测现有两个自动写入者都不写这个字面量：`stage-infer.ts` 写 `STAGE_INFER_ACTOR = 'ai:conversation-read'`、`qualified-buyer.ts` 写 `AUTO_TAG_ACTOR = 'system:qualified-buyer'`。只认字面量会把它们的写入误判成人工改动 → 命中 0 行 → 再叠加「有订单的联系人不再由邮件推断阶段」这条排除，真实的定金阶段**永久卡住不更新**。
     所以要集中定义一个集合（如 `src/lib/crm/system-actors.ts` 导出 `SYSTEM_STAGE_ACTORS`），把现有两个 actor 加上本方案自己的 actor 常量一并枚举；**今后新增任何自动写入者都必须把自己加进去**。最近一条不在集合里（是操作者邮箱 = 真人改的），一律命中 0 行。
  2. **取消最后一单时的回退档位必须从客户配置读，不能硬编码 `contacted`**。CTS 的 9 档种子把它配成 `contacted`，但那是 CTS 的配置值不是代码默认值；换一个不用这套档位模型的旅游客户，它可能根本没有 `contacted` 这一档。**客户没配、或配的档位名在 `client_pipeline_stages` 里找不到 → fail closed**：不写 `stage`，落人工待办说明「客户未配置取消回退档位」，不许套用别的客户的档位名，也不许置回 `NULL`（置 NULL 会被 `stage-infer` 从旧邮件重新填回已付款，又被 suppress）。
  3. **映射表（含回退档位）落 `clients.leads_config`，不写死在代码**（红线 2）。`contacts.stage` 本身没有外键约束，写一个客户配置里不存在的档位名不会报错，只会留下孤儿键——所以第 2 条的检查必须在写入前做，不能指望数据库拦。
- **广告**：收到定金 = 成交，走**已上线**的 `me_sale_outcomes` + `me_conversion_writebacks`（`20260905000002`）。**不再建第二本钱的账**——同一笔定金记两次会发给 Meta 两次，而 CAPI 没有删除端点、撤不回。
  - **「已收定金 / 已收尾款」不能是一次点击就写库的按钮**：订单表本身不存金额（钱不在这张表），点击这个动作**没有可落库的输入**——`pax` 和 `departure` 推不出「收了多少、什么时候到账」。必须弹一个小表单收两件事：**实收金额**（默认带出出发团价格但可改，定金往往不等于全款）、**到账日期**（默认今天可改；语义是钱到账日，不是出发日）。
  - 表单提交先把**实收金额 + 到账日期**写进 `tour_orders.deposit_amount_minor` / `deposit_currency`（通过 §5.2.1 的 `record_tour_deposit` 函数），这一步**不依赖联系人有没有邮箱电话**——`tour_orders` 是这笔钱的第一落点，金额事实无论如何都不会丢。
  - 联系人**有**邮箱或电话时，在同一次提交里**再**调用 `src/lib/conversions/intake.ts` 的 `buildIntakeRow(input, ctx)` 写一条 `me_sale_outcomes`，驱动广告回写。`outcomeKind` 传 `'purchase'`（定金）/ `'balance'`（尾款）；邮箱电话从订单关联的联系人读；`sourceKind='api'`、`sourceRef='tour_order:<id>:deposit'`（尾款 `:balance`）——幂等靠已有的唯一索引，连点两次不会双发。
  - 联系人**没有**邮箱也没有电话时（`buildIntakeRow` 强制至少要有一个 match key，`me_sale_outcomes_needs_match_key` 也会拒绝插入）：**跳过 `buildIntakeRow` 调用**，不勉强插一条注定失败或伪造 match key 的行。`tour_orders` 上的 `deposit_amount_minor` / `deposit_currency` / `deposit_received_at` 已经完整落档，表单提示改成「此单收款已留档，因联系人缺邮箱/电话未同步到广告数据」——**不能提示成笼统的「已留档」，那会让人以为已经发了 Meta**。后续联系人补齐邮箱/电话后，允许对同一订单补发一次 `buildIntakeRow`（`sourceRef` 不变，靠既有唯一索引防重）。
  - `buildIntakeRow` 校验失败（金额非法、日期超期等）直接在表单报错，**不许绕过校验直插库**；但这只挡广告回写这一步，不影响 `tour_orders` 上金额事实的落档顺序（先落档，再尝试同步广告）。
- **不自造事件名**：冻结契约 `me/crm.deal.closed` 写着「不能改」，若要 emit 必须沿用它，并在契约文档补一句「上游可能是 ME 自己」。

---

## 6. 不做什么（Scope 闸）

行程版本号与生效时间 · 图片挂到具体某一天 · 物化视图 / 计数器触发器 · 官网回写接口 · 占位与超时释放机制（因为改成"收定金才扣"了）· 佣金结算 · 任何收付款处理 · 下单系统的代码。

---

## 7. 验证（A 级）

| 步 | 证据 |
|---|---|
| migration | 本机 PG 沙盘真跑 `scripts/db-replay-and-verify.sh`，证明能从零重放 |
| 日期解析 | 同一输入在 `TZ=UTC` 与 `TZ=Pacific/Auckland` 下结果相等 |
| 导入 | 真实 `tours.ts` 跑一次：**商品 32 行、出发 25 行**；2 处计算展开必须解出日期而不是 0；失败落待办 |
| 图片 | 生成一条团上传链接 → 传图 → 图归到该团 → vision-analyzer 自动打标；令牌里不含明文客户 UUID |
| 名额 | 未设置显示「未设置」不是 0；编辑入口能改并留痕 |
| **第二个旅游客户接入** | 建虚构旅游客户，**只插数据 + 改配置、不改一行代码**，跑通「建团 → 排出发 → 设名额 → 传图 → 列表显示」 |
| 界面 | 截图 + 读失败态截图 + 名额未设置态截图 |
| RLS | 新表用 anon key 实测读写被拒 |

---

## 8. Reuse Statement

- **复用**：`client_assets` 素材库 + `/api/upload/[token]` 免登陆上传 + `client-upload-token.ts` 加密令牌 + `vision-analyzer` 看图打标 + `assets/provenance.ts` 来源归属（铁律 8 的守卫）· `cms/github-client.ts` 读 chinatravel 仓 · `me_sale_outcomes` + `me_conversion_writebacks` 收款与 CAPI 全链 · `contacts` / `contact_stage_events` / `client_pipeline_stages` / `clients.leads_config` · `pm-todo/manual-items.ts` · `client_portal_users` + `access-types.ts`
- **新增的 `src/lib/` 共享代码**：`src/lib/travel/` —— 团目录读取口、日期解析纯函数、导入器、（第二步）名额计算与阶段派生。**这些是 L2 ME 旅游版共享代码，不是 L1 平台能力**，里面不许出现任何客户名 / 客户 ID / 具体团名。
- **industry-specific**：三张新表的领域形状 + `src/lib/travel/` → L2
- **client-specific**：客户的团 / 日期 / 价格 / 名额 / 行程 / 图片 / 订单 / 代理名单 / 阶段映射 → 数据行与 `leads_config`
- **有没有把客户名 / ID / 行业判断写进 shared runtime**：没有。
- **与 tier-gate 决策一致性**：一致，判定 L2 · ME 旅游版，实现落在 `src/lib/travel/` 与三张 client-scoped 表。
- **学习边界**：留在 client-private；PM 2026-09-08 回「跳」，本轮不登记平台候选。

---

## 9. 已知薄弱点

1. **内容双真相源**（本方案第一步的代价）：官网与 ME 各存一份团内容会漂移；且 `cts-meta-pr` 会自动改写官网的 title。
2. **名额全靠人填**：源数据几乎没有容量，上线初期大多数团显示「名额未设置」。这是如实反映现状。
3. **行程改动不追溯下游**：已投广告 / 已发帖 / 已导手册按旧版行程做的，不自动改写，只留变更记录可查。
4. **占用现算**：万级数据要改法，现在故意不提前优化。
5. **下单系统的授权层是全新的**：「agent 只能看自己的客人」ME 今天没有，不要按「复用登录就好了」估工。

---

## 10. 审查记录

| 轮次 | 结论 | 处理 |
|---|---|---|
| 子牙（架构）· 对 v2 | CONDITIONAL PASS · 6 blocker | 全部吸收：钱不重复建账 / 不自造事件名 / 删 departure_code / 5 个鉴权口列为前置 / 阶段派生七条 / 名额连界面一起做 |
| 魏征（挑刺）· 对 v2 | FAIL · 10 blocker | 全部吸收：单一状态机 / 名额可空 / 取消回退阶段 / 「最靠前」定义死 / 读失败三态 / matcher 不覆盖 API / 函数 REVOKE / 日期时区 / 城市无源 |
| Codex round-1（自动化） | 5 条 | 复合外键防跨客户拼接 / `retired` 状态 / `travel_agents` 提前建 / 阶段派生看 `changed_by` / 取消回退档位读客户配置且 fail closed —— 全部并入 |
| Codex round-2（自动化） | 4 条 P1 | **①与 `ME_PRODUCT_DEFINITION.md` §3.2/§3.3 产品边界冲突 → 见 §0 PM 拍板项①，PM 书面表态前「名额+订单」不许进 migration**；②代理跨客户串号 → 复合外键；③收款按钮无可落库输入 → 改成收「实收金额+到账日期」并复用 `buildIntakeRow`；④系统 actor 不能只认字面量 `'system'` → 改枚举常量集合 —— 全部并入 |
| Codex round-3（自动化） | 6 条 P1 | ①`travel_agents` 建表语句仍排在 `tour_orders` 之后 → 移到前面（§5.2）；②`tour_departures`/`tour_itinerary_days`/`tour_orders` 漏挂 RLS → 四张表逐一内联 `ENABLE ROW LEVEL SECURITY` + service-role policy（§2.2/§5.2/§2.8）；③上传令牌 `listingId`/`tour_product_id` 形状相同会被误判 → 载荷加类型标记，形状不再同构（§2.3）；④并发定金写入/改 `pax` 可能超卖 → `record_tour_deposit` / `update_tour_order_pax` 两个 `SECURITY DEFINER` 函数在同一事务内锁 `tour_departures` 行再校验（§5.2.1）；⑤无联系方式收款金额会丢 → `tour_orders` 新增 `deposit_amount_minor`/`deposit_currency` 作为第一落点，`buildIntakeRow` 只在有邮箱/电话时补发（§5.2/§5.4）；⑥直客单仍可挂 `agent_id` → CHECK 改成 direct⇔NULL、agent⇔NOT NULL 双向约束（§5.2）—— 全部并入 |
| 事实更正 | 7 处 | §2.6 表格 · 圣诞团理由更正 · §2.8 删掉 RLS 误报 |

**v3 因产品定义变化引入的新面（团管理模块 + 素材管道复用 + 下游统一读取口）尚未过审，需再走一轮子牙 + 魏征。**
