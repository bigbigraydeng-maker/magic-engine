# 社媒客户接入：真实状态与统一入口

## 当前追加任务：Instagram 独立登录原生连接（仅账号资料）

本节为当前唯一写入范围，替代此前已完成任务；根会话唯一写入，子牙、魏征、板桥只读审查。风险 A；频率高 / IMPACT 高 / 收入中 → P0。

- 目标：复用既有客户守卫、加密连接表、状态投影和设置面板，新增 Instagram API with Instagram Login 专业账号连接。只请求 `instagram_business_basic`，不申请发布、评论或消息权限，不宣称可自动发布。
- 基线：隔离工作区 `/private/tmp/magic-engine-social-channel-onboarding`，分支 `codex/instagram-native-onboarding`，起始 `46090e93275632e727f73b1d4594161e563702c4`；依赖尚未合并的 PR #2895；本次 fetch 后 main `3f1c24526dfbbc1b1823ac597a984a696fc20108`，新增仅广告说明。不编辑共享主工作区。
- 写入：`instagram-oauth`；Instagram connect/callback 及客户 scoped DELETE；platform-oauth provider、窄读取、状态/健康投影/scope gate；设置面板/回跳及对应测试；CLI 已生成的 provider CHECK 迁移；ENV/.env.example、此说明与新台账。无新框架、表、依赖或后台任务。
- Tier / Reuse：既有社媒 L3 Connector，handle 为 L4 配置；客户和行业不改变授权语义。连接只保存长期 token，真实期限与实际 granted permissions；没有刷新调用方，本轮不实现刷新，过期需重新连接。新 provider 没有既有客户需重连，Meta scope 不变。
- 安全：默认关闭的独立开关和 Instagram product 凭据；随机 nonce/HMAC/短期 HttpOnly cookie 绑定浏览器、发起用户、客户与服务端规范 handle；交换前后重查身份/访问权/配置/开关；账号由长期 token 的 `/me.user_id` 字符串与精确 username 核验。取消、错配、异常不写库，不覆盖旧授权，不清除其他新尝试 cookie。
- 允许本地实现、验证、提交推送和叠加 PR；不合并、部署、执行生产迁移、访问生产密钥、配置新应用或接受新授权，不发布/关注/读取私信。准备迁移并以本地隔离 PostgreSQL 验证。
- 验证：协议/state/真实 handler cookie、隔离与等待期间变更、窄读取、错误脱敏、默认关闭、UI 回跳/撤销；本地 SQL；定向 Vitest、完整类型、lint、假配置 build、冻结代码 mutation、三方实施复审。Mock 不代表真实授权或平台审核完成。

官方依据（2026-10-19，通过当前 Chrome 实读）：[Business Login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login)，页面更新 2026-03-13；[Get Started](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/get-started)，当前示例 v26.0。授权地址 `www.instagram.com/oauth/authorize`；code 交换为 api.instagram.com 的 multipart POST，示例为单项 data 数组含 access_token、字符串 user_id、permissions 逗号串；长期 token 交换为 graph.instagram.com/access_token，返回 access_token、bearer、expires_in；me 示例返回单项 data 数组中的字符串 user_id 与 username。id 是 app scoped，不能代替 user_id。生产接入仍需专业账号、独立 Instagram product 凭据、回调及平台审核/测试资格。

### Instagram 本轮验证回执（2026-10-19，尚未上线）

