# 成片入口接进社媒 Agent（外部剪好的片走同一条流水线）设计 v0.2

- 日期：2026-11-04 · 窗口：97 号（社媒统筹）· 风险级别：A（碰发布前驱、客人肖像授权）
- 上游：每周闭环设计 v1.1 `docs/specs/2026-11-04-social-agent-weekly-loop-design-v1.md`
- 触发：PM 2026-11-04「客户真人出镜的那条呢」——CTS China Panorama 客人出镜片（PM 剪，Dropbox `03_Enterprise/CTS/CTS-China-Panorama-testimonial-50plus-ad-2026-11-02.mp4`），PM 回过「发」但没有正式通道。PM 同日确认**客人同意出镜**，并定方向：**成片入口和工厂出品汇总在同一个仓库，让其他流水线 agent 提取**。
- v0.1 → v0.2：子牙、魏征设计复审（各 6 条必改，结论一致）全部并入，见 §9。

## 1. 结论

不新建仓库、不新建表、不改表结构。外部成片登记成一张 `content_work_orders` 视频工单——这张表已经是 ME 的成片仓库（社媒每周闭环挑片、广告记「投的是哪条片」`ads/creative-link.ts`、线索归因都从它取）。登记函数**已经存在**：`admitFinishedVideo`（`src/lib/factory/admit-finished.ts`，PR #3573，11-03 合并，线上 0 条使用）。本设计补齐它，让外部成片过和工厂片一样的闸，并新增一道**所有发布路径共用的肖像授权闸**。

## 2. 层级判定（tier gate · Inline）
归既有社媒支柱下「视频工厂」能力，不新增能力线、不登记候选。共享：登记、授权闸、马良版本选择；客户私有：授权记录（工单 `brief.talent_consent`）。共享代码不写客户名 / ID。

## 3. 改动（按施工顺序）

### 3.1 共享授权闸 `src/lib/factory/talent-consent.ts`（新，纯函数，A 级核心，Claude Code 逐行审）
`consentVerdict({ brief, output, use: 'facebook_organic' }) → { ok: true } | { ok: false, reason }`，**默认不放行**：
| 情形 | 结论 |
|---|---|
| 外部成片（`brief.engine = 'external_upload'`）且没有 `talent_consent` | 拦：`consent_missing` |
| `talent_consent.status = 'granted'` 但 `scope` 不含本次用途 | 拦：`consent_scope` |
| 外部成片但马良结论不是 v2 或是「没看成」 | 拦：`faces_unchecked`（不把「没查出来」当「没人脸」） |
| 马良 v2 `identifiable_faces[].count > 0`（结构化字段，不匹配中文问题句） 且没有 granted | 拦：`face_consent_missing` |
| `status = 'not_needed'` 但马良查出人脸 | 拦：`consent_conflict` |
| 其余 | 放行 |
工厂片（非外部）没有 v2 结论时放行——这是已知缺口（工厂片仍是 v1、不出人脸信息），开台账卡跟进，不在本设计里扩大花费面。

**接到三处，读不到就拒**：①每周闭环 `run.ts` 排除原因（新 `consent_*`，进今日待办）；②单条转公开前置检查 `promote/guards.ts checkOrderPrechecks`；③发布 worker 真发分支（`!opts.draft`）。草稿发布不拦（草稿不对外）。

### 3.2 登记函数 `admitFinishedVideo` 补四处
- `storage_path` 只收 `content-factory` 桶里的相对路径，拒绝 http(s) 外链（外链下游三处都接不住）。
- 同一 `storage_path` 已有工单 → 返回已有那张（不重复建、不重复花马良的钱）。
- 新参数 `talentConsent` 与 `confirmedBy`：`confirmedBy` 由调用方给——接口从登录态取（请求体里的不信）；后台脚本写成固定的服务身份 `system:pm-chat`，并必须带 `evidence`（本次：「PM confirmed in chat 2026-11-04」）。
- 插入成功后**在函数内**发 `me/maliang.render.ready`（工单路径；视频地址由服务端从 `video_path` 拼，不收外部传入）。发送失败不回滚工单，记进返回值，工单照旧在审片箱等人工。

### 3.3 清单两项改为「等马良」
「字幕」「封面」两项登记时写 `NOT_MEASURED`（不再直接写 PASS）。马良 v2 跑完后按结果改写成 PASS / FAIL（封面 = 第 1 帧 `image_ok`，字幕 = 各帧 `text_ok`）。马良没看成 → 仍是 NOT_MEASURED → 审片箱点通过会被既有闸挡下（`review-apply.ts:98`），这本身就是一道闸；重新发一次马良事件即可重审。

### 3.4 马良工单路径选 v2
`runWorkOrderReview` 里抽一个 `pickWorkOrderCheck(brief)`：外部成片用 `runReviewCheckV2`，其余仍 v1。新增 `writeWorkOrderVerdictV2`（只在 `in_review` 时写、写前重读，同 v1），并在同一次写里按 §3.3 改写两项清单。

