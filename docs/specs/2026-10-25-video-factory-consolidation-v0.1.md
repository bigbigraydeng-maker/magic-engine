# 视频工厂整合 · 入口合并规格 v0.1（L9 + 视频工厂页标签页，一份规格一次做完）

- 日期：2026-10-25 NZDT · 来源：Issue #3090 · 决定人：Ray（14:48 NZDT「一次到位。没有用的都摘掉。但是素材库应该还在使用？其他功能能合并的合并，无用的摘掉」）
- 替代：此前「L9 分两步摘」「L9 与标签页分开」的说法作废；以本文为准。
- 风险级别：**B 级**（纯前端入口/标签，不碰接口、库表、凭证；改的是在用的审片页和客户页，需保证默认体验不退化）。
- IMPACT 位置：Act（工厂入口与回执的呈现）；Check（表现标签）。不新增能力，不 Build 新底层。
- 红线：页面和路由全部保留，只摘入口；不改库表；不碰 `boundaries.ts` / workflows / 凭证；不合并、不部署、不写生产库、不花广告费、不发布。

## 一、入口处理总表（含「是否在用」核实）

核实方法：只读，查代码引用（grep）+ 生产库只读 `count` / `max(created_at|updated_at)`（2026-10-25 约 19:10 NZDT，Supabase 项目 `glbdnayojixmexgofbsd`，没读行内容）。结果见第五节；只摘入口不删页面，风险可控。

| 入口 | 处理 | 代码引用核实 | 30 天数据 |
|---|---|---|---|
| 「出片」门卡 | **保留**，唯一主入口 | `clients/[id]/page.tsx` 门卡 | — |
| 素材库 `/clients/[id]/assets` | 合并成「素材」标签主体 | 自助客户左栏、出片门卡引用，在用 | `visual_assets`：总 9 行，30 天新增 0 / 更新 0，最后写入 2026-06-08 |
| 视频工厂素材标签与审核 `/clients/[id]/factory-clips` | 合并为「素材」标签里的「视频片段」子页 | 仅出片门卡引用（受 `factory-clips` 入口开关，仅管理员） | `video_clips`：30 天新增 0 / 更新 0，最后写入 2026-09-01 |
| 内容工厂看板 `/clients/[id]/content-factory` | 合并进「选题」标签 | 门卡、ContentHub、出片门卡的客户侧兜底目标，在用 | `content_posts`：30 天新增 34 / 更新 48，最后写入 2026-10-25（在用，不能摘） |
| 「生成单条内容」按钮 | 合并进「选题」标签（`新建选题`） | 绑 `setGenerationOpen`，在用 | — |
| 系列视频与播放数据 `/content-factory/series` | 合并进「表现」标签 | 内容工厂页内链接，有测试 `series/page.test.tsx` | series 没有单独的表（清单文件 + `clients.factory_config` JSON 字段），无写入时间，查不出 |
| 社媒日常「短视频」页签（`daily-plan?tab=reels`） | 合并进「待审/分发」 | `DailyPlanReelsPanel`，仅 `ADMIN_EMAILS` 精确名单可见 | —（无独立表） |
| 社媒日常其余 | 只留「本周总览」+「图文帖子」 | — | — |
| Story 自动发布 | **不动**，留社媒门卡下 | `showEntry('story')` | — |
| 内容生产包 `/clients/[id]/production` | **摘入口**（门卡）；路由保留 | 查过代码：除生产包页自身、`ZhugeGlobalFab.tsx:95` 页名映射（保留）外，只有 `execution/_client.tsx` 量产完成提示链到 `production/<packageId>`。→ 摘门卡入口；**该提示保留链到生产包页**（量产草稿写 `content_posts`/`production_items`，社媒日常只读 `social_plans`，看不到本次草稿；Codex P2），没有 packageId 时链生产包列表；页面、路由、接口都保留 | `production_packages`：总 26 行，30 天新增 0 / 更新 0，最后写入 2026-08-25 |
| 客户主页概览的审片框（`ReviewInbox`） | 由「待审」标签代替后摘（**PR 2 随标签页一起摘**，避免出现无入口期） | `page.tsx:593`，组件本体被视频工厂页复用，**组件保留** | — |
| 推广活动页的生产快捷入口（`ContentHub` 的「生产工作台」两张卡） | **摘**（PR 1） | `ContentHub.tsx`；调用方只有 `campaigns/page.tsx`；两个目标页都在门卡里有入口，不丢入口 | — |
| 自助客户左栏打不开的链接（`Visual Studio` / `Content`） | **摘**（PR 1） | `middleware.ts:212` 只对 `paid_client` 放行 `/dashboard/content`、`/dashboard/visuals`，自助客户点了被弹回 | — |
| Launch Hub（`/dashboard/visuals`） | **改名「图片工厂」**（PR 1） | 页头、BriefGate 文案 | — |
| Launch Hub（`/dashboard/content`） | **改名「内容日历」**（PR 1） | 页头、快捷链接、`ZhugeWorkbenchFab` 内的区域名与 5 处提示文案（同步改，Fab 里用区域名做判断，必须两边一致） | — |

