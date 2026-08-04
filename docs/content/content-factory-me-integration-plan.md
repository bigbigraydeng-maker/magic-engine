# 内容数字工厂 · 植入 ME 落地方案（代码审计版）

> 2026-07-29 夜 · 子牙带 4 路 agent 只读审 ME 代码后重写。替掉之前偏乐观的版本。

## 一句话结论

**ME 已经有内容工厂 ~70-80% 的零件。** 我原以为要从零建，实测大部分是"接线/换皮"。**唯一真正要从零建的重活 = 出片云化**（现在跑在一台本地 Mac 上）；但现成本地 worker 已连着 ME、能先顶着，所以**不卡启动**。

## 审计结果：已有 vs 缺口（文件为证）

| 流水线环节 | ME 现状 | 判定 |
|---|---|---|
| **agent 框架** | `src/lib/anthropic/client.ts` `callClaudeWithTools` + `src/lib/agent-tools/readonly/`（4轴越权防护）+ **`src/lib/factory/chat.ts`（内容工厂对话助手，最佳模板）** | ✅ 复用 |
| **生产看板 + 阶段模型** | `dashboard/factory` + `content_work_orders`（16 态生命周期）+ `_components/statusMeta.ts`（阶段分组范式）+ `admin/prospecting/PipelineCRM.tsx`（列式 kanban 骨架可抄） | ✅ 复用 |
| **素材导入（手机回传）** | **`src/app/upload/[token]`（免登录三步上传页）+ `/api/upload/[token]` + bucket + 自动打分 cron** | ✅ **已建好，直接用** |
| **爆款库** | `viral_reference_library` + `src/lib/reels/viral-analyzer.ts`（Gemini）+ cron `viral-discovery-weekly` | ✅ 复用（FB 抓取用本地 yt-dlp，需换 Apify） |
| **单镜头 AI 生成** | `src/lib/visual/`（Atlas/Muapi/Seedance/HeyGen 云生成） | ✅ 复用 |
| **人设/支柱/禁词读取** | `getActiveBrief()`（`src/lib/content/brief-injector.ts`）；persona 在 `brand_voice.persona`，**无需 migration** | ✅ 复用 |
| **cron 基础设施** | route + render.yaml 块 + `CRON_SECRET`；抄 `viral-discovery-weekly` | ✅ 复用（新 cron 必手动 link `me-shared-cron-secret`） |
| **Apify 接入** | `src/lib/apify/client.ts`（`APIFY_API_KEY`，别造 `APIFY_TOKEN`） | ✅ 复用 |
| **发布 · Facebook** | `src/lib/factory/publish/`（`facebookReelAdapter` 直发 + 草稿闸 `FACTORY_PUBLISH_LIVE` + 红线 `scanPublishCaption`） | ✅ 复用 |
| **发布 · 小红书/抖音** | 无 API 通道；只能生成+存库 | 🔴 手动发（PM 已接受 OK） |
| **出片（多片段装配）** | **仅本地 Mac：`scripts/factory-worker/worker.mjs` + `make_promo.py` + ffmpeg + piper + 本地 CTS_BrandKit assets**。ME app 只编排（发工单/签名URL/审片） | 🔴 **唯一从零建的重活（云化）；本地 worker 现成可先顶** |

## 硬约束（agent 挖出，务必遵守）

1. **发布不能让 agent 自动干** —— 花钱/对外/不可逆只走 UI 明确按钮（`factory/chat.ts` 红线；跟 CLAUDE.md「显式 go」一致）。发布助理 = 备好料 + 人点发布。
2. **优先 stateless agent**（历史前端传、复用现成表）避免 migration；要建表/加列**必 PM 拍板 apply**，新表 RLS 走 service_role 模板。
3. **越权防护**：按客户查数据的工具，资源标识符服务端注入 ctx 闭包，input_schema 不暴露。
4. **status 别硬塞**：`content_posts.status` 是审批态（5值），生产阶段挂 `content_work_orders`（16态），别污染。
5. 新 cron 必手动 link `CRON_SECRET` env group + 配 healthcheck，否则静默 401（memory 事故）。

## 落地计划（分 3 期）

### 第一期 · 前半段流水线跑起来（大量复用 + 轻建）
- **内容工厂看板页**（新页）：抄 `PipelineCRM.tsx` 骨架 + `statusMeta` 范式，5 列 = 选题→录制→出片→发布→复盘，数据挂 `content_work_orders`。
- **选题助理 agent**（新）：照 `factory/chat.ts` 模板；读 `viral_reference_library` + `getActiveBrief` → 生成候选工单。
- **Apify 爆款抓取 cron**（新）：抄 `viral-discovery-weekly`，换成 Apify 小红书 actor（`zen-studio/rednote-search-scraper`，已验证）→ 入 `viral_reference_library`。
- **逐字稿扒取**：Apify 拿视频 URL → Whisper（已验证）→ 存爆款库。
- **素材导入**：直接用现成 `/upload/[token]`，卡片出二维码 → 手机三步传回。
- **出片**：用**现成本地 worker**（已连 ME），先跑通。
- → 交付：大瑞在 ME 看板里 选题→领候选→手机录传→出片，全程一个页面。

### 第二期 · 发布 + 复盘
- **发布助理**：FB 自动（现成 adapter）；小红书/抖音 = 生成文案+封面 + "复制粘贴发"交接（人点）。
- **复盘助理**：Apify 按发布链接抓点赞/评论/收藏 cron → `flywheel_metrics`。
- **三平台裁版**：一稿 AI 裁小红书/抖音/FB 三版（时长/钩子不同）。

### 第三期 · 出片云化 + 多客户产品化
- 容器化视频 worker（ffmpeg + brandkit assets 上云 + piper 迁移），去掉"本地 Mac 不能合盖"。
- 配置全读各客户 master_brief → 一套工厂服务所有客户（ME 产品）。

## 待 PM 拍板
- 进不进第一期开发？
- 第一期若加"阶段"字段 = 唯一可能的 migration，到时单独问 go。其余尽量 stateless。
