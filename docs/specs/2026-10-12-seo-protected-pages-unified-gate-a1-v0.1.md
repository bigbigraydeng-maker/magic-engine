# SEO 保护页统一闸（手册行 A1）设计稿 **v0.3**（文件名沿用 v0.1）

> 状态：**设计稿 v0.3。** 已过两轮子牙（架构）+ 魏征（挑刺）审查；第二轮结论「小改后可开工」，本版吸收全部意见。风险级别：**A**（碰 Kernel 边界测试与鉴权入口）。
> 权威来源：[SEO 手册 §5.3 / §5.3.5 / §13 行 A1](../sops/2026-10-11-seo-agent-playbook-and-rules-v1.0.md)（PR #2455，读的是分支 `claude/funny-snyder-7e231f`）。
> 范围外（PM 已定）：不改 `oztop-seo-optimizer`；不动标题周循环自动合并行为（PM 2026-10-11「保留自动」，仅非保护页标题/描述）；不做 A4 写入对账、批准按钮、名单专用增删入口（手册 P-02c，留后续）。
> 基线：HEAD = `origin/main` = `8f16acaf1`（2026-10-12 fetch 后）。
> **v0.2 → v0.3 的核心改动**：通行证（路由铸造、写函数核对指纹）整个换成**「写函数自己算身份、自己过闸」**——写函数收到的是一个只含「客户 + 操作人」的闸对象，**页面身份由写函数用它自己真正要写的目标算出**，路由说谁是谁不再有人信（子牙 N1、魏征 N1/N2/N3 同源）。

## 0. 一句话

给「写客户网站」的每一条路径装同一把锁：**保护名单里的页，系统一个字都不自动改；人点按钮改，也只有 PM 能改。**

## 1. 现状（子牙 / 魏征 / 本窗口三方 grep 核实）

- 读名单：`seo-meta/cycle/roster.ts`（解析 + 批量读）、`runner.ts:292`、`seo-weekly-list/run.ts:396`、`candidates.ts` `slugOf/isExcludedUrl`；`gate.ts`、`types.ts` 只有注释。全仓无其他读取。
- 三种口径并存；每周清单遇非数组当空名单（**fail-open**）；roster 对「数组里夹着非字符串」静默丢弃（`[{"slug":"x"}]` 解析成空名单且判「没坏」）；首页归一化成空串被丢；超 50 静默截断。
- 人点按钮三条路只验「登录 + 付费客户成员」。
- **`seo-fix` 是未登记的 Kernel 旁路**：`seo-fix-orchestrator.ts` 用相对路径 `./github-client`，架构测试与 ESLint 只匹配别名写法，抓不到。本稿**不修这条规则本身**（会让现有测试变红，另算一件事，登记台账），但本稿的闸必须覆盖它，且新扫描（§5⑤）按「引用了写模块（含相对路径）」判，自然把它纳入。
- 手册「汇合点在 `capabilities/`」只对 `page-apply-optimization` 成立（已修正）。

### 1.1 全部写客户网站的调用方（`PROVIDER_WRITE_MODULES` 全量）

| 路径 | 改已有页？ | 本稿 |
|---|---|---|
| 标题周循环 `apply-adapter`（写入单位=数据文件，一个文件含多页） | 是 | **覆盖**：逐 slug 过闸；**合并 PR 前再过一次**（写入到自动合并之间名单可能变） |
| `seo-fix` → `seo-fix-orchestrator` | 是（数据文件里的条目） | **覆盖**（§2.1：slug 出现多次即 unknown） |
| `cms/github/update-page` → `github-page-upgrade-publisher` | 是 | **覆盖** |
| `cms/wordpress/update-post` → `updateExistingWordpressPost` | 是 | **覆盖** |
| `capabilities/page-apply-optimization`（Draft PR） | 是 | **覆盖**（无 override） |
| `cts-meta-pr.ts` `runCtsMetaPr`（旧 CTS 标题 PR 执行器，路由已 410，仅测试调用，**但 9-28 事故里被复活过的就是这类旧路**） | 是 | **覆盖**：给它也加必传闸对象，不只是白名单 |
| 每周清单 | 不写，只出清单 | 覆盖（读侧，fail-closed） |
| `publish-geo-to-github` | 往全站模板 `<head>` 注入 GEO 标记，**会影响保护页** | **不覆盖**：白名单带「文件 + 允许的写调用次数」，台账跟进（站点级注入算不算「受保护字段」是 PM 判据，不在 A1） |
| `publish-wordpress`（含其对**自己建的草稿**的 delete）、`publish-shopify`（`publishShopifyPage` 发布 ME 新建页）、`publish-geo-snippet`、`publish-blog`/`blog-publisher`（无 sha，只能建新文件） | 否（新建 / 删自己的草稿） | 不适用；白名单每条带一句「为什么不会改已有页」（审查时核，测试只冻结次数） |
| `cms/test`、`wordpress/test`、`lookup-post`、`yoast-probe`、`connect`、`cms/shopify/route.ts`、`cms/wordpress/route.ts`、`cron/cms-connection-retest` | 否（只读/连通性/配置） | 不适用 |
| `blog/pr-sync`、`cms/page-upgrade-pr-sync`、`cms/github/webhook` | 否（PR 状态同步） | 不适用 |
| `gsc/index-request`、`reels/*/publish`、`publer/*`、`luban/tools.ts`(GBP)、`flywheel/social-post-publish` | 否（非站点页） | 不适用 |

