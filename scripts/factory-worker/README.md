# Content Factory 本地 worker(P21.J M2)

单机 Mac 产线。领 ME 的 queued 工单 → 生成/取库存 clip → `make_promo.py` 装配 9:16 + brandkit → 上传成片 → 标 `in_review`,直接进 ME 驾驶舱 `/dashboard/factory` 审片队列。

> 2026-07-23 起交付直接转 `in_review`。此前是转 `rendered`,再由 `factory-review-sweeper` cron 推 Airtable 审核卡时改 `in_review`;Airtable 已退役、该 cron 已停调度,`rendered` 成了死胡同(成片永远进不了审片队列),故去掉中间这一站。

## 依赖

- Node 18+(用内置 fetch)
- Python3 + ffmpeg + ffprobe + tesseract + piper(装配走 `~/Documents/CTS_BrandKit/make_promo.py`,已有)
- Tesseract 用于封面占位字检测;未安装或不可运行时，该审核项保持 `NOT_MEASURED` 并阻止自动通过。可用 `FACTORY_TESSERACT_PATH` 指定可执行文件。
- `CTS_BrandKit/assets`(logo/music/watermark/voice,已有)

## 配置

```bash
cp scripts/factory-worker/.env.example scripts/factory-worker/.env
# 编辑 .env:填 FACTORY_WORKER_TOKEN(= Render 上同名值)
# 可选填 FACTORY_WORKER_TARGET_CLIENT_ID 来限定单客户;不填沿用现有全白名单行为
# 生成路径再填 MUAPI_API_KEY;文案可选 OPENAI_API_KEY
```

`.env` 已 gitignore,只留本地,绝不进 Render/仓库。

## Inngest Cloud dry-run pilot (#1280)

This pilot is isolated from the production factory worker. It never imports `worker.mjs`,
calls a provider, reads or writes Supabase, uploads media, or invokes review/publish APIs.

```bash
npm ci --prefix scripts/factory-worker --legacy-peer-deps --ignore-scripts
INNGEST_PILOT_CRASH_AFTER_EFFECT=1 node scripts/factory-worker/inngest-pilot.mjs connect
node scripts/factory-worker/inngest-pilot.mjs start
node scripts/factory-worker/inngest-pilot.mjs connect
node scripts/factory-worker/inngest-pilot.mjs duplicate
node scripts/factory-worker/inngest-pilot.mjs review pass
```

The pilot uses an outbound Connect worker with concurrency 1. It sends opaque IDs only,
stores atomic receipts in `~/Library/Application Support/Magic Engine/inngest-pilot/`,
and permits only one start, one duplicate probe, and one review. It does not modify the
existing LaunchAgent.

For the crash/restart acceptance run, start Connect with the crash flag, send `start`,
and wait for that worker process to terminate immediately after the local effect receipt.
Restart Connect **without** the crash flag, then send the duplicate probe and review.
Connect remains active until interrupted with `Ctrl-C`; keep exactly one Connect process.

Acceptance requires both the local receipts and Inngest Dashboard to show one admitted
run, `effect_count=1`, `provider_calls=0`, `production_writes=0`, and a final
`dry_run_complete` pass verdict. Never delete or reset pilot state to repeat a run; a new
run requires a new approved task/version and state directory.

## Inngest CTS production relay

The production relay is deliberately narrower than the factory worker: one configured
client, one registered recipe, one candidate, provider cost at or below the configured
cap, and `no_publish=true`. It uses Inngest Connect with concurrency 1, checkpoints the
code gate and generation separately, then waits up to seven days for Ray's correlated
pass/fail event without holding local compute.

```bash
npm run test:cts --prefix scripts/factory-worker
npm run inngest:cts --prefix scripts/factory-worker -- connect
npm run inngest:cts --prefix scripts/factory-worker -- start
npm run inngest:cts --prefix scripts/factory-worker -- review pass
```

The worker additionally verifies the claimed order has the exact configured client,
recipe id/version, and budget before any provider call. If
`single_image_i2v_multicut_9s` is not registered in the checked-out code, `start` ends as
`blocked_code_gate`; it never falls back to the old 12-second or legacy renderer. A
correct recipe order must already be queued by the existing factory scheduler. Local
receipts live in `~/Library/Application Support/Magic Engine/inngest-cts-workflow/`.
`FACTORY_WORKER_TOKEN` is required only when the code gate passes and generation starts;
the relay can therefore report a missing/unregistered recipe without production access.

## 运行

```bash
node scripts/factory-worker/worker.mjs          # 领一单跑完退出(调试用)
node scripts/factory-worker/worker.mjs --loop   # 常驻轮询(生产)
```

常驻可挂 `launchd` / `pm2`,Mac 合盖睡眠 → 心跳超时 → ME `factory-worker-sweeper` 10 分钟后收回工单回 queued(不消耗 attempt),醒来重领。

## 流程与护栏

1. **claim**:`factory_claim_work_order` RPC(FOR UPDATE SKIP LOCKED)。配置 `FACTORY_WORKER_TARGET_CLIENT_ID` 时只领该客户的最老 queued，且服务端先校验它属于既有白名单；不配置时保留原有全白名单领取行为。返回 brief + 库存 clip 签名下载 URL + 成片/生成 clip 签名上传 URL。
2. **clip 就绪**:每段优先用 `clip_ids` 库存实拍;缺则按 `clip_generation_plan` 调 muapi Kling I2V 生成。**预扣硬数本地强制 check**:已生成数 ≥ `max_new_clips` 立即 fail(不可重试)。
3. **文案**:OpenAI 溯源 `angle`+`rationale` 写短文案;无 key 走模板 fallback(不编价格数字)。
4. **装配**:`make_promo.py` 出 1080×1920、brandkit watermark + endcard + 音乐 + 转场。
5. **上传+complete**:三件套(final.mp4 / segments.json / captions.srt)+ 生成 clip 传签名 URL;`complete` 服务端复扫红线 + 校验路径前缀 + 预算硬顶,过 → `in_review`。
6. **心跳**:关键步骤前后发 heartbeat(cost_so_far),超预算返回 `abort`。

## 失败语义

- 可重试(网络/muapi 超时):`fail(retryable=true)` → 回 queued,attempt+1,满 `max_attempts` 进 dead_letter。
- 不可重试(预扣硬顶/无上传通道/缺素材):`fail(retryable=false)` → 直接 dead_letter。
- dead_letter 在 ME 后台 `/dashboard/factory` 一键「复活回队列」(attempt 归零)。

## 待实测(接 muapi 真 key 时验证,见 spec muapi spike)

- Kling 2.1 I2V 确切 slug + body 字段名(`image_url` vs `image`)
- 失败任务是否自动退 credits
- `cdn.muapi.ai` 输出 URL 保留期(worker 已即时转存 bucket,不依赖)
