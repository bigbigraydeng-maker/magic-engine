# R4 任务单：视频工厂发布成功的 Reel → 自动起草一条「暂停」广告（交 02 号「广告构建控制」窗口）

来源：PM 2026-10-06 拍板「广告出口要先接通」。方案沿用 [视频工厂三个出口](./2026-10-05-video-factory-three-outlets.md) 的 R4，本单只补现状核实与边界。风险级：**A**（碰广告写入与审批）。本窗口（25 号）只出任务单，不写广告代码。

## 目标 / 完成即停
片子在 Facebook 真发布后，系统自动起草一条**暂停状态**的广告并给 PM 发一条待办；PM 点头才激活。到「暂停广告草稿建好 + 待办出现 + 有机器可读回执」为止，**不自动开启、不改预算**。

## 现状（读代码核实，2026-10-06）
- 发布成功会发事件 `me/factory.reel.published`（`src/lib/factory/publish/reel-published-event.ts`），字段含 `page_id`、`video_id`、`work_order_id`、`client_id`；只有 `PUBLISHED` 才发，草稿不发。
- 现在**只有一个接收方**：`src/lib/inngest/functions/factory-reel-measurement-adapter.ts`（记 T+4 / T+72 效果）。没有任何东西据此起草广告。
- 个人广告号不能直接用主页 Reel 的编号建视频广告（会报「没有推广权限」），必须先把成片传进**官方号**视频库拿 `video_id`，代码里没有这一步。参考做法已在 `docs/clients/cts/2026-10-06-remotion-video-ad-plan.md` 第二节（0–3 步，全暂停）。
- 广告写入走 Kernel（WP3）；`winner-reel-sync` 等旁路尚未收编。相关 A 级修复 PR #2310（广告重开/审批绕过授权熔断）**已合并（2026-10-06），前置已满足**。

## 做什么（最小版）
1. 新增一个 Inngest 函数，订阅 `me/factory.reel.published`，前置检查：该客户开了「广告草稿」开关、素材确实来自 Dropbox（有出处路径；PM 已多次确认 Dropbox 里的视频/图片/音乐都有授权，不再另设音乐来源确认）、没有重复草稿（幂等键用 `work_order_id` + `video_id`）。
2. 成片传官方号 → 在个人号建素材 → 在指定系列下建 1 个**暂停**广告组 + **暂停**广告，全部走 Kernel 的审批入口，ThruPlay 版位锁 Facebook+Instagram。往在投广告组里加广告会重置学习期，**必须另建独立广告组**（手册 `playbook-ads-meta-general`）。
3. 每步写回执：request id、client id、work order id、状态、provider 影响、`no_publish` / 授权状态、时间；失败要变成今日待办的「需要你动手」（what / how / href 三件套），不许只写日志。
4. 建好后给 PM 一条待办：广告预览链接 + 一句「批了才会开」。

## 不做
激活广告、改任何预算、改受众池规则、碰现有在投广告组、每日计划接视频（R3，PM 已定推迟到 10-20）、新建视频出口。

## 必须守的规矩
- 视频只走工厂；真开广告、花钱永远要 PM 点头；涉及广告自动化要叫**卫青**做记录/审查；A 级需子牙 + 魏征设计与实施各审一次，狄仁杰看授权旁路。
- 平台层级：用现有 Meta Ads Connector 与 Kernel，不新增能力线；客户名/ID 不写进共享代码，客户差异走配置。
- 交付前「当场试跑」：用测试客户/假账户或不外发的 dry_run 跑一遍完整链路，贴真实输出；做不到先和 PM 说好试跑路径再开工。

## 前置与顺序
设计稿一审 → 实施（DeepSeek 写，窗口出指令审 diff）→ 当场试跑 → 实施二审 → PR Ready，由 PM 回「合」。