## 2. 要建的东西（`src/lib/seo/protected-pages.ts`，不进 `kernel/`；只收注入的 supabase 客户端，不自己 import `supabaseAdmin`——`capabilities/` 禁止直连库）

### 2.1 页面身份 = 一组身份，由**写函数自己**算

`PageIdentity = { paths: Array<{ value: string; kind: 'url' | 'file' }>; slugs: string[] }`。

| 路径 | 谁算 | 身份来源 |
|---|---|---|
| 周循环 | `apply-adapter`（每个要改的 slug） | `candidate.pageUrl` 路径 + 数据 slug（按现有约定数据 slug = URL 最后一段，`buildSlugIndex` 即按此找条目） |
| 每周清单 | 清单代码 | URL 路径 + 最后一段 |
| `update-page` | `publishPageUpgradeToGithub` | `page_url` 路径 **+ `resolveStaticHtmlPath` 实际解析出的 `filePath` 反推路径（kind=`file`，去 `.html`、去尾 `index`）**；解析失败（`NO_TARGET`）时仍先用 `page_url` 身份过闸，**先拒后报错**，避免泄露「这页有没有文件」 |
| `seo-fix` | `orchestrateSeoFix` | 请求的数据 `slug`；`file_path` 不进身份（数据文件是批量的，反推不出页面，魏征 N1）。**魏征 N2（补丁锚点取文件里第一处 `slug: 'x'`，若别的条目里引用了它，补丁会落进别的条目）的处理**：实测该文本窗口法**无法可靠还原「补丁实际落在哪个条目」**，所以改为 fail-closed——`patchMetaField` 额外返回 `anchorCount`（该 slug 在文件里出现几次）；**出现多于 1 次 → 身份记为 `unknown`**（非 PM 拒绝）。 |
| `update-post` | `updateExistingWordpressPost`（内部先 `GET` 旧帖子，得到 `slug` + `link`） | 读回的 `slug` + `link` 路径（`link` 是 `/` 或 `?p=ID` 而 slug 非空时，**不当首页**）+ 请求体里新 `slug`（改前改后都算）；`target_type` 一并记入回执。`GET` 与 `PATCH` 之间被并发改名属残余风险 R-f |

`normalizePagePath`：`decodeURIComponent`（失败 → `unknown`）、小写、去协议/域名/query/hash、去 `.html`、去尾 `/index`、去首尾斜杠；**首页别名 `''`、`/`、`home`、`index` 仅用于「页面身份」，统一得到 `paths=['/']` 且 `slugs=['', 'home', 'index']`；不用于名单项分类**。

### 2.2 匹配规则（生产只读数据定案）

**生产只读核对（2026-10-12，CTS 182 个已抓页面）**：名单 7 项全是单段 slug，其中 `china-visa-free-nz-2026` 的真实页面是 `/blog/china-visa-free-nz-2026`。纯完整路径匹配会让它从「保护」变「不保护」。所以：
- **名单项先归一化（去首尾斜杠、小写），再按归一化后的值分类**：不含 `/` = **slug 项**（页面任一身份的最后一段等于它即命中）；含 `/` = **路径项**（等于页面任一身份的完整路径即命中；对 `kind='file'` 的身份按 `resolveStaticHtmlPath` 同口径允许「以 `/项` 结尾」，如 `public/en/china-tours` 命中路径项 `en/china-tours`）；首页项写 `/`（归一化后为 `/` 例外，视为路径项）。
- 保护的是**这一页**，不含它的子页和分页（`tours` 不保护 `/tours/china/...`；与现行行为一致，写给 PM 知道）。
- CTS 7 项均核过无意外命中；**其他客户上线保护名单时必须做同样的只读比对**（含 `/zh/`、`/en/` 前缀、数据 slug 与 URL 最后一段是否一致），写进台账 `verify_how`。