## 二、#3117 合并后「出片」两边怎么指、怎么统一

代码事实（`clients/[id]/page.tsx` 出片门卡 + `lib/auth/home-entries.ts`）：
- **内部（无客户上限的管理员，`factory` 入口可见）**：主链接 → `/dashboard/factory?client=<id>`（视频工厂，按客户锁定）。
- **客户 / 受限管理员**：`middleware` 只放行 `/dashboard/clients/<自己>/**`，打不开 `/dashboard/factory`，且工厂接口要管理员登录态 → 主链接 → `/dashboard/clients/<id>/content-factory`（内容工厂）。

统一办法：**两边用同一组 6 个标签（选题 / 素材 / 出片 / 待审 / 分发 / 表现），只是挂在不同页面上，由同一个标签定义文件驱动**。

1. 新建共享标签定义 `src/app/dashboard/_shared/factory-tabs.ts`（纯数据：key、中文名、各 tab 在「内部」「客户」两侧的目标与可见条件）。两侧页面都读它，避免两处各写一套。
2. **内部侧**：标签栏加在 `dashboard/factory/page.tsx`（`?tab=`，默认「待审」，保持现有审片体验）。
3. **客户侧**：标签栏加在 `clients/[id]/content-factory/page.tsx`（同一个 `FactoryTabs` 组件，`?tab=`，默认「选题」，即现有看板）。客户侧「待审/分发」依赖管理员接口的部分先显示「由我们的团队处理」说明，不展示假数据、不新增客户可达的管理员接口。
4. 标签 → 现有内容映射（只引用，不搬代码、不改表）：

| 标签 | 内部侧（视频工厂） | 客户侧（内容工厂） |
|---|---|---|
| 选题 | 链到内容工厂看板 + 「新建选题」按钮（打开现有生成弹窗） | 现有内容工厂看板 + 「新建选题」 |
| 素材 | 素材库 + 子页「视频片段」（factory-clips） | 素材库（视频片段子页管理员可见） |
| 出片 | 现有工单进行中列表（`work-orders` 非 in_review） | 看板的出片段 |
| 待审 | 现有 `ReviewInbox`（默认） + 社媒日常「短视频」面板 | 不开放（说明文字） |
| 分发 | 占位「未开放」；仅放原 FB 草稿/发布状态呈现（不新增数据） | 不开放（说明文字） |
| 表现 | 链到 series 页（系列视频与播放数据） | 同左（该页已是客户路径下） |

5. 两侧门卡主链接保持现有分流，**不新增客户可达路径**；统一的是标签名与顺序，不是页面。

## 三、拆成 3 个顺序 PR（同一份规格连续做完；`claude/` 分支单个 PR 受 800 行上限）