- 基线四文件 57 测试通过；最终恢复源文件后的定向回归含 Instagram、既有 Meta/TikTok/YouTube、客户守卫及台账：31 文件、518 测试通过，退出 0，日志 `/private/tmp/celine-ig-final-regression.log`。协议与 handler 使用真实 HMAC/NextRequest/cookie 边界，外部 API/DB 替身；不是生产授权验收。
- 官方 CLI 创建迁移后，只在 `/private/tmp` 的一次性真实 PostgreSQL 应用：保留十个既有 provider、接受 Instagram、拒绝未知值、重放通过；Unix socket only，无 TCP 监听，完成已停止。未连接生产或执行生产迁移。CLI 的遥测写入及本地共享内存受沙箱限制后使用已批准提升；未修改数据库访问权限。
- 最终源码 `npm run type-check`（Node 堆 8GB）、所有变更 TS/TSX 的显式 next lint、回环 URL/假 key 的 `npm run build` 全部退出 0；Kernel architecture 203/203，通过。临时预览路由移除后 build 重建类型文件，再跑完整 type-check；无残留测试入口。构建不替代独立类型/静态检查。
- 对冻结的源码/测试/SQL集合执行九项 mutation：cookie、发起用户、最终目标、实际 scope、核验用户名、撤销客户过滤、末端开关、state 期限、token 期限，全部退出 1 且为断言失败；每轮恢复源字节。集合 SHA256 `041732ae9eaab04d9010a012931db51a659e4f7d11e67d57f6033d800926d40a` 恢复前后一致，提交时再核对；无变体残留。完整相关 21 文件套件用于每项变体；恢复后再跑上面的 31 文件回归。
- 子牙/魏征两轮安全与架构审查收敛；板桥两项 P2（用户名规则矛盾、多授权客户循环）已批量修复，Round 2 通过。新增三例最后 DB 等待期间关闭开关/state 到期/token 到期的持久回归；魏征亦独立探针验证均零写入。不宣称跨系统原子或服务端严格一次 state 消费。
- Chrome 合成数据检查真实组件的资格提示、最小权限、六卡与多授权无误导 CTA；本地截图在用户输出目录。Jev DNS 失败后原生继续，元数据观察记录已保存；不把私有授权页发给决策服务。没有真实账号新增 grant、发帖、DM 或生产变更。
- 新功能默认关闭。真实可用仍需合并依赖 PR #2895 及本 PR、应用迁移、独立 Instagram product 凭据/HTTPS 回调/专业账号和平台审核或测试资格，再受控真实授权。此提交不代表 Celine 已连上，也不包含发布器。

## 先前任务：浏览器实测后的授权修复

本节替代下文已经完成的实现范围。唯一写入者为本 Codex 根会话，子牙和魏征只读审查。

- 目标/验收：Meta Page 的成功及取消回调均绑定发起浏览器、用户、客户访问权和最初服务端目标；可信取消回原客户可见面板；不可信回调零平台请求、零写入。
- 范围：meta-oauth/client.ts、Facebook connect/callback、三处对应测试、本说明与新台账。其余平台后台仅检查和准备，不访问生产密钥。
- 基线：UTC 2026-10-18 已 fetch；工作区 `/private/tmp/magic-engine-social-channel-onboarding`，分支 `codex/social-oauth-remediation`，干净起点 HEAD/origin/main `9b9c68548a559ca5d8d3d25b3cc7b7b156d8828f`。Node/依赖沿用现有工作区。
- 风险 A；频率高 / IMPACT 高 / 收入中 → P0。本地实现、测试、提交、推送 PR 在范围内；本轮不合并、部署、发帖、开自动化、扩大 scope 或接受新授权。
- Tier / Reuse：既有社媒 L3 Connector 安全修复，账号目标 L4；CTS/Roman 和旅游/地产使用相同校验，无客户或行业语义。复用原 HMAC、客户 guard、连接存储与 FacebookPagePanel；不新增框架、表、依赖、能力线或 Inngest 事件。
- 双审设计：随机 nonce、发起人及服务端目标签入 state；短期 HttpOnly cookie 绑定浏览器；先验证后处理取消/交换；当前尝试结束清 cookie，旧窗口错配不得清新尝试。旧 state 缺少新字段要求重新连接，不做兼容绕过。结果仍回真正显示 meta 提示的面板。
- 基线验证：相同三处定向 Vitest 退出 0，3 文件 59 测试通过。后续扩展取消、cookie、切换身份、撤权、目标变化及读失败回归，再跑类型、lint、假配置 build、冻结代码 mutation 和双审。
- 现场条件：ME TikTok 主应用已 In review；另建 Celine 应用是空草稿，不重复接入。Sandbox 目前只有 CTS 目标，新增 Celine 需要登录和具体授权。Google 原项目仍需验证；不绕过未验证提示。Facebook 当前身份没有列出 Celine，不能绑定其他客户 Page。IG/Threads/X 原生缺口单列，不伪造接通。

