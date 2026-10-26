# 全部接口「此人是否属于该客户」只读清查（66 号窗口）

日期：2026-10-10 · 风险级：A（客户隔离）· 性质：**只读清查，没改任何代码、没动生产库、没对线上发过任何请求**
基线：分支 `claude/stoic-khorana-b29223`，HEAD `6cf5afa5a`（本地快照，未刷新远端）
关联：work-logs 三个接口已有单独修复卡 65，本报告不重复修，只在清单里标注。

---

## 一、结论（三句话）

1. **共查了 583 个接口文件、718 个读写动作**（含定时任务 80 个）。明细表里标为「中」及以上的共 **126 行**（高 36、中高 11、中 79；按「接口+方法」计行，同一接口的多个方法各占一行；机器统计，可能略有出入），另有大量「低」；**另有 21 个定时任务在密钥漏配时会放行**。
2. **最严重的三个**：
   ① **`/api/admin/viral-references` 一组：任何人不用登录就能让我们的服务器执行任意命令**（提交的网址被原样拼进命令，约 `viral-analyzer.ts:198`），能读走全部密钥；
   ② **匿名（不用登录）就能读/改客户数据**的一批接口：任意客户的月报、任意客户素材覆盖、往公开存储桶传文件、触发出图出视频烧钱、写飞轮记录；
   ③ **客户员工能越到别家客户**：把视频发到别家 Facebook/Instagram 主页、暂停或改别家的 Google/TikTok/Meta 广告、读别家的广告预算花费。
3. **一个放大器**：自助注册 `auth/self-register` 对全网开放，陌生人输入自己的邮箱收验证码就能拿到登录身份。所以「只检查登录」的接口，实际等于对全世界开放。

> **没有发现「正在发生的泄露证据」，但也没有去查**——我只读代码，没有读服务器日志，所以不能说「没人用过」。第 8 节写了怎么查。

---

## 二、怎么查的、有什么没做

方法：脚本枚举全部 `route.ts` → 按「函数体里有没有归属守卫」分四批 → 8 个只读小组逐个**读代码**分类 → 魏征独立重读 52 个接口并跑 4 套全量扫描 → 我本人核实了命令注入与自助注册两条关键事实。

**没做/做不到的（直说）**
- 没读生产环境变量：不知道线上有没有 DEMO_ADMINS（只绑单个客户的演示管理员）账号，也不知道 CRON_SECRET 等是否都配了；凡取决于此的条目都标了「条件型」。
- 没读服务器日志、没查数据库里有无跨客户痕迹（原因：本卡限定只读代码与表结构）。
- 命令注入只读代码判断，**没有实际打过**；线上有没有下载工具我也没验证。
- **狄仁杰（攻击视角）复审被安全检查拦下，两次都没产出文件**。我不再重试。「CTS 员工能做什么」这一节是我根据 8 组结果自己推导的，**不是独立复审**；独立的攻击视角复审建议改由有权限的人工审计员做，或在修复 PR 的测试里证明。
- `/api/mcp/[transport]`、`/api/mcp-admin/[transport]` 两个文件不在 8 组清单里（魏征补查：鉴权方式是对的，但管理员钥匙的 IP 白名单取自可伪造的 `x-forwarded-for`）。用「导出再命名」方式声明的处理函数，我的脚本可能漏数。
- 全量明细里的「中/低」条数是从各表格机器统计的，含部分「OK 但标低」的行，所以第一节只给大数。

---

## 三、先弄清「谁能打到」——四类身份

| 身份 | 怎么得到 | 能碰什么 |
|---|---|---|
| ④ 匿名 | 不需要 | 所有「完全没守卫」的接口 |
| ① 任意登录账号 | **自助注册**：`auth/self-register` 公开→邮箱收验证码→`verify-otp`，得到免费档（self_serve）会话 | 上面所有 + 所有「只检查登录」的接口 + 免费档能过的归属守卫 |
| ② 某客户的成员 | `client_portal_users` 里的一行（邮箱+客户+access_type） | 本客户的全部接口；若接口信了请求里自报的账号/编号，则能越到别家 |
| ③ ME 内部全局管理员 | 环境变量 ADMIN_EMAILS / ADMIN_EMAIL_DOMAIN | 全部 |
| ③' 受限管理员 | 环境变量 DEMO_ADMINS（带 allowedClientId），或库里 `scoped_admin=true` | 被 `guardAdmin` 当成管理员放行，**只在应该仅限全局管理员的接口上是问题** |

