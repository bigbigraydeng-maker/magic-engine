# Remotion 引擎开发计划（瘦身版，PM 2026-10-05 回「开」，并要求「不要过度开发」）

范围依据：`docs/specs/2026-10-05-content-foundation-trimmed-scope.md`。只做 CTS 一两个模板接入出片机；外部成片入口、统一发布闸、其余模板、视频工厂统一、后台归拢页面一律不做。
授权：Remotion 3 人以内免费（PM 确认），台账 `2026-10-05-remotion-license-check`。音乐：Dropbox 三个音乐文件夹 PM 已拍板有版权、可商用（含广告），不再核对。

## 已有零件（Codex/其它窗口做过的，不重复）
- Codex 的广告功能：预算审批与止损走 Kernel + Inngest（#2204 #2205 #2207 O1 预算放量流程）、Meta Ads AI 只读报告（#1982）、广告到线索路径检查 MVP。**都不涉及视频与素材**，与本计划无重叠；可复用的是 O1 预算审批流（10/8 再营销 +20% 走它，不手工改）和「起草→建成暂停→审批」入口。
- 工厂：工单认领/心跳/上传/`completeWorkOrder`/审核/Facebook 原生直发（CTS 已配好）、`brandkitFor`、Master Brief（vi_colors、tagline）。

## 三步，每步一个 PR，前一步合并才开下一步
**R1 模板参数化 spike（B 级：独立目录，不接任何运行中的流程）**
- 在 `scripts/factory-worker/engines/remotion/` 建**独立的 package.json 与锁文件**，不动根目录依赖，保证主站构建与类型检查不受影响。
- 只搬一个模板：`ListReel`（「费用包含什么」清单：开场 + N 个条目配镜头 + 价格揭晓 + logo + 音乐）及它用到的 PriceScene、Logo/Footage/Reveal/CutFlash、theme。**所有内容改成 props**：开场文字、条目（文字+镜头文件）、价格（金额/币种/出发日/脚注）、品牌色、logo、音乐与节拍；**`defaultProps` 为空，缺 props 直接抛错**；props 用 zod 校验（限长，禁 URL 与本地路径越界）。
- `render.mjs --props props.json --out out.mp4`（带超时）。
- 测试：props 校验（缺字段/多字段/超长/URL 都拒）；**模板源码扫描：不得出现 CTS、ctstours、NZ$、China Panorama、10,899 等客户事实**；渲染冒烟（本机跑，不进 CI）。
- **当场试跑**：用 CTS 的真实 props（价格团期取自官网 2026-10-04 核对值）渲一条，再用一套**非 CTS 的假 props（如悉尼公寓）**渲一条，证明换客户不改代码；各出 9 宫格自检。成片放仓库外。
- 不做：其余 5 个模板、worker 接线、读 Master Brief、每日计划、改根依赖。

**R2 出片机引擎分支（A 级）**：工单 `brief.engine='remotion'` 时 worker 走 Remotion；不认识的引擎先拒、不重试；props 从工单 brief 组装（文案/价格来自现有客户资料，品牌色取 `vi_colors`，logo 沿用 `brandkitFor`，找不到就失败）；渲染期间定时心跳 + 超时 + 单次重试上限；上传三件套 → `complete` 走现有闸门；出片机健康检查加 Chromium/Remotion；不得与 `creative_recipe` 并用；`FACTORY_PUBLISH_LIVE=false` 只存草稿。当场试跑：Mac 上真领一张 CTS 工单渲一条，马良 9 宫格自检。
**R3 每日计划接入（先一页纸小方案，再 1–2 个 PR）**：计划里的 Reel 自动生成工单 → 渲染 → 回写 → 审核 → 工厂 Facebook 发布；Inngest 事件+回执；R2 稳定后再写。

## 流程
写代码交 DeepSeek（aider one-shot，配方见记忆 reference-aider-deepseek-oneshot-recipe 与 docs/codex-prompts/2026-09-24-ads-impact-deepseek-rounds.md），Claude Code 出指令、审 diff、跑测试；R1 新依赖须子牙+魏征各审一次，R2 另加狄仁杰看出片机准入；A 级 PR 保持草稿、合并由 PM 回「合」。方案文档不再多轮多人审。