类型基线追加：沿用用户此前“修复基线错误”的要求，仅允许修正 `src/lib/capabilities/ads/__tests__/envelope-facts.test.ts` 的测试辅助函数参数类型；不改广告生产代码或断言。未改动主干归档在相同依赖与 8GB Node 上执行 `npm run type-check` 也出现同一四条错误；该测试修改前 51 例通过。实际 resolver 契约接受字符串 actionKey，测试 helper 误限三个旧动作；从真实契约派生类型即可保留新旧动作测试，无须 any、强转或抑制。不是扩大广告业务范围。

台账基线追加：同一未改动主干的 entries 检查也因 `2026-10-19-stop-loss-route-503-account-id-shape.md` 正文含两个完整账户号失败；仅将这两个正文示例替换为 `<account-id>`，前置字段及验收文字逐字不动，不更改台账检查或冻结规则。

### 当前追加任务的验证与现场回执

- 基线三文件 59 测试通过；实施后覆盖成功、取消、cookie/HMAC、切换用户、撤权、服务端目标变化、平台等待期间变更与写失败。新增四例真实 handler/HMAC/NextRequest 和响应 cookie 交接；外部平台与数据库用替身，不宣称真实平台授权成功。
- 最终定向命令：`npm test -- src/lib/meta-oauth src/app/api/auth/facebook src/lib/platform-oauth src/lib/auth/__tests__/client-access.test.ts src/lib/capabilities/ads/__tests__/envelope-facts.test.ts src/lib/ledger`，退出 0，22 文件 412 测试通过，日志 `/private/tmp/celine-oauth-final-tests.log`。
- 默认 type-check 因 Node 4GB 堆耗尽退出 134；同命令加 `NODE_OPTIONS=--max-old-space-size=8192`，修正上述测试类型后退出 0，日志 `/private/tmp/celine-oauth-final-types.log`。没有跳过或抑制类型检查。
- 八个变更 TS 文件显式传入 `next lint --file`，退出 0。使用回环 Supabase URL/假 key 的 `npm run build` 退出 0，日志 `/private/tmp/celine-oauth-build.log`；未使用生产凭据。`git diff --check` 退出 0。
- 子牙/魏征 Round 1 提出的落库前重查、持久化异常和旧回调擦新 cookie 均已修；Round 2 无新增 blocker/P1/P2。测试 helper 类型由子牙单独核对真实契约，通过。不是服务端严格单次 state 消费，也不声称外部授权与数据库配置跨系统原子。
- Chrome 已将 Celine 登记的新 Facebook Page 配为发布目标，并刷新读回“发布目标已配”；自动出片关闭、收件箱未绑定、无发帖。当前 Facebook 身份的可管理主页搜索仍没有 Celine。TikTok 主应用审核中，添加沙盒目标要求重新登录，已保留用户登录窗口；未新增 grant。Google 审核准备页缺用途说明及 demo，已配置权限不含当前运行时请求的 YouTube 三项，需单独核对重提范围，未改全局项目。
- 浏览器使用原生控制检查私有授权页面，未向外部决策服务传页面；一条纯元数据观察记录已保存。截屏/客户现场回执仅保存在用户本地输出目录，不提交仓库。
- 本轮尚未合并/部署或完成任一新平台授权；后续 commit/PR、mutation 和发布决定以实际回执为准。

## 本轮权威任务说明

