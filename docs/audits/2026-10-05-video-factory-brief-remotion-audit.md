# 视频工厂 × Master Brief × 每日计划 × 广告 × Remotion：到底连没连（只读检查）

检查日期 2026-10-05 · 仓库基线 `a6252be51`（与 origin/main 同一提交，本地快照，未刷新远端）· 本次**只读**：没改代码、没改数据库、没发布任何东西。
读了哪份手册：`playbook-social-general`（出片红线）、`playbook-ads-meta-general`（素材同步、版位、改素材回读）。
**没查生产数据库、没跑任何命令去试**；下面说「连了/没连」都只是代码层面，生产里哪个开关开着我没验证。

## 结论（一段话）

**视频工厂只有一半连着 Master Brief：文案、禁区、品牌名连了；logo、品牌色、Slogan 的「画面层」没连。** logo 来自 Mac 上的本机文件夹或 Creatomate 模板，不是从 Master Brief 来的。
**每日计划跟工厂完全没连**：每日计划只会写 Reel 脚本、发图片帖，从不向工厂要视频；「工厂出片→发布→自动建广告」最后一步也没人接。
**Remotion 在仓库里是零**：今天的几条视频全在仓库外，文案、价格、logo 都是手写死的，更没经过工厂的审核与发布闸。
**你担心「所有工作都在云里做」，答案是：不用。** 工厂现在就是「云上管数据和闸门，一台 Mac 管渲染」，Remotion 正适合挂在那台 Mac 上。

## 1. 工厂链路与 Master Brief

有**两条**互不相通的出片线（另有一条 2026-09-02 已退役的旧云上拼片线，头注写明停机，`render.yaml:1181-1195`）：

- **线 A（广告成片工单）**：`evaluate.ts:382` 建工单 → Mac 上的出片机领单（`worker.mjs`）→ 本机 `make_promo.py` 拼片 → 上传 → `complete-work-order.ts` 复扫红线与品控 → 审核 → `publish-worker.ts` 发布（默认只存草稿，设了 `FACTORY_PUBLISH_LIVE=true` 才真发）。
- **线 B（内容看板「确认选题」）**：Inngest 通知 → Creatomate 云端渲染 → 马良 9 宫格自检（`maliang-render-check.ts`）。只有客户配置里写了 `render.engine = creatomate` 才走（`content-factory/[postId]/route.ts:172-191`）。

| 环节 | 证据 | 读 Master Brief？ |
|---|---|---|
| 建单取品牌底稿 | `evaluate.ts:94-112` 取最新有效版 | ✅ 读全字段 |
| 红线闸（角度） | `strategist.ts:93-115` | ✅ `excluded_topics` + 客户禁语 |
| 文案生成（旧路径） | `copy-generator.ts:236`、`evaluate.ts:394` | ✅ 品牌名/官网/语气/产品/Slogan 进提示词 |
| 文案生成（配方路径） | `evaluate.ts:353-393` | ❌ 不读，端卡事实来自客户配置 `verified_cta` |
| 成片复扫/品控/发布前 | `complete-work-order.ts:161-231`、`publish-worker.ts:77-125` | ✅ 禁区 + 品牌名防发错主页 |
| **logo（线 A）** | `worker.mjs:82,95-109` 读 Mac 上 `brandkit/assets/logo_color.png` | ❌ 本机文件夹，靠 worker 环境变量映射 |
| **logo（线 B）** | `client-config.ts:177` 取模板里叫 logo 的图层 | ❌ 模板里写死 |
| **品牌色 VI** | 仅 `lecture-render.ts:648`（讲课线，已退役） | ❌ 渲染层没读 |
| 避讳词 `avoid_words` / `vi_donts` | 只进提示词 | ❌ 软约束；`worker-guard.ts:104-119` 的硬扫只扫禁语和禁区 |
| 配方（爆款样本） | `viral-structure.ts:129`、`evaluate.ts:201` | 只取节奏数字，不取画面形态 |
| 素材池 | `client-asset-pool.ts:79-141` | ❌ 不读（只读素材库本身） |

「苏东坡」代码里**没有对应实现**，只是文档角色（`CLAUDE.md:243`）；真有的自动审查是马良（只看画面/字/logo）和 `content-quality-guard`。

## 2. 每日计划怎么用工厂：**没连**

