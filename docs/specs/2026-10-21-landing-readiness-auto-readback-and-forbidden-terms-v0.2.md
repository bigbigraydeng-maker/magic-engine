# 页面就绪回执自动读回 + 违禁词单一源头 · 设计 v0.2 · 只设计，未写代码 · 119 号 · 2026-10-21

> v0.2 = 吸收子牙+魏征对 v0.1 的复审（「修后再进」）。取代 v0.1。风险级：设计内容含 A 级（新表、对外只读接口、进开投闸）。**未写代码**；官网（121）与 ME 都等审后再开工。
> 相关：122 台账 v0.7（唯一写入入口是 `ad_agent_apply_receipt_v1`）、121《网站 Agent 设计稿》§5、`v0.4` §7。

## 0. 复审意见 → 本稿修改

| 意见 | 处理 |
|---|---|
| 挂台账方式对不上 v0.7：`appendAgentRequestReceipt` 不存在；阶段 14 个没有「读回」；actor 封闭清单无 `me_readback`；每小时心跳会刷满请求链；`fulfilled` 后只收 `reconciled/corrected`；客户配置里的落地页没有 request_id；provider_ref 形状没归宿 | **页面就绪不进请求链**。新建小表「页面就绪当前状态」（§1.3，每页一行、可覆盖），台账只记状态翻转时**挂在对应 page 请求下的一条普通回执**（用已有阶段词表，不新增阶段/actor）。这样没有心跳刷链、没有无请求的落地页问题、provider_ref 不需要归宿 |
| `checkCreativeCopy` 全仓不存在；`playbooks/travel.ts` 没有词条；原词表在官网 `facts.ts` | §2.1：明确它是**新代码**（本期不做，只定设计）；词条来源与分层重做（§2.2）；原词表由官网导出一份只读副本作为**迁移输入**，不是源头 |
| 带团语义规则（3 月团无早鸟）进旅游 Profile 前要分层，别违反 Domain Semantics Gate | §2.2 分三层 |
| 「两边不一致即红」只到 ME 侧待办 | 已明说，见 §2.4 |
| `landing-state` 公开 GET 无鉴权 | §1.2：共享密钥头 |
| `generated_at`/`tour_data_version` 判定函数没用，CDN 缓存可能读到过期「未售罄」 | §1.2：`no-store` + ME 校验新鲜度 + 页面/接口 path 绑定 |
| 路径白名单要写 `../`、编码、尾斜杠 | §1.2 |
| 词表副本可被只改 `terms_version` 绕过 | §2.3：ME 用拉到的 rules **自己重算哈希**，结论写进当前状态表，开投闸读结论 |
| 运行时渲染的价格班期文案 CI 扫不到 | §1.1 加「渲染后 HTML 跑违禁词规则」一项 |

## 1. 页面就绪回执：自动读回（复用现有零件）

### 1.1 谁读、读什么
ME 里已有「读落地页」的零件并在每小时自动跑：`ads-tracking-preflight/landing-probe.ts`（手动跟跳转、读状态码/最终地址/UTM/像素）+ `ads-tracking-launch-watch`（Inngest，每小时，只读，写 `cron_run_logs`）。**复用，不另写爬虫。** 新增一个 Inngest 函数 `ads-landing-readiness-watch`（每小时；只读官网 + 写 §1.3 的当前状态表；合并后要对 `/api/inngest` 重新 Sync）。每次对「需要保持就绪的落地页」逐个读：

| 字段 | 来源 | 读法 |
|---|---|---|
| `http_status`（200 才算活）/ 最终地址 | ME | `landing-probe` |
| `noindex` / `canonical_absent` | ME | 解析页面 robots meta 与响应头 `X-Robots-Tag`、`<link rel=canonical>`（官网已核实：meta robots `noindex, nofollow`，无 canonical） |
| `in_sitemap` | ME | 读官网 `/sitemap.xml` |
| `tracking_ok` | ME | 复用追踪体检静态读回（像素在、表单脚本仍调 `/api/tour-enquiry`、UTM 保留；**不提交线索**） |
| `departure_ok` / `price_source_ok` / `sold_out` | 官网状态接口 | §1.2 |
| **`copy_clean`（新增）** | ME | 对**已渲染的 HTML**（探测已拿到）剥掉 script/style/noscript 后取可见文本，跑 §2 的违禁词规则（scope=landing）；**任一命中 → not_ready**，原因写命中的规则 id。这一项覆盖运行时渲染出来的价格/班期文案（官网 CI 扫不到的部分） |
| `live_submit_verified` | — | 自动读回**恒写 `none`**（真提交测试线索会计入广告转化，需 PM 许可+74 标注；闸不要求它） |
| `checked_at` / `expires_at` | ME | `expires_at = checked_at + 24h`（每小时刷新，正常不会过期） |