- 目标：让客户与团队在同一入口识别六个平台的登记、授权记录、目标账户与下一步；复用已有授权及配置流程。
- 验收：资料不等于授权；Facebook 匹配工厂发布主页而非收件箱；YouTube 匹配配置频道且只描述私享暂存；TikTok 不凭 handle 推断授权身份/公开审核；读失败、未知状态、多账户不显示完成；无凭据/平台错误原文返回浏览器。
- 写入者：本 Codex 会话；范围为 `platform-oauth/social-onboarding*`、连接存储窄读取、客户 `social-connections` GET 及测试、设置页面/面板、旧 social 标记入口和状态、YouTube 频道读取编辑权限、TikTok/YouTube 可信取消回跳及对应测试、本说明及台账。其他窗口只读审查。
- 基线：2026-10-18 UTC 已刷新 origin/main；工作区 `/private/tmp/magic-engine-social-channel-onboarding`，分支 `codex/social-channel-onboarding`，HEAD `56749dd438fbf197eda9fd5a3e224fd32bbbbd4d`，初始干净。审查期间本地 origin/main 变为 `c06fab3967cf52496a44935c3e02310e8d12c2b4`，新增仅广告测试说明文档，不影响本轮。
- 权限：本地实现/测试、提交分支及 PR；不合并、不部署、不改生产数据，不访问生产密钥，不申请账号新权限。
- 风险 A：新增客户范围的授权事实读取；使用原有隔离守卫，明确查询列、客户/provider/purpose 过滤，GET 无外部请求/刷新/写库。
- 不做：新增 OAuth 引擎、令牌表、发布器、后台授权、发布/关注/私信；不接已退役的发布服务；本轮不扩大现有角色权限。
- 验证：定向 Vitest（状态、端点隔离/失败/脱敏、组件动作与回跳）→ type-check → targeted lint → build；相关基线先跑，修改后同命令复跑。验证只用测试替身和非生产构建值。

## Tier Classification Report

1. 对象：既有社媒 L3 Connector 的客户接入展示与导航，客户目标属于 L4 configuration；不新增 L1 能力线或行业版本。
2. 归属：社媒支柱的 Inspect / Act 前置，连接官方平台。
3. 换客户：CTS、Roman 使用同一查询和判据，仅账号、发布主页和频道配置不同。
4. 换行业：旅游、地产不改变授权身份或平台语义。
5. 执行边界：复用 OAuth/存储/配置，不重造授权基础设施；纯 GET 不需要 Inngest。
6. 红线：不包装新能力、不放客户事实或行业规则进共享代码、不引入新 L1/L2，客户与行业测试通过，候选晋升不适用。
7. PM 待拍板：无新增商业/支柱决定；用户已授权检查现有代码并开发，继续本轮。
8. 复用：既有客户 guard、平台连接表/加密、工厂目标投影、Facebook 设置抽屉、YouTube 配置、TikTok OAuth；不新增数据库结构。新增窄读取因为旧 listConnections select('*') 且失败返回空数组，不能证明真实状态。

按 §11：接入状态/入口频率高 / IMPACT 高（阻塞 Act 且可能给错误信号）/ 收入中 → P0；缺少平台连接器另列后续，不用未实现的能力装成已接通。

## 当前主干核查与后续

Facebook 原生 OAuth 与 Reel adapter、TikTok OAuth/直发/刷新、YouTube 频道锁定/暂存/授权都已存在。Facebook 发布目标与 inbox 绑定是独立配置。Instagram 现有旧 adapter 依赖用户已禁止的发布服务；本轮不使用。主干检查范围内未找到 Threads/X 原生授权与发布器。

| 平台 | 现有实现与可复用位置 | 接入障碍的性质 |
|---|---|---|
| Facebook | `meta-oauth/client.ts`、`api/auth/facebook/{connect,callback}`、`factory/publish/facebook-reel-adapter.ts`、`FacebookPagePanel.tsx` | 多处 UI/配置分散；首次发布需工厂目标；现有授权还包括消息/评论/线索。专用最小权限与授权后 Page 选择尚需独立安全实现。 |
| Instagram | `factory/publish/instagram-crosspost.ts` 及旧适配器；`SocialHandlesPanel.tsx` 仅登记身份 | 现有主干无可供本任务使用的原生 OAuth，不能把旧发布服务配置当成原生授权。 |
| Threads / X | 本次范围查找 `src/app/api/auth`、平台 provider 词表、`factory/publish` 与设置调用方 | 未找到原生连接与发布实现，属于技术缺口，不能只改按钮冒充可用。 |
| TikTok | `tiktok-oauth/client.ts`、`tiktok/token.ts`、`tiktok/post-send.ts`、现有发布审核 UI | OAuth/刷新/直发可复用；持续状态、身份与回跳属于体验缺口；生产应用审核是独立平台门槛。 |
| YouTube | `youtube-publish/{oauth,client,workflow}.ts`、`api/auth/google/youtube`、`YoutubePanel.tsx` | 频道锁定/暂存/授权可复用；授权由内部管理员执行，公开步骤仍是单独受控范围。自助选择频道不可仅靠前端放按钮。 |