- 每日计划里的 Reel 只是脚本草稿，`media_status` 只许填 `NO_MEDIA/DRAFT_MEDIA`，代码注释明说没有核实成片的通路，不许填「已就绪」（`daily-plan.ts:339-349`）。
- 每日计划真正发的是图片帖（`campaign-daily-plan/publish/route.ts:30`），发布前强制素材是图片（`publish-queue/route.ts:171`）。
- 社媒视频与广告视频**不是**同一条链路：工厂按自己的每日定时排产（`order-scheduler.ts:60-85`），与每日计划无关；两边只在最后共用「发布后量效果」的通知。
- Inngest 回执（CLAUDE.md §3）**半连、三处断头**：
  1. `daily_plan.publish_queue.ready` 有明确回执字段（`daily-plan.ts:141-157`），但接收方只往本机 JSON 文件写一张「已就绪、不发布」的条子，**不建工单、不请工厂出片**（`inngest-cts-workflow.mjs:278-296`）。
  2. 工厂候选片的「开始」通知只有人手敲命令才发，没有任何自动发送方（`inngest-cts-workflow.mjs:341-351`）。
  3. `me/factory.reel.published`（发布后通知）只有「量效果」一个接收方，没人据此自动起草广告。

## 3. 广告这一头：工厂成片怎么变广告素材

- `POST /api/clients/<id>/meta-ads/draft`（**半连**）：「起草→建成暂停→人审批→才开」闸门是通的（`draft-and-gate.ts`、`ad-approval/[actionId]/route.ts:69`），认视频；但视频要**外面先传到 Meta 拿到 video_id 再喂进来**（`ads-strategy/ad-draft.ts:69-72,193-198`），**工厂成片没有自动接进来**。仓库里找不到谁调用这个入口。
- `winner-reel-sync`（ThruPlay **半连**、留资**没连**）：目标广告组存在数据库表 `winner_reel_sync_config`（`engine.ts:73-86`），仓库里没有写死值，我没查生产里配的是哪个。它吃的是「主页上已发布且表现好的视频帖」，用「推现有帖子」方式建广告，没有任何留资表单逻辑，**不能给留资广告系列供素材**。手册 §十一 还记着：CTS 上次实测这个目标广告组挂在已停投的系列下。
- `creative_pool` 为什么是空：**没人往里放**。默认就是空列表（`ad_strategy_configs_autonomy` 那份建表文件第 20 行），唯一入口是人工在设置页粘贴（`autonomy-settings.tsx:233`）、再人工批准；`kind: work_order` 这个类型声明了，但没有任何代码产出它；也没有任何代码从池子里取东西。
- 个人号要先传官方号：**代码没处理**。`asset-upload.ts:94-122` 一律往传入的账户直传，唯一调用方 `draft-listing/route.ts:252` 传的就是客户主账户（CTS 即个人号）。「先传官方号拿 video_id 再引用」这条只存在于我的记忆笔记里（2026-09-09 实测有效），代码里没有；CTS 官方号上的三条广告是一次性脚本+手工做的。

## 4. Remotion：现状与接法

- 仓库里 **零** Remotion 代码、零依赖（全仓只有一行「本轮不做」的文档）。
- `~/Projects/cts-remotion`：6 个视频模板、约 57 个已渲染成片；素材全是本机 `public/clips`（约 87MB）；**文案、价格（注释里手抄「NZ$…checked 2026-10-04」）、品牌色、logo 全写死**（`theme.ts:3`、`ListReel.tsx:7-9`）；没有渲染脚本；**这个目录不是 git 仓库，检查时没有任何版本备份**（PM 已要求保留，Dropbox 备份进行中，见下文「PM 硬要求」）。
- 「云里做」的担忧对应三件事：①渲染要 Chrome 和较大内存——仓库里没有这个条件（`render.yaml` 56 个服务全是定时触发器，没装 Chrome，web 服务内存规格仓库查不到，过去出过内存撑爆）；②素材在你电脑上；③成片要回到 ME 才能过闸。**这三件正好是 Mac 出片机现成解决的**：它领单时拿到品牌+文案+素材链接，渲完用签名链接传回（`worker.mjs:512-514`；`STATE.md:186-190`）。

| 接法 | 利 | 弊 |
|---|---|---|
| **A 本机出片机加一个 Remotion 引擎（推荐）** | 现成领单/回传/复扫/品控/审核/发布全沿用；零新增云费用；模板可改成读 Master Brief | 依赖那台 Mac 开着；仓库里没有开机自启和掉线告警（会静默卡单）；Remotion 公司使用授权条款我没联网核实 |
| B 在 Render 上新建渲染服务 | 不依赖 Mac | 新基建、新月费（未估）、要装 Chrome 并重新定内存；发布链路相关，A 级 |
| C 只「收片入工厂」：视频照旧本机做，做完上传成一张工单只走闸门 | 最快，今天的几条就能进闸 | 文案/logo 仍写死，**不满足「连 Master Brief」**，只能当过渡 |