**成员表的真实规则**（我读了迁移文件）：`client_portal_users` 现在的唯一约束是 **(邮箱, 客户)**，旧的「邮箱唯一」已在 2026-05-22 删掉；所以**一个邮箱可以同时属于多个客户**。

**免费档和付费档的区别只有一个**：路由用的是哪个守卫。`requireDashboardClientAccess` 和 `requireOnboardingClientAccess` 对免费档放行，只有 `requirePaidClientAccess` 把免费档挡在外面。凡是「花钱/外发/改自动开关」的接口用了前两种，免费档就能打。

**CTS 员工能做什么（我的推导，非独立复审）**：CTS 成员属于「付费客户」档（access_type 为 client/dashboard/both/fde 之一），所以过得了所有付费守卫，**能打到的越界项 = 第四节 B 类「请求里自报账号/编号」那一批**，另外加上陌生人能打的全部。CTS 与 Oztop 共用同一个 Meta 广告账户（代码注释自承），所以在 Meta 广告执行接口上这是一个**现实场景，不是理论**。我没有读任何 CTS 成员的邮箱或类型，实际是哪种类型需要有权限的人查库确认。

---

## 四、问题清单（按严重度，每类标「谁能打到」）

> 逐接口完整明细见同目录 `appendix-*.md`（8 份）。魏征复核：`review-weizheng.md`。

### P0 · 命令注入（匿名）
| 接口 | 问题 | 谁 |
|---|---|---|
| `admin/viral-references` POST、`[id]/retry`、`upload`、`discover`、`analyze-pending` | **整组无任何登录检查**；网址被原样拼进 shell 命令（`viral-analyzer.ts:198`），没有协议或字符校验。魏征补充：匿名 `upload` 会把文件名存成来源地址，定时 worker 会重试 pending/error 的行，**所以只给 POST 入口加登录修不干净，必须改命令执行处** | ④ |

### A 类 · 匿名能读写客户数据或花钱（无守卫）
| 接口 | 问题 | 严重度 |
|---|---|---|
| `reports/[clientId]/monthly` GET、`recommendations` POST | 凭客户号匿名读完整月报；后者无限触发 GPT-4o | 高 |
| `visual-assets/[assetId]/upload-version` POST、`edit-status` PATCH、`versions` GET | 只凭素材号匿名覆盖素材并标成「终稿」、读历史版本 | 高 |
| `visual/upload` POST | 匿名往公开存储桶传最多 500MB，并给任意客户建素材记录；每次还把桶改成公开 | 高 |
| `visual/avatar`、`visual/video` POST | 匿名触发 HeyGen / Seedance 烧钱；`client_id`/`post_id` 自报不核对 | 高 |
| `flywheel/execute` POST | 匿名往任意客户写飞轮动作记录，污染归因与学习 | 中高 |
| `baselines/domains*`（POST/PATCH/DELETE/collect）、`baselines/*` GET | 匿名增改删基准域名、触发付费 SEO 采集 | 中 |
| `diagnose` GET、`diagnostic/*` 6 个 GET | 调试遗留：匿名读 CTS 的 AI 可见度原始数据，还白花 OpenAI/Claude | 中（建议直接删，删前确认无前端引用） |
| `public-scan/keyword-gap`、`discover/*`、`leads`、`contact` | 有意公开，但限流取自可伪造的 `x-forwarded-for`，可烧 DataForSEO/发邮件 | 中低 |
| `webhooks/publer-published` POST | 无签名，匿名可伪造「已发布」状态 | 中 |
| `tools/github-commits` GET | 用服务器令牌匿名返回私有仓库提交信息（仓库是否私有未验证） | 中 |