后续工程边界：发布专用的最小 Meta 授权（现有入口请求消息/线索等权限）、首次授权后可用 Page 的安全选择、Instagram 原生连接、Threads/X 连接与发布器、TikTok 应用审核、YouTube 自助账户选择及公开发布验证。不能靠本轮展示页宣称这些已经可用。

## 设计审查

已完成子牙、魏征/狄仁杰、板桥三方只读设计审查：使用窄读取；排除 Meta 广告只读用途；token 过期不等于可刷新平台已断线；匹配具体目标；按现有角色显示下一步；公开发布资格保持未核实。实施后沿相同边界复审。

实施 Round 1 发现的撤销入口回归、配置后继续入口、已授权客户提示与可信取消回跳已批量修复。Round 2 的撤销异步回调跨客户切换回归已补生命周期隔离和专门回归测试。

## Reuse Statement

实现仍落既有社媒 L3 连接与 L4 客户配置，和层级判定一致；新增共享内容仅为保存事实的读取、投影与界面。复用原有 OAuth/加密表、客户 guard、发布目标投影和 YouTube 撤销端点；无新依赖/表/权限范围/发布通道/行业规则。客户事实仅来自该客户配置，没有客户名或 ID 写进共享运行逻辑。本次没有将客户私有学习晋升到行业或全局记忆。

## 本地验证记录（2026-10-19 Pacific/Auckland）

目录/分支/HEAD 与上文一致；修改均为本任务未提交 diff。未使用生产凭据、真实账号授权或外部发布。

- 修改前定向基线：`npm test -- 'src/lib/platform-oauth/__tests__/connection-store.test.ts' 'src/app/dashboard/clients/[id]/settings/_components/__tests__/SettingsTabs.test.ts' 'src/lib/meta-oauth/__tests__/client.test.ts'`：退出 0，3 文件 58 测试通过。
- 最终回归（11:15 NZ）：以下命令退出 0，17 文件 222 测试通过；不是整仓全量测试。

```sh
npm test -- 'src/lib/platform-oauth' 'src/lib/meta-oauth/__tests__/client.test.ts' 'src/lib/youtube-publish/__tests__/oauth.test.ts' 'src/lib/auth/__tests__/client-access.test.ts' 'src/app/api/clients/[id]/social-connections/__tests__/route.test.ts' 'src/app/api/clients/[id]/connectors/status/__tests__/route.test.ts' 'src/app/api/clients/[id]/connectors/[anchor]/connect/__tests__/route.test.ts' 'src/app/dashboard/clients/[id]/settings/_components/__tests__/SocialConnectionsPanel.test.tsx' 'src/app/dashboard/clients/[id]/settings/_components/__tests__/YoutubePanel.test.tsx' 'src/app/dashboard/clients/[id]/settings/_components/__tests__/SettingsTabs.test.ts' 'src/app/api/auth/tiktok/callback/__tests__/route.test.ts' 'src/app/api/auth/google/youtube/callback/__tests__/route.test.ts'
```