- **判定**（平台层纯函数）：`ready` ⇔ `http 200 ∧ noindex ∧ canonical_absent ∧ ¬in_sitemap ∧ tracking_ok ∧ departure_ok ∧ price_source_ok ∧ ¬sold_out ∧ copy_clean ∧ terms_in_sync`；`sold_out` 或页面 404 → `blocked`；其余 `not_ready`。**读不到的任一项 = 不通过。**

### 1.2 官网只读状态接口（121 实现，契约在此）
`GET /api/landing-state?path=<页面路径>`，返回 `{ path, tour_slug, departure_ok, price_source_ok, sold_out, tour_data_version, generated_at }`。
- **鉴权**：要求请求头 `X-ME-Readback-Key`（官网与 ME 两侧各一个环境变量，常量时间比较）；缺/错 → 401，不返回任何状态。不是公开接口。
- **新鲜度**：响应头 `Cache-Control: no-store`；ME 校验 `generated_at` 与本机时间差 ≤ 5 分钟，否则按 `not_ready`（`state_stale`）；`tour_data_version` 不用来判定，只用来发现「数据变了」（写进当前状态表的变更检测）。
- **path 绑定**：ME 用**同一个规范化后的 path** 去探页面和接口，并核对响应里的 `path` 回显与请求一致，不一致 → `not_ready`（防止读到别的页面的状态）。
- **白名单与规范化**（官网实现）：只允许登记的路径；先解码一次，拒绝含 `..`、`//`、`%2f/%5c`、控制字符的输入；去掉单个尾斜杠后**大小写敏感**精确匹配；不在白名单一律 404 `{error:'not_found'}`，**不回显输入**。
- 只读 GET，不写统计/转化、不触发线索、不发邮件、不读访客信息；不返回成本/线索/邮箱/内部备注；其它方法 405。接口不可用/超时/401 → `not_ready`（`state_endpoint_unavailable`），**不是 ready**。

### 1.3 当前状态表（新增，一张小表）
`landing_readiness_current`（A 级迁移，RLS 用 `FOR ALL TO service_role`）：每个「客户 × 规范化页面路径」**一行，可覆盖**：`client_id, page_path, offer_ref?, status(ready|not_ready|blocked), fields jsonb（§1.1 各项+原因）, state_hash, terms_version_pulled, terms_in_sync, checked_at, expires_at, last_flip_at, last_flip_from`。
- **写入者唯一**：`ads-landing-readiness-watch`；其它代码不得写（全仓扫描测试）。
- **开投闸读它**：「该客户该页面一行、`expires_at` 未过、`status='ready'`」；缺行或过期 → 拦（v0.4 §7 的 `landing_receipt_required` 之后对 CTS 置 true）。
- **页面清单从哪来**：读 122 台账里未终态的 page 请求带的 `landing_ref`，加上追踪体检配置里登记的 `LandingTarget`；**没有 `request_id` 的页面也有行**（这张表不以请求为键）。
- **状态翻转**（`ready ↔ not_ready/blocked`，或 `state_hash` 变化）时：写一条待办（what/how/href）；若该页面有对应的未终态 page 请求，则**追加一条普通回执**（用已有阶段词表，不新增阶段、不新增 actor，不每小时追加）。
- 人工首份（上海页）：由人工执行一次同样的读回并写入这张表（`checked_by` 记人），之后函数接手。

### 1.4 局限
- 官网接口和这张表都还不存在；没有它们 `departure_ok/price_source_ok/sold_out` 读不到，只能 `not_ready`，所以仍是「人工首份 + 24h 到期自动拦」。
- 页面改版可能让解析失效 → 读不到=不通过，会出待办，不会误放行；限速：每页每小时 ≤1 次、并发 1。

## 2. 违禁词：ME 为唯一源头