### B 类 · 只检查登录（任意登录账号 = 全网任何人）
| 接口 | 问题 | 严重度 |
|---|---|---|
| `clients/[id]/work-logs` GET/POST、`[logId]` DELETE | 登录即可读写删任意客户的工作日志（**卡 65 已单独修**） | 高 |
| `visual/batch-image` POST | 对任意客户贴文出图（花 ME 钱）并把贴文改成「已批准」 | 高 |
| `baselines/trigger-cron` POST | 登录即可用服务器密钥触发付费 SEO 任务 | 高（花钱） |
| `visual/assets` GET、`publer/accounts` GET | 把各客户的素材与账号编号暴露出来——**「编号猜不到」这层缓解因此不成立**，魏征建议优先修 | 中高 |
| `mtc/*`、`onboard/self` | 按本人账户，合理 | OK |

### C 类 · 守卫在，但信了请求里自报的账号/编号（客户成员能越到别家）
| 接口 | 能越过去做什么 | 严重度 |
|---|---|---|
| `clients/[id]/reels/[draftId]/publish` | `account_id` 取自请求体，只在 ME 全局账号表里找；**可把视频发到别家 FB/IG 主页**（免费档也能） | 高 |
| `clients/[id]/google-ads/execute`、`campaigns` | 账号号取自请求；暂停/改预算/读别家广告（付费成员）；代码里自带 `TODO P18.D … prevent IDOR` | 高 |
| `clients/[id]/tiktok-ads/execute`、`campaigns` | 同上，用服务器全局令牌 | 高 |
| `clients/[id]/ad-health/stop-loss`、`meta-ads/execute` | 广告归属只校验到广告账户级；CTS 与 Oztop 共用账户 → 一家的付费员工可暂停另一家的广告（Meta 的 execute 有部分归属断言，但共用账户场景仍可穿） | 高 |
| `visual/image`、`publer/schedule`、`publer/create-post` | `post_id`/`account_id` 不校验归属；别家贴文素材可被替换；素材可被发到别家主页 | 高 |
| `clients/[id]/connectors/[anchor]/connect` | 客户成员能改写 Publer 账号绑定（使上面一些「只发已绑定账号」的闸能被绕）；GSC 分支的 `site_url` 不校验，可拉别家搜索词 | 中高 |
| `clients/[id]/brief/[briefId]/chat` | `briefId` 不校验归属，可读并让 AI 改写别家简报 | 高 |
| `clients/[id]/marketing-plan/[planId]` DELETE | 先按 planId 删光待办，再校验 | 高 |
| `clients/[id]/geo/[directiveId]`、`fan-out`、`diagnostic/report`(run_id)、`site-audit/status`、`zhangqian/status` 等 | 子记录/请求里的号不核对客户 | 中 |
| `clients/[id]/users` POST/DELETE | 付费成员可给任意邮箱授权并发邀请邮件，还能改/删包括 ME 内部 fde 行在内的成员（团队管理本身是功能，问题在 fde 行与邀请滥发） | 中高 |
| `auth/google/connect`（connect 分支） | 匿名知道客户 UUID 即可用自己的 Google 授权顶掉该客户连接（只能投毒、不能读数据） | 中高 |

### D 类 · 免费档（self_serve）能打到本该付费的外发/花钱/自动开关
`seo-config` PATCH（自动写博客、自动改官网标题）、`factory-config` PATCH（发布主页、自动出片）、`google-ads-customer-id` PATCH、`whatsapp-number` PATCH/GET（可抢绑未绑号码，客人来信会进错收件箱）、`leads-config` PATCH、`content-posts/[postId]/publish`（回退用 ME 共享账号发）、`content-factory/[postId]` PATCH（自行置「已批准」→LinkedIn 直接发）、`lecture` publish_facebook、`generate-video`、`run-intake`、`comment-autoreply-*`、`luban`。**修法统一是把守卫换成 `requirePaidClientAccess`；哪些本来就该对免费档开放，需 PM 定。**

