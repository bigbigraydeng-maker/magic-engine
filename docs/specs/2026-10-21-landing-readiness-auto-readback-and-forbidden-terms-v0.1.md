# 页面就绪回执自动读回 + 违禁词单一源头 · 设计 v0.1 · 只设计，未写代码 · 119 号 · 2026-10-21

> 来源：74 号 10-21 两条指示：①违禁词清单以 ME 为唯一源头，官网同步，要写明生成/同步方式和「两边不一致即红」的校验；②页面就绪回执每天人工出一份违反「能自动就别丢给人」，要设计成可自动（ME 侧读官网只读页面状态，写回 122 台账），人工只做首份。
> 风险级：设计内容 **B/A 混合**——只读读回（B）；写 122 台账、违禁词进开投前检查（A）。设计阶段需子牙+魏征复审。
> 相关：`2026-10-21-ad-agent-kernel-side-design-v0.4.md` §7（landing_ref 闸）、121 号《网站 Agent 设计稿 v0.1》§5（页面就绪回执字段）、122 号台账 v0.6。

## 0. 先说结论（先查了已有的，不从零造）

1. **ME 里已经有「读落地页」的现成零件，而且已经在每小时自动跑**：`src/lib/ads-tracking-preflight/landing-probe.ts`（手动跟跳转、读状态码/最终地址/UTM 是否保留/页面里的 Meta 像素编号，只探官网自己的主机、带超时、响应大小上限、重试）+ `ads-tracking-launch-watch`（Inngest，每小时，只读，写 `cron_run_logs` 运行记录）。**页面就绪的自动读回应该复用这套，不另写一套爬虫。**
2. **ME 里也已经有「读官网仓库」的通道**：`src/lib/seo-meta/cts-meta-pr.ts` 通过 `GithubClient` 对官网仓库开 PR（人合）。**违禁词同步校验与同步 PR 可以复用这条**，不另建跨仓库凭证。
3. 页面就绪回执里有些字段 ME 从外部**读不出来**（班期是否未出发、价格是否全来自团数据、是否售罄）。这些只有官网自己的数据知道——所以需要官网提供一个**只读、无副作用**的页面状态接口，ME 来拉。

## 1. 页面就绪回执：自动读回

### 1.1 谁读、读什么
**ME 侧每小时一个 Inngest 函数 `ads-landing-readiness-watch`**（只读 + 追加台账；仿 `ads-tracking-launch-watch` 的写法与运行记录；新增 Inngest 函数合并后要人去 Inngest 后台对 `/api/inngest` 重新 Sync 一次）。每次运行，对「需要保持就绪回执新鲜的落地页」逐个读回，字段与 121 稿一致：

| 字段 | 谁能读到 | 怎么读 |
|---|---|---|
| `url` / `http_status`（200 才算活）/ 最终地址 | ME | 复用 `landing-probe`（手动跟跳转） |
| `noindex` / `canonical_absent` | ME | 读页面 HTML 的 robots meta 与响应头 `X-Robots-Tag`、`<link rel=canonical>`（在 landing-probe 基础上增加两项只读解析） |
| `in_sitemap` | ME | 读官网 `/sitemap.xml` 是否含该路径（只读） |
| `tracking_ok` | ME | 复用现有追踪体检的静态读回：像素编号在、表单脚本仍调用 `/api/tour-enquiry`、UTM 保留（**不提交线索**） |
| `departure_ok` / `price_source_ok` / `sold_out` | 只有官网知道 | **官网提供只读状态接口**（见 1.2）；ME 拉取，不自己推断 |
| `live_submit_verified` | — | 只作信息字段，自动读回**恒写 `none`**（真提交测试线索会计入广告转化，必须 PM 许可且由 74 标注；闸不要求它为 done，见 v0.4 §7 / 121 的说明） |
| `checked_at` / `checked_by` | ME | `checked_by='me_readback'`；`expires_at = checked_at + 24h`（每小时刷新一次，所以正常情况下永远不会因过期被拦） |

### 1.2 官网侧的只读状态接口（由 121 实现，本稿只定契约）
- 路径示意：`GET /api/landing-state?path=<页面路径>`；**只读、无副作用、不计入任何转化/统计、不触发线索**；返回 JSON：
  `{ path, offer_ref?, departure_ok, price_source_ok, sold_out, tour_data_version, generated_at }`。