### 2.1 实情（先说清）
- `checkCreativeCopy` **目前不存在**（v0.3 §8 只是设计）；`playbooks/travel.ts` **没有**词条；官网 `src/lib/ad-landing/facts.ts` 有 13 条手写词表（测试钉死 13 条）；ME 已有的是**客户级**禁用词机制 `ads-strategy/draft-redlines.ts`（读 `master_briefs` 的 `avoid_words/excluded_topics`）。所以本稿的「源头」是**新建**：平台机制 + 分层配置，官网词表作为**迁移输入**（只读拷贝），不是源头。
- 本期只定设计，不写。

### 2.2 分三层（避免把客户事实写进共享/行业层）
| 层 | 放什么 | 放哪 | 例（来自官网 13 条） |
|---|---|---|---|
| 平台（L1，机制） | 规则结构 + 校验函数 + 导出脚本；**不含任何词条** | `src/lib/ad-agent/copy-rules/` | — |
| 行业（L2，旅游） | 对旅游广告普适的「无依据声明」类 | `playbooks/travel.ts` 同层配置 | small group、max N、名额/稀缺、guarantee/selling fast/hurry/last chance、save、book by、countdown、weeks/days left |
| 客户（L4，CTS 私有） | 只对这个客户的事实成立的规则；**可以只对某些团生效** | 客户配置（沿用 `master_briefs` 的客户禁用词机制，并扩展 scope） | Wuzhen（仅上海团）、交通措辞只许 "High-speed train and coach"（CTS 的行程事实）、3 月团无早鸟（early bird）、WhatsApp（号码未开通，带解除条件）、luggage/baggage（CTS 未发布行李标准，带解除条件） |
- 合并规则：**L4 只能加严，不能放宽 L1/L2**；每条规则带 `layer`，导出时记录来源层。
- 「3 月团无早鸟」「交通措辞」「Wuzhen」都是 CTS/具体团的事实——**不进旅游 Profile**（避免违反 Domain Semantics Gate：共享/行业层不得写某客户的行程事实）。

### 2.3 导出、同步与校验
- 导出脚本 `scripts/export-forbidden-terms.ts` 按 `layer/scope` 合并出**给某一个站点**的规则集，写确定性 `forbidden-terms.json`：`{ schema_version, terms_version, generated_at, rules[ { id, layer, kind: term|phrase_only, pattern, flags, allowed_phrase|null, scope: all|{offers:[…]}, applies_to, severity, reason, lift_condition|null } ] }`；`terms_version = SHA-256(JSON.stringify(rules))` 前 12 位（只哈希 rules）。线性时间安全的正则检查（拒绝嵌套量词）。
- 官网收带版本号静态副本；官网 `facts.ts` 改为读副本（121 稿已确认；等审后开工）；同步走 ME 已有的 `GithubClient` 通道开同步 PR（人合）。
- **防绕过**：副本的 `terms_version` 不被信任。ME 的每日只读比对**拉取官网主干副本的 rules 全文，自己重算哈希**，并与 ME 当前导出的规则集逐条比对；结果写进 §1.3 的 `terms_in_sync`；**开投闸读这个结论**（`false` 即 not_ready）。只改 `terms_version` 而不改 rules 会因重算不一致而被发现。
- **「两边不一致即红」——诚实边界**：官网仓库 CI 内部只能做到「副本自身哈希自洽、`facts.ts` 无手写词表、页面文案不含词条」；**与 ME 源头的一致性只能由 ME 侧每日比对发现，红灯是 ME 侧一条今日待办（落后超过 24 小时升红）+ 开投闸关门**，官网 CI 不会因落后于 ME 而红（要那样需要官网反向读 ME，需新增跨仓库凭证或公开词表，PM 已定不做）。

### 2.4 范围
本期：设计。迁移时**原样迁入官网现有 13 条**并加一条「迁前迁后对同一批样例结果一致」的断言测试；新增词条走正常变更。不替官网改文案。

## 3. 切分与排期（建议）
①121：官网状态接口（含密钥头/白名单/no-store）+ 词表改读副本——**都等本稿审通过后**；②ME：`copy-rules` 机制 + 导出脚本 + 每日比对（B 级，只读+开 PR）；③ME：`landing_readiness_current` 迁移 + `ads-landing-readiness-watch`（A 级，排在 122 台账落地之后）。在此之前页面就绪仍是人工首份 + 24h 到期自动拦。

## 4. 未核实
官网 `sitemap.xml`/robots meta 的实现要对着上海页上线后验证；官网 `getDepartureRows` 复用性已由 121 确认；`master_briefs` 客户禁用词机制能否表达 `scope`/`lift_condition`（需要看现有结构，可能要扩展，属 L4 配置层的实现细节）。