- `npm run type-check`：退出 2。将 HEAD 归档到独立临时目录，使用同一 `node_modules`、相同命令建立对照；基线与最终均 17 条错误，完整输出 `cmp` 相同。错误在 auto-dev、ads-health 测试、messenger 测试、Meta Ads metrics 测试、ops-review-loop 测试，本轮没有新增；不宣称整仓类型检查通过。
- 必过台账检查 `npm test -- src/lib/ledger`：当前与独立 HEAD 基线均退出 1、99 通过/1 失败；失败涉及相同的四张既有台账格式错误，本轮未修改这些卡。本轮新增卡通过现有 `parseLedgerFile` 校验。该整仓红项未擅自修复，仍是提审限制。
- 改动的 `.ts/.tsx` 文件逐一传给 `next lint --file`：退出 0，零警告/错误。
- `npm run build`：本地假 Supabase 值（指向回环地址）及假 key，退出 0；Next 配置跳过 type/lint，构建成功不代替上面的类型结果。
- 实际 Next 服务边界：未登录请求新状态 GET，HTTP 401，响应只含 Unauthorized；未触发平台调用。业务隔离、purpose/字段与失败状态另由定向路由测试覆盖。
- 六项关键 mutation：移除访问闸、替换客户过滤、取消 Meta purpose 排除、放宽目标匹配、跳过所需权限、放过旧客户撤销回调，均令测试失败（6/6 捕获）；各次恢复源文件并核对字节散列。没有新增测试工具依赖。
- Chrome 使用合成资料检查六卡、刷新操作及无横向溢出；Jev 因 DNS 无法决策，原生操作完成独立核验。浏览器观察记录已保存；没有上传真实客户页面。临时预览路由随后删除，不进入提交。
- 子牙、魏征/狄仁杰、板桥设计与实施复核完成；撤销回调回归单独复验通过。无未解决 blocker/P1/P2。
- 未运行：生产 OAuth、真实撤销/发布、全仓 Vitest、平台审核验证。没有部署或生产数据变更。

## 用户追加范围：修复基线错误（2026-10-19）

此段替代上轮“既有红项不在本轮修复范围”的限制。用户已明确要求修复基线错误；唯一写入者仍为本 Codex 根会话，其余审查者只读。

- 验收：消除已复现的 17 条类型错误及 4 张卡格式错误，完整 type-check 与 ledger 检查通过，六个相关测试文件断言保持并通过。
- 写入范围：auto-dev/pick、ads-health/autonomy-settings、messenger/send、meta/ai/metrics、ops-review-loop/merge-decision 与 workflow-guards 六个测试文件；四张失败旧卡、明确标注历史转录的 D3 证据文档、本说明和本次台账卡。
- 不做：生产逻辑、工作流/检查规则、依赖、数据库、真实账号授权/发布、合并或部署。本次仅测试/文档维护，但涉及 ops-review-loop 受保护测试路径，按 A 级控制面审查；整张 PR 原有 A 级不降低。复用现有测试与台账解析器，无新能力、框架或客户特供逻辑。
- 基线：目录 `/private/tmp/magic-engine-social-channel-onboarding`；分支 `codex/social-channel-onboarding`；HEAD `f917e629fa32615cec2f9d5ddecb090ca95b2056`，开工工作树干净。fetch 后 origin/main `ae35bcaff91428cc5e1932633292accc9b85f1a1`，未合并/更新工作分支，目标文件无上游改动。Node 26.7.0、既有 node_modules；无生产凭据。
- 修改前真实验证：`npm run type-check` 退出 2（17 条错误）；`npm test -- src/lib/ledger` 退出 1（99 通过 / 1 失败，涉及四卡）。命令运行于本目录同一 HEAD，日志在本机 `/private/tmp/baseline-repair-before-{types,ledger}.log`。
- 方案：补 mock 签名/人工发送参数；对象断言保留原键和值；移除失效抑制；补测试 YAML 类型。不改运行时契约。台账仅修语法/指针，不改历史结论；D3 历史转录不算生产复验。
- 已读 `playbook-social-general.md`；本轮不生产或发布内容。按 §11：频率高 / IMPACT 中 / 收入中 → P2。
- 子牙与魏征已完成只读设计复核，无 blocker；实施后复核同一 diff。

### 基线修复结果（11:31 NZ，同目录/分支、HEAD 加本轮未提交 diff）

