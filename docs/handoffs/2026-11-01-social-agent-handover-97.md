# 社媒 Agent 交接（97 号社媒统筹 → 下一个窗口 / 接手人）

写于 2026-11-01 04:00 左右（新西兰），风险级 C（纯文档）。**线上数字是我 2026-10-29 至 11-01 用只读查询读的**，之后会变，动手前先复核（下面每条都写了怎么查）。
范围：社媒支柱的 Agent（苏东坡）怎么按 IMPACT 工作、现在到哪一步、设计稿在哪、还欠什么、怎么接着干。**不含**广告 / SEO / 口碑。

---

## 一、给 PM 的一页话（先看这个）

**第一件事：社媒 Agent 的"设计"基本做完，"能自己转的闭环"还没有。**
发现、量、开处方、做、查、调六段都有了设计稿，也都过了子牙和魏征多轮审查；但"发出去之后把数据读回来、判断好不好、再喂给下一轮"这一圈，今天还转不起来。

**第二件事：转不起来的最大原因不是代码，是 Reel 根本没公开。**
CTS 近 30 天工厂出了 25 条 Reel，全部存成 Facebook 草稿；工厂"真发"开关近 60 天一直是关的；2026-10-13 之后没有通过 ME 公开过任何 Reel。没公开，就没有数据可读。

**第三件事：查出了 3 个会影响客户 / 统计的问题，要你知道。**
- 线索归因把"自然社媒"记成"付费广告"，社媒自己的线索数是 0。
- 往 Meta 导出"客户名单"时，系统把"来源是 Meta 广告"当成"客人同意过"，官网表单进来、链接带 facebook 的线索也会被当成同意过（CTS 有 2 条可疑，未核实）。
- 私信读不到"是不是广告带来的"。

**第四件事：你欠回复的事见第六节，最要紧的是三条：**
图文怎么发、20 条草稿 Reel 要不要转公开、要不要修线索归因（含"同意"口径）。

---

## 二、现状（线上，11-01 读的；CTS 客户 id `c0000000-0000-0000-0000-000000000000`）

### 2.1 发布线（只有 Facebook；Instagram 没接）
| 线 | 现状 | 怎么复查 |
|---|---|---|
| **Reel（视频工厂）** | 近 30 天 25 条 `factory_reel_publish` 动作，**全是 Facebook DRAFT**；发布器 cron `factory-publish-worker` 近 60 天 `summary.live` **全是 false**；工单里 20 个 `status=published` 但 `video_state=DRAFT`（违反"草稿不记成已发布"）；3 个 `PUBLISHED` 是 **2026-10-13 一次会话里手工转公开**（`published_ref.promoted_note`，无 `promote_request_id`），流量记录仍 DRAFT；另有 1 条（工单 `e8c5b66a`，10-06）**在 Facebook 上已公开、ME 里仍写 DRAFT** | 实现说明 §2.2 的 Q1/Q2/Q3/Q8；Facebook 公开页对照法：`curl -A "facebookexternalhit/1.1" https://www.facebook.com/reel/<video_id>/`，有 `og:title` = 已公开（"没有"不等于一定是草稿，可能受限）|
| **Story（周包）** | CTS 周包 10-12 ~ 10-19：SENT 11、PENDING 36、BLOCKED 5、MISSED 2；**10-19 之后没有新周包授权，Story 线实际停了**；发布 cron `story-lite-publish` 每 10 分钟照常跑（无授权可发）| `story_items` 按 status 分组 |
| **图文 Post** | 每日计划图文自动发布 cron 每小时跑，**默认只演练**；`social.publish_post` 动作全库仅 3 行（最后 2026-09-06）。Post 最小版（Post-lite）**只有设计稿，没有代码**。系统发的图文近乎为 0 | `flywheel_actions` 按 `action_type` |
| **评论自动回复** | cron 每小时跑，近 14 天 3 条回复 | `cron_run_logs` `social-comment-autoreply` |
| **页面互动读数** | cron `social-engagement-pullback` 每天 04:00，**10-26 起每天"部分失败"**（5 个客户页面里 1 个失败，CTS 页面本身同步成功）；失败的是哪个客户未查 | `cron_run_logs` 看 `summary.page_metrics.results` |

