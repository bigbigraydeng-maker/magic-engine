# 工厂「行程城市核验」闸 设计稿 v0

**一句话**：旅游团广告片进「待审」前，确定性地核对片子里**声明的城市/景点文字**是不是都在**这个团官网行程的授权城市清单**里；出现行程里没有的城市（如给上海团配「长城/兵马俑」）就拦下并指出哪一镜。纯文字对文字，**禁止用视觉模型猜画面**。

**谁写**：设计 = 本窗口（Claude Code）；生产代码 = DeepSeek 分刀写，Claude Code 审 diff。
**背景**：2026-11-05 PM 核现役 Shanghai & Beyond 广告时提出「机器自动核城市」。查实后把方向定死为确定性文字闸（不做视觉判断），本稿把实现定死。

---

## 0. 为什么不是「AI 看画面核城市」

`src/lib/factory/shot-guards.ts:1-13` 白纸黑字记着教训：让视觉模型判断图像内容「它是在猜，同一张图两次给不同答案，已废弃（见 face-frame.ts）」。所以本闸只吃**文字**（镜头声明的上屏字幕 / 场景标签 / 角度 / caption）与**行程城市清单**，文字对文字，同输入永远同输出。画面像素层的错配（把长城实拍硬标成「外滩」骗过文字层）仍由 **马良帧审 + 人眼分镜自检** 兜底——本闸不声称覆盖这一层。

已有但**未接线**的互补闸：`shot-guards.ts:63 verifyPlaceProvenance(sourceMetadata, requiredPlaceKeywords)`——核「这张图的来源描述有没有指名它声称的地点」。它和本闸互补（本闸核「这个地点在不在这个团」，它核「这张图是不是真的这个地点」），且 `shot-guards.ts:10-13` 自述「目前纯逻辑+测试，未接进 live 出片管线」。建议同一刀里一并接线（见 §7 刀 F-3）。

---

## 1. 数据从哪来（每条给证据，不猜）

### a) 片子里「声明的城市/景点文字」在哪条数据里

两条生产路径，文字可得性不同：

- **工厂自产（recipe/multicut）**：逐段上屏文字是**结构化文本**，已被服务端读出——
  `src/lib/factory/complete-work-order.ts:197-207` 取 `brief.copy.segments[].{title_sub,caption,title_main}`；recipe 单取 `recipeReceipt.segments[].caption`（:208-209）。现有「成片文案品控」`content-quality-guard.ts` 正是吃这批文本。**本闸复用同一批文本**，逐段核城市。✅ 可得。
- **外部上传成片（admit-finished）**：`admit-finished.ts:36-48 AdmitInput` 只带 `caption`（广告正文）、`angle`（角度串），**没有逐段城市字段**——成片是 MP4，逐段城市字（"Suzhou gardens"）已烧进像素，文字层拿不到。本闸在这条路**只能核 caption/angle**；逐段像素城市由 `admit-finished.ts:190-218` 现有的**马良帧审**（image_ok/text_ok）+ 人审兜底。⚠️ 可得但不全。

### b) 一个 work order → 哪个团 → 授权城市清单

- **授权城市清单**：`FirstPartyTour.tour_cities: string[]`（`src/lib/web-intelligence/first-party-tours.ts:14`）；落库在 ME Tour 目录表 `tour_catalog_tours.tour_cities`（jsonb array）与发布快照 `tour_catalog_published`（`supabase/migrations/20261010300000_tour_catalog_access.sql`；读法见 `src/lib/tour-catalog/sales-facts.ts:54`、`store-publish.ts:114`）。粒度 = 每团一行、按 `client_id + slug` 键。写方 = ME Tour 目录（PM 2026-10-29：团的任何改动必须走目录）。消费方 = 本闸（只读）。
- **缺口（必须补）**：工厂 work order **当前不携带 tour_slug/tour_id**（`grep tour_slug/tour_id src/lib/factory` 无命中）。所以「这条片是哪个团」现在无结构化来源。补法（刀 F-2）：产旅游团片的下单入口在 `brief.tour_slug`（或 `angle_source.tour_slug`）写死目标团 slug；闸据此只读取 `tour_catalog_published` 的 `tour_cities`。退路：caption/angle 里按团名匹配目录——**仅作兜底，匹配不唯一就判「疑」交人审，不硬判**。