- `npm run type-check`：退出 0，原 17 条错误已消除；日志 `/private/tmp/baseline-repair-after-types.log`。
- `npm test -- src/lib/ledger scripts/auto-dev/__tests__/pick.test.ts 'src/app/dashboard/clients/[id]/ads-health/__tests__/autonomy-settings.test.tsx' src/lib/messenger/__tests__/send.test.ts src/lib/meta/ai/__tests__/metrics.test.ts tools/ops-review-loop/tests/merge-decision.test.ts tools/ops-review-loop/tests/workflow-guards.test.ts`：最终退出 0，14 文件、223 测试通过；日志 `/private/tmp/baseline-repair-final-tests.log`。含整仓台账格式检查；首次修复后原卡另暴露 6 行正文超限，已保留完整原文移入历史文档，未删业务结论。
- 六个修改测试文件传给 `./node_modules/.bin/next lint --file ...`：退出 0，无警告/错误；日志 `/private/tmp/baseline-repair-lint.log`。
- `git diff --check`：退出 0。独立比较原 HEAD 与现文：kernel `verify_how` 解析值逐字相同、D3 原正文完整转录且除 `done_ref` 外原字段不变。
- 子牙、魏征实施复核通过，无 blocker/P1/P2；魏征独立复跑相同 14 文件、223 测试，退出 0。
- 未重跑 build/E2E/全仓 Vitest：追加改动仅测试和文档，无生产代码或构建配置变更；上轮应用构建证据不冒充本轮全量测试。未访问生产、合并或部署。

## 合并前检查点（2026-10-19 11:36 NZ）

用户已明确授权合并。PR 已转为待审并通过 GitHub update-branch 合入当时最新 main；本地干净工作树快进到同一版本。检查版本：HEAD `c2d891c8b08c1d109b7500fb10de9bb928f2d1f9`，base `ae35bcaff91428cc5e1932633292accc9b85f1a1`。相比已审修复提交仅增加上游两份广告文档。子牙、魏征确认源码审查可继承，但下列真实失败出现后，不再代表可以合并。

- `npm run type-check`：退出 0。`./node_modules/.bin/tsc -p tools/ai-orchestrator/tsconfig.json`：退出 0。
- 社媒原定向回归 + `tools/ops-review-loop/tests` + `tools/ai-orchestrator/tests` + `src/lib/ledger`：63 文件、1728 测试通过，退出 0；日志 `/private/tmp/celine-merge-tests.log`。
- `./node_modules/.bin/vitest run --config src/lib/kernel/__tests__/vitest.architecture.config.ts`：退出 1，202 通过 / 1 失败。`src/lib/factory/publish/promote/books-port.ts` 直接写入 execution_items，不在架构允许范围；PR 未改该文件。对 base SHA 使用 `git archive` 建独立目录 `/private/tmp/celine-merge-main-baseline`，同依赖/同命令复现相同失败。只能证明为主干既有问题，不能当通过。
- `BASE_SHA=<上述base> HEAD_SHA=<上述head> node --import tsx scripts/ledger-check-frozen-runner.ts`：退出 1。kernel 旧卡 verify_how 虽解析值相同，但治理检查明确比较原始字段，块标量包装构成冻结冲突。前轮仅核对语义，遗漏实际冻结检查；子牙已撤回对此格式修正的放行。
- GitHub Actions 在该 head 返回 startup_failure、没有启动检查步骤，`gh run view` 仅提示可能为工作流问题，具体原因未确认。Cloudflare Pages 成功不能替代必过检查。
- 停止合并：不扩大执行写入白名单、不修改 Kernel 运行语义、不放宽冻结规则、不伪造远端绿。上述两项需受控修复后复验；本轮未执行 merge、未触发 main 部署。上轮“无 blocker”结论由此检查点更新。

## 用户追加授权：修复合并阻塞后再次上线

用户已授权修复上述两项后重试合并与上线。唯一写入者为本 Codex 根会话；子牙和魏征只读审查。目录和分支不变，起始 HEAD `bde334fba9c67f9a6a37b61fc6b2d64c054b2be2`，工作树干净；刷新远端仍为上述 main。风险 A；按 §11：频率高 / IMPACT 高 / 收入中 → P0。