### E 类 · 受限管理员（条件型：取决于线上有没有 DEMO_ADMINS）
`admin/users`（POST/DELETE/upgrade/GET，client_id 完全不校验）、`admin/mcp-keys`（可给自己发管全部客户的钥匙、可一键作废全部钥匙）、`voice/*` 13 个（能读所有租户来电与线索，含客人电话）、knowledge 六个接口、`factory/work-orders/*` 等共 42+13+6。**修法：换成 `guardGlobalAdmin`**。

### F 类 · 定时任务密钥缺失时放行（隐患，非当前漏洞）
21 个 cron 写成 `!== \`Bearer ${CRON_SECRET}\``，密钥没配时变成匹配 `Bearer undefined`；另有 `ai/zhugeliang/proactive`、`admin/billing/datasources` 同类。其中 `factory-publish-worker`（发社媒，另有 `FACTORY_PUBLISH_LIVE` 开关兜底）、`linkedin-progress-post-*`（自动发 LinkedIn）、`content-factory-intake`、`factory-order-scheduler`、`zhuge-recalculate`、`proposal-view-digest` 有外发/花钱副作用。**59 个已正确 fail-closed**（先判密钥存在）。70 个文件各写一份校验，没有共享函数。**无任何 cron 接口信任请求里的 client_id 到能被登录用户触达的程度。**

---

## 五、统一修法（倾向一个共享守卫 + 逐接口替换 + 每接口一条「跨客户被拒」测试）

1. **新增共享守卫库**（建议 `src/lib/auth/client-ownership.ts`，复用 `client-access.ts`，不另造一套）：
   - `requireClientRecord(clientId, table, recordId)`：守卫通过后，**用 `.eq('id', …).eq('client_id', clientId)` 取记录**，取不到一律 404（不区分「不存在」与「不是你的」，避免被当探针）。
   - `requireAccountBoundToClient(clientId, provider, accountId)`：请求里的外部账号（Publer/Google Ads/TikTok/Meta）必须出现在**该客户自己的绑定表**里，**不再从 ME 全局账号表里直接找**。
   - `verifyCronRequest(req)`：共享的 fail-closed 校验——密钥未配置直接 500/拒绝，不比对；替换 21 处内联写法。
2. **接口逐类替换**：
   - 匿名接口：加 `requireDashboardClientAccess(clientId)`（客户号一律用**守卫校验过的那个**，不用请求体里再取一次）；调试遗留直接删。
   - 仅登录接口：改成按客户的归属守卫，或仅管理员。
   - 自报账号/编号：用上面两个共享函数。
   - 免费档越权：换 `requirePaidClientAccess`。
   - 受限管理员：换 `guardGlobalAdmin`。
   - **命令注入：改成参数数组方式调用（不经过 shell）+ 只放行 `http(s)://` 协议 + 加登录检查**。
3. **每接口一条测试**：用假 supabase（按表建模，别按调用次序）造「客户 A 成员 + 客户 B 的记录/账号」，断言 403/404 且**没有任何写入**。再加一条**防回潮测试**：扫描全部 `route.ts`，要求每个导出的处理函数要么调用白名单内的守卫、要么登记在一份「有意公开/密钥校验」清单里——新接口漏守卫会直接红灯（这是让这类问题不再反复的关键，文字规则已被证明不起效）。
4. **为什么不会误伤门户成员**：本客户成员访问本客户记录时，`client_id` 与守卫放行的客户一致，行为不变；只有「请求里的号不属于该客户」的情况才被拒。多客户邮箱（现在合法）按各自行放行，不会被误拦。免费档换成付费守卫后会拿到现有的结构化 403（`reason: 'paid_only'`），前端本来就会弹升级提示。**例外**：若某接口前端本就让免费档用，则应保持 `requireOnboardingClientAccess`，所以 D 类需 PM 逐个确认。

---

## 六、修复批次建议（均为 A 级；我没有开任何修复 PR）