### 2.3 解析与读取（fail-closed）

- `readProtectedRaw(seoConfig)`：全仓**唯一**取 `meta_cycle_protected_slugs` 字段处（roster 批量读、单客户读都调它；日志/错误信息里不再出现字段名字面量）。
- `parseProtectedSlugs(raw)`：`undefined/null` → 空名单；**非数组、含非字符串项、超过 50 项、`seo_config` 非对象 → 一律 `malformed`**，整客户拒绝写、周清单跳过并写原因。不再静默截断。
- `loadProtectedPages(supabase, clientId)`：**每次写入前现读库**，不用 roster 快照；读失败 → `lookup_failed`。
- `decide(...)` → `'protected' | 'open'`；`malformed / lookup_failed / 身份算不出 / 解码失败` 归 `'unknown'`，写路径与 `protected` 同等对待。

### 2.4 闸对象（替代 v0.2 的通行证）

- `PageWriteGuard`：用**文件内不导出的 `unique symbol`** 做品牌，只有 `createPageWriteGuard({ supabase, clientId, actor })` 能造；字面量造不出来。它只含「客户 + 操作人 + 注入的库客户端」，**不含页面**。
- `guard.assert(identity)`：现读名单 → 决策 → 写回执 → `open` 放行；`protected/unknown` 仅当 `actor` 是 PM 才放行，否则抛 `ProtectedPageError`（路由转 403）。
- **必传闸对象的写函数**：`orchestrateSeoFix`、`publishPageUpgradeToGithub`、`updateExistingWordpressPost`、`apply-adapter`（通过 runner 注入的 `apply` 契约新增 `guard`，在 `seo-meta-cycle.ts` 创建 adapter 处注入库客户端）、`runCtsMetaPr`。**每个函数在自己「已算出真实目标、尚未写入」的那一刻调 `guard.assert`**；`apply-adapter` 在每个 slug 累积编辑前调一次，**合并 PR 前再调一次**。
- **`page-apply-optimization`**：Kernel 内没有登录用户，`actor` 固定为 `{ kind: 'system' }`（永远不是 PM）→ **对保护页一律拒绝，没有 override**；`prepare` 与**批准后真正写入前**各检一次；库客户端经 `deps.ts` 注入。

### 2.5 谁算「PM」

仅三条人点按钮路由，且在 `requirePaidClientAccess` **之后**：邮箱 trim + 小写后精确等于环境变量 `PROTECTED_PAGE_OVERRIDE_EMAILS`（逗号分隔，不认域名）之一，且会话邮箱已验证。（审查指出「已验证」在邮件登录下基本恒真，保留只作无害的第二道，不当主要防线；真正的风险是变量里邮箱写错，所以首次读到变量时日志记一条「override 名单 N 个」，不记邮箱。）没设变量 = 没有 override。非客户成员的 PM 邮箱仍被前一道 403 拦住（测试钉死先后）。上线前需 PM 在 Render 设一次，写进 `docs/ENV.md` 与 PR 正文。`actor` 只由 `protected-pages.ts` 的 `resolveActorFromSession` 产生。

### 2.6 回执（`cron_run_logs`，已核列与约束）

- `job_name='seo-protected-page-gate'`，**直接插入一条终态行**：`status='completed'`、`failed_count=0`（`status` 只允许 running/completed/failed，写 `failed` 会让每日健康邮件和 cron-health 把正常拦截报成故障）；决定放在 `summary.decision`：`denied_protected | denied_unknown | denied_not_pm | allowed_open | allowed_pm_override`；`summary` 还含 `client_id`、`route`、归一化身份、`target_type`、`caller_hash`（邮箱 sha256 前 12 位，**不存明文邮箱**，避免健康邮件读 `summary` 时外泄）。
- **id 每次随机**（不是 `receipts.ts` 那种「每客户每周一行」的确定性 id，否则重复被拒会覆盖成「最后一次」）。需要新写一个**会返回成败**的写入函数（现有 `writeStepReceipt` 吞错，不能直接复用）。
- 拒绝：先返回 403，回执尽力写，失败 `console.error`，**仍然拒绝**。PM 放行：**先写回执，写失败就不放行**。`allowed_open`（普通页放行）**不写**，避免每次写入都刷一行。
- 保留期：该表对所有行 180 天硬删，**PM 放行回执 ≤180 天**；无 `client_id` 列，只能 `summary->>'client_id'` 查。属运维级回执，不是长期审计；PM 放行另在 PR/台账约定转存，残余风险 R-g。无告警：拒绝次数异常多不会触发任何通知（残余风险）。