### 2.2 读回与表现数据（Measure / Check 的底）
- 读回链主干已有：发帖 → `daily_plan.post.published` / `me/factory.reel.published` → T+4 / T+72 → `record_post_measurement_snapshot` → `social_post_measurement_receipts`。
- **回执全库 4 行，最新 2026-09-09，全是"部分读到"。** 单条表现读取 `post-performance`（S2）只是读回执表的汇总函数，没有定时调用方。
- 断点（已查实）：①没公开的 Reel 不会发事件；②手工转公开的 3 条因流量记录仍 DRAFT 被读回环节拒绝（拒绝时没留人看得见的痕迹）；③Story 不在读回链上。

### 2.3 授权与权限
- CTS Facebook 页面授权：状态正常，**到期 2026-12-07**，最近同步 2026-10-08；范围含发帖 / 读互动 / 管评论 / 读私信，**没有 `read_insights`**（观看数、触达读不到）。日历里旧提醒写"11/2 到期"已过时，**交 CTS 统筹核对**，本窗口没改。
- 另有一条 Meta Ads 只读授权，到期 2026-11-22。

### 2.4 客户数据（CTS）
- 素材：客户实拍已确认 46 张（最新入库 2026-09-13，**新素材 6 周没更新**）；FDE 自拍 7；图库 10；来源不明 4。
- 目标：进行中的有"11 月 China Tour 推广"留资 300（当前 11）和自然搜索点击 1340（当前 893）；**没有任何社媒目标**。
- master brief 第 1 版（10-15 更新）写发帖"每周 3–4 次"、含 Instagram / YouTube，**与现状（只有 Facebook 在发）不一致**，排计划以现状为准。
- 官网自相矛盾：首页"Trusted by 10,000+ Kiwi travellers"，团页"50,000+ Happy Travelers"→ 事实核对要有"冲突"状态，不能用。

---

## 三、设计稿与 PR 索引

| PR | 内容 | 状态（11-01）| 文件 |
|---|---|---|---|
| 2906 | 社媒 Agent 能力地图 v0.3（现状对账 + 创意层 + 接口合同）| 已合并 | `docs/specs/2026-10-19-social-agent-capability-map-v0.3.md` |
| 3347 | S1 平台 / 创意标签 + S2 单条表现读取 | 已合并 | `src/lib/social/platforms.ts` 等；台账 `2026-10-28-social-s1-s2-platform-tags-and-post-metrics` |
| 3359 | Facebook / Instagram 平台运营思路 v0.1，登记到后台"Agent 与手册"页 | 已合并 | `docs/sops/2026-10-28-social-platform-{facebook,instagram}-playbook-v0.1.md` |
| 3379 | 新客户冷启动策略 v0.1 | 已合并 | `docs/sops/2026-10-29-social-new-client-cold-start-v0.1.md` |
| 3381 | **社媒 IMPACT 闭环 v1.4**（总方案）| 已合并 | `docs/specs/2026-10-29-social-goal-driven-impact-loop-v1.md` |
| 3385 | CTS 只读 D0 试跑记录 | 已合并 | `docs/audits/2026-10-29-social-cluster-d0-dryrun-cts.md` |
| 3384 | 快速部署 + 快速测试 v0.4 | **转正后等自动合并**（子牙 / 魏征均已放行）| `docs/specs/2026-10-29-social-agent-cluster-rapid-deploy-test-v0.1.md` |
| 3386 | 社媒指标四级 + 素材库三层 v0.4 | 草稿，**等 3384 合并后再转正**（两位均已放行）| `docs/specs/2026-10-29-social-metrics-and-asset-library-layers-v0.1.md` |
| 本 PR | 本交接 + 读回实现说明 v2 | 本 PR | `docs/specs/2026-10-29-social-wp1-readback-implementation-brief-v2.md` |
| 2817 | 工厂"只有 Meta 确认公开的 Reel 才记成已发布" | **别的写入者（Cursor 自动代理）在写，A 级草稿，我没碰**；Codex 提 2 条（`+0000` 时间格式会让补发失败；共享记账测试夹具要补 `video_state:'PUBLISHED'`）| 见 PR |

