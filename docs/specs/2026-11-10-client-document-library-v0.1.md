# 客户资料库（文件下载）设计稿 v0.1

> 日期：2026-11-10 · 风险级：**A**（新增数据库表 + 新增存文件的私有桶 + 新增对外下载接口 + 按客户/按角色的权限边界）
> 起因：PM 要把 CTS 的 2027 电子手册和 8 个单团小 PDF 放进后台，成为「企业内部可下载的资料库」。
> 本稿只管**文件**（能下载的文档）。不是「客户资料库」那份事实表设计（`2026-10-05-client-content-foundation-plan-v0.3.md`，管价格/团期等结构化事实），也不是任何一套「素材库」（管图片/视频）。

## 1. 大白话：做完你会看到什么

- 客户页「经营工具」里多一张卡片「资料库」，点进去按类别（手册、单页资料、价格与团期、品牌资料、合同、其他）列出文件：名字、版本、大小、哪天放进来的，旁边一个「下载」按钮。
- Magic Lab 内部账号能上传新文件、给文件换新版（旧版自动收进「旧版」）、改名字和类别、设「谁能看到」。
- 客户自己的员工（付费客户账号）只能下载标了「客户员工可见」的文件，看不到内部文件，也看不到旧版。
- 文件放在**私有**存储里，没有公开网址；每次点下载，系统先核对身份和客户，再给一个 60 秒有效的临时下载链接。

**本期不做**：文件夹层级、搜索、标签、下载记录统计、客户员工自己上传、批量上传、预览、版本对比、自动同步 Dropbox。要不要做，等 PM 用过再定。

## 2. 为什么新建，而不是用现成的（Reuse Gate）

| 现有的 | 能不能装手册 PDF | 原因 |
|---|---|---|
| 后台「素材库」（`client_assets`，`/assets`） | 不能 | 只收图片；存储桶是**公开**的（`visual-assets`，`public: true`）；上传后会排队做 AI 看图打分 |
| 马良的 Dropbox 素材库（`scripts/media-library/`，桶 `me-media-*`） | 不能 | 桶只允许视频/图片/音频/JSON，没有网页，没有「下载」入口；改桶配置需要另行评审 |
| 新系统素材库（`portal/media`） | 不能 | 代码不在本仓库，只能通过连接口读写 |
| 视频工厂素材（`video_clips`） | 不能 | 只收视频，服务出片机 |
| 直连 Dropbox（让后台读 Dropbox 文件夹） | 不用 | 仓库里没有 Dropbox 连接器，只有一个讲课录屏链接工具；要新做授权、刷新令牌，还要把 PM 个人 Dropbox 的凭据放上服务器 |

沿用的现成做法：`requireDashboardClientAccess` / `requirePaidClientAccess` / `requireOperatorAccess`（谁能进、谁算内部）；`supabaseAdmin` 私有桶 + 临时下载链接（同 `brief-uploads`、`telephony-recordings`）；service-role 专用 RLS 模板；`factory-clips` 的「内容指纹去重 + 失败清理」；客户页 `ToolCard`。

## 3. 平台层级（me-platform-tier-gate）

不是新业务能力：不属于 6 大支柱，不新增「能力线 / 智能层」，不用登记候选。是后台的通用功能（共享底座，按 `client_id` 隔离）。CTS 的 9 个文件只是第一批**数据行**，代码里没有客户名、没有行业词（类别用「手册 / 单页资料 / 价格与团期 / 品牌资料 / 合同 / 其他」这套行业中立的）。换成 Roman 或悉尼地产客户，代码不用改。

## 4. 权限矩阵

| 谁 | 看列表 | 下载 | 上传 / 换版 / 改 / 归档 |
|---|---|---|---|
| Magic Lab 内部（`requireOperatorAccess` 通过：管理员、受限管理员） | 全部（含内部、含旧版） | 全部 | 能 |
| 客户付费账号（`requirePaidClientAccess` 通过，非内部） | 只有 `visibility = client` 且 `status = current` | 同左；别的一律按「不存在」处理（404） | 不能（403） |
| 自助版账号（self_serve）/ 只有 portal 的账号 / 别的客户的账号 / 没登录 | 不能 | 不能 | 不能 |

`fde` 类型的成员行不能当「内部」用（`access-types.ts` 已写明它可被付费客户给任意邮箱发放），所以内部身份只认 `requireOperatorAccess`。文件默认 `visibility = internal`，必须有人明确选「客户员工可见」才会给客户员工看。

## 5. 数据

- 表 `public.client_documents`（RLS 开启，只有 `service_role` 一条策略，`anon`/`authenticated` 全部收回）。
- 桶 `me-client-documents`：**私有**，不建任何 storage 策略；单文件上限 50 MiB；允许类型 pdf / docx / xlsx / pptx / png / jpg / webp。
- 路径只由服务器生成：`<client_id>/<doc_id>/<安全文件名>`；表上有 CHECK：`storage_path` 必须以 `client_id/` 开头（数据库层再拦一道串客户）。
- 同一客户同一内容（SHA-256）只能有一份「现行」文件（部分唯一索引，旧版不占位，可回退到旧内容）。
- 换新版 = 新增一行（`replaces_id` 指向旧行）+ 旧行归档；不覆盖、不物理删除文件。

## 6. 接口契约

所有接口都在 `/api/clients/[id]/documents` 下；`[id]` 是客户 ID；返回 JSON（下载除外）。

