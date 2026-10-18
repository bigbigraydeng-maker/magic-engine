# 社媒客户接入：真实状态与统一入口

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
