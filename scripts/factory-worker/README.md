# Content Factory 本地 worker(P21.J M2)

单机 Mac 产线。领 ME 的 queued 工单 → 生成/取库存 clip → `make_promo.py` 装配 9:16 + brandkit → 上传成片 → 标 `in_review`,直接进 ME 驾驶舱 `/dashboard/factory` 审片队列。

> 2026-07-23 起交付直接转 `in_review`。此前是转 `rendered`,再由 `factory-review-sweeper` cron 推 Airtable 审核卡时改 `in_review`;Airtable 已退役、该 cron 已停调度,`rendered` 成了死胡同(成片永远进不了审片队列),故去掉中间这一站。

## 依赖

- Node 18+(用内置 fetch)
- Python3 + ffmpeg + piper(装配走 `~/Documents/CTS_BrandKit/make_promo.py`,已有)
- `CTS_BrandKit/assets`(logo/music/watermark/voice,已有)

## 配置

```bash
cp scripts/factory-worker/.env.example scripts/factory-worker/.env
# 编辑 .env:至少填 FACTORY_WORKER_TOKEN(= Render 上同名值)
# 生成路径再填 MUAPI_API_KEY;文案可选 OPENAI_API_KEY
```

`.env` 已 gitignore,只留本地,绝不进 Render/仓库。

## 运行

```bash
node scripts/factory-worker/worker.mjs          # 领一单跑完退出(调试用)
node scripts/factory-worker/worker.mjs --loop   # 常驻轮询(生产)
```

常驻可挂 `launchd` / `pm2`,Mac 合盖睡眠 → 心跳超时 → ME `factory-worker-sweeper` 10 分钟后收回工单回 queued(不消耗 attempt),醒来重领。

## 流程与护栏

1. **claim**:`factory_claim_work_order` RPC(FOR UPDATE SKIP LOCKED)领最老 queued,返回 brief + 库存 clip 签名下载 URL + 成片/生成 clip 签名上传 URL。
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
