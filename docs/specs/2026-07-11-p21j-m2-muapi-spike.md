# P21.J M2 — muapi 计费/上传双 spike 结论（2026-07-11）

> Spec §9 M2「开工第一天必答」+ 风险 6 必答项。调研基于 muapi.ai 官方文档 + 官方 CLI 仓库；
> 查不到的如实标注，接入前用真 key 打一发验证「待实测」三项。

## 1. 余额 API — ✅ 有（护栏 10 可升级为双源核账）

- `GET https://api.muapi.ai/api/v1/account/balance`，header `x-api-key`，响应 `{ "balance": 42.50 }`（USD）。
- **每一个** `/api/v1/*` 响应都带 `X-Account-Balance` 响应头（剩余 USD）——worker 每次生成顺手读，
  与 `factory_balance_ledger` 台账对账，漂移即告警。台账仍是停机线事实源（决策不依赖外部 API 可用性）。
- 证据：muapi.ai/docs/credits · muapi.ai/docs/api-reference · github.com/SamurAIGPT/muapi-cli

## 2. 计费模式 — 生成时扣费；失败退款条款缺失，靠 `cost.refunded` 核账

- "All AI generation tasks deduct credits at the time of generation"（按提交/生成扣费，非按成功结算）。
- 响应 cost 对象有 `refunded` 字段 + `X-MuAPI-Cost-USD` 响应头 → 存在退款机制，但**失败/超时是否自动退官方未写明**。
- Refund Policy：credits 用掉不退现金；仅 "Extended service outage / Critical API failures" 例外。
- **工程结论**：预扣制（max_new_clips 硬数）是唯一可靠护栏；worker 每次提交后读 `cost` 记台账 spend，
  `refunded=true` 时补一条 adjustment 正数回冲。**不假设失败必退**。
- 证据：muapi.ai/docs/credits · muapi.ai/refund-policy

## 3. 结果视频访问 — CDN 直链，保留期未知，必须立即转存

- 结果在响应 `outputs` 数组：`https://cdn.muapi.ai/...` 直链，下载不带 key。
- 输入上传走 S3 presigned URL（1 小时过期）；**输出 CDN URL 保留期官方未写 — 未查到**。
- **工程结论**：worker 拿到 `outputs` URL 立即下载 → 直传 `content-factory` bucket（claim 下发的
  signed upload URL），muapi CDN URL 只进 `source_meta` 留痕，绝不当持久链接消费。
- 证据：muapi.ai/docs/api-reference · muapi.ai/docs/file-upload

## 4. API 形态

- 提交：`POST https://api.muapi.ai/api/v1/{model-slug}`，header `x-api-key` + JSON body；
  响应 `{"request_id": "...", "status": "processing", "cost": {...}}`
- 轮询：`GET https://api.muapi.ai/api/v1/predictions/{request_id}/result`
- Kling 2.1 I2V slug（playground 推断，**待实测**）：`kling-v2.1-standard-i2v` / `-pro-i2v` / `-master-i2v`
- 证据：muapi.ai/kling-3（完整 curl 示例）· muapi.ai/playground/kling-v2.1-standard-i2v

## 5. 终态 + Webhook

- 状态：`queued/pending/processing`（+`cancelled`）→ 终态仅 `completed` / `failed`。
- Webhook：提交时 query 参数 `webhook=https://...`（HTTPS POST），仅终态回调，失败指数退避重试 3 次。
  **无签名验证机制** → 若用 webhook，回调后必须反查 `urls.get` 二次确认，不能直接信 payload。
- v1 决策：worker 本地轮询（日 ≤3 单量级），webhook 不接 —— 少一个无签名入口少一个攻击面。
- 证据：muapi.ai/docs/webhooks

## 待实测三项（接入日用真 key 验证）

1. 失败任务 credits 是否自动 `refunded=true`
2. `cdn.muapi.ai` 输出 URL 实际保留多久
3. Kling 2.1 I2V 确切 slug + body 字段名（`image_url` vs `image`）