| PR | 内容 | 级别 | 估计行数 |
|---|---|---|---|
| **PR 1：摘掉 + 改名**（本分支已做） | 门卡摘「内容生产包」；ContentHub 摘「生产工作台」；自助客户左栏摘 Visual Studio/Content；两个 Launch Hub 改名（含 Fab 联动） | C | ≈ −60 / +20 |
| **PR 2：标签壳 + 内部侧** | `factory-tabs.ts`、`FactoryTabs.tsx`；`dashboard/factory/page.tsx` 接标签（待审默认）；摘客户主页概览 `ReviewInbox`；社媒日常「短视频」页签并入待审，社媒日常只留总览+图文；组件测试 | B | ≈ 300–450 |
| **PR 3：客户侧 + 并入** | 内容工厂页接标签（选题默认）；素材标签并入 factory-clips 子页；表现标签接 series；出片门卡其余链接（素材库、素材标签与审核、内容工厂、生成单条内容）按并入完成情况摘掉 | B | ≈ 300–500 |

顺序理由：先做不丢入口的减法与改名；标签落地后再摘被它替代的入口，**任何时刻都不出现无入口期**。

## 四、验收

PR 1：
- 出片门卡不再出现「内容生产包」；素材库、素材标签与审核、内容工厂、生成单条内容仍在。
- 推广活动页不再有「生产工作台」两张卡，推广计划面板不变。
- 自助客户左栏无 Visual Studio / Content；付费客户和管理员导航不变。
- `/dashboard/visuals` 页头显示「图片工厂」，`/dashboard/content` 页头显示「内容日历」；`/clients/[id]/production`、`/dashboard/visuals`、`/dashboard/content` 直接输入地址仍可打开。
- 全仓无残留的用户可见 `Launch Hub` 字样（测试里「不得出现 Launch Hub」的断言保持通过）。

PR 2 / 3：
- 打开 `/dashboard/factory?client=X`：6 个标签，默认「待审」，审片操作不变；切换保留 `client` 参数；刷新停在当前标签。
- 未实现的标签（分发/表现的未接部分）明确写「未开放」，不展示数据。
- 客户账号访问行为不变（仍被 middleware 拦，不引入新可达路径）。
- 不动 `content_posts` / `content_work_orders` 结构。

## 五、30 天数据核实结果（只读，2026-10-25 约 19:10 NZDT）

ME 生产库只跑 `count` / `max(created_at|updated_at)`，没读行内容。规格早期草稿里的表名 `content_production_packages`、`factory_clips` 在库里不存在，实际为 `production_packages`、`video_clips`。

| 项 | 实际表 | 总行数 | 30 天新增 | 30 天更新 | 最后写入（NZ） |
|---|---|---|---|---|---|
| 内容生产包 | `production_packages` | 26 | 0 | 0 | 2026-08-25 23:19 NZST |
| 视频片段 | `video_clips` | 281 | 0 | 0 | 2026-09-01 09:33 NZST |
| 内容工厂 | `content_posts` | 318 | 34 | 48 | 2026-10-25 11:01 NZDT |
| 图片素材 | `visual_assets` | 9 | 0 | 0 | 2026-06-08 03:37 NZST |
| 系列视频 series | 无单独表 | — | — | — | — |

补充：`video_clips` 的 `last_used_at`、`reviewed_at`、`license_reviewed_at` 全为空；series 数据在代码清单文件 + `clients.factory_config` JSON 字段里，查不出写入时间。结论：生产包两个月无新包，按 Ray「没用的都摘掉」处理；内容工厂在用，不能摘。其余项是否退役另开卡决定，本规格仍只摘入口。

## 六、验证与检查点

- PR 1：未运行测试（本环境运行 `npm test` / `type-check` 需审批，无退出码）。请 CI / 本机跑 `npm test -- src/app/dashboard` 与 `npm run type-check`，并手看客户页「出片」卡、推广活动页、自助客户左栏。
- Reuse Statement：复用现有页面、`ReviewInbox`、`homeEntryVisible`；新增仅 PR 2/3 的共享标签定义（platform-shared，无客户/行业硬编码）；无客户私有内容进入共享代码。
