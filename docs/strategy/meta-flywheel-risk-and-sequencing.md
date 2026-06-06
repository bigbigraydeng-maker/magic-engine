# Meta 飞轮 — 风险收口与施工顺序（立项依据）

> 创建：2026-06-06 · 状态：📋 立项中（未开工）· 关联 Phase：**18.D（Ads Execution Engine 子阶段）**
> 四路审查：子牙（架构）+ 魏征（代码挑刺）+ 板桥（客户/商业）+ 狄仁杰（隔离/安全）
> 本文是「付费优先创意测试飞轮」的立项依据。**结论先行：飞轮战略成立，但地基有 live 裂缝，先收口再施工。**

---

## 0. 战略模型（一句话）

> 批量生成 10–20 创意变体 → 灌进 Meta 付费创意测试 → 用 per-creative 的 CPA/CTR/完播 几天内判生死 → 砍输家、放大赢家 → 赢家特征回喂生成。

它是 ME「以 Goal 为中心」定位下的一条**快车道**：对标 OTTO / Search Atlas 只做 SEO（3–6 月见效），这个飞轮**1–2 周出结果**，补 SEO 的「慢」。是当前最锋利的差异化卖点。

---

## 1. D0 实测结论（2026-06-06，只读核实）

查 `clients` 表 `meta_ad_account_id` 绑定现状：

| 客户 | meta_ad_account_id | 含义 |
|------|--------------------|------|
| **CTS Tours NZ**（`c0000000-…-000000000000`） | `act_2775766642787274` | 绑在一个**无归属商业组合**的混账户 |
| **oztop**（`d5c98811-…`） | `null` | 未绑，数据未回流 |
| 其余客户 | `null` | 未绑 |

实测广告账户分布（Meta 侧）：

| 账户 | 归属商业组合 | 状态 |
|------|-------------|------|
| `2202695063810470` CTS | CTStours（自己的） | 空 |
| `1735240120460765` Oztop | Oztop Building Supplies（自己的） | 空（MCP 未放量） |
| **`2775766642787274`（无名）** | **无**（business_id 为空） | **所有 boost 都在这里**（CTS 旅游帖 + Oztop flooring 帖混跑） |

**根因**：Magic Engine 自己的商业组合**企业验证未完成**（2026-06-06 已提交申请），走不了正规代理通道，于是一直用一个游离账户 `2775…` 给多客户混投。

**救火紧迫性判定（中，非拉警报）**：
- ✅ 「CTS↔Oztop 双向串数据」**目前未发生**（Oztop 未绑账户，只有 CTS 单边绑）；
- ✅ R5 写越权**当前是哑的**：`META_SYSTEM_USER_TOKEN` 生产未配（ROADMAP `PM-ENV-1`），写操作根本执行不了；
- 🟠 **CTS 数据正在被污染**：CTS 绑的混账户含 Oztop 的 flooring 花费 → CTS 的 spend/ROAS/Goal 指标虚高（live，但爆炸半径小：仅 CTS 一家数字错，无对外泄露）；
- 💣 **埋雷**：任何人再把第二个客户绑到 `act_2775766642787274`，立刻触发完整 R1/R5 双向灾难。

→ **立即生效的铁律**：在账户治理完成前，**绝不允许任何客户绑定 `act_2775766642787274`**。

---

## 2. 四路审查结论

### 2.1 子牙（架构）：根只有一个
整个 Meta 子系统的隔离假设是「一个广告账户 = 一个客户」，现实是多客户混在 `2775…`。假设一破，读串 / 写越权 / 归因烧错钱全连锁。**最省的根治不是写白名单代码，而是账户治理**——让每个客户的广告回到**他自己的账户**（CTS/Oztop 的自有账户已存在且空着），「账户=客户」重新成立，R1/R5/串账大半自动消失。白名单是「必须继续混账户」时的退路。