- 三项含义以 121 稿 §5 为准：`departure_ok`=页面上至少有 1 个未出发且有自己价格的班期；`price_source_ok`=页面上的价格全部来自团数据；`sold_out`=该团已标售罄（售罄时页面 404，回执 `blocked`）。
- 安全：只读 GET；限制可访问路径为白名单（只给广告页 `/campaigns/*` 与登记过的落地页）；不返回团内部成本、不返回任何线索信息；官网自己的 PR 实现与审查（121 负责），ME 不改官网代码。
- 接口不可用/超时 → 回执 `status='not_ready'`（原因 `state_endpoint_unavailable`），**不是 ready**；这样官网故障时开投闸关门，方向安全。

### 1.3 判定与写回
- 判定函数（ME 侧纯函数，放平台层，客户无关）：`status = ready` 当且仅当 `http_status==200 ∧ noindex ∧ canonical_absent ∧ ¬in_sitemap ∧ tracking_ok ∧ departure_ok ∧ price_source_ok ∧ ¬sold_out`；`sold_out → blocked`；其余 `not_ready`。**每一项读不到都按不通过处理（不是跳过）**。
- **写回 122 台账**：作为挂在对应 page 请求下的追加回执行（`LandingReadinessReceipt`，v0.4 §7），**只经 122 的唯一写入函数 `appendAgentRequestReceipt`**；ME 侧函数是受信调用方，不需要新的鉴权端点（官网不写 ME 库，沿用 121/74 确认的方向）。**写入内容没有变化时不追加**（状态与上一行完全相同且未接近过期，只更新 `cron_run_logs` 运行记录），避免每小时刷一行；每 12 小时至少追加一行心跳，保证 `expires_at` 前移。
- 状态从 `ready` 变为非 ready（比如售罄）时**立即追加**，并给待办一条（what/how/href 三件套）：「页面 X 就绪回执从 ready 变成 not_ready：原因…」。
- **回执没有 ready 的页面不能被广告引用**：这是开投闸（v0.4 §7，`landing_receipt_required`）的事，读的是「该 landing_ref 最新一行、未过期、`status=ready`」。

### 1.4 要保持新鲜的页面清单从哪来
- 读 122 台账里「状态未终态、`request_type='page'`、带 `landing_ref`」的请求，加上客户配置里登记的「在投广告引用的落地页」（来自开投前追踪体检已读的 `LandingTarget`，`ads-tracking-preflight/client-config`）。**不自己维护第二份清单。**
- 首份回执：上海页由人工出（作为 schema 的第一个实例，已与 121/74 对齐）；之后即由本函数接手，人工只在状态异常时介入。

### 1.5 风险与已知局限
- 官网的 `landing-state` 接口还不存在——它是自动化的前置，没有它 `departure_ok/price_source_ok/sold_out` 读不到，回执只能一直 `not_ready`。所以排期是：121 先做接口 → ME 函数接上；在那之前保持人工首份 + 24h 到期自动拦（方向安全，已对齐）。
- `in_sitemap`/`noindex` 的读取依赖页面 HTML 结构；页面改版可能让解析失效 → 失效时按「读不到=不通过」处理，会触发待办，不会误放行。
- 每小时读官网会产生访问量：限制为白名单路径、每页每小时 ≤ 1 次、并发 1。

## 2. 违禁词清单：ME 为唯一源头

### 2.1 源头放哪、长什么样
- **源头 = ME 侧「旅游行业 Profile/Playbook 配置层」**（`src/lib/ads-strategy/playbooks/travel.ts` 同层；**共享代码里不写任何团名/客户词**，只有「机制」：规则结构 + 校验函数）。
- 规则结构（平台通用）：`{ id, kind: 'term' | 'phrase_only', pattern, allowed_phrase?, reason, applies_to: 'creative' | 'landing' | 'both', severity: 'block' }`。例：`phrase_only` 表示「某个词只许这样写」（如交通只许写 "High-speed train and coach"）；`term` 表示出现即拦（如保证/抢购类用语、不允许的供应商名）。**具体词条属于旅游 Profile（L2）；个别客户的补充词条属于客户配置（L4）**，两层合并时 L4 只能**加严**、不能放宽 L2。
- 校验函数 `checkCreativeCopy(profile, text, scope)`（平台层纯函数，v0.3 §8 已定）。调用点：①创意请求生成前 ②起草广告门（`validateDraft` 旁）③质检前置自检 ④**官网页面文案的发布前检查（官网 CI，见 2.3）**。
- 版本：每次词条变更生成 `terms_version`（内容 SHA-256 的前 12 位）+ `generated_at`。

