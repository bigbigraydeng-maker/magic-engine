# 内容工厂架构整理方案 v0.1（子牙综合 · 三方审计签字）

> 2026-07-12。PM 令:「内容工厂是核心功能,之前 ME 架构有点乱,停下推进,子牙带队整理架构,再继续。」
> 召 3 agent 并行审计:①架构映射(部件/数据流)②魏征(架构债务)③复用+DAPE一致性。子牙综合。
> **供 PM 拍板整理顺序。整理完再推 S1 喂料 / muapi / M3 闭环。**

---

## 0. 诊断:不是「乱」,是「三层过渡态没收尾」+ 一个结构错位

三方一致结论:**决策核(strategist / evaluate / worker-guard)是全仓最干净的复用范例**——纯函数、fail-closed、有测试、正确复用 goals/master_briefs/clients。乱不在这。真正的债高度集中在两处:

**① 结构错位(最关键,复用审计主发现):worker 这个「仓外 Mac 脚本」揣了太多「脑子」。**
`scripts/factory-worker/worker.mjs` 现在:硬编「CTS Tours / ctstours.co.nz」(`generateCopy` L140)、自己 fetch OpenAI 写文案、绕过 ME 已有的 `brief-injector`(品牌注入)和 `reels/generator`(文案生成)、muapi 源图写死占位(L232)。**后果:工厂现在只能服务 CTS 一个客户,换客户串味;且品牌 VI 注入不到成片(PM 要的「带 logo/VI、准确」断在这)。** 根因:worker 是仓外进程,物理 import 不到 `src/lib`,于是重造了简化版。

**② 地基债(魏征主发现):工单状态机没有类型来源。**
`content_work_orders.status` 有 15 个值(queued/claimed/producing/rendered/in_review/review_rejected/approved/publishing/publish_failed/published/measuring/closed/failed/dead_letter/archived/superseded),但 `types.ts` **没有 `WorkOrderStatus` union**,UI 全用裸 string,STATUS_META+ORDER 只活在 page.tsx。CLAUDE.md「改 enum 必全仓 grep 同步」在这里**没有着力点**。每加一个状态(发布链路/peer_study)都得人肉扫 4+ 文件。

## 1. 整理总纲(子牙一句话)

> **把「脑子」收回 ME 后端,worker 只当「手」。** 决策/文案/VI/角度全在后端(strategist + brief-injector + reels/generator)算好,塞进 `content_work_orders.brief`;worker 只干两件体力活:muapi 生成 + make_promo 装配。

这一个动作同时修好:品牌准确(VI 后端注入)、多客户通用(不硬编 CTS)、复用 brief-injector、复用 reels/generator。

## 2. 三个复用断点(PM 要的能力,轮子都在 ME,没接)

| 要的 | ME 现成轮子 | 现状 | 修法 |
|---|---|---|---|
| 品牌准确(logo/VI) | `src/lib/content/brief-injector.ts`(`formatBriefForPrompt` 已格式化 vi_colors/vi_style_keywords/vi_dos/vi_donts) | worker 硬编 CTS,没接;strategist 只读 4 个战略字段没读 VI | VI 注入挪回后端,strategist 建单时调 brief-injector 渲进 brief;删 worker.generateCopy |
| 学广告结构(甩链接学) | `src/lib/reels/viral-analyzer.ts`(`analyzeViralReference` 吃任意 FB/YT/TikTok URL→opening_hook{type,script,feel}+key_techniques+style_scores) | **完全没接**;spec §494 还把它 defer 到 v2(方向偏差) | 甩 URL→viral-analyzer→映射进 winner_structures 三段,`entry_channel='peer_study'` |
| muapi 批量图→I2V 储备 | worker `muapiGenerate()`(Kling v2.1 I2V 引擎已在,$0.225/条,幂等入 video_clips) | 只在临时补料触发,无「批量图预囤」入口,源图写死 | 抽 `lib/factory/muapi.ts` 共享;加 `POST /api/factory/clips/generate-batch`;源图从 bucket `sources/{client}/` 读 |
| 表现归因 | flywheel_actions/metrics/outcomes 表 + client_learned_preferences(P21.F 同字段) | **零接入**(grep 全模块无一处写);与 CLAUDE.md「外部执行必三落库」冲突 | M3 落地照 spec §467/476/480 走 flywheel,别自建归因表;factory_balance_ledger 是成本台账职责不同,保留 |

## 3. 整理路线图（A→B→C→D，排好序不返工）

### A 段 · 地基收尾（先做，纯内部重构，零生产行为变更）
- **A1 状态机类型来源**：`types.ts` 补 `WorkOrderStatus` / `ReviewRejectCategory`('quality'|'budget') / `WinnerEntryChannel`('auto'|'manual_intake'|'peer_study') 三个 union;`STATUS_META`+`ORDER` 提到共享常量文件;UI import。可加 `state-machine.ts` 的 `canTransition`（Explore 建议）。**这是所有后续改 enum 的地基,最先做。**
- **A2 脑子收回后端（结构错位修复）**：strategist 建工单时调 `brief-injector` 把 VI（色卡/style_keywords/dos/donts/brand_name/tone）渲进 `content_work_orders.brief`;删 worker 硬编 CTS 的 `generateCopy`,worker 改读 brief 里已生成的 copy。→ 品牌准确 + 多客户通用一次到位。
- **A3 抽 lib + 补测**：`complete/route.ts`(298 行,内联多表写)抽 `completeWorkOrder()` lib;给 review-apply 三函数 + approve $50 闸补 DB 层测试（现只测 parser）。抽共享 `brief-utils.ts`(active brief 双轨 loader,evaluate + brief-injector 复用) + `redline.ts`(统一 scanRedlineHits + strategist containsPhrase)——Explore/魏征共同建议。