### 2.2 魏征（代码挑刺）：三个致命前置（带文件证据）
- **A · content_posts ↔ creative_id 无共享主键【致命】**：`content_posts`（`migrations/20260425000001:82-104`）外部 ID 只有 `publer_post_id` / `airtable_record_id`，无任何 Meta 字段。boosted post 的 creative_id 是 Ads Manager 手动加投时生成的，两条数据流物理隔离。`publer_post_id` 走的是 organic post（`lib/publer/engagement-pullback.ts:86-104`），不是付费 creative，桥不了。**唯一不靠人工的正路：飞轮自己建投（调 API 建 creative、当场拿 id 写回）——而建投能力当前一行没有。**
- **B · 混账户一对一归因会串花费【致命】**：归因键是 `clients.meta_ad_account_id` 单值，`getAdAccountInsights` 用 `level:account` 整账户拉回原样归一个 client（`lib/meta/client.ts:77`、`MetaAdsAdapter.ts:82-120`）。
- **C · API 版本散布 4 处且已停用【高】**：`lib/meta/client.ts:11` v19.0（2026-05-21 停用）；`lib/social/facebook-publisher.ts:109` + `feedback-collector.ts:54` v18.0。**意味着现有 Meta 调用此刻就是死的**，不是「将来要升」。升级需抽 `META_GRAPH_VERSION` 单点常量；`parseInsights` 的 action_type 白名单（`:303-307`）过窄，新版会静默漏算转化。
- **E · token 未配 = 连读都空中楼阁【致命】**：sync/execute/cron 三处强依赖 `META_SYSTEM_USER_TOKEN`，未配即 424/skip。写飞轮还需 `ads_management` + Advanced Access。

**魏征施工顺序**：先治账户隔离 + 配可写 token + 升版本（复活现有读写）→ 再补建投能力 → 最后才谈批量变体判生死。**跳步 = 在污染数据上自动决策，真烧客户钱。**

### 2.3 板桥（客户/商业）：能卖，但别接错客户
- **最大风险是接错客户**：飞轮卖「花标准预算买确定性」，不是「花小钱赌爆款」。**想隔夜见效又只肯花 $5 的客户坚决不接**（满足不了 + 反噬口碑）。
- **客户不该看 CPA 判决表**（那是 FDE 后台）。客户面前只要：① 🟢🔴 红绿灯排行榜 ② 一句人话（"每个询盘花 $2.7，是赢家的 5 倍，已帮你关掉"）③ 月报里一段话。术语折叠进二级页。
- **封装名**：Meta → "投放渠道"；整套功能对外叫 **创意测试引擎 / Creative Testing**。
- **定价**：捆进「Goal 加速包」，收**服务费**，广告费客户自付透明走，不做成「代投过路费」。
- **承诺话术**：「第一周系统在学，第二周开始给答案——1–2 周内告诉你哪条创意真能带客户进来，再把预算压上去。卖的不是隔夜爆款，是少花冤枉钱、快速找到对的那条。」
- **失败也是交付物**：「测下来都不行，本身就是结论——省下盲投的钱，换方向再来。」
- **绝不出现在客户/PM 沟通里**：学习期公式、供应商真名、CPA/CTR/完播术语、Meta 算法机制。

### 2.4 狄仁杰（隔离/安全）：两个 bug + 默认拒绝原则
- **R5 写越权【致命】**：`meta-ads/execute/route.ts:53-77` 只校验 `requirePaidClientAccess(clientId)`，`campaign_id` 直接来自请求 body，**不校验该 campaign 属不属于本 client**。CTS 看板用户构造 body 塞 Oztop campaign_id 即可暂停/改预算 Oztop 广告；FDE 在混账户列表里手滑点到别家 campaign 同样中招。（注：ROADMAP §Phase 18 安全边界第 2481 行**声称已校验账户 ownership，与实现不符**——`requireDashboardClientAccess` 只到 client 级，无 entity 级。）
- **R1 读串【致命】**：account-level 聚合原样归一 client，snapshot 的 `campaigns` JSONB 含跨客户 campaign（`sync/route.ts`、`AdsFixDrawer.tsx:62` 直接渲染）。
- **R2/R3/R4【高】**：新表继承串数据风险 + Portal 装配层泄露 + token 进 URL querystring（`client.ts:73-80`，应改 `Authorization: Bearer` header）+ token 权限过宽。
- **唯一钥匙**：引入 `client_ad_entities` per-client 白名单（R1+R5 共用），所有读聚合 / 写守卫 / Portal 装配 / 新 creative 表一律「默认拒绝、白名单放行」。**白名单落地前：严禁 creative 级数据进客户 Portal，严禁对混账户开放 execute 写操作。**

---

## 3. 修正后的施工顺序（替代早期 P0/P1）