## 4. 不做（本轮）
- **口播事实核对**（`audio.transcript` 进 `checkFacts`）：两位复审都指出会误拦（客人说「在西安待了两天」）也会漏放（转写不准）。第一条片在周卡上把口播文字摆给 PM 看即可；之后若做，口播一串只许出「待人核」。
- **审片箱展示 v2 详情**（人脸 / 口播 / 画面文字）：第一条由我在对话里把马良结论贴给 PM；界面另开 C 级。
- **上传页面**：第一条由我走后台；第二条起再做「内容工厂 → 上传成片」按钮。
- 人工清单 V3 里「有 logo」「BGM 分段」对证言片不一定适用——本轮不改清单定义；若这条片确实不适用，由 PM 在审片时决定，不由程序代勾。

## 5. 已核实的线上事实（2026-11-04）
- `FACTORY_PUBLISH_LIVE`：Render 上**未设置** → 发布 worker 只发草稿（`route.ts:24` 未设 = 草稿）。
- 「爆款自动转广告」`winner-reel-sync-daily`：近 3 天回执均为「没有客户开启赢家素材同步，本轮空转」→ 不会拿这条片去投广告。开启前须先接授权闸（§3.1 用途 `meta_ads`），记入台账。
- `GEMINI_API_KEY`：Render 上已设置。

## 6. 第一条怎么跑（China Panorama 客人出镜片）
1. 本机把 Dropbox 原片上传到 `content-factory/<CTS 编号>/external/2026-11-04-china-panorama-testimonial.mp4`（生产存储写：PM 本次「开始」；存储桶公开可读，客人已授权，风险可接受并记入回执）。
2. 先 WebFetch 官网 China Panorama 团页核对页名与价格，再用 Render 一次性任务调 `admitFinishedVideo`（`confirmedBy = system:pm-chat`、`evidence` 写明、`scope = ['facebook_organic']`）。
3. 马良 v2 自动审，结论（人脸、口播文字、画面文字、两项清单）贴给 PM。
4. PM 在审片箱过审 → 发草稿 → 下个出稿日进周卡 → PM 批卡 → 单条转公开；授权闸在转公开那步再查一次。**任何一步都不自动公开。**

## 7. 验证
测试（A 级，含变异）：授权闸六种情形；三处接线各自拦；外部链接被拒；同路径去重；`confirmedBy` 不从请求体取；两项清单 NOT_MEASURED → 马良 pass 改 PASS、没看成仍 NOT_MEASURED 且审片过不了；外部片走 v2、工厂片仍 v1。当场试跑 = §6 第 1–3 步。

## 8. 台账卡
- 本设计（decided）。
- 已知缺口：工厂片仍用 v1、不出人脸信息，授权闸对工厂真人照片无效。
- 广告侧：`winner-reel-sync` 与广告取片在开启前须接授权闸（用途 `meta_ads`）。

## 9. 复审并入记录（v0.1 → v0.2）
- 闸只在每周闭环、可被单条转公开 / worker 真发绕过（子牙 2、魏征 1）→ §3.1 共享函数三处接线。
- 清单改 `NEEDS_HUMAN` 不合法、会卡死（子牙 1、魏征 2）→ §3.3 NOT_MEASURED + 马良后改写。
- 只靠模型标人脸 = 没查出来就放行（子牙 4、魏征 3）→ §3.1 外部片默认要授权、用结构化字段、没看成即拦。
- 服务密钥调不了登记接口、`confirmed_by` 可伪造（子牙 6b、魏征 4）→ §3.2 显式 `confirmedBy` + 服务身份 + evidence。
- 外链路径下游接不住、马良地址取自事件（子牙 5、魏征 8）→ §3.2 只收相对路径、服务端拼地址。
- v2 没有写回函数（子牙 6a）→ §3.4。
- 口播核对误拦漏放（魏征 5）、`run.ts` 逼近 800 行（子牙 8）→ §4 本轮不做。
- 爆款转广告不查授权（魏征 6）、发布开关未核（魏征 7、子牙 3）→ §5 已核实。
- 重复登记（魏征 10）→ §3.2 去重。

## 9a. 实施复审并入（PR #3588，子牙 + 魏征）
- **人脸规则本轮只管外部成片**（魏征 4）：#3582 的每周补审会给工厂片跑 v2 并写人脸数，若对工厂片也拦，带游客 / 图库人物的工厂片会被成批拦下且没有任何补授权入口。工厂片继续当已知缺口（台账卡 `2026-11-04-consent-gate-known-gaps`）。
- **TikTok 发布接口也接授权闸**（魏征 1），用途 `tiktok_organic`。
- **登记函数自己发马良事件**（子牙 1、魏征 2），事件编号带时间，人为重审不会被 24 小时去重吞掉。
- **再登记 = 补授权 / 补审**（子牙 2、魏征 3）：同路径已有工单时，带来的授权写进那张工单（只在审片中 / 已过审 / 已发布时，按 `updated_at` 条件写）；还在审片中且没有可用的 v2 结论时重新请马良。打回 / 失败等终态工单不参与去重。今日待办「在成片登记里补上授权记录」因此是真实可走的路。
- 路径必须在 `<客户编号>/external/` 下、拒绝 `%` 与反斜杠；文件超过 80MB 登记时直接拒（马良下载上限）；请求体里格式不对的授权直接 400。
- 马良结论写回沿用 `writeWorkOrderVerdict`（v2 对象整份存下，人脸字段不丢），未另写 v2 写回函数。
- 未做（后续）：成片内容指纹（sha256）绑定授权；外部片被打回时不重开新单。

## 10. 待 PM 拍板
- 这位客人的授权是否也包括**拿去投广告**？本次只记「Facebook 主页发帖」。