### 2.2 生成与同步方式
1. **导出脚本**（ME 仓库）：`scripts/export-forbidden-terms.ts` 读源头配置，生成确定性（排序、稳定格式）的 `forbidden-terms.json`：`{ terms_version, generated_at, rules[...] }`。**同一输入必然得到同一输出**，便于比对。
2. **官网侧**：官网仓库收一份**带版本号的静态副本** `src/lib/ad-landing/forbidden-terms.generated.json`（121 稿已确认「带版本号的静态文件、走官网自己的 PR、页面运行时不读外部服务」）。官网现有的 `src/lib/ad-landing/facts.ts` 里手写的那份词表**改为读这份副本**（不再手写），测试强制继续有效。
3. **同步动作**：ME 侧的函数在源头变更后，对官网仓库**开一个同步 PR**（复用 `cts-meta-pr` 那条 `GithubClient` 通道，人合；B 级、只改这一个 JSON 文件）。词条的每次变化因此留痕、可回滚。

### 2.3 「两边不一致即红」的校验（分三层，诚实写明各自能红什么）
| 层 | 校验 | 红的方式 |
|---|---|---|
| ME 内部 | 单测：`export-forbidden-terms` 的输出 == ME 仓库里提交的生成物（若 ME 也存一份）；生成函数确定性；`checkCreativeCopy` 对每条词条各有一个应拦用例 | ME 的 CI 红 |
| 官网内部 | 官网测试：副本 JSON 的 `terms_version` 与按其内容重算的哈希一致（防手改）；`facts.ts` 不得再含手写词表（扫描）；页面文案对词条逐条检查 | 官网 CI 红 |
| **跨仓库一致** | ME 每日一个只读检查：用 `GithubClient` 读官网主干上的副本，比较 `terms_version` 与 ME 当前导出的是否一致 | **不能让官网的 CI 变红**（跨仓库红灯需要官网仓库反向读 ME，要新增跨仓库凭证，不推荐）；它的红 = 一条今日待办「官网违禁词副本落后于 ME（版本 X vs Y）」+ 该检查的运行记录标 failed；落后超过 24 小时升级为红待办 |
- 说明：用户要的「两边不一致即测试红」，**官网仓库 CI 内部**能做的是「副本自身一致 + 页面文案不含词条」；**与 ME 源头的一致性**只能由 ME 侧的每日跨仓库比对发现。若 PM 一定要官网 CI 因落后而红，需要给官网仓库一个只读读取 ME 生成物的方式（例如发布到一个公开静态地址）——会暴露词表内容，需要 PM 决定是否可接受。

### 2.4 范围与不做
- 本期词条来源：先把官网现有 `facts.ts` 的词表、以及 74/121 已提到的规则（交通只许写 "High-speed train and coach"、3 月团不得出现早鸟、供应商名封装、保证/抢购类）**原样迁入**旅游 Profile，不新增词条；新增词条走正常变更。
- 不做：不替官网改文案；不在页面运行时读 ME；不把词表放进共享代码常量。

## 3. 与现有计划的关系（切分）
- **不新增表、不新增合同类型**：页面就绪回执类型已在 v0.4 §7 定义，存放在 122 台账；违禁词函数已在 v0.3 §8 定义，本稿只补「源头放哪、怎么同步、怎么校验」。
- **排期（建议）**：①121 先做官网 `landing-state` 接口 + 把词表迁成读副本（官网 PR，各自审）；②ME 先做导出脚本与每日比对（B 级，只读 + 开 PR）；③`ads-landing-readiness-watch`（A 级，因写台账；排在 122 台账落地之后）。在 ③ 之前，页面就绪回执仍是人工首份 + 24h 到期自动拦（与 74/121 对齐的方向）。

## 4. 未核实 / 待决
- 官网 `sitemap.xml`、robots meta 的实际形态（读取实现要对着真实页面测试，上海页上线后验证）。
- 官网是否已有可复用的「团数据 → 价格/班期」只读函数供 `landing-state` 使用（121 判断）。
- 台账 v0.6 是否接受「机器读回」作为 `checked_by` 与 `provider_ref` 的组成（page 请求的 provider_ref 形状见与 121 的对齐：`{commit, live_read_ref, deployment_id?}`）——待 122 确认。
- 词表迁移时「各团不同的部分」（121 说官网现在还没做成可配）怎么映射到 Profile/客户配置，待 121 给具体清单。
