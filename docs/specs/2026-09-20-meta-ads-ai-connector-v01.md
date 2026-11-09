remote fetched at: 2026-09-20T06:21:10Z · exact main SHA: edfeb2eea144f71be295bc55f07201aba0be75a0

# Magic Engine Meta Ads AI Connector V0.1

Discovery / Implementation Proposal · 2026-09-20 · 状态：DISCOVERY COMPLETE / STOP BEFORE BUILD

**建议立项方向成立：将已有 Meta 能力产品化，先定义与模型无关的 ME tool contract，再复用现有 MCP transport，并提供同契约 HTTPS 接口。不要从零再造 Meta Connector、令牌库或 MCP server。**

本轮授权仅 Discovery。唯一业务仓库：`bigbigraydeng-maker/magic-engine`。只读检查 main、项目文档、源代码、相关 Issues/PRs 与官方资料；未写应用代码，未创建分支/PR/Issue，未 merge、deploy、migration apply、读取生产凭据或执行生产/广告写入。本文件是本地审阅交付物，不等同于 GitHub 施工合同或上线证明。收到 GO BUILD 后，实施前将批准切片登记到同仓 Task Contract Issue。

## 1. 当前 main 已具备什么

代码基线为 [edfeb2ee](https://github.com/bigbigraydeng-maker/magic-engine/commit/edfeb2eea144f71be295bc55f07201aba0be75a0)。技术栈为 Next.js 14 / TypeScript / Supabase，已有 `@modelcontextprotocol/sdk`、`mcp-handler`、Zod。`docs/ARCHITECTURE.md` 自述属于旧设计；`docs/STATE.md` 部分状态仍是历史核验。本报告优先以固定 SHA 源码判断“已实现”，不把文档的“已上线”当本轮生产验证。

| 能力 | 已有实现与证据 | 对本项目的判断 |
|---|---|---|
| Meta OAuth | [meta-oauth/client.ts](https://github.com/bigbigraydeng-maker/magic-engine/blob/edfeb2eea144f71be295bc55f07201aba0be75a0/src/lib/meta-oauth/client.ts#L37)、connect/callback routes | 有 HMAC state、code exchange、long-lived exchange、实际 granted scopes 查询；当前是 Page/Messenger/Publishing 流程，**不是 Ads 只读 onboarding** |
| 加密授权存储 | [connection-store.ts](https://github.com/bigbigraydeng-maker/magic-engine/blob/edfeb2eea144f71be295bc55f07201aba0be75a0/src/lib/platform-oauth/connection-store.ts#L34)、vocabulary、cms/crypto | 已有 AES-256-GCM、状态与安全摘要；可扩展，不能重建 vault |
| 广告账户登记 | [ad-account-binding.ts](https://github.com/bigbigraydeng-maker/magic-engine/blob/edfeb2eea144f71be295bc55f07201aba0be75a0/src/lib/meta/ad-account-binding.ts#L177)、binding-service、client-ad-accounts | 规范化、Graph 核验、新旧两处登记重复检查、审计；现有绑定仅内部员工可实际写入，不是客户自助授权 |
| Campaign / Ad Set / Ad 实体 | [entity-settings.ts](https://github.com/bigbigraydeng-maker/magic-engine/blob/edfeb2eea144f71be295bc55f07201aba0be75a0/src/lib/meta/entity-settings.ts#L199) | 已有 GET-only 列表、账户 currency/timezone、实体层级、创意引用；支持分页完整度，但默认排除 archived/deleted，字段偏内部诊断 |
| Insights | [meta/client.ts](https://github.com/bigbigraydeng-maker/magic-engine/blob/edfeb2eea144f71be295bc55f07201aba0be75a0/src/lib/meta/client.ts#L426) | account aggregate、campaign/adset/ad daily、Spend/Impressions/Clicks/Reach/Frequency、衍生 CTR/CPC/CPM、actions 与部分成本；不同函数口径不完全一致 |
| 视频 | [meta/client.ts](https://github.com/bigbigraydeng-maker/magic-engine/blob/edfeb2eea144f71be295bc55f07201aba0be75a0/src/lib/meta/client.ts#L216) | 已有 3 秒、ThruPlay、25/50/75/95/100%、平均观看秒，缺失使用 null；无需新建视频采集体系 |
| 历史数据与设置快照 | ad_daily_insights、ad_entity_snapshots、ad_snapshot_captures、daily-insights / portfolio/snapshot-sync | 可供将来 ME Intelligence 使用；不能默认当作免费工具的可信完整来源，存在共享账户、币种和旧口径问题 |
| 疲劳分析 | [ads-strategy/baseline.ts](https://github.com/bigbigraydeng-maker/magic-engine/blob/edfeb2eea144f71be295bc55f07201aba0be75a0/src/lib/ads-strategy/baseline.ts#L1) | 已有相对自身历史的 campaign 判断与行业配置；不等同于已完成的 ad/creative 级通用疲劳判定 |
| MCP | [api/mcp/[transport]/route.ts](https://github.com/bigbigraydeng-maker/magic-engine/blob/edfeb2eea144f71be295bc55f07201aba0be75a0/src/app/api/mcp/%5Btransport%5D/route.ts#L30) | 已有 `/api/mcp/mcp`、Streamable HTTP、client/admin key 分离、租户上下文、审计和基础限流；未提供本项目八个 Meta tools |
| 内部 agent tools | agent-tools/readonly/types.ts、index.ts | 已有服务器注入资源上下文；定义绑定 `Anthropic.Tool`，不能原样作为模型中立契约 |
| CAPI / Messenger | meta/capi/config.ts、writer.ts、meta/leads-sync.ts、Page OAuth | 已有基础设施；CAPI writer 含 `POST /events`。仅盘点边界，V0.1 不调用、不导入、不触发 |

关键 GitHub 状态：

- 已合并：[PR #1659](https://github.com/bigbigraydeng-maker/magic-engine/pull/1659) 视频/广告组日数据与设置快照；[PR #1649](https://github.com/bigbigraydeng-maker/magic-engine/pull/1649) 广告账户绑定安全；[PR #1791](https://github.com/bigbigraydeng-maker/magic-engine/pull/1791) Page 绑定；[PR #1658](https://github.com/bigbigraydeng-maker/magic-engine/pull/1658) 多账户归属；[PR #1477](https://github.com/bigbigraydeng-maker/magic-engine/pull/1477) lead/messaging 防重复计数；[PR #1407](https://github.com/bigbigraydeng-maker/magic-engine/pull/1407) CAPI 回写。
- 未合并：[PR #1701](https://github.com/bigbigraydeng-maker/magic-engine/pull/1701) Page 发评论权限；[PR #1362](https://github.com/bigbigraydeng-maker/magic-engine/pull/1362) 授权每日体检；[PR #1612](https://github.com/bigbigraydeng-maker/magic-engine/pull/1612) onboarding SOP。不能把它们当 main 能力。
- 待处理：[Issue #1702](https://github.com/bigbigraydeng-maker/magic-engine/issues/1702) 掉权/错误回跳；[Issue #1299](https://github.com/bigbigraydeng-maker/magic-engine/issues/1299) 企业验证；[PR #1494](https://github.com/bigbigraydeng-maker/magic-engine/pull/1494) 只登记了定时抓取 token 错配，未提供修复；[Issue #1334](https://github.com/bigbigraydeng-maker/magic-engine/issues/1334) 仓库与生产数据库历史不完整。
- 广告执行层另有开放 PR #1730/#1732/#1734；它们不属于此只读项目的前置依赖，也不得合并进本项目 scope。
- 本轮 main checks 仅观察到 sweep / Cloudflare Pages success 与 Claude skipped；**这不能证明 main 全量测试、构建或生产运行已通过**。历史 PR 的测试数字不作为本轮验证结果。

## 2. Build / Buy / Reuse 与产品层级

**Reuse 优先；Build 只补授权用途、数据契约和用户入口。** 现有 API、加密、账户校验、MCP SDK 足以承载，没有采购第二家 Ads Connector 的必要证据。若未来某客户端需要标准 OAuth authorization server，优先评估既有身份服务或成熟组件；不借本项目自建通用身份平台。第三方连接产品即使代抓取，也不能替 ME 解决客户隔离、数据语义和免费/付费权限边界。

| 归类项 | 判定 |
|---|---|
| 项目主体 | L3 Meta Connector，挂在既有 Ads 支柱，服务 Inspect / Measure |
| ME tool contract / scope / audit | 既有平台基础设施扩展，首批仅八工具；不做全平台工具框架重写 |
| 行业差异 | 转化目标、比较阈值等留在 Playbook/Profile/Policy，不进 provider adapter |
| 客户差异 | 所选账户、授权主体、时区币种、选用的 conversion action 留在配置 |
| 换客户测试 | CTS 与 Roman 都调用同一读服务；不会继承另一家的 Page、账户、域名或 token |
| 换行业测试 | 旅游、地产、外贸共用字段与单位；不把“私信=线索”或某行业 CPL 阈值固定为平台真相 |
| 智能层/执行手 | 连接层负责证据读取；ME Intelligence 负责持续判断与闭环，免费层允许上层 AI 做一次性分析 |
| 七条红线 | 禁包装升级✓；禁客户/行业事实进共享层✓；不直建 L1✓；换客户✓；换行业✓；Build Gate✓；L2 不装单客户事实✓ |

商业分层沿用 PO 本次明确决定：免费 **Meta Ads → 用户选择的 AI**；付费 ME 保留跨渠道上下文、持续监控、归因、受控执行和结果学习。免费工具不自动启用发布、CAPI、CRM 联系人同步、收费采集或营销外发。

风险定为 **A 级**，因为涉及公众鉴权、客户隔离、授权关系与新增接口。按 §11，对本项目暂按「频率中（预期周分析，尚无使用数据）/ IMPACT 中（Inspect、Measure 数据入口）/ 收入中（获客间接关联）→ P2」；这是资源判断，不撤销 PO 的 Discovery 授权，也不自动越过现有客户事故的排期。安全与数据完整性是本项目发布硬门，不能以 P2 为由删掉。

## 3. V0.1 真正缺少什么

1. **Ads 专用 OAuth 用途。** 当前固定申请 Page/发布/线索权限，callback 只保存 Page token 并丢弃 long-lived user token。新增 `intent=ads_read`；只请求所需广告读取权限，保存 user grant，允许没有绑定 Page 的用户连接。
2. **账户发现与客户自助确认。** 实现分页的 `/me/adaccounts` 候选发现；明确授权可访问不等于企业法律所有权。用户选择后，服务器重验同一 grant 能否读取，执行跨客户冲突检测；不能降低旧 staff-only 绑定路由权限。
3. **凭据用途与授权关系。** 现连接唯一键只有 client/provider/account；区分 Page 与 Ads，增加到期事实、主体和 grant 关联。公众路径不得使用环境变量或共享 system token 兜底。
4. **统一只读数据服务。** 补 age/gender breakdown、任意受限日期窗口、窗口聚合、period comparison。现有小时 breakdown 不等同于人口分组。
5. **数据语义。** 币种、时区、CTR 单位/点击类型、归因窗口、Lead/Conversion action、视频分母、缺失/零/部分数据都必须明确。
6. **公众工具权限。** 现 MCP key 默认 `read:all`，工具层未执行细粒度 scope；新增 `meta:ads:read` 并同时限制 tools/list 与 tools/call，旧 ME tools 也必须拒绝 Ads-only key。
7. **非技术用户接入。** 现 key 发行依赖管理员；旧文档要求命令行/配置文件。免费入口需自助连接与撤销，并提供至少一种实际可用的非 Codex 客户端接入体验。
8. **公开运行硬限制。** 现限流依赖近似日志计数且失败放行；补按 principal/tenant/connection/account 的原子限额、并发、provider 配额退避与完整度标记。不能靠“readOnlyHint”代替服务端安全。

另有必须局部处理的技术债：`meta/client.ts`、adsets 使用 v19.0，OAuth/entity-settings 用 v21.0。版本分裂是静态事实；本轮未证实这些版本在生产的实际行为。新增公开读路径需统一受支持的固定版本并做只读兼容性验证，不能简单宣称旧版仍可用，也不顺手全仓升级所有 Meta 写路径。

## 4. 架构选择：contract-first，MCP 是 adapter

```text
用户通过 ME 身份登录 → Connect Facebook → 用户授权 → 选择 Ad Account
                                              ↓
                  现有 OAuth store + Ads read grant + 租户/权限守卫
                                              ↓
                        Meta 既有只读 provider functions
                                              ↓
                    ME Meta Ads read service / metrics contract
                         ↙                    ↘
               现有 MCP adapter          HTTPS JSON adapter
                         ↘                    ↙
                 Codex / Claude / DeepSeek / Qwen 的客户端或 agent
```

共用的工具定义包含 `name/version/inputSchema/outputSchema/requiredScopes/effect/handler`，使用 JSON Schema/Zod，不依赖任何模型 SDK。资源 context 由服务器构造：`principalId/clientId/connectionId/allowedAccountIds/scopes/requestId`；模型不能传 clientId、token、任意 Graph URL、HTTP method 或自由字段表达式。

八个工具均为 `effect=read`，MCP 加 readOnlyHint，但服务端另做强制 allowlist。`client.ts/adsets.ts` 混有广告写函数，需将被复用的读取部分抽入明确只读模块，旧 export 保持兼容；不复制实现。只读模块不能依赖 ad-publisher、CAPI writer、stop-loss 或通用执行器。

| Tool | 最小输入 | 结果与限制 |
|---|---|---|
| `meta_list_accounts` | cursor/limit 可选 | **只返回本 client 已确认的 read grants**，含状态/币种/时区；OAuth 候选列表只在用户连接页展示，不自动交给模型 |
| `meta_get_campaigns` | account_id、受限 status/ids、cursor | campaign id/name/objective/status；不靠 Insights 行推断实体全量，不漏报停投但期内有花费的对象 |
| `meta_get_adsets` | account_id、campaign_id 可选、cursor | campaign 父子关系、投放/优化目标等安全字段；过滤项逐个验归属 |
| `meta_get_ads` | account_id、campaign/adset_id 可选、cursor | ad/creative 标识、状态和父级，用于对应素材表现；不读个人线索或完整 audience 规则 |
| `meta_get_insights` | account_id、since/until、level、time_increment、metric_set、conversion_action 可选 | account/campaign/adset/ad 的总量或日序列；指标与过滤白名单 |
| `meta_get_video_insights` | 同上、ad_ids 可选 | p25/50/75/95/100、ThruPlay、3 秒、play 基数、平均观看秒及字段可用性 |
| `meta_get_breakdowns` | account_id、日期、level、breakdown preset | V0.1 age / gender / age+gender；每种合法 fields×breakdown 组合需验证，不接受任意拼接 |
| `meta_compare_periods` | account_id、current、previous 可选、level、metric_set | 默认前一段等长完整日期；绝对差、相对变化、单位、可比性和不足原因 |

统一输出：`contract_version/data/meta/errors`。meta 包含 `account_id/currency/timezone/date_range/granularity/metric_definitions/attribution/fetched_at/source/api_version/completeness/next_cursor/warnings/request_id`。completeness 区分 complete/partial；每个指标区分 available/not_reported/not_applicable/unsupported，不把失败置零。分页使用绑定 tenant、grant revision、account、query hash 的不透明 cursor；不向客户端暴露含 token 的 paging.next。

错误码至少包括 `NOT_CONNECTED`、`RECONNECT_REQUIRED`、`FORBIDDEN`、`SHARED_ACCOUNT_UNSUPPORTED`、`UNSUPPORTED_COMBINATION`、`RATE_LIMITED`、`UPSTREAM_UNAVAILABLE`、`PARTIAL_DATA`。不得在错误中暴露其他客户姓名、ID、token、SQL 或原始 provider 请求 URL。

建议公开接口：`GET /api/ai-tools/meta/manifest` 与 `POST /api/ai-tools/meta/invoke`，后者 body 仅 `tool/arguments`。这是对 ME 的 RPC POST，不是广告写入。两种 adapter 调同一 handler，未知 tool 和额外参数直接拒绝。HTTPS manifest 同样要求认证和权限过滤；MCP tools/list 按每次请求的认证上下文过滤，不能因全局注册而暴露其他 ME tools。复用现 `/api/mcp/mcp`，不另部署 server。只读 transport 使用 POST/DELETE 等协议方法不代表广告 mutation；硬限制落实在 Meta 数据调用层。

MCP annotations 只是提示，不能替代权限系统；HTTP MCP 的标准 OAuth 还涉及资源发现、audience、PKCE 等，现有 API-key transport 不能被称为“已经完成客户端 OAuth”。[MCP 官方 annotations 说明](https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/)；[MCP 2025-11-25 授权规范](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)。

## 5. 怎样做到 model/client agnostic，且非技术用户可用

模型与客户端是两层：DeepSeek/Qwen 可以作为 agent 的模型，但某个普通聊天网页未必支持 MCP、外部 tools 或自定义 HTTP。**不能宣传“任意聊天框授权一次就自动能读广告”。**

- 数据服务不调用 LLM，不保存用户模型 key；Meta token 只留 ME 服务端。SDK 格式转换发生在客户端 adapter，换模型不改 Meta 层。
- 提供 MCP 与 HTTPS + JSON Schema 两种出口。至少验证一个支持 MCP 的客户端和一个使用 DeepSeek 或 Qwen 的非 MCP tool-calling agent；其余未实测客户端标“待验证”，不虚报兼容。
- 客户登录复用 ME 身份与 client_portal_users；连接页只包含 Meta 授权、选账户、连接状态、进入 AI 的受支持方式、断开。OAuth 回来不能因拿到 token 就显示成功，需通过实际 scope/账户读取检查。分别展示“广告账户已连接”和“AI 已可读取”，后者只有客户端授权及首次工具读取验证成功后成立；保存前展示所属 ME 客户与所选广告账户。
- 对支持 bearer 配置的客户端提供可导入配置及一次性显示的 ME 受限凭据；Meta token 不出现在配置里。若目标非技术客户端只支持标准 OAuth，则将该 adapter 的标准授权接入作为发布前必要工作，优先成熟身份服务；不能退回让用户开终端。
- 最小技术 slice 可用测试客户端/API key，但**非技术用户公开版的验收必须另有无终端、无手改配置的真实接入路径**。本轮未核验任何具体国内聊天应用具备这一路径，列为客户端适配 release gate，不能以 mock 算通过。
- V0.1 不额外建设多模型聊天产品。若所选客户端均不能提供上述体验，公开发行应停在受限 beta，不能把开发者 API 冒充自助工具。
- 不依赖用户开通 Codex；但 Meta 本身的账户资格、授权页面和网络可达性仍需具备。“模型无关”不等于消除 Meta 登录条件，也不承诺大陆任意网络都能访问 Meta。

免费工具的数据只在用户明确启用的 AI 连接中传给所选消费者，不默认用于跨客户学习或训练。应在连接页清楚说明会提供广告汇总与实体名称；不包含联系人、电话号码、email、Messenger 内容。

## 6. Meta permissions / App Review / OAuth / token 公共使用要求

**核心申请 `ads_read`。** 本项目不需要 `ads_management`、Page 发布/消息权限、`leads_retrieval`。Lead/Conversion 的汇总统计和读取 Lead Form 中的个人信息是两件事。Business 资产枚举若确需 `business_management`，必须先证明必需；首版优先 `/me/adaccounts`，不以 Business/Page 绑定作为强制前置。

面向第三方广告账户，需取得适用的 Advanced Access；Meta 官方发布的 Marketing API collection 明确区分自有账户与他人账户的权限级别。[Meta 官方 Marketing API 文档集合](https://www.postman.com/meta/facebook-marketing-api/documentation/0zr4mes/facebook-marketing-api-mapi)。

公开发行前的检查清单：

1. 复用实际生产 Meta App，核对 app ID、App 用途/产品配置、上线模式、联系邮箱、正确域名和精确 HTTPS redirect URI；不建立第二个同名 App。
2. 完成适用的 Business Verification、`ads_read` App Review/Advanced Access，以及后台实际要求的 access verification / tech-provider 步骤。Marketing API access tier 与 permission scope 不应混为一谈；所需名称与门槛以该 App 当前 dashboard 为准。
3. 提交可复现的“授权→选账户→展示广告报告”审核演示、测试登录说明、权限必要性；隐私政策、用户数据删除/撤销入口、数据保留说明必须可用。审核获批和非 app-role 用户成功连接，是两个独立验收证据。
4. 若当前 Page App 已获更多权限，`scope=ads_read` 不保证历史授权被缩小；保存实际 granted scopes，运行时仍禁止一切广告写路径，不擅自撤销现有 Page 功能授权。
5. code exchange 服务端完成；state 增加一次性 nonce、发起 principal/session、client、intent、expiry 和固定返回地址。callback 重检身份与客户权限；换会话、过期、重放、取消、上游异常分别处理。Facebook Login 的 PKCE 能力需按所选流程核实，不假定与 ME→MCP OAuth 等同。
6. 保存 provider 返回或 token debug 核实的 `expires_at/data_access_expires_at/token_type/app_id/subject_id/scopes`；不硬编码“永不过期”，也不拿旧 Page callback 的固定 60 天当真实有效期。现库 Meta refresh 尚未实现，到期/撤销/掉权应显示重新连接。
7. 复用加密与 secret 配置，token 不送模型、不进日志、不进前端、不写 URL 输出。Graph 请求用受控目标、header token 和支持时的 appsecret_proof；provider error 只输出净化后的分类。
8. 断开撤销本产品 read grant 与相关 ME 凭据、清缓存；不要默认整 App deauthorize 导致已有 Messenger/Publishing 断连。用户要求删除全部 Meta 数据时走明确的全域删除流程，验证 deauthorization/data-deletion 请求签名。

**现状证据的限制：** Issue #1299 仍 OPEN，正文记录企业验证未通过、无高级权限及联系邮箱未验证，并已由评论确认法定主体为 Magic Engine AI Technology Limited。本轮没有访问 Meta App dashboard 或使用生产 token 重测，故只作为“公开发行前必须复核的阻塞记录”，不宣称它仍是实时后台状态。

本轮尝试访问 Meta developers 的授权、long-lived token、access-level、breakdown/versioning 页面，遇到 429/不可读取。已用 Meta 官方 Postman 与官方 Business SDK交叉验证权限方向与字段存在；**并未核实该 App 当前审核状态、具体 token 生命周期或每种 breakdown 组合**。相关发布门保留，不用第三方博客代替。核验入口：[Meta 授权](https://developers.facebook.com/docs/marketing-api/get-started/authorization/)、[长期 token](https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-long-lived/)、[Breakdowns](https://developers.facebook.com/docs/marketing-api/insights/breakdowns/)。

## 7. tenant → grant → account → entity 怎样防串客户

这里的 tenant 直接采用现有 `clients.id`，不另造 workspace/tenant 体系。Business/Page 与 Ad Account 是相关资产，不是天然一对一树；个人账户可能没有 Business，Agency 可以有受托访问。

服务器的授权链必须为：**ME 已验证身份 → client membership/受限 ME credential → active Ads-purpose connection → 用户确认的 read grant → 允许的 account → entity 实际 account/parent**。任何一环读不到、过期或不匹配都拒绝。

### 推荐的数据结构变化（仅设计，未执行）

| 存储 | 拟议变更 | 不变量 |
|---|---|---|
| `platform_oauth_connections` | 增 `credential_purpose/token_kind/provider_subject_id/provider_app_id/data_access_expires_at/verified_at/grant_revision`；调整用途唯一性和 expiry 可未知的表达 | 仍是唯一 token vault；Page 原记录保留，旧 reader 明确限定 Page 用途；未知用途拒绝读取，不能猜 |
| **新增 `meta_ads_read_grants`** | `id/client_id/connection_id/ad_account_id/confirmed_by/status/verified_at/revoked_at/revision`，必要币种时区快照；同租户连接 FK，规范账户 ID | **这是只读许可关系，不是第二套 Meta connector/account inventory/token store**；不存 token；不授予既有广告写能力 |
| `client_api_keys` | 显式 `meta:ads:read`、目的/过期/撤销与授权版本；兼容既有 key | 公众 key 不默认 `read:all`；现有 ME key 不自动获得新增 Meta grant |
| `client_binding_audit` / `mcp_access_log` | 扩用途/transport/request ID/connection reference/结果分类，按需复用 | 不存业务明细或 secrets；关键授权审计失败就不完成绑定，读审计先记录请求 |
| OAuth transaction | 优先复用可用的授权事务机制；当前 signed-state 无一次性存储，需要短期 nonce 状态 | 有限 TTL、绑定主体与用途、原子消费，不新建通用身份平台 |

为什么不直接往 `client_meta_ad_accounts` 加记录：现表既参与 campaign 写权限判定，也让账户进入日常同步/扫描。免费读授权直接填入会扩展旧 runtime 的可操作范围。单独的 read-grant 关系是用途隔离，复用加密、校验、审计与 provider 实现，比修改所有 operational callers 更窄。`clients.meta_ad_account_id`、facebook_page_id、factory publish target 均不由免费连接流程填写。

独占账户检查必须同时查 read grants、`client_meta_ad_accounts`、旧 `clients.meta_ad_account_id`；复用 `findOtherClientRegistrations` 的双来源分页与规范化逻辑。不能仅用 `findSharedAdAccounts`（它只查新登记表）。首次切片与 V0.1 公共入口拒绝跨客户共享账户；不接受用户传 `allow_shared_account`，也不按广告名称猜归属。冲突只返回中性提示，不暴露另一客户身份。

新 grant 的活跃账户唯一约束防止两个新用户并发认领；与旧绑定变更必须共用按规范 account 锁定的事务/检查协议或数据库约束。只加新表唯一键挡不住旧登记路径并发。每次读前重验授权版本及跨客户冲突，撤销/改绑时使缓存失效。不能仅复核新 grant revision：授权版本必须覆盖旧两来源绑定增删、connection/grant/key 的撤销或改绑。实现可采用所有受保护 writer 在同一账户锁事务中更新的 authorization epoch，或在释放结果前重新检查三来源冲突及全部 active 状态。测试 in-flight 读与撤销竞争并定义最终授权检查时点；已经发出的网络字节不可能追回，撤销后的后续请求与缓存读取必须拒绝。若无法证明这组协议覆盖旧 writer，公众自助绑定不放行。

数据库沿用当前服务端 service-role 模型：隔离主要在最内层服务代码，RLS 不能被误称为已替 service-role 自动隔离。新关系对 anon/authenticated 禁止直读，service_role policy 要显式 `TO service_role`；新增 RPC 默认不对 PUBLIC 可执行。[Supabase 官方 RLS 文档](https://supabase.com/docs/guides/database/postgres/row-level-security)。

## 8. 最小安全 vertical slice 与全 V0.1 边界

**第一刀只验收一条真实路径：** 一个测试用户、一个独占广告账户，完成 Ads-only OAuth → 选择账户 → `meta_list_accounts` + `meta_get_insights` → 返回过去七个账户当地完整自然日数据 → MCP/HTTPS 结果一致 → 断开后两种入口都失效。没有 Page 也可完成；授权失败不能显示成功。先用隔离测试环境与授权测试账户，不拿生产凭据做隐式探针。

建议实施顺序，每项完成停在可审查产物，发布操作另行授权：

| 切片 | 交付 | 完成判据 |
|---|---|---|
| A：授权与两工具 | neutral contract、用途隔离、read grants、scope、只读 provider、账户发现、两工具、连接 UI | 上述单账户路径 + 隔离/撤销/零广告写测试；仅算最小 slice |
| B：补齐八工具 | 实体、视频、age/gender、窗口对比，完整度与数据口径 | 八个 schema/handler 两 adapter 一致，真实只读 fixture 与测试账户逐项对账 |
| C：公众发行准备 | Meta 审核证据、非技术客户端路径、中文说明、配额/删除流程 | 非 app-role 用户成功；至少一种不依赖 Codex 且无需终端的接入；有限 beta 容量实测 |

V0.1 不做广告 mutation、异步 Meta 报表 job 创建、CAPI、个人线索读取、CRM 同步、自动监控、预算建议执行、跨平台归因或自动学习晋升。同步只读不需要新 Inngest workflow；若将来大账户确实需要异步报表，再单独评估外部只读 job 的副作用与既有 Inngest，不在本轮偷偷加入 Graph POST。

单次请求建议初始最多 90 日、500 行/页、有限页数与并发，执行预算低于现路由 60 秒；具体 provider/用户配额在测试账户吞吐结果后配置，不能宣称免费无限量。超过同步预算返回 partial/缩小范围提示，不能静默漏数。不新增一套广告历史仓库；首版按需读取，若缓存采用短 TTL 且键含 client/grant/account/query/version。

### 指标口径必须在 Build 前冻结

- 金额带账户币种；多币种不直接相加，不做隐式汇率转换。日期按账户时区，默认最近 7 个完整自然日，不含今天；对比前 7 日，含边界日期说明。
- `ctr_all = clicks/impressions`，统一 ratio；UI 乘 100 显示百分数。link/outbound CTR 另名。CPC、CPM 从相同范围总量重算，不平均日比率。
- Reach 不按日或子实体相加；Frequency 从同窗口同粒度 Meta 数据取值。没有准确窗口数据则 unavailable，不给“近似总触达”冒充准确值。
- Lead/Messaging/Purchase 保留具体 action_type 与归因配置；不给 `max(leads,messaging)` 起名通用 conversion。复用 objective-metrics 的防重叠原则，但修正缺失默认 0、整数截断与混合目标解释问题；estimated/fractional 数据不擅自取整。
- CPL 的分母是明确的 lead action；不同目标 Campaign 不按同一 CPL 强排最好/最差。缺结果、小样本、近期上线和不完整期间应标无法比较。
- period comparison 以相同 account、时区、粒度、过滤、货币、action/归因规则为前提；previous=0 或 null 时相对变化为 null 并说明，不能输出 infinity 或伪造 100%。CTR 同时给百分点差与相对变化，勿混淆。
- 官方 SDK 声明了 `video_play_actions`、p25/50/75/95/100、ThruPlay 等字段，但存在字段不代表每种组合一定可读。补 `video_play_actions` 基数，pX/play 仅在同口径可比时称观看进度比例；pX/3秒观看须另名，不能当同一留存。播放事件不等于独立人数，不强制推断为用户 cohort 留存。[Meta 官方 Business SDK](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adsinsights.py)。
- Age/gender 是广告汇总维度；null、未知桶、受限/不可用和无数据分别表示，不能推断个人年龄性别。breakdown 转化指标可用性逐组合验证，不将被省略行当零。
- “素材疲劳”只给基于 ad/creative 日序列、频次与 CTR/CPL 变化的**疑似信号**；需要足够历史、样本及目标一致性。现 campaign baseline 不能直接证明某创意疲劳，7 天数据不足则明确需要更长证据。AI 的分析不得调用发布/止损流程。
- 原始 campaign/ad 名称原样保留，不经过现 MCP 的递归供应商替名。用字段白名单保护内部信息；名称作为不可信数据，不能覆盖工具指令或授权。

## 9. 预计文件、测试、风险与 acceptance criteria

以下是实施落点，不是本轮修改。路径均相对唯一业务仓库；“新”表示拟议文件。

| 文件/目录 | 修改目的 |
|---|---|
| `src/lib/meta-oauth/client.ts`；`src/app/api/auth/facebook/{connect,callback}/route.ts` | Ads intent、最小 scope、主体绑定/一次性 state、真实 token 事实与非 Page callback 分支 |
| `src/lib/platform-oauth/{connection-store,vocabulary,token-manager}.ts`；`src/lib/meta/token-selection.ts` | 扩用途/类型，服务端 scoped lookup；旧 Page path 回归；Meta 到期不假装自动 refresh |
| 新 `src/lib/meta/ads-read-grants.ts`、`ads-read-token.ts` | 许可关系与严格 credential resolver；不回退环境 token |
| `src/lib/meta/{ad-account-binding,ad-account-binding-service,ad-account-registry-write}.ts` | 复用 ID/Graph/重复检查，接入原子冲突协议；保留 staff-only 原路由 |
| `src/lib/meta/{client,entity-settings,objective-metrics}.ts`；新 `read-client.ts`、`insight-contract.ts`、`account-discovery.ts` | 抽出只读调用、扩窗口和人口分组、固定版本、单位/归因/完整度、保留旧 exports |
| 新 `src/lib/agent-tools/{contract,meta-ads}.ts` | 中立定义、八个 handlers、服务器 context，不依赖 Anthropic/MCP 类型 |
| `src/lib/mcp/{tools,rate-limit}.ts`；新 `meta-tools.ts`；`src/app/api/mcp/[transport]/route.ts` | 两类工具均按 scope 检查；Meta 工具不递归改写原始名称；同 server 复用 |
| `src/lib/auth/api-key-access.ts`；`src/app/api/clients/[id]/api-keys/*` | 受限 scope/过期、公开自助发行与撤销须经过本产品的 membership/CSRF/限额校验，不放开原 admin key 功能 |
| 新 `src/app/api/ai-tools/meta/{manifest,invoke}/route.ts` | HTTP/OpenAPI/JSON Schema 出口，复用 handlers |
| 新 `src/app/portal/meta-ads/page.tsx` 及连接组件；新 client-scoped discover/bind/disconnect routes | 免费连接 UX、账户确认、状态/重连/撤销、支持的 AI 连接说明；连接管理不作为八个 AI tools |
| `src/lib/auth/self-serve-client.ts` 或其受限产品入口；相关资格判定 | 复用身份，但避免 onboarding 写 domain/operational 账户或默认报名收费运行任务 |
| `src/lib/clients/binding-audit.ts`；`supabase/migrations/` 新 migration（GO BUILD 后生成） | connection purpose、read grant、授权事务、scope/日志最小扩展、锁与权限；无生产 apply |
| 就近 `__tests__`、`tests/e2e`、`docs/specs` / `docs/sops` | A 级隔离、模型适配、用户流程和数据口径验证；正式 task contract 记录验收证据 |

不把 CAPI writer、Messenger sync、ads execute/boost/publish、既有 Intelligence 算法整套带进来。若原子冲突协议触及共用模块，应拆成可审查安全前置，而非用扩大权限绕过。

测试计划与硬验收：

1. **授权**：取消、拒绝 ads_read、scopes 查询失败、code/state 过期、重放、跨会话、换用户、角色撤销，全部不产生成功绑定；同次回调并发只能消费一次。
2. **隔离**：A/B 两客户交叉 account/connection/campaign/adset/ad/cursor，返回拒绝且不发越权 Graph 请求：先从已授权 account 的边列表/受限过滤路径定位实体并验证 parent，不能用宽 token 先 GET 任意外来 entity ID 再判归属；B 的名称不出现在冲突错误。共享账户、新旧登记混用、分页后冲突、并发抢绑、绑定后变共享均覆盖。
3. **零广告写**：网络 mock 捕获所有 provider calls；广告对象/CAPI 的 POST/PATCH/DELETE、GET method override、任意 URL/字段扩展均为零；导入图禁止到发布、CAPI、stop-loss 模块。OAuth exchange 和本地授权存储作为独立控制面例外。
4. **免费权限**：Ads-only key tools/list 仅 Meta 八工具（可加无敏感信息 health）；直接调用 me_get_goals/SEO/traffic/admin 等仍拒绝；伪造 scope、过期、撤销、旧 key 升权均测试。
5. **凭据生命周期**：重连与断开不覆盖 Page token；外部撤销导致读取失败/重连提示；缓存失效、in-flight grant revision 再验；所有错误和 audit 不泄露 token/个人线索。
6. **无隐式执行**：免费注册连接前后，operational cron、付费采集、CAPI、发布队列/策略执行的候选集合不增加；账户 read grant 不被旧 campaign 写 ownership 接受。
7. **指标**：时区跨日/DST、零分母、币种、百分数与 ratio、重复 action、缺失与零、浮点 action、不累加 Reach、归因不一致、视频不同基数、age/gender 不支持组合、历史停投实体全部 fixture 测试。
8. **上游故障**：429、超时、后续页失败、页数上限、缺失字段、权限掉失分别返回诚实状态；并发限额和额度后端异常 fail closed，不能空数组假成功。
9. **一致性**：同一固定 fixture、context 与输入，MCP/HTTP data+meta 语义相同；任意模型 SDK 只转换 schema，不改变授权或指标；至少一国内模型消费者实际 tool-call 验证。
10. **端到端**：测试账户完成完整连接与撤销；V0.1 八工具逐项与相同口径 Ads Manager/Graph 对账；非 app-role 真人和无终端接入路径单独验收，不以开发者自测替代。
11. **工程门**：GO BUILD 后运行相关 Vitest、类型检查、build、git diff --check；数据库仅本地沙盘 replay、RLS/GRANT/约束/并发和回滚验证；A 级关键守卫 mutation/攻击测试。基线失败必须在同 main 复现，不引用旧 PR 测试结果。

主要风险按阻塞程度：公众自助绑定与旧 operational 权限混用（先解决）；OAuth 主体/用途隔离与共享账户（先解决）；App Review/企业验证（公开发行门）；数据口径/版本/配额（八工具放行门）；客户端无终端接入能力（非技术用户发布门）。大账户异步报表与共享账户 campaign allocation 后置，不用不完整实现承诺支持。

开发工作量初估：A 切片 6–9 工程人日，B 4–6 人日，C 的工程验证 3–5 人日，共 13–20 人日；这是静态 Discovery 估算，不含 Meta 审核等待、额外标准 OAuth 接入或未知迁移历史修复。每个切片重估，不承诺两三天公开上线。

## 复审、验证与停止条件

仓库要求的独立设计复审已进行：子牙（架构）支持 contract-first + 现有 MCP，指出 scope、混合读写、action 语义与名称替换问题；魏征（安全）附条件支持，指出 state、purpose、账户并发、免费入组及 token 回落问题。上述条件已纳入本方案；这是设计建议，不代表代码已修好或安全测试通过。板桥（非技术体验）要求区分 Meta 连接与 AI 可读两种状态、至少一条真实非 Codex 无终端接入路径、不得把普通模型聊天页自动视为 tool client，已纳入 §5 与发布验收。最终文档由架构与安全再核对一轮：方向通过，补入授权版本覆盖旧绑定、实体读取顺序及 manifest 权限过滤；不再开启额外设计轮次。

本轮完成静态源代码/调用方/迁移文本/相关 GitHub 状态检查与官方资料读取。未安装依赖或运行测试、type-check、build、浏览器、生产数据库和 Meta 实账号探针；未对真实广告账户产生读取/写入请求。Meta 官方部分网页不可读取已如实列明。临时源码 checkout 保持干净。

Reuse Statement：复用现有 Meta 读取、OAuth exchange、加密 store、账户规范化/校验、审计、ME 身份与 MCP transport。新增仅中立工具契约、read-grant 用途隔离及产品入口；无新智能层、第二套 token vault 或 Meta 基础设施；无客户/行业事实写进 shared runtime；没有客户学习晋升。提案落点与 L3 + 既有平台基础设施判定一致。

**最短板是公众授权与租户/用途边界，不是广告指标抓取。下一道唯一产品门：PO 的 `GO BUILD`。在此之前停止，不实施、不建施工 PR、不 merge/deploy/apply，不写广告。**