| 接口 | 谁 | 行为 |
|---|---|---|
| `GET /documents` | 付费客户 / 内部 | 按上面的矩阵过滤后返回；内部可加 `?includeArchived=1`；返回 `canManage` 告诉页面要不要显示上传区 |
| `POST /documents`（multipart：`file`、`title`、`category`、`visibility`、可选 `versionLabel`、`description`、`replaceId`） | 内部 | 校验 → 上传 → 入库；失败回收已上传的文件；同内容已有现行 → 409；超 50 MiB → 413 |
| `PATCH /documents/[docId]` | 内部 | 改标题 / 类别 / 版本号 / 说明 / 可见范围 / 归档或恢复；一律带 `client_id` 条件 |
| `GET /documents/[docId]/download` | 付费客户 / 内部 | 核对身份和客户 → 找行（带 `client_id`，非内部再带 `visibility = client` 且 `status = current`）→ 生成 60 秒临时链接（带原文件名，强制下载）→ 302；找不到一律 404（不泄露「有但你看不到」） |

## 7. 威胁模型

| 威胁 | 防线 | 验证 |
|---|---|---|
| 串客户：用 A 客户的页面下载 B 客户的文件 | 所有查询带 `client_id`；路径由服务器按行里的值取，不接受前端传的路径；表上 CHECK 路径前缀；下载前再校验路径前缀 | 路由测试：别的客户的 `docId` → 404；路径前缀对不上 → 500 不出链接 |
| 客户员工越权拿内部文件 | 非内部一律加 `visibility = client` 且 `status = current` 过滤；越权按不存在处理 | 路由测试：客户员工请求内部文件 → 404 且不生成临时链接 |
| 自助版、没登录、别的客户账号 | `requirePaidClientAccess` 先挡 | 路由测试：401 / 403 / 402 路径 |
| 上传恶意文件（脚本、网页、伪装类型） | 只收 7 种扩展名；服务器按扩展名定类型；校验文件头；不收 svg/html/zip/可执行；下载强制 `attachment` | 单元测试：改扩展名、文件头不符、超大、空文件、路径穿越文件名 |
| 临时链接被转发 | 60 秒有效；每次点击现生成；不写进日志 | 单元测试：有效期常量；日志里不出现链接 |
| 桶被误改成公开 | 迁移里 `public = false` 且冲突时强制改回；代码不在运行时建桶（缺桶时报「资料库暂不可用」，不静默创建） | `db-replay-and-verify.sh` + 迁移读回检查 |
| 数据库直连（匿名 key） | RLS 开 + 只放 `service_role` + 收回 `anon/authenticated` 权限 | `db-invariants.sql` 四条不变量 |

## 8. 失败与并发模型

- **先传文件、后写行**；写行失败就删刚传的文件（同 `factory-clips`）。文件传上去但清理也失败 → 留下孤儿文件（无行指向，不可下载，不泄露），日志记路径，人工清理即可。
- **换新版**：先写新行成功，再归档旧行；归档失败时新行已生效，接口返回 201 加警告，由内部在页面手动归档旧版（最坏结果是暂时有两份现行）。
- **同时上传同一内容**：部分唯一索引兜底，后到的收到 409。
- **下载时对象已不在**：临时链接生成失败 → 500「文件暂不可用」，不暴露路径。

## 9. 验收与测试（A 级）

允许路径和拒绝路径都要有测试：内部全权限；客户员工只见客户可见的现行文件；self_serve / 未登录 / 别的客户账号被拒；跨客户 `docId` 404；上传校验矩阵；缺桶时报错不静默建桶。迁移用本机 Postgres 从零重放全部迁移并跑安全不变量（`scripts/db-replay-and-verify.sh`，用独立库名，不碰别人在用的）。

## 10. 上线步骤（每一步都等 PM 点头）

1. PM 本人回「合」合并这条 PR（A 级，碰数据库）。
2. PM 同意后，在线上数据库执行迁移（建表 + 建私有桶）。
3. PM 同意后，上传 CTS 的 9 个文件（Dropbox 里的 v11 手册 + 8 个单团 PDF），并由 PM 定这 9 个是否设为「客户员工可见」。用 `scripts/client-documents/import-files.ts`：先演练（只读本地文件，不联网、不用钥匙），再加 `--apply --project-ref <项目号>` 真写；写之前它会核对钥匙文件指向的项目和你给的项目号一致，不一致就拒绝。清单文件（谁能下载逐个写明，没有默认值）放在 Dropbox 的 `Tours/brochure-source-v11/资料库首批文件-manifest.json`，现在 9 个都写的是「仅内部」。
4. 用内部账号和客户员工账号各点一次下载，核对。

**回滚**：删表 `client_documents`、删桶 `me-client-documents`（先清空），再去掉客户页那张卡片；没有别的功能依赖它。

## 11. Reuse Statement

- 复用：客户访问三件套（`client-access.ts`）、`supabaseAdmin` 私有桶与临时链接做法、service-role RLS 模板、`factory-clips` 的指纹去重与失败清理、客户页 `ToolCard`、`scripts/db-replay-and-verify.sh`。
- 新增且平台共享：`client_documents` 表、`me-client-documents` 桶、`src/lib/client-documents/`、`/api/clients/[id]/documents*`、`/dashboard/clients/[id]/documents` 页。
- 行业专属：无。客户专属：无（CTS 文件是数据行）。客户名 / 客户 ID / 行业判断进共享代码：无。
- 学习 / 记忆：无。
- 不上 Inngest：同步读写，没有跨步骤异步接力，没有对外发布 / 扣费 / 给客户发消息。