| 批次 | 内容 | 文件范围（概数） | 要 PM「合」吗 | 优先 |
|---|---|---|---|---|
| **P0 紧急** | viral-references 命令注入：5 个路由 + `viral-analyzer.ts` 命令执行处 + worker | 约 7 个文件 | **是（A 级，单独一个窗口，先做）** | 立刻 |
| **B1 匿名/仅登录大门** | 第四节 A、B 类（月报、素材、visual/*、baselines/*、flywheel、`visual/assets`、`publer/accounts`、`publer-published` 签名、删 diagnose/diagnostic 调试路由）。work-logs 走卡 65 | 约 25 个 | 是 | 高 |
| **B2 自报账号/编号越界** | 第四节 C 类（reels publish、google-ads、tiktok-ads、meta 共用账户归属、`visual/image`、`publer/*`、connectors connect、brief chat、marketing-plan、users 的 fde 行与邀请） + 新增共享守卫库 | 约 25 个 + 1 个库 | 是 | 高 |
| **B3 免费档越权** | 第四节 D 类，等 PM 定哪些本就对免费档开放 | 约 15 个 | 是 | 中高 |
| **B4 受限管理员** | 第四节 E 类（先查线上有没有 DEMO_ADMINS） | 约 60 个（改法机械） | 是 | 取决于查证 |
| **B5 定时任务统一** | 第四节 F 类 21 个 + `verifyCronRequest`，顺带修 `x-forwarded-for` 白名单 | 约 25 个 | 是 | 中 |
| **B6 防回潮** | 全仓路由守卫清单测试（只加测试，不改行为），可与 B1 同发 | 1-2 个 | 是（碰仓库规矩） | 中 |

---

## 七、魏征复核结果与处理

- 独立重读 52 个接口（OK 类 21 / 高 17 / cron 6 / 无守卫 8），另跑 4 套全量扫描并与前人清单对账：**21 个 OK 全部一致；没有一条把有洞的判成 OK；7 条严重度不一致（4 条前人偏高、已在本报告改成「条件型/中高」，1 条前人偏乐观已在 C 类补入——`publer/create-post` 的「只发已绑定账号」闸可被 connectors connect 改写绑定绕过）**。
- 魏征补的**漏网**已并入：命令注入的更多入口（匿名 upload 的文件名→worker 重试）、`mcp` 两个路由的 IP 白名单可伪造、`visual/assets` + `publer/accounts` 暴露编号。
- 魏征的两处更正已采纳：开放跳转对 `/auth/callback` 不成立（只对 portal 登录页成立）；`users` 的团队管理是设计功能，只有 fde 行与邀请滥发是问题。
- 扫描「守卫结果未检查 / 请求体 client_id 错位 / 子资源直接按 id 取」**无新增漏网**。

**狄仁杰**：见第二节——两次被安全检查拦下未产出，**此项未完成**，已在批次 B2/B6 的测试里要求对每个 C 类接口补一条「别家号被拒」用例作为替代证据；仍建议择期由有权限的人工审计员补做。

---

## 八、「有没有正在发生的泄露」怎么查（本卡没做）

1. 看服务器访问日志里 `/api/admin/viral-references*` 有没有非内部来源的 POST；上传记录里文件名是否含奇怪符号。
2. `viral_reference_library` 表里 `source_url` 是否出现非 `http(s)://` 开头的值（这是只读计数查询，需要授权）。
3. 工作日志/素材表里「作者邮箱不属于该客户成员」的行数（只数数、不看内容）。
4. P0 修好后，若第 1、2 项有可疑，**把服务器上的全部密钥换掉**（尤其全库最高权限那把）。

## 九、Reuse Statement
- 复用：现有 `client-access.ts`、`require-admin.ts` 守卫体系，不新造；建议的共享库是把已有校验模式（如 `meta-ads/execute` 的 `assertCampaignOwnedByClient`、`ad-entity-snapshot` 的 fail-closed 写法）提炼成平台共享件。
- 平台共享：守卫库、`verifyCronRequest`、路由清单防回潮测试。行业层：无。客户层：无——本报告没有把任何客户名/行业判断写进共享代码；CTS 仅作为「会出现的场景」在文字里出现。
- 学习：「请求里自报的账号/编号必须回到客户自己的绑定表核对」建议沉淀为平台层规则（PITFALLS），不属于任何单一客户。
