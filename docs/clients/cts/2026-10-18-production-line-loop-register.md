# 出片线闭环登记表（106 号 · 核实日 2026-10-18）

> 18 号转 PM 要求：每个环节写 通/断/未验证 + 证据。证据来源：生产库只读查询（`content_work_orders`、`cron_run_logs`、`clients`、`flywheel_actions`、`social_post_measurement_receipts`，2026-10-18）、`origin/main` 代码（ad7cc7e1d）、今天出片机实跑。**没读到**：105 号「素材需求单」设计稿（未合入主干）、Inngest 运行历史（无只读工具）。

| # | 环节 | 触发 / 谁做 | 闸门 | 产出 | 回执 | 核实 | 回写 | 状态 | 证据 |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **下单（触发）** | **人工**：各窗口手写 SQL 往 `content_work_orders` 塞单（我、111、各专员）；自动路径 `factory-order-scheduler`（每天 20:00 UTC）理论上给开了 `auto_order_enabled` 的客户发信号 | 角度溯源、日单量/日花费上限（strategist 既有护栏）；Remotion 单无前置「为什么做这条」闸 | 工单（queued） | `angle_source.source = manual_remotion_*` | 无 | 无 | **断** | 近 30 天 **全部 ~90 张工单都是 `manual_remotion_*`**（cts_may2027 32、cts_spring2027 31、cts_shanghai 13、east 各版 5、trial 3、本周 dusk/atmosphere 各 2）；调度器 30 天跑了 30 次全 `completed`，但**没有任何客户 `auto_order_enabled=true`**（CTS=false、East=false，其余 null）→ 空转；近 30 天需求信号只有 3 条（`codex-cts-review-batch`）；`evaluate.ts`/`order-scheduler.ts`/`client-config.ts` 里 **`remotion` 零命中** → 自动路径根本不会产生 Remotion 单。结论：**现在是「先做片、再挑片」**，没有「计划→素材需求→出片」的上游 |
| 2 | 选素材/选曲 | 人（我/专员）：Dropbox 素材目录 + 目录表 + 登记表；买/下载素材要 PM 同意 | 素材授权证据入 `credits-*.json`；音乐必须在 `music-vocals.json` 登记；近 7 天不重复靠人记 | 素材/曲子 | `credits-v10.json`、登记表 | 人工核 | 无 | **通（人工）/ 断（无需求单）** | 今天两次下载+入库留了出处；音乐人声闸实测拦含人声曲；但「该补什么素材」没有来源（105 的需求单未读到，**未验证**）；7 天不重复无机器检查 |
| 3 | 出片机领单/渲染 | `factory-worker`（PM 本机 launchd，开机自启，每 30s 轮询） | 渲染前：模板校验、`TEXT_WIRED_TEMPLATES`、素材 ffprobe 预检（atmosphere）、音乐人声闸（含 legacy/recipe）、红线复扫文字 | `final.mp4` + `segments.json` + SRT | `segments.json`（props、`music_vocal_gate`、`atmosphere_preflight`、`recipe_gaps`） | 当天实跑 | — | **通** | 今天升级后连出 5 张试跑单（拦 3、放行 2）+ 冒烟 + v4 + 样片 + 明信片，全部到 `in_review`；**但单机单点无监控**（台账 `2026-10-14-factory-worker-single-mac-unmonitored`：挂了约 6 小时才有人知道） |
| 4 | 出片后自动体检 | 服务端 `complete-work-order.ts` | 7 项技术体检（音轨/9:16/字幕时间轴/封面不黑/…）+ AI 品控标记 + 红线 | `output.quality_checklist_auto`、`quality_flags` | 同左 | 每单 | — | **通（技术项）/ 断（内容项）** | 氛围片样片 7 项全 PASS 却被 PM 批「没有实际内容」→ **缺「内容实质闸」**；设计稿已写（`2026-10-18-content-substance-gate-design.md`），**PM 未点头，代码未写**；AI 标记（如 `placeholder_caption`）只是提示，不拦 |
| 5 | 审片 | PM（审片页，人工清单 V2） | 人工 10 项（含「已开声音听」）；A 类自动项必须 PASS | `review_ref.approved_by/at/checklist_human` | 同左 | 每单 | — | **通** | PR 2719 已合；回填只认 PM 邮箱；待审积压：近 30 天 `in_review`=3 |
| 6 | 发布 | `factory-publish-worker`（Render cron，每小时）→ Facebook Reel | 只认 `approved`；全局发布开关未开=只存草稿；首评 CTA/追踪链接体检 | Facebook 视频（草稿/公开）；`published_ref` | `published_ref`（post_id、video_state、published_at、event_ids） | 每单 | 发 `me/factory.reel.published` 事件 | **通（带说明）** | 18 张 `published`：**11 张是 Facebook 草稿（DRAFT）**、4 张真公开（PUBLISHED）、3 张老单无状态；10-12 两张是 PM 口头指令下把草稿手动转公开（`promoted_note`）→ 「已发布」状态≠真公开，看板易误读 |
| 7 | **发布后回写（测量）** | `factory-reel-measurement-adapter`（Inngest，监听 `me/factory.reel.published`） | 三层幂等；身份重绑（client/page/video） | `flywheel_actions` 一行（`social.publish_post`）+ 扇出 T+4h / T+72h 的 `measure_due` → `social_post_measurement_receipts` | 回执表 | T+4/T+72 | **只回写测量表**；不回写工单、不回写计划、不进选片/下单 | **断（3/4）** | 4 张真公开的 Reel 里只有 **f9f05b76（09-06）有动作行+2 条回执**；**fa4fdd89（10-11 直接公开）、7ed7645b、e29b0986（10-12 草稿转公开）动作行=0、回执=0**，而它们的 `published_ref.event_ids` 都在（事件发出了）→ 适配器没登记/被跳过；原因**未验证**（看不到 Inngest 运行记录；7ed7645b/e29b0986 疑似「草稿转公开不重发事件」，fa4fdd89 是直接公开却也缺，更像适配器未生效） |
| 8 | 学习回路（测量→下一条怎么做） | 无自动；`tune-suggestions` 只服务每日计划 | — | 调参建议（每日计划侧） | — | — | 测量结果**不会**进出片选片/选曲/下单 | **断** | `social_post_measurement_receipts` 的消费方只有 `flywheel/tune/*` 与 `campaign-daily-plan/tune-suggestions`；`evaluate.ts`/`order-scheduler.ts` 不读测量 |
| 9 | 监控/存活 | 出片机 30s 上报 `factory-worker-alive`；今日待办 6 小时才报警 | — | `cron_run_logs` | — | 今天 | — | **通（弱）** | 今天升级前后读回存活；**队列为空时挂了无人知** |