Tier Classification / Reuse：既有社媒 L3 发布完成回执与 L1 治理实现修复，不新增 Capability、支柱、行业版本或候选。正常发布与转公开共用现有发布完成投影；客户身份继续参数化且不注入客户/行业判断，换 CTS、Roman 或旅游/地产不需改语义。台账默认原文字节冻结继续有效，仅限无效 YAML 的 verify_how 原样规范包装；不接受实际内容变动。无需新 Inngest 事件：既有转公开工作流与栅栏仍负责外部副作用，本轮只合并其同步完成投影。

写入范围：publish-worker.ts、promote/books-port.ts 及相关测试；ledger/frozen.ts 及单元/真实 Git 集成测试；本说明与本轮台账。禁止改架构白名单、降低必过检查、引入新依赖/数据库结构、重放真实社媒发布或修改生产客户数据。允许本地验证、提交/推送、合并本 PR 并核验部署；不使用生产密钥补测试环境。

设计已由子牙与魏征只读核查：提取已有严格 completed 投影，两个原调用方共享；冻结例外必须满足 base 真 YAML 语法错误、唯一单行 plain 字段、head 精确规范块包装、修正该字段后 base 语法完全有效、head 完整合法、原文字逐字保留。其余字段仍原文冻结。验收：相关回归、类型、lint、build、Kernel architecture、台账格式/冻结/指针检查均通过，再复核并尝试合并；远端不可用不能冒充通过。

### 修复实施验证（2026-10-19 11:50 NZ）

本节更新上一检查点中的两项代码阻塞：已修复，远端合并/部署结果须另行核验。目录/分支同上，起始 HEAD 加本轮 diff。未使用生产数据库或真实发布作为测试。

- 从既有 writeThreeBooks 提取固定 completed 投影，两个原调用方共用；删除 promote 重复 SQL，架构白名单、Kernel 运行逻辑、claim/fence 均未改。投影失败仍独立写流量/工作日志，保留普通数据库错误信息。
- 冻结默认 raw 比较不变；规范包装例外仅修无效 verify_how 的原文，新增改字、重复键、注释截断、续行、有效旧 YAML 及同时改其他字段的拒绝测试，并真实 Git 提交对照验证。
- `npm test --` 原社媒定向路径、tools/ops-review-loop、tools/ai-orchestrator、src/lib/ledger、promote、两个 publish-worker 测试及六个基线修复测试：退出 0，75 文件、1977 测试通过，完整输出 `/private/tmp/celine-unblock-final-tests.log`。
- 原架构命令 `./node_modules/.bin/vitest run --config src/lib/kernel/__tests__/vitest.architecture.config.ts`：退出 0，203/203 通过；输出 `/private/tmp/celine-unblock-kernel.log`。没有改架构测试或扩大许可。
- `npm run type-check` 与 `./node_modules/.bin/tsc -p tools/ai-orchestrator/tsconfig.json` 均退出 0；六个变更 TS 文件的 `next lint --file` 退出 0，无警告/错误。
- 最终代码 `npm run build`（回环 Supabase URL 和假 key）退出 0，输出 `/private/tmp/celine-unblock-final-build.log`；没有访问生产补凭据。构建不代替独立类型检查。
- 四项 mutation 均被测试捕获：删投影客户过滤、删回挂客户过滤、允许有效 YAML 重写、放过验收文字改写。每次退出 1；逐项 finally 恢复并比较 SHA256，未留变体。
- 子牙、魏征设计/实施复核无 blocker/P1/P2；魏征独立 8 个攻击/正例符合预期，四文件 62 测试通过。子牙指出的普通错误对象日志信息丢失已修并补精确消息断言，最终回归覆盖。
- `git diff --check` 退出 0。提交后必须执行真实 base..head 的台账冻结/引用脚本；合并时固定经审查的 head。没有新增能力线、依赖、表、外部授权或客户事实；本轮只复用已有完成投影与治理解析器。