台账卡（`docs/ledger/`）：`2026-10-29-social-impact-loop-v1-design`、`…-cluster-rapid-deploy-design`、`…-metrics-asset-layers-design`、`…-new-client-cold-start-strategy-v01`、`…-cluster-d0-dryrun-cts`、`2026-10-28-social-platform-playbooks-fb-ig-registered`。到期核对日 11-04 / 11-05。

---

## 四、IMPACT 六段现状

| 段 | 已有 | 设计了但没做 | 缺口 |
|---|---|---|---|
| **I** 发现 | 社媒日常页、评论分类、页面指标同步、master brief | 先读 brief + 官网的发现步骤；机会信号 SO1–SO5 | 目标契约；Instagram 未接入 |
| **M** 量 | 读回链、S2、创意标签 | 读回补齐（Reel 状态 / Story / 助推标记）| 回执 4 行；Story 不在链上；私信读不到来源 |
| **P** 处方 | 苏东坡规则手册、冷启动、平台运营思路 | 封闭处方词表 `social.*`；测试矩阵规划器 | 创意层 S5 未做；处方记录落点未定 |
| **A** 做 | 视频工厂、Story-lite、每日计划发布、Facebook 发布器 | 发布暂停标记（WP1b）| Reel 全草稿；图文无系统发布路径；5A 自动下架未建 |
| **C** 查 | 保真比对方法 | 保真 / 表现 / 目标节奏三判定 + 判定表 | 读回之后的判定链不存在 |
| **T** 调 | 复盘规则 R1–R5、"社媒调整 v1"（`flywheel/tune`）| 验证结果回流处方 | 样本长期不足（见下） |

**样本现实**：门槛 每组≥3（方向）/≥5（候选结论）/调时段连续 2 期每组每期≥10；Facebook 读不到观看数，新账号单条互动常只有几个；按现状（只有工厂 Reel 能逐条对比）一轮单因素两组对比要 5–10 周，**这些天数都是算出来的最快值，不是实测**。

---

## 五、查出来的问题（按重要性）

1. **"同意"口径漏洞（已在线上）**：`conversions/audience-export` 把 `attr_platform='meta'` 或有 `attr_ad_id` 当"同意过"（口径 2026-09-06 子牙 + 魏征定死），官网表单 + `utm_source=facebook` 的线索会被记成 meta 来源 → 被当成同意过 → 导出明文邮箱 / 电话供上传 Meta。CTS 533 条 meta 来源里 2 条无广告编号，**是否属于这种情况未核实**（要看个人信息，不在本窗口做）。导出需管理员手动下载再手动上传，所以有人把关。
2. **线索归因把自然社媒记成付费**：`crm/attribution.ts` 的 `attributionFromUtm` 只看 `utm_source`。修它会改"哪些客人算同意过"，所以**风险级 A（加狄仁杰）**，历史回填要 PM 本人授权。
3. **私信拿不到广告来源**：读接口没有 referral（只在推送事件里），记"来源不明"；推送送达率有前例仅约 2%（旧记忆，未复核）。
4. **Reel 全草稿 + 20 个"已发布实为草稿" + 3 条手工转公开 + 1 条 Facebook 已公开 ME 未知**（见 2.1）。
5. **Story 周包 10-19 后没有新包**。
6. **页面互动读数每天部分失败**（10-26 起）。
7. **PR 2817 有并发写入者**（见第三节）。
8. **授权提醒日历日期过时**（11/2 vs 库里 12/07）。

---

## 六、PM 已拍板 / 欠回复