## 3. 与 B7 / Kernel 临时豁免台账的先后（不赌）

台账 `verify_by` 2026-10-11 已逾期，`seo-meta-cycle.ts`、`apply-adapter.ts`、`pr-guard.ts` 仍在豁免清单。本稿只改 `apply-adapter` 的 `apply` 契约（新增 `guard`）和周循环早退换调同一匹配函数，不迁移、不清豁免。B7 的 PR 必须按新契约搬并引用本稿（写进台账卡）。

## 4. 测试

**行为测试**（每条写路径各一组）：保护页被拒；名单格式坏（非数组 / 夹非字符串 / 超 50 / `seo_config` 非对象）被拒；读库失败被拒；身份算不出/解码失败被拒；非 PM → 403 + 回执；PM → 放行且回执先于写入、回执写失败则不放行；变量没设 → 谁都不行；非成员 PM 邮箱 → 前一道 403；`seo-fix` 用**未保护 slug 但补丁窗口落在受保护条目内**（合成数据文件）→ 被拒；`update-post`：改前/改后 slug、`link` 为 `/?p=ID`、`target_type`；`update-page`：`%2D`、`%2F`、`.html`、`index`、`en/` 前缀 + 路径项后缀匹配（B3）、`NO_TARGET` 时先拒后报错；名单项 `'tours/'`、`'/china-tours'` 归一化后分类；首页别名全链路（首页不在名单时 `home` 项不被别名吞）；`apply-adapter` 同一数据文件含保护页与普通页时只拒保护页那条且不提交整文件、合并前名单变化被拦；每周清单名单坏 → 整客户跳过（现状 fail-open 的回归）；`runCtsMetaPr` 不带闸对象编译不过。
**变异检验**（每种都必须有测试变红）：①每处 `guard.assert` 注释掉；②匹配永远 `open`；③`unknown` 当 `open`；④`ok:false` 当 `open`；⑤PM 判据永远真；⑥回执写失败仍放行；⑦`anchorCount>1` 不判 unknown；⑧合并前不再检。
**架构测试**（`architecture.test.ts`；通过数以实跑为准，同步上调 `kernel-architecture.yml` 的 `MIN_PASSED`，现 181）：①`PageWriteGuard` 品牌只在 `protected-pages.ts` 创建（`unique symbol`；禁止别处对该类型的字面量/`as`）；②上述写函数签名含 `guard`；③`kernel/` 不 import `protected-pages`，`protected-pages.ts` 不 import `@/lib/supabase`；④全仓只有 `protected-pages.ts` 取 `meta_cycle_protected_slugs`（扫属性访问与字面量，日志字符串已去掉）；⑤**新增写路径扫描**：`src/` 下凡 import（别名**或相对路径**）`PROVIDER_WRITE_MODULES` 任一模块、或含 `api.github.com` 且带写动词的文件（排除 `github-client.ts` 自身与测试），必须在代码里**调用** `guard.assert(`（只 import 类型不算），或在冻结白名单里；白名单**按「文件 + 允许的写调用次数」记，次数变了就红**，只准变短，每条带「为什么不会改已有页」；不按 HTTP 动词扫（WordPress 改旧页用 POST，按 PATCH/PUT 扫会漏，子牙 N2）。

## 5. 平台层级门（Inline，已核）

- 层级：L1（SEO 支柱写入治理 + Kernel 边界），归位既有，不新增能力线 / 支柱 / 表。名单内容 L4（`clients.seo_config`）；入名单判据 L2（手册 §5.3.1）。
- **§11 打分**：频率 **中** / IMPACT 闭环关键度 **高**（卡在 Act，错改喂坏 Measure）/ 收入关联度 **高**（保护页是询盘入口，9-28 出过事故）→ 零低、两高 → **P0**，与手册行 A1 一致。
- **换客户**：CTS → Oztop → 悉尼地产：共享代码不含客户 ID / slug，名单各自在 `seo_config`；slug 项/路径项语义对任何站点结构成立 ✓。**换行业**：旅游 → 地产 → 装修：闸只问「名单里有没有这页」，无旅游语义 ✓。
- **Reuse Statement**：复用 `requirePaidClientAccess`（保留）、`AUTHORIZED_CONTEXT_MINTERS` 的「只此一处铸造」测试模式、`cron_run_logs`、`resolveStaticHtmlPath`（不重写路径解析）、`buildSlugIndex`。新增 platform-shared：`protected-pages.ts`、闸对象、5 条架构测试。industry/client-specific：无。客户名/ID 进共享代码：无。学习：无。**落点与决策时分类一致**（交付时再对账）。