### B 段 · 喂料复用接通（= PM 批准的 S1 + muapi + 学广告，建在理干净的地基上）
- **B1 muapi 批量入库**：抽 `lib/factory/muapi.ts`；`POST /api/factory/clips/generate-batch`（PM 的「批量图→I2V→video_clips 储备」）;源图不再硬编,从 bucket `sources/{client}/` 读;muapi prompt 也吃 VI（承 A2）。
- **B2 学广告结构**：接 `viral-analyzer` 做 `peer_study` 通路——甩广告 URL→`analyzeViralReference`→映射进 winner_structures。PM 明确要,轮子已在,提前 spec 的 v2。
- **B3 worker 指对引擎**：`MAKE_PROMO_PATH` 从旧 `CTS_BrandKit/make_promo.py` 改指 `MagicLab_Studio/engine/make_promo.py`(新版有 music_mood/looks/motion/CJK/真实clip自动匹配/BGM循环铺满)。治「没音乐/素材糙」。
- **B4 素材灌库**：Dropbox 真实素材（CTS 15+Oztop 13 i2v）→ Supabase `video_clips`（承存储决策 v0.1 的 S1 ingest）。

### C 段 · 删脚手架（有前置依赖，按序）
- **C1 建 winner 写入路径**：`GET/POST /api/factory/winners`——`winner_structures` 现在唯一写入路径在要删的 Airtable `pullWinnerIntake`(review-sync.ts:365)。**这是删 Airtable 的前置,不建就删=赢家库变只读死表,strategist 永远拿不到新骨架。**
- **C2 删 Airtable**：删 `review-sync.ts`(425 行)+ `factory-review-sweeper` route + `.github/workflows/factory-sweepers.yml` 里 review 那半个 loop + 5 个 env（AIRTABLE_API_KEY/FACTORY_OPS_BASE_ID/FACTORY_REVIEW_TABLE_ID/WINNER_INTAKE_TABLE_ID/FACTORY_REVIEWER_EMAILS）。两套平行 apply 实现(review-sync 老版 vs review-apply 新版)收敛成一套。审核走 ME 同步请求-响应。
- **🔴 C 段红线：`factory-worker-sweeper` 必须留**（收 worker 僵死工单的兜底,跟 Airtable 零关系,魏征+Explore+复用三方共同红字警告最易误删）。

### D 段 · M3 闭环（later，照 spec）
- **D1 发布**：Meta API 投放 + publish_intent 幂等 + publish_failed 收敛 + 发布预算硬顶。
- **D2 归因回流**：`factory-performance-daily` cron 读 meta_ads_snapshots→`flywheel_metrics(ads.factory.*)`；winner 判定→`flywheel_outcomes`+自动拆片入 winner_structures(entry_channel='auto')。
- **D3 memory 回灌**：打回 reject_category+意见→`client_learned_preferences.rejected_creative_patterns`；赢家→`winning_reel_patterns`；strategist 的 `GateContext` 加 `rejectedPatterns` 输入每轮读。别自建,用 P21.F 同字段。
- **D4 内部自发疲劳信号**：接 meta_ads_snapshots 自动发起 `content_demand_signals`。

## 4. 留着别动（三方共识）
- `strategist.ts` / `evaluate.ts` / `worker-guard.ts` 决策核——纯函数、fail-closed、有测试,架构最扎实。
- `chat.ts`——正确复用 callClaudeWithTools,红线（对话无 approve 工具）已守。
- `factory-worker-sweeper`——单机 worker 兜底,C 段千万别误删。

## 5. S1 落在哪 + 一致性

PM 批准的 **S1 = A2（VI 收回后端）+ B1/B3/B4（muapi 批量入库 + 指对引擎 + 灌素材）**。即:**整理架构不是耽误 S1——A+B 段做完,S1 自然落成,且建在干净地基上、多客户通用、品牌准确。**

## 6. 命名/约定一致性待修（Explore 补，随手做）
- `video_clips.track`='a_real'/'b_generated'(DB) vs storage 路径 'a-real'/'b-generated'——已靠 worker-guard 正则映射,文档化即可。
- `storage_url` 双模式(外链 vs bucket 路径)→统一 bucket 路径 + 全签名化。
- `content_demand_signals.confidence` strategist 从不用=死字段,考虑清理。
- cron 无 `factory/` 前缀,routes 混——文档化分层即可,不强改。

## 7. 待 PM 拍板
> **整理顺序 A→B→C→D（先补地基类型 + 收脑子回后端 → 接喂料复用 → 删脚手架 → M3 闭环）—— 认可?**
> 认可即从 A 段开工:A 段纯内部重构 + 补类型,零风险、不动任何生产行为。

关联:[[project-content-factory-ads-loop]] · me-native-design v0.2 · storage-decision v0.1 · migration-plan v0.1