**已拍板（别再问）**：客户自己实拍素材坚决不可共用到行业层（2026-08-02）· 所有视频默认带 logo、结尾带不带由工厂按模板定（10-29）· 开投 / 加预算只认 PM 本人（10-10）· Story 效果用"20:00 邀请私信后 12 小时新开私信会话"替代量法、连续两周再下结论（10-14）· 合并两档：B/C 机器自动合，A 级要 PM 回"合 N"· 写代码默认走 DeepSeek（aider），Claude 管指令 / 审 / 项目管理 · 不用 Codex 审代码（10-15）· CTS 3–5 月团全是英文团、无销售截止、不用倒计时 / 余位（10-14）· 推送攒着一次推（每次约 $0.15）。

**欠回复（回一个字就行）**
| 事 | 回法 |
|---|---|
| 图文怎么发（每日计划图文从演练转真发 = 发布授权，还是另做 Post 最小版）| 写明选哪个 |
| CTS 20 条草稿 Reel 要不要转公开（对外发布）| `看看` 逐条挑 / `不` |
| 工厂"真发"开关为何一直关（有意草稿 + 你逐条转公开，还是该打开）| `草稿` / `打开`（打开要单独授权）|
| 是否修线索归因（A 级，含"同意"口径先交你）| `同意` / `缓` |
| 那 2 个无广告编号的联系人要不要核实（派 CRM 窗口）| `核实` / `先不` |
| 已公开但 ME 写草稿的那 1 条（`e8c5b66a`）要不要改 ME 状态（写线上数据）| `改` / `不` |
| 是否允许小额付费测试及预算上限 | `允许` + 金额 / `不要` |
| 目标指标：先按"过程指标"报，归因修好后升为自然线索数 | `同意` / 另说 |
| 是否开工读回第一刀（P0 先行，P1 起要先补"当场试跑"方案）| `开工` |
| PR 2817 谁来改 | `我接` / `别动` |
| 要不要同时申请洞察数据权限（改授权范围有静默断连先例）| 你本人定 |

---

## 七、下一步（按顺序）

1. **P0 只读排查**（不写代码）：数据库部分已做大半（结果见 2.1）；剩 Inngest 面板确认函数已同步、Render 日志搜"发布信号 emit 失败"。**谁做**：有面板 / 日志权限的窗口。
2. **补"当场试跑"方案**（魏征：本机没有 Supabase / Inngest 开发环境，搭它要下载工具）：二选一——把"搭本机环境"列成独立一步并获准外网下载，或按项目规矩写"当场跑不了"、开台账卡、`verify_by` = 首次自动运行当天。
3. **子牙裁决已出**：新增的"读回链结果记录"是事件触发、无排班，写进不排班白名单 `UNSCHEDULED_CRON_ROUTES` 并写原因，不在 `CRON_REGISTRY` 填占位排班；写入改走 `startCronRunWithId` + `finishCronRunIfOpen`。
4. **按实现说明 v2 拆小包做**：P1a 时间格式（大概率删）→ P1b 拒绝留痕 + 通用结果记录（A）→ P1c S2 口径 + 契约测试（B）→ P2 建判定表 + Story 唯一索引（**要 PM 回 `go apply`**）→ P3 Story 动作行 + 私信读取 → P4 助推标记 → P5 暂停标记等。每包都先让子牙 + 魏征审实施前版本，再派 DeepSeek。
5. **修线索归因（ATTR）**：A 级；写入方只有官网表单一处，但读方含导出名单和每周报告；"同意"口径改动先交 PM；补测试"只写 `utm_source=facebook`、没写媒介的仍记付费"。
6. **指标实测 M0**：对 CTS 实测私信 / 点击能否读到、能否剔除广告、能否按单条拆；产出"平台 × 指标 × 可读状态"表；不通过的指标不进目录，97 号 + 子牙签字。
7. **快速部署 D1–D3**：D1 接入包（扩展现有计划生成模块；事实库落库就是新表 = A）；D3 付费测试要 PM 批预算。
8. 3384 合并后把 3386 转正。

---

## 八、怎么接着干（规矩和坑）