## ① 出片由什么触发？计划→素材需求单接上后，scheduler 怎么按单出
- **现状**：先做片再挑片（见第 1 行）。
- **只用现有零件的最小接法（不新增表）**：①需求单落到现有 `content_demand_signals`（`source`、`dedupe_key`、`request` JSON 已有）；②`factory-order-scheduler` 保持不动（按客户开关 + 日上限 + 一天一单），但让 **evaluate 能处理「Remotion 订单」**：`signal.request` 带 `{ template, props_ref }`，`evaluateSignal` 按 `props_ref` 读已审过的 props（如 docs 里的 `*.order.json`）建工单——**这是 A 级**（碰 `evaluate.ts`=建单/花钱路径，且要先开客户开关），**先上报，不动手**；③在这之前的「零代码」办法：约定「每条下单必须带 `angle_source.source`+`authorized_by`+对应台账卡/需求单号」，我们已在做，只缺「需求单号」字段（105 设计稿定了再接）。
- 新表一律先标 A 级上报：本次**没有新增表**。

## ② 模板总负责人缺位：改模版冲突的实际风险与最小协调规则
- **风险有证据**：近 14 天动 `scripts/factory-worker/engines/remotion/**` / `remotion-branch.mjs` / `worker.mjs` 的窗口至少 **5 个**（103 datacard、111 datacard 接线、P21.J.M1 postcard、cts.shanghai-reel-v5 footageScrim、P22.FACTORY.CTS 的 list 选项、我的 atmosphere+人声闸），共 29 次提交，同一批文件；已出现过「模板在引擎里加了、出片机没接线」（datacard 曾被 `DATACARD_NOT_WIRED` 拒单）和我两次把本机符号链接误提交进 PR。目前 `remotion-branch.mjs`、`worker.mjs`、`creative-recipe.mjs` 已被列为 A 级受保护文件（PR 2721），任何改动都要 PM「合」，这本身就是一道串行化。
- **最小协调规则（不新增系统）**：(1) 动这些路径前，在对话里向 18 号报「涉及文件清单」并等回（今天已按此做）；(2) 同一时间同一文件只允许一个写入窗口；(3) 动手前 `git fetch` 并对这些路径 `git diff 分支基..origin/main`，别人刚合的先吃进来；(4) 加新模板必须同时改 4 处（`templates.ts`、`Root.tsx`、`render.mjs`、`remotion-branch.mjs` 的 `TEXT_WIRED_TEMPLATES`）——**机器化**：加一条测试「`TEMPLATE_IDS` 的每个 id 都在 `TEXT_WIRED_TEMPLATES` 里」，漏接就测试红（B 级小改，零新依赖；等你点头我就做）；(5) 引擎目录加 `README` 里的「谁在改什么」留言栏不要——用台账卡（每改一次一张）即可。

## ③ 出片后回写：adapter 写回了什么
见第 7 行：只写 `flywheel_actions`（一行）与测量回执表；不写回工单/计划/下单；且 **3/4 的真公开 Reel 根本没登记**。最小修法（只用现有零件）：先查清为什么没登记（需要 Inngest 运行记录或对适配器加一次「按 published_ref 补登记」的只读演练——补登记会写库，要 PM/18 号点头），再决定是适配器没部署、条件跳过还是事件没发。**我不动手**，等 18 号定。

## 我建议的下一步（按「频率/闭环关键度/收入」排序，不替 PM 定）
1. 查清「3/4 真公开 Reel 没有测量」（闭环关键度高：没有测量就没有 Check/Tune）；
2. 内容实质闸（设计稿在，等 PM 点头）；
3. 「新模板必须接线」的机器测试（B，小）；
4. 出片机队列空时的存活监控（台账已有卡，暂缓）。