### c) 挂在哪一步才拦得住、且拿得到 a) 和 b)

- **工厂自产路径**：挂 `complete-work-order.ts` 的闸区（现有 `护栏 6` + 文案品控同处，:162-178 一带），它在置 `status='in_review'`（=进待审）**之前**跑、fail-closed、且已取到逐段文本（a）。在同处补「解析 tour_slug → 读 tour_cities（b）→ 逐段核城市」。✅ 真实调用点、数据齐。
- **外部上传路径**：挂 `admit-finished.ts admitFinishedVideo`（插入 in_review 之前，:594 一带），只核 caption/angle（b 同样按 tour_slug 解析）。逐段像素城市交马良帧审。
- **不要**挂在只有 MP4、没有逐段文本的地方当成「全覆盖」——那是自欺。

### d) 别名 / 中英 / 非城市字幕 / 抽象空镜 怎么判（不误伤）

- **城市/景点 → 城市映射**用一份**旅游行业地名表（gazetteer）**：中英别名 + 地标归城（长城/Great Wall→Beijing；兵马俑/Terracotta Warriors→Xi'an；外滩/The Bund→Shanghai；西湖/West Lake→Hangzhou；苏州园林/Suzhou gardens→Suzhou；无锡/Wuxi→Wuxi…）。复用 `shot-guards.ts:24 singularEnglishTokens`（词边界+单复数归一，挡 Chinatown⊃china）与中文 substring（`shot-guards.ts:83-86` 同策略）。
- **非城市字幕**（价格 `NZ$2,699`、`per person`、`twin share`、`flights included`、`10 days`、CTA）→ 地名表命不中 = **不是地点**，放行，不误伤。
- **抽象空镜 / 无城市**（`clip-library.ts:133 ABSTRACT_SCENE_TAGS`、价格卡、片尾卡）→ 无地点声明，放行。

### e) 判不准怎么办（PM 2026-11-03 原则：别排除、量准确率、人纠正）

三态，不是两态：
- **BLOCK（拦）**：地名表确信识别出的城市/地标，且**不在**该团授权城市里（如上海团出现「长城」）。
- **FLAG（疑，交人审）**：像地名但表里映不出、或团名匹配不唯一、或 tour_slug 缺失拿不到授权清单。**不硬判死**，转马良/人审，并计入「待补地名表」。
- **PASS（放行）**：地名∈授权城市（归一后），或根本不是地点。

人审对 FLAG/BLOCK 的纠正回流扩充地名表；闸每月自报 BLOCK/FLAG 命中数与人审改判率（量准确率）。

---

## 2. 闸的契约（纯函数边界）

新文件 `src/lib/factory/itinerary-city-guard.ts`（与 `shot-guards.ts` 同风格：纯函数、无外部调用、无 vision、返回「判定+证据+稳定 code」，**不是完整 receipt**——身份字段由上游 step 落）。

```
type ItineraryCityCode =
  | 'CITY_ON_ITINERARY'      // pass
  | 'CITY_OFF_ITINERARY'     // block
  | 'PLACE_UNMAPPED'         // flag
  | 'NO_ITINERARY'           // flag：拿不到授权清单
  | 'NO_PLACE_CLAIMED'       // pass：这段没有地点
verifyItineraryCities(
  segmentTexts: readonly string[],   // 逐段上屏文字（或 caption/angle 合并）
  authorizedCities: readonly string[], // 该团 tour_cities
  gazetteer: PlaceGazetteer,         // 行业地名表（别名+地标归城）
): { verdict: 'pass'|'flag'|'block'; items: Array<{segmentIndex; placeText; city; code; reason}> }
```

稳定机器 code 供下游分支/告警；中文 reason 只给人看，别去解析。

---

## 3. Tier 分类（平台层级门）与 Reuse Statement