## 6. 残余风险（诚实列出）

- R-a 闸挡「忘了」，挡不住 `protected-pages.ts` 自身写错——靠变异检验 + 双审。
- R-b `update-post` 读回失败 → `unknown` → 非 PM 拒绝；WordPress 客户可能误拒（宁拒勿错）。
- R-c 名单被 `seo-config` PATCH（读-合并-写、无并发保护）覆盖：本稿不处理。
- R-d `publish-geo-to-github` 站点级注入、`seo-fix` 的 Kernel 规则旁路：登记台账，不在本稿修。
- R-e 其他客户上线保护名单时要做同样的只读比对（§2.2）。
- R-f `update-post` 的 `GET` 与 `PATCH` 之间被并发改名。
- R-g PM 放行回执 ≤180 天、无告警（§2.6）。
- R-h `seo-fix` 的数据 slug 与 URL 最后一段若不一致，按 URL 写的名单挡不住；周循环按现有约定一致，`seo-fix` 无法证明——上线保护名单时需核。

## 7. 实现分轮（DeepSeek 写，Claude 审 diff；跨文件推理的第 3、5 轮由 Claude 自写并在 PR 写原因）

1. `protected-pages.ts`（身份 / 归一化 / 解析 / 匹配 / 闸对象 / 回执）+ 纯函数单测。
2. `roster.ts` / `runner.ts` / `candidates.ts` / `run.ts` 收口（含每周清单 fail-closed 回归）。
3. 写函数加 `guard` 与各自的身份计算（`patchMetaField` 返回 `anchorCount`；`update-post` 内部 `GET`；`apply-adapter` 契约；`runCtsMetaPr`；`page-apply-optimization` 注入与双检）。
4. 三条路由接线 + PM 判据 + 行为测试 + 变异检验。
5. 架构测试 + `MIN_PASSED` + `docs/ENV.md`。

**当场试跑**：无新定时任务，不适用；PR 附本地 vitest 输出、`tsc --noEmit`、架构测试实跑条数。生产写、Render 环境变量：一概不做，交 PM。

## 8. 实现与 v0.3 稿子的差异（实施后两轮审查的结论，已落代码）

- **seo-fix / 周循环的「目标页是谁」**：v0.3 写的是「slug 在文件里出现多于 1 次即 unknown」。实施后审查（魏征）指出这既挡不住「只出现 1 次但落在别的条目里」，又会误拒「首个锚点就是条目自己、后面另有引用」的正常情况。改为：用括号深度（认字符串/注释）判断**第一个 `slug: 'x'` 是不是嵌在别的条目里**（`src/lib/cms/slug-anchor.ts`），是 → 身份 unknown。`seo-fix` 与 `apply-adapter` 同一规则；`seo-fix` 的闸移到补丁之前（拒绝不泄露 old_value 是否匹配）。
- **WordPress 身份**：链接是站点根且无查询串 = 真首页（可被 `/` 名单项保护）；`/?p=ID` 类链接忽略；slug 与链接都读不到 → unknown，不再默认成首页。
- **名单项与页面共用同一套规范化**（去 `.html/.htm`、去 `/index`、重复去斜杠）；`index` 名单项 = 首页；`home` 仍是 slug 项。
- **PM 判据没有「传入名单」的口子**：`resolveActorFromEmail(email, verified)` 只读真实环境变量；架构测试限定只有两个文件能调用它。
- **闸对象与客户核对**：`assertGuardMatchesClient`（orchestrator / publisher）；`apply-adapter` 的闸由同一客户的 `buildAdapterForClient` 构造。
- **apply-adapter**：合并前被拦时**回滚内存里的编辑**，避免下一个候选把保护页改动带进别的自动合并 PR。
- **架构测试 7 条**（实跑 203 条）：新增「改已有页函数的调用方必须自己造闸」「PM 身份只能由两个文件产生」；闸调用判据收紧到 `guard.assert(`（`console.assert(` 不算）。
- **回执**：PM 放行的回执带 `overridden_decision`；403 响应体不再返回 `decision`（防探测名单）。
- **未做（已知）**：每周清单名单坏时只在运行结果里记 `withheld='protected_list_malformed'`，没有另写回执行；`runCtsMetaPr` 带闸保留（已退役，建议后续删除）；WordPress / Shopify 的发布（新建页）函数不在扫描里，只靠白名单文字说明。