**推荐 A，第一步先做 C 的收片入口**（把今天的成片接进闸门），第二步把模板改成吃 Master Brief。
**PM 硬要求（2026-10-05）**：`~/Projects/cts-remotion` 里约 6 个 Remotion 模板和已渲染成片**必须保留，不能丢**。所以「收片入口」的**第 0 步是先备份、再接入工厂**：整个目录先备份一份到 Dropbox，确认备份在了，才允许任何接入动作碰这个目录。
**这一步已做完（2026-10-05，另一个窗口做的，我事后核对过）**：备份在 Dropbox 的 `Magic Engine/by-client/01_CTS_Tours/Remotion_Reels_backup_20261005/`（不含 node_modules，里面有 README.txt 写了恢复办法，共 1.4G）。我核对了文件数，和原目录一一对应：src 17、public 23、tools 3、out 成片 57。注意：这只是一份拷贝，原目录仍然不是 git 仓库；接入工厂时仍不要直接改原目录。
级别与审：整体按 **A 级**（给外部成片开一个进发布链路的口子，属发布相关）；其中纯渲染适配器部分是 B。新增依赖 = 大任务，必须 **子牙 + 魏征** 设计与实施各审一次；面向客户加 **板桥**；若改鉴权/出片机准入再加 **狄仁杰**。写代码默认交 DeepSeek（`CLAUDE.md §5`），Claude Code 出指令、审 diff、跑测试。
需要 PM 记一笔：PM 当初是嫌 Creatomate 模板「平庸」才换 Remotion（记忆 `reference-cts-remotion-local-project`）；已买供应商是默认项，换引擎属 PM 决定，应在台账留一句。

## 5. Remotion 成片要投广告，必过哪几道闸

按 `CLAUDE.md §8`：①**视频只走工厂**——Remotion 成片没经工厂就发布/投放 = 绕闸（2026-09-28 East Inter 事故同型）；②**配方对账表**（查 `viral_reference_library` 行业配方，逐列写 满足/未满足/不适用；logo 开场与尾卡、景观空镜开场是低分特征，Remotion 版正好有大 logo 和地图）；③**分镜 9 宫格自检**（素材文件名不可信，笔记里「紫禁城」素材实为现代大楼）；④**苏东坡/马良审**（生产方≠质检方）；⑤**价格/行程逐句标「官网可溯」**；⑥**PM 授权**；⑦广告侧：暂停建好→回读能否投→人审批→才开；ThruPlay 要手动锁版位；别拿花费最大的在投广告当试验台（手册 §十五、§二十七）。

**今天最快的合规路径（不用写代码）**：把这几条定性为「**样片，不发布、不投放**」→ 每条补①配方对账表 ②9 宫格 ③价格逐句官网溯源 → 派独立审查员（苏东坡角色）看 9 宫格出意见 → 你看样片。**要真投一条做测试，需要你明确批一次例外**（因为没走工厂），并走：传官方号拿 video_id → 草稿路由建暂停 → 回读 → 你批 → 才开。

## 总表（连没连）

| 问题 | 状态 |
|---|---|
| 工厂读 Master Brief：文案、禁区、品牌名 | 已连 |
| 工厂读 Master Brief：logo、品牌色、Slogan 画面层、避讳词硬扫 | **没连** |
| 配方路径文案读品牌语气 | 没连 |
| 每日计划 → 工厂出片 | **没连** |
| 工厂发布 → 自动起草广告 | **没连** |
| 广告起草入口 `/meta-ads/draft` 认视频 | 半连（要外部先传） |
| winner-reel-sync 给留资供素材 | **没连**（ThruPlay 半连） |
| `creative_pool` | 没连（只有手填，无人读） |
| 个人号先传官方号 | **没处理** |
| Remotion 在仓库/工厂 | **零** |

## 没验证的事
生产库里各客户开了哪条出片线、`winner_reel_sync_config` 实际配值、Render 上各定时任务是否开着、Remotion 授权条款、「Meta 是否接受把留资广告组当作 winner-sync 目标」均未验证。调查员读出的行号我抽查了关键几处（出片机品牌包、建单取底稿、每日计划不允许就绪、回执接收方只写条子、上传不分账户、草稿入口校验），其余按调查员报告。路径更正：Inngest 在 `src/lib/inngest/`，不在 `src/inngest/`。

## 平台层级（Inline）
Remotion 引擎 = **L3 适配器**，挂在既有社媒/视频工厂下，不新增支柱；旅游版式（路线地图）= L2 行业版式；价格/文案/logo = L4，必须从 Master Brief 来，不进共享代码。CTS 手写的价格与文案**不得**沉进共享模板。

## Reuse Statement
复用：工厂领单/回传/复扫/品控协议、`master_briefs` 读取（`evaluate.ts`、`brief-injector.ts`）、马良 9 宫格自检、广告草稿闸门。本次**无新增**共享代码（只读）。共享：A 方案里的 Remotion 适配器；行业：旅游路线地图版式；客户：CTS 现有写死文案/价格。无客户名写进共享运行时。学习：无。本次落点与层级门判定一致（未实现，仅建议）。