- **闸的机制 = L1 平台通用**：属「成片内容品控」能力族（与 `content-quality-guard.ts`/`shot-guards.ts` 同层）。换客户/换行业机制不变（地产客户换成「楼盘/区域对不对」同样是「声明主体 ∈ 授权主体表」）。
- **地名表 gazetteer = L2 旅游行业参考**：跨所有旅游客户共享，不是单客户事实；放行业参考数据，**不写死某客户**。
- **授权城市清单 = L4 客户数据**：来自 `tour_catalog_published.tour_cities`，本就按 client_id 隔离，闸只读。
- **红线自查**：① 不包装升级（只是既有品控族加一道，不新设能力线）✅；② 不把客户名/ID 写进共享 runtime（城市来自目录数据，地名表是行业级）✅；③ 不用视觉猜测 ✅；④ 复用既有闸层与 `shot-guards` 工具函数 ✅。
- **复用**：`complete-work-order.ts` 现有闸挂点与逐段文本提取、`shot-guards.ts` 分词/CJK 工具、`tour_catalog_published`、未接线的 `verifyPlaceProvenance`。

## 4. 风险级别：B

依据：碰 `src/lib/factory/` 共享 runtime 且能**拦下成片进待审**（影响产出流转），算业务逻辑闸；但**不碰**鉴权/RLS/资金/Meta 凭证/数据库结构（**无 migration**：tour_slug 只是 `brief` jsonb 内字段，授权清单读既有表）。故判 **B**，核心+少量集成测试 + 一次集中 review（子牙/魏征看一眼）。注意**误拦风险**（地名表不全→拦掉好片）属操作性伤害，故 FLAG 态必须 fail-soft + 真实测试覆盖，不可一刀 BLOCK。

---

## 5. 当场试跑方案（纯函数，刀 F-1 即可全量跑）

- **应放行**：现役 Shanghai & Beyond 的逐段文字（价格卡 `NZ$2,699 twin share`、`Suzhou gardens`、`Wuxi canal`、`The Bund`），授权城市 = `[Shanghai, Suzhou, Wuxi, Hangzhou]`（官网 `/tours/china/discovery/shanghai-surroundings`）→ 期望 **全 PASS**。
- **应拦下**：同一授权清单，塞一段 `Great Wall` / `长城` 或 `Terracotta Warriors` / `兵马俑` → 期望 **BLOCK**，reason 指出「本团只有上海/苏州/无锡/杭州」。
- **应标疑**：塞一段映不出的地名（如生造词）或不传授权清单 → 期望 **FLAG**，不 BLOCK。
- 三例都是确定性单测，入库前当场跑（无外部调用）。刀 F-2 的接线用 supabase 测试替身返 tour_cities 跑集成。

---

## 6. 诚实边界（写进交付，别让 PM 以为 100%）

- 只核**文字层**：把错城市实拍硬标成对的城市名、文字层骗过它——靠马良帧审+人审兜底。
- **外部上传成片**只核 caption/angle，逐段像素城市拿不到（§1a）。
- 地名表起步小，靠人审纠正长大；起步阶段 FLAG 会偏多，属预期。

---

## 7. 分刀（谁写：DeepSeek；Claude Code 审/测/建 PR）

- **刀 F-1（B）**：纯函数 `itinerary-city-guard.ts` + 旅游地名表（行业参考）+ 单测（§5 三例）。无接线、不碰库。
- **刀 F-2（B）**：接进 `complete-work-order.ts`（工厂自产路径）；补 `brief.tour_slug` 下单plumbing；按 slug 读 `tour_catalog_published.tour_cities`；BLOCK→拒、FLAG→进待审但打标记交人审。集成测试用 supabase 替身。
- **刀 F-3（B，可选同批）**：接 `admit-finished.ts`（外部上传路径，仅 caption/angle）；并把已存在的 `verifyPlaceProvenance` 在选图处接线（填它 `shot-guards.ts:10-13` 挖的坑）。

每刀开工前按 PM 2026-11-04 规矩大白话讲清「做完你看到什么变化」，PM 点头再动。

---

## 8. 还没核实、动工前要确认的数据关系

1. **现役旅游团 reel 实际走哪条路**：工厂自产（complete-work-order，逐段文本可得）还是外部上传（admit-finished，只有 caption/angle）？这决定本闸的覆盖面。本稿未确认 Shanghai & Beyond 那条的实际产线。**刀 F-2 开工前必须查实**。
2. **旅游团下单入口是否能稳定写入 tour_slug**：现无此字段，需确认下单路径能取到并写入目标团 slug。
3. **地名表起步覆盖度**：先覆盖 CTS 在投团涉及的城市/地标，其余靠 FLAG+人审增量补。
