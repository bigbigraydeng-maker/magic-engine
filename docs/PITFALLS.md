# Magic Engine — 踩坑清单

> 每条都是**真实事故**，不是假想风险。开工前扫一眼，比事后复盘便宜。
> 新踩的坑请追加到对应分类，格式：**症状 → 根因 → 怎么防**。

---

## A. 配置陷阱（最容易静默失败的一类）

### A1 · `ATLAS_API_KEY` vs `ATLAS_CLOUD_API_KEY` 名字对不上 🔴

**症状**：图片 / 视频生成在生产上失败或返回 401，本地却正常。

**根因**：`render.yaml` 声明的是 `ATLAS_API_KEY`，但代码只读 `ATLAS_CLOUD_API_KEY`
（`src/lib/visual/atlas.ts:5`、`seedance.ts:6`、`wavespeed.ts:5`，三处都写死这个名字）。
Blueprint 里的名字和代码里的名字不一致时，Render 不会报错 —— 它只是给你一个 `undefined`。

**怎么防**：改 env 名字时 grep 全仓 `process.env.<旧名>`。跑 `bash scripts/doctor.sh --env` 会直接点名。

### A2 · `FACTORY_PUBLISH_LIVE` 未设 = 静默发草稿 🔴

**症状**：片子 `status=published`，三处落库全绿，FB 主页上却什么都没有。

**根因**：未配该变量时 Factory 走 dry-run 分支，只发 DRAFT。全链路没有任何一处报错。

**怎么防**：验完草稿格式后，PM 显式在 Render 设 `FACTORY_PUBLISH_LIVE=true` 才会真发。

### A3 · `APIFY_API_KEY` 和 `APIFY_TOKEN` 两个名字并存

**症状**：一部分 Apify 调用能跑，另一部分 401。

**根因**：代码里两个变量名都在读，但只配了其中一个。

**怎么防**：两个都配上，或统一成一个（未做，见 `ENV.md` §3）。

### A4 · `UPLOAD_LINK_SECRET` 未配时会 fallback 到 `CRON_SECRET`

**根因**：`src/lib/uploads/client-upload-token.ts:90` 写了 `|| process.env.CRON_SECRET`。

**风险**：轮换 `CRON_SECRET` 会顺带作废所有客户上传链接，且没有任何提示。

### A5 · 判「环境变量零引用」时只 grep `process.env.X` 会漏一大片 🔴

**事故（2026-08-01，本仓文档整理 PR #651）**：清理 `.env.example` 时按 `process.env.X` 判定零引用，
**误删了 9 个仍在用的 Voice Agent 变量**（`TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` /
`WHATSAPP_ACCESS_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID` / `META_APP_SECRET` / `META_VERIFY_TOKEN` /
`TELEPHONY_PROVIDER` / `WEBHOOK_REPLAY_WINDOW_SECONDS` / `DEFAULT_HUMAN_TRANSFER_URI`）。
Codex 审出 5 个，人工复查又找出 4 个。

**根因**：`src/lib/voice/config.ts` 用 zod schema 声明变量名（`TWILIO_ACCOUNT_SID: z.string().optional()`），
读取时走 `parsed.TWILIO_ACCOUNT_SID` —— 全程不出现 `process.env.TWILIO_ACCOUNT_SID`。
后果不是「少一行模板」：生产环境（`isProd` 且没开 `MOCK_EXTERNAL_SERVICES`）这些 provider 落回 mock，
`voice/config.ts` 会**直接抛错拒绝启动**。

**怎么防**：
- grep **变量名本身**，不要 grep `process.env.<名>`；范围含 `src/` 与 `scripts/`（排除 `archive/`）
- 命中后逐个看上下文 —— 有的命中只是文档字符串举例（`SEMRUSH_API_KEY` 在
  `validation-utils.ts` 就是注释里的 `@param` 示例，那个确实零引用）
- 删任何模板项前，先问「有没有 schema / 配置中心 / 字符串拼接式读取」

