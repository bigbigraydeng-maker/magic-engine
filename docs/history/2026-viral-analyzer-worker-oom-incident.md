# 2ME Adivise - viral-analyzer-worker OOM 导致 cron job 连锁宕机

> 对话日期：2026-06-15 | 类型：生产故障根因分析

---

## 1. 对话背景一句话

诊断 2026-06-11 凌晨 2:24 AM 开始的 Render 生产告警：`viral-analyzer-worker` 反复 "server failure"，并连带导致 `anomaly-detector-daily` / `social-engagement-pullback` / `goal-current-value-refresh` / `google-data-pullback-daily` 四条 cron job 在 3–5 AM UTC 全部 DOWN，涉及 DAPE **E（Execution）** 层的 Phase 11 视频分析引擎，以及 Phase 12 / Phase 22 飞轮数据采集 cron 链路。

---

## 2. 学到了什么（认知层）

### 技术架构

- **`maxDuration = 120` 在 Render 上不生效**：Next.js `export const maxDuration` 是 Vercel 专用约束，Render 不识别，route handler 会一直跑到 Node.js 进程自己崩溃为止。（来源：对比 `viral-analyzer-worker/route.ts:26` 与 Render `curl --max-time 120` 差异发现）

- **curl `--max-time` 断开 ≠ 后台子进程终止**：Render cron 的 `curl --max-time 120` 超时后 HTTP 连接断开，但 Next.js handler 里通过 `child_process.exec` 启动的 `yt-dlp` 子进程**不会随连接断开而 kill**，会继续下载视频直到自己的 180s timeout 到期。（来源：阅读 `src/lib/reels/viral-analyzer.ts:189` execAsync 调用）

- **cron 间隔（2 min）< 单批最大执行时间（> 3 min）= 并发累积 OOM**：非 YouTube 视频走 yt-dlp 下载（最大 180s）+ Gemini 文件 API 轮询（最大 60s）+ 模型分析，单批最坏耗时超过 4 分钟，但下一批 2 分钟后就启动，多批 yt-dlp 并行下载 720p 视频耗尽内存。（来源：对照 render.yaml schedule 与 viral-analyzer.ts 两个超时常量）

- **主 web service 崩溃 = 所有 cron job 级联 DOWN**：ME 所有 cron job 都是 Render cron 用 curl 打同一个 Next.js web service。主进程 OOM 重启期间，3:00 / 4:00 / 5:00 AM 的 cron 打不通 endpoint，curl 以非零退出，healthchecks.io 未收到 ping → DOWN 告警。（来源：对比 Render 告警时间线与 render.yaml 各 cron schedule 交叉推断）

- **崩溃中的批次会制造永久 stuck rows**：worker 在批次开头把所选行 `analysis_status` 更新为 `'analyzing'`，进程 OOM 崩溃后这些行永远停在 `'analyzing'`，下次 worker 查询 `in(['pending','error'])` 不会触及它们，形成僵尸数据。（来源：阅读 `route.ts:63–71` claim 步骤 + `analyzeViralReference` catch 块）

### 监控与运维

- 现有告警体系（healthchecks.io DOWN 邮件）只能发现"cron 没有 ping 到"，无法直接告诉 PM 是哪一层出了问题；root cause 需要人工交叉比对 Render 服务器崩溃告警时间线与 healthchecks DOWN 时间线才能定位。（来源：PM 提供两张截图后需要代码级排查才能定位根因）

---

## 3. 实现了什么（产物层）

无落地代码，仅认知沉淀。本次对话产出：

- **故障链还原**（本文件）：时间线 + 根因 + 三个关键矛盾的定量对照表
- **三项修复方案描述**（待实施，见第 5 节）：并发锁 / yt-dlp 文件大小上限 / stuck rows 自动清尸

---

## 4. 避坑清单（反面教材）

1. **`maxDuration` 写了当没写**
   现象：route.ts 写了 `export const maxDuration = 120`，但 Render 上实际不限制执行时间
   根因：该字段是 Vercel 专用，Render 完全忽略
   下次怎么避：在 Render 上需要超时控制，必须在代码层自己用 `Promise.race` + `AbortController` 实现；Render 部署的项目禁止依赖 `maxDuration`

2. **cron 触发间隔 < 单次执行时间 → 无限并发**
   现象：viral-analyzer-worker 每 2 分钟触发，但一批 8 个视频可能跑 4+ 分钟
   根因：没有并发锁，没有检查"上一批是否还在跑"
   下次怎么避：所有重型 cron worker 在 route 入口先查 DB 活跃锁（查 `analysis_status='analyzing'` 行数，或查 `cron_locks` 表），有锁则直接 `return {skipped: 'batch in progress'}`

3. **execAsync 子进程在请求断开后游魂独立**
   现象：curl 超时断开后，yt-dlp 进程仍在后台跑最多 180s
   根因：`child_process.exec` 不绑定请求生命周期，HTTP 连接关闭不触发任何 cleanup
   下次怎么避：用 `spawn` + `AbortController`，绑定 `req.signal`，连接断开时自动 `childProcess.kill()`