| 阶段 | 任务 | 依赖 / 备注 |
|------|------|------------|
| **救火（与飞轮解耦）** | ① 铁律：禁止再绑客户到 `act_2775…`；② execute 写前加 `assertCampaignOwnedByClient` 守卫（放最里层，防 API 旁路）；③ 读聚合按 client 过滤，不整账户归一 client | R5 当前哑（token 没配），但守卫要先于 token 上线 |
| **地基 0** | 账户治理（**首选拆账户**：CTS/Oztop 迁回自有账户）+ 企业验证（已提交）+ Partner Access + 配 `ads_management` token + API 版本单点升 v23（复活现有读写） | 企业验证是前提 |
| **地基 1（链路）** | 解决 creative_id↔content_posts 断链。正路=ME 自己建投（需 Advanced Access）；过渡=UTM/命名约定反解（脆弱）；**禁**=FDE 手维护映射表 | 魏征 A |
| **判决 2** | `scoreCreative` 纯函数（仿 `computeGoalVerdict`/`scoreReputation`）+ creative 级 snapshot 表 + Workbench 红绿灯榜（板桥版客户呈现） | 数据接上后 |
| **自动 3（P1b）** | 自己建投 / 砍 / 放大全自动 | 需 Advanced Access（以周计） |

### 新表设计要点（狄仁杰 + CLAUDE.md 强约束）
三张新表 `creative_variant_groups` / `creative_content_map` / `creative_performance_snapshots`：
- 全部带 `client_id uuid NOT NULL REFERENCES clients(id)`；
- `creative_content_map` 加 `UNIQUE(ad_account_id, creative_id)` 防一对多串认领；
- **RLS 一律 service_role 幂等模板**（防 2026-06-05 schema 漂移事故）：
  ```sql
  ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;
  DO $$ BEGIN
    CREATE POLICY "service_role_full" ON <t> FOR ALL USING (true);
  EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  ```
- 写完 migration **必须** grep `workspace_id|client_team|auth\.uid|auth\.jwt`，命中即重写；
- 新增 `client_ad_entities(client_id, ad_account_id, entity_level, entity_id, label)` 白名单表（**配 Settings UI**，禁止让 FDE 进 Supabase Studio 直填）。

---

## 4. App 与 Meta 商业组合关系（背景，给 PM）

- **商业组合 = 资产组合 = Business Portfolio**（旧 Business Manager），中文官方「业务资产组合」。是 ME 拥有一切资产的「总部大楼」。**一个个人 FB 号最多建 2 个**。
- **App（Magic Engine，ID 1752513682785923）** 本身不拥有广告账户；靠 **System User** 同时绑定「App + 指定资产」签发 token 才能操作。
- **代理标准做法**：客户把**他自己的**广告账户 Partner-share 进 ME 的商业组合（Advertiser/Admin 角色），钱走客户账户，所有权不转移。
- **三种「认证」别混**：① 企业验证（验公司，解锁代理/高级 API，**当前卡点，已提交**）② App Advanced Access（仅自动建投飞轮需要，读/手动不需要）③ 账户付款/身份。
- **不要用全新 FB 号注册**（易风控 + Meta 连坐共享资产）；用稳定老号 + 至少 2 个管理员。

---

## 5. PM 决策清单

| # | 决策 | 子牙/板桥建议 |
|---|------|--------------|
| **D1** | 账户治理方式 | **拆账户**（用客户自有空账户，省工程）＞ 继续混账户+建白名单 |
| **D2** | 最低接单预算线 | 入门 $30–50/天，低于不接（降级为「先做内容」） |
| **D3** | 定价归属 | 进「Goal 加速包」，收服务费、广告费客户自付透明 |
| **D4** | 承诺话术 | 用板桥版（卖确定性，不卖隔夜爆款） |

---

## 6. 一句话立项结论

> **别先盖飞轮。先做两件最便宜、最高杠杆的事：① 加 execute 写前归属守卫 + 禁止再绑客户到混账户；② 走完企业验证 + 把 CTS/Oztop 拆回各自账户。** 这两件做完，一半「致命」自动消失，剩下的飞轮按 地基0→1→判决2→自动3 慢慢盖。

---

## 参考来源（外部基准，行业经验值非权威）

- Meta Graph API 版本/停用：developers.facebook.com/docs/graph-api/changelog/versions
- 学习期 50 转化/周、日预算≈7×CPA：usewonderful.com / modernmarketinginstitute.com
- 创意测试 3-3-3 / 5 创意/ad set / ASC 10-20：motionapp.com / pilothouse.co / jonloomer.com
- 自然测试→赢家放大：thecirqle.com / almcorp.com
- 完播率长度对照（<15s ~72%、15-30s 60-70%、>50% 算法加成、>70% 显著加推）：thatrandomagency.com / opus.pro / metricool.com
- 代理接入 / 企业验证 / Advanced Access：adamigo.ai / stackmatix.com / get-ryze.ai / graphed.com