---

## B. Migration / Schema

### B1 · migration 必须 PM 拍板，worker 严禁自行 `apply_migration`

**事故**：W4 / W5 两个 worker 都踩过 —— 一个把 P0 Kanban 搞崩，一个把 P→E 链路搞断。

**怎么防**：worker 只写 migration 文件，等 PM 显式 `go apply`。

### B2 · worker 报「已 apply migration」不能信，必须 SQL 验证

**事故**：W4 / W5 都误报过。

**怎么防**：查 `supabase_migrations.schema_migrations` 确认版本号真的在里面。

### B3 · RLS policy 引用不存在的对象 → 整个事务回滚，文件在仓里但 DB 里啥都没建

**事故**：审计发现 13 处 schema 漂移（9 张表没建 + 4 个列缺失）。根因是早期 migration 的
`CREATE POLICY` 引用了 `clients.workspace_id`（不存在）和 `client_team`（不存在），
apply 时炸在 policy 步骤。影响 19 个客户的关键词排名 cron 全瘫 + 5 个模块功能。

**怎么防**：新表 RLS 一律用 service-role 模板（见 [DECISIONS.md](./DECISIONS.md#2026-06-05--新表-migration-的-rls-一律-service-role-模板)）。
写完 grep `workspace_id\|client_team\|auth\.uid\|auth\.jwt`，命中就重写。

### B4 · 加 enum / status 新值必须同步前端 type + UI fallback

**事故**：`superseded` 状态加了 DB 没加前端，UI 直接崩。

**怎么防**：每次改 `type X = 'a' | 'b' | 'c'` 必须 grep 全仓 `Record` / `switch` / `STATUS_META` 的 key。

---

## C. Git / 分支

### C1 · 长命分支是万恶之源

**事故**：一次审 4 个 open PR（#460 / #455 / #452 / #448）发现**全部 dirty 无法 merge**，最老的放了 4 天。
两个 docs-only PR（2 文件 / 1 文件）也照样冲突 —— 全因抢改 `ROADMAP.md` / `CLAUDE.md`。
#460 描述说改 8 文件，GitHub 显示 78 文件 +4718 行 = 典型「分支基于旧 main、从没 sync」的 diff 虚胖。

**怎么防**：① 能合就几小时内合，别过夜拖天 ② 登记类改动拆独立小 PR 立即合
③ 新窗口开工先 `git fetch origin && git merge origin/main`（**永远 merge，永不 rebase** —— 本仓禁止 force push，
而 rebase 已 push 的分支必须 force push）④ merge 完必须重跑 build + 测试（文本不冲突 ≠ 语义不冲突）。

**警报信号**：「文件数 vs PR 描述对不上」就是分支漂移。

### C2 · 删分支前必须 verify PR 真的 MERGED

**事故**：PR #410 / #415 force push 完立刻 delete branch，实际 PR 还没 merge，代码丢了。

**怎么防**：`gh pr view <N> --json state` 确认 `MERGED` 才删。

### C3 · PR 动 `ROADMAP.md` 必须逐行扫 diff

**事故**：PR #353（修 goals 入口）merge 时意外删掉了 PR #348/#350 登记的 Phase 22.E S9-S13 + 决战日 schedule
共 105 行。下个 session 开工 S13 时 grep "S13" 返回 0 行才发现，靠 PR #359 才恢复。

**怎么防**：开 PR 前跑 `git diff main -- docs/ROADMAP.md`，确认所有 `-` 删除行都 100% 与本 PR 主题相关。
看到无关的 `-` 行立刻停手，从 `git show <base>:docs/ROADMAP.md` 恢复。

---

## D. 客户数据 / 内容（对客户伤害最大的一类）

### D1 · 绝不凭空注入客户业务数据

**事故 1（CTS）**：子牙凭空假设「queenstown inbound 旅游」—— 实际 CTS 做的是 outbound Kiwi→中国旅游。

**事故 2（Oztop）**：子牙编了 vinyl / herringbone / plantation shutters / sheer curtains 五个品类页，
还编了 18100 / 22200 的搜索量 —— 实际 Oztop 不卖 shutters / curtains / herringbone，数字全是编的。

**怎么防**：写任何客户 Goal / Initiative / 关键词列表之前，必须先
① 查 `master_briefs.{brand_name, core_proposition, target_audience, content_pillars, keyword_seeds}`
② 查 `clients.primary_keywords`。
搜索量 / KD / 月点击**必须来自 DataForSEO 或 GSC snapshots**，不能估、不能编。
任何 SEO 内容或 Initiative hypothesis 必须能在 `master_briefs` 或 `clients` 表里指明来源，否则停手问 PM。

### D2 · 客户对外内容必先 grounding 官网真实行程

**事故**：CTS 长城 reel 编了「日出登长城 / at DAWN」。查官网 Tale of Two Cities 的真实行程是
**慕田峪 Mutianyu、early start 全天、缆车上+滑道下、没有日出**。PM 追问来源当场揭穿，已撤 Publer 排期。

**怎么防**：`master_briefs` 只给定位/受众/支柱，**不含真实运营细节** —— 具体怎么安排只有官网行程页有。
发布前逐句标「官网可溯 / brief 可溯 / 未证实」，未证实的删掉或让 PM 确认。

**和 D1 的关系**：同一红线的两面。D1 防编**数字**，D2 防编**运营细节**，一样致命。

### D3 · 客户营销落地页绝不能建在 ME 域名下

见 [DECISIONS.md 2026-06-10](./DECISIONS.md#2026-06-10--客户营销落地页必须建在客户自己的域名红线)。这是永久红线。

### D4 · FDE/PM 要填的字段必须连 UI 一起做完

**规则**：任何需要在客户级别填的配置（`brand_aliases` / `competitor_domains` / `primary_keywords` /
GA4 property_id / GBP account_id / 任何 connector 配置），**必须连同 Settings 页 UI 一起做完才算 ready**。

**绝不能写**「让 PM 进 Supabase Studio 直填」/「FDE 跑 SQL UPDATE」这类 SOP —— 运营人员不应该碰数据库。

**判断标准**：如果某字段被 FDE 工作流读，它的写入路径必须是 ME 后台的可视化 UI。
只加字段不加 UI 就上线 = 产品缺陷，下一个 PR 必须补。
复用 pattern：`CompetitorDomainsPanel` / `PrimaryKeywordsPanel`（chip + add input）+ `/api/clients/[id]/{field}` 对称 GET/PATCH。

---

## E. 匹配 / 算法逻辑

### E1 · token equality 漏掉 80% 的多词品牌

**事故**：`brand_search_volume` 用 token 相等匹配品牌词，CTS 的 "cts tours" 匹配不上域名根 "ctstours"，
统计出来只有 ~5 次品牌搜索（真实值 166）。

**怎么防**：新增 `clients.brand_aliases` 字段 + substring 匹配（不污染原 `isBrandedKeyword`）。
SOP：`docs/sops/brand-aliases-setup-for-gsc.md`。

### E2 · 通用词表整张启用 → 顶满 100 个结果 slot

**事故**：Oztop 跑 keyword gap 返回 100 个词全是 shutters/blinds/windows（27.1K 月搜/条），但 Oztop 不卖这些。
根因：`BUILDING_SUPPLIES_TERMS` 通用词表含 shutter/blind/curtain，只要 domain hint 含 flooring/oztop 就整张表启用。
影响所有「卖部分建材类别但不卖全部」的客户。

**怎么防**：`isBusinessRelevantKeyword` 加 `excludedTopics`，**排除检查必须在 business-relevance 之前跑**。
数据源是 `master_briefs.excluded_topics`，配套 `ExcludedTopicsPanel` UI（符合 D4）。

---

## F. 运维 / 调度

### F1 · 7 个 cron 端点根本没有调度器

**症状**：功能「上线了」，但从来没自动跑过，也没有任何地方报错。

**清单**：`admin-key-expiry` · `benchmark-accumulator` · `flywheel-seo-weekly` · `kpi-backfill` ·
`memory-extractor` · `poster-studio-daily` · `factory-review-sweeper`（最后一个是有意退役）。

**怎么防**：新建 `/api/cron/*` 路由的同一个 PR 里就要加 `render.yaml` 条目。
`bash scripts/doctor.sh --cron` 会列出所有「有路由无调度」的端点。

### F2 · GitHub Actions 的 scheduled run 是 best-effort

**事故**：`winner-reel-sync-daily` 的 15:00 UTC 那次被静默跳过。

**怎么防**：定时任务一律优先放 Render Cron。GH Actions 只留 `workflow_dispatch` 手动触发。

### F3 · viral-analyzer-worker OOM 导致 cron 连锁宕机

见 `docs/history/2026-viral-analyzer-worker-oom-incident.md`。

### F4 · 本地 worker 不在跑 = 工单永久卡在 queued

**症状**：Factory 有新工单但没人认领，界面上看不出问题。

**根因**：`scripts/factory-worker/worker.mjs` 跑在某台 Mac 上，仓库里**没有 launchd / pm2 配置**，
进程挂了没有任何告警。

**怎么防**：上机 `ps` / `pm2 list` 确认；改了 worker 逻辑后要确认进程重启过（否则还在用旧逻辑）。

### F5 · 系统「知道」问题，但没有任何一处会走到人眼前

**事故（2026-08-01，一天撞出三件）**：CTS 一篇 blog 的 PR 开好后躺着没人知道（待办只统计 `draft`
不统计 `pr_open`）；Oztop 2 个页面谷歌不收录、网站页面数据 65 天没更新（主机商挡了我们的服务器）。
三件事系统全都有数据，但都只停在日志里。

**反模式**（三条都算「没下发」）：
- ❌ 发现写进 `cron_run_logs.summary` / `console.error` 就算完事 —— 那不叫下发，叫埋掉
- ❌ 卡片只说「Resubmit for indexing」不说去哪点 —— FDE 得先自己研究一遍，等于没下发
- ❌ 系统做不了就 silent skip —— 静默降级必须同时产出一条人工任务，或一条可见的数据断流标记

**怎么防**：自动化确实做不了的，一律下发到今日待办「🙋 需要你动手」栏
（`src/lib/pm-todo/manual-items.ts`），并带齐 what / how / href 三件套。见 [CLAUDE.md 铁律 3](../CLAUDE.md)。

---

## G. 协作 / Agent

### G1 · 「我自己审过了」不算 2 审

大任务必须 **子牙 + 魏征**至少 2 个不同 agent；面向 C 端加**板桥**；触碰安全核心实施后补**狄仁杰**。
同级别 agent 互查、挑遗漏角度才是价值所在。

### G2 · Codex 会虚报

**事故**：Codex 声称修复完成，仓库里根本没有那个 commit。

**怎么防**：Codex 交付的 PR merge 前必须子牙复审，重点查
① commit 真实存在 ② 测试数量对得上 ③ **变异测试**（故意改坏校验逻辑，看对应测试会不会 fail，防空架子测试）
④ 边界覆盖（Codex 容易只写 happy path）⑤ 架构旁路（校验必须在最里层，确认没有 API 绕过）。

### G3 · PM 反问 ≠ 删除指令

看到 PM 问「这个还需要吗？」不要直接动手删。先读意图，再确认，最后才动手。
见 `~/.claude/rules/coding-style.md`「删除代码前的强制流程」。

### G4 · 一个分支同一时间只允许一个窗口开

并行任务用 `git worktree` 物理隔离。接力同一大任务用同一分支，全新任务基于最新 main 开新分支。