4. **进程崩溃后批次行永远卡在 `analyzing`**
   现象：某批视频 OOM 后，那 8 行 `analysis_status` 停在 `'analyzing'`，下次 worker 查不到它们
   根因：claim 步骤先写 `'analyzing'`，crash 后没有 finally/cleanup
   下次怎么避：worker 起跑时先把"超过 N 分钟仍在 `analyzing`"的行重置为 `'error'`（"超时清尸"），放在 claim 之前

5. **单个 worker OOM 拉垮所有 cron job**
   现象：4 个无关 cron（anomaly/social/goal/google）因 web service 重启被连带 DOWN
   根因：所有 cron 共用同一个 Next.js 进程，重型 IO 任务和轻量 cron 完全耦合
   下次怎么避：重型视频处理（yt-dlp + Gemini 上传）应独立为 Render Background Worker；短期至少加文件大小上限降低内存峰值

---

## 5. 给 ME 后续开发的具体建议

> 写前已跑 `grep -nE "^## Phase|^### Phase" ROADMAP.md`，Phase 号均来自真实列表。

---

### P0 — 立刻修（生产随时再崩）

**5.1 并发锁 + stuck rows 清尸**

- 归属：建议作为 Phase 11 稳定性子任务（Creative Intelligence Engine）
- 文件：`src/app/api/cron/viral-analyzer-worker/route.ts`
- 改法：在 batch select 之前插入两步：
  1. 把 `analysis_status='analyzing'` 且 `updated_at < NOW() - INTERVAL '10 minutes'` 的行重置为 `'error'`（直接跑 Supabase Admin update，不需要 migration）
  2. 查 `count(*)` where `analysis_status='analyzing'`，若 > 0 则 `return {ok:true, skipped: 'previous batch still running'}`
- 验证：手动把一行置为 `analyzing` + `updated_at = 15min ago` → 跑 cron → 确认行变为 `error`；再置一行 `analyzing` + `updated_at = 1min ago` → 确认 cron 返回 skipped
- 谁来做：Codex（单文件精准改动，低风险机械任务）

**5.2 yt-dlp 文件大小上限**

- 归属：Phase 11 稳定性子任务
- 文件：`src/lib/reels/viral-analyzer.ts` 第 189 行 execAsync 命令
- 改法：加 `--max-filesize 80m` 参数，超大视频直接让 yt-dlp 报错被 catch，不进内存：
  ```
  `${cmd} --max-filesize 80m -f "best[height<=720][ext=mp4]/best[height<=720]/best" -o "${tmpFile}" "${url}"`
  ```
- 验证：用一个已知 > 80MB 的 Facebook 视频 URL 测试，确认 yt-dlp 报错被 catch，DB 行状态变为 `error`，`analysis_error` 写入具体信息
- 谁来做：Codex（单行改动）

---

### P1 — 本周内

**5.3 yt-dlp 子进程绑定请求生命周期**

- 归属：Phase 11 稳定性子任务
- 文件：`src/lib/reels/viral-analyzer.ts` `downloadAndAnalyzeVideo` 函数（约第 174 行）
- 改法：把 `execAsync` 换成 `spawn` + `AbortController`；从 route handler 传入 `signal`（`req.signal`）；HTTP 断开时自动 kill yt-dlp 子进程
- 注意：需要修改 `analyzeViralReference` 函数签名，增加可选 `signal?: AbortSignal` 参数透传
- 验证：本地 dev server + curl 请求后立即 Ctrl-C 断开，`ps aux | grep yt-dlp` 确认无残留进程
- 谁来做：Claude Code（涉及调用链函数签名修改，非单文件）

**5.4 cron 监控分层：区分"service 挂了"和"业务失败"**

- 归属：建议并入 Phase 17（Unified Data Pullback / 统一数据回流层）作为可观测性子任务，新建子任务 P17.obs.1
- 改法：`cron_run_logs` 表加 `exit_reason` 字段（`'skipped_concurrent' | 'service_error' | 'business_error' | 'ok'`）；Render cron startCommand 里根据 HTTP 状态码区分：5xx = service error（应触发高优先告警），2xx/4xx = 业务层（可降级处理）
- 谁来做：Codex（migration + route 小改，低风险）
- 注意：migration 必须用 service_role 模板，不引用 workspace_id / auth.uid()（已写入 CLAUDE.md § 新 migration RLS policy 约束）

---

### P2 — 季度内评估

**5.5 视频分析引擎从主 web service 剥离**

- 归属：Phase 11 长期架构规划
- 当前架构：Render cron 每 2 分钟打主 Next.js web service → yt-dlp + Gemini 在同一进程执行
- 目标架构：视频分析改为 Render **Background Worker**（独立服务，独立内存配额），主 web service 只负责入队（写 `analysis_status='queued'`），不承担视频下载/上传/分析负载
- 这是 DAPE **E（Execution）** 层的基础设施分层问题：重型异步 AI 处理不应混在响应型 web service 里
- 谁来做：子牙出方案 + 魏征审（大任务，影响服务架构，≥2 审）；实施前必须 PM 拍板

---

*本文档由 Claude Code 生成于 2026-06-15，无 commit / 无 PR / 无 push*