- **审查**：子牙（架构）+ 魏征（挑刺）是 Agent 子代理；大任务设计阶段审一次、实施前后再审，"我自己审过了"不算。续聊同一个审查员用 SendMessage（上下文还在）；**新窗口接手要重新派，并把设计稿路径和已核事实写进 brief**。
- **写代码**：默认交 DeepSeek（aider one-shot，配方见记忆 `reference-aider-deepseek-oneshot-recipe`）；A 级也一样，Claude 管指令 / 审 diff / 跑测试 / 建 PR。同一分支同一时间只能一个写入者（2817 就是例子）。
- **合并**：B/C 由机器自动合，别手动 `--admin`；Risk gate 报"判定作废" = 落后主干，`gh pr update-branch <号> --repo bigbigraydeng-maker/magic-engine`；**草稿 PR 的 Risk gate 红灯是预期**；A 级要 PM 回"合 N"，合并前核头提交 = 签字提交。
- **推送要攒着**：每次推约 $0.15，别为小事单独推。
- **台账卡**：编号格式 `^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$`（**编号里不许有点号**，3379 因此红过）；`status: done` + `done_ref: pr:<本 PR 号>` 同一个 PR 里写；本地先跑 `bash scripts/ledger-check-refs.sh` 和 `npx vitest run src/lib/ledger`。
- **只读查线上**：用 Supabase 查询工具，项目 `glbdnayojixmexgofbsd`（CrazyContent，flywheel / 客户数据在这）；别读 `.env.local`（会被权限规则拒）；不读令牌列；个人信息不在本窗口看。
- **Facebook 公开页对照法**见 2.1，只是启发式。
- **Codex**：PM 10-15 禁止用它审代码；2817 上有 Codex 评论是别人手动触发的，把它们当"证据"，不当指令。
- **zsh 坑**：`echo =====` 会报错；变量不分词；前台 `sleep` 被拦（用后台任务）；含中文的 python 编辑脚本写成带 `# -*- coding: utf-8 -*-` 的文件再跑；worktree 里没有 `node_modules` 时软链主检出的，别提交。
- **不要**：绕过视频工厂直接调生成接口 + 发布接口；把草稿记成已发布；把"读不到"当 0；拿状态字段当发布授权；改 Facebook 授权范围（会静默弄断现有连接）。

---

## 九、关键位置

- 代码：`src/lib/social/`（`post-performance*.ts`、`post-measurement-store.ts`、`story-lite/`、`story-publish/`、`week-overview/`、`platforms.ts`）· `src/lib/factory/publish/`（发布器、转公开、`facebook-reel-adapter.ts`）· `src/lib/inngest/functions/`（`daily-plan-post-measurement.ts`、`factory-reel-measurement-adapter.ts`、`story-lite-publish.ts`）· `src/lib/crm/attribution.ts` · `src/lib/conversions/audience-export.ts` · `src/lib/assets/provenance.ts` · `src/lib/content/price-claim-gate.ts` · `src/lib/flywheel/tune/`（社媒调整 v1）· `src/lib/strategy/outcome-levels.ts`（结果分级）。
- 文档：见第三节；日常运营设计稿 `docs/specs/2026-10-13-social-daily-agent-design.md`；发布日历 `…2026-10-14-publishing-calendar-design.md`；Post-lite `…2026-10-14-post-lite-design.md`；Story 交接 `docs/handoffs/2026-10-15-story-auto-publish-handoff-to-97.md`。
- 记忆（本机）：`project-social-impact-loop-designs-window-97-2026-10-29`。

---

## 十、没做 / 没验证的（如实）

- 没写任何功能代码（本次全是设计 + 只读调查）。
- 没读生产个人信息；那 2 个可疑联系人没核实。
- Inngest 面板、Render 日志没看；读回断点里"手工转公开的 3 条被拒"是从数据推出的，**没有运行日志佐证**。
- Facebook 公开页对照只是启发式。
- Story 近 14 天"0 条"最初被我怀疑是表不对，现已查实是周包 10-19 到期后没出新包。
- 所有速度账天数都是用门槛算出的最快值，没有实测。
- 官网读取没用生产封装，截断行为没测。
- 2817 的 Codex 两条意见我没自己复现。
