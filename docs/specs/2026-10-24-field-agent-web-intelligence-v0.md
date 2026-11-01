# 外勤采集助手 × 网页情报 v0

状态：代码已进分支，迁移未应用到生产。不新建定时任务。

## 这是什么

Magic Engine 负责排期、落库和人工审核。外部采集助手（有浏览器、搜索和数据库写入能力）负责去公开页面上看，并把结果写成待审行。人在经营页点通过或驳回。通过后的观察才会进入竞品总览。

这不是新的能力线。它是挂在现有网页情报上的外勤连接。客户差异只在任务参数里的竞品名单。

## 表

迁移：`supabase/migrations/20261024120000_field_agent_web_intelligence.sql`

### `field_agent_tasks`

| 列 | 类型 | 允许值 / 规则 |
|---|---|---|
| `id` | uuid | 主键，默认生成 |
| `client_id` | uuid | 必填，客户 |
| `task_type` | text | `competitor_ads_scan` `google_maps_rating` `tripadvisor_scan` `ai_answer_scan` |
| `params` | jsonb | 对象。本次按钮会写入下面的竞品参数 |
| `status` | text | `queued` `running` `done` `failed`。新建是 `queued` |
| `requested_by` | text | 发起人邮箱，1–200 字 |
| `result_summary` | jsonb | 可空对象。助手完成时写 |
| `error` | text | 可空，最长 2000 |
| `dispatched_at` | timestamptz | 请求送出后由 ME 写入 |
| `started_at` | timestamptz | 助手开始时写 |
| `finished_at` | timestamptz | 助手结束或送出失败时写 |
| `created_at` `updated_at` | timestamptz | 自动 |

状态只允许：`queued` → `running` / `done` / `failed`，然后 `running` → `done` / `failed`。`done` 和 `failed` 不能再改状态。`client_id`、`task_type`、`params`、`requested_by` 不能改。

助手完成时建议的 `result_summary`：`{"observations_written":0,"competitors_checked":0,"note":""}`。

### `web_intelligence_external_observations`（扩展，不新建广告表）

原有列继续用。新增：

| 列 | 规则 |
|---|---|
| `payload` | jsonb 对象。四种新来源的字段见下 |
| `review_status` | `not_required`（旧的自动采集，默认）`pending` `approved` `rejected` |
| `reviewed_by` | 通过或驳回时必填，1–200 字。插入时必须为空 |
| `reviewed_at` | 通过或驳回时必填。插入时必须为空 |
| `review_notes` | 可空，最长 2000。这就是审核备注 |
| `task_id` | 可空，指向 `field_agent_tasks.id`。有任务号的新行，`review_status` 必须是 `pending` |
| `screenshot_path` | 可空。私有桶里的对象路径，不是网址 |

新的 `source_type`：`meta_ad_library` `google_maps_rating` `tripadvisor` `ai_answer`。旧值保留，其中已有的 `public_ads` 不要拿来写这次的广告。

助手插入一行时必须带上的原有列：`client_id`、`source_type`、`source_tier`、`source_name`、`source_url`、`canonical_url`、`title`、`excerpt`、`observed_at`、`content_hash`、`status`。`competitor_domain`、`published_at`、`valid_until` 可空。`status` 写 `observed`。同一客户下 `canonical_url` + `content_hash` 重复会被拒绝，应当计成已存在，不要把任务打成失败。

证据列插入后不能改。审核只能调用 `web_intelligence_review_observation(p_id, p_client_id, p_status, p_reviewer, p_notes)`，把 `pending` 改成 `approved` 或 `rejected`。直接改这四列会被拒绝，所以助手不能把自己写的广告标成通过。

来源等级：广告库、地图、点评站写 `B`；AI 回答写 `C`。

### `payload` 按来源

`meta_ad_library` 必填：`competitor_name`（1–200）、`ad_library_id`（1–80，只含字母数字、`_`、`-`）、`platforms`（1–8 个，每个只能是 `facebook` `instagram` `messenger` `audience_network` `threads`）。`primary_text`、`headline`、`offer_text` 至少有一项有字。可选：`cta`、`landing_url`（https）、`facebook_page_id`、`facebook_page_url`（https）、`started_running_on`（`YYYY-MM-DD`）。

同时：`source_name` = `Meta Ad Library`。`canonical_url` = `https://www.facebook.com/ads/library/?id=<ad_library_id>`。`excerpt` 放主文案，`title` 放标题。`published_at` 用开始投放日的零点（不知道就空）。`content_hash` 是下面这段 UTF-8 文本的 sha256 小写十六进制，字段之间用换行，缺的字段用空字符串：

```text
meta_ad_library
<ad_library_id>
<primary_text>
<headline>
<landing_url>
```

`google_maps_rating` 必填：`competitor_name`、`rating`（0–5 的数字）、`review_count`（0 以上的整数）、`maps_url`（https）。

`tripadvisor` 必填：`competitor_name`、`rating`、`review_count`、`location_url`（https）。

`ai_answer` 必填：`query`、`engine`（`google_ai_overview` `chatgpt` `perplexity` `gemini` `copilot` `other`）、`mentioned`（true/false）。可选 `citation_urls`（最多 8 个 https）。

## 截图

私有桶：`field-agent-screenshots`。不公开。只允许 png / jpeg / webp，单文件最大 5MB。没有给访客开读权限，页面用短时签名链接预览。

对象路径必须是：`<client_id>/<task_id>/<文件名>`。文件名 1–120 位，只含字母、数字、`.`、`_`、`-`。广告建议用 `<ad_library_id>.png`。把这个路径写进 `screenshot_path`，不要写完整网址。上传用助手已有的服务端钥匙。

## 仪表盘发给 ME 的 JSON

页面：客户的「经营 Agent」。按钮「请求采集竞品广告」。只有管理员看得到。

`POST /api/clients/<client_id>/field-agent/tasks`

```json
{
  "task_type": "competitor_ads_scan",
  "params": {
    "channel": "meta_ad_library",
    "active_only": true
  }
}
```

服务器会把该客户未归档的竞品补进任务，再发给助手。没有竞品名单、或下面的环境变量没配好时，不建任务，页面直接说明原因。

待审列表：`GET /api/clients/<client_id>/field-agent/observations?review_status=pending`。`review_status` 还可为 `approved` 或 `rejected`。可选 `competitor`。

审核：`POST /api/clients/<client_id>/field-agent/observations/<observation_id>`

```json
{ "review_status": "approved", "review_notes": "" }
```

`review_status` 只能是 `approved` 或 `rejected`。

## ME 发给助手的 JSON

`POST` 到 `FIELD_AGENT_WEBHOOK_URL`。默认请求头 `Authorization: Bearer <FIELD_AGENT_WEBHOOK_KEY>`。若设置了 `FIELD_AGENT_WEBHOOK_HEADER`，头名改成那个值，头的内容就是钥匙原文，不再加 `Bearer`。地址必须是 https。

```json
{
  "task_id": "<uuid>",
  "client_id": "<uuid>",
  "task_type": "competitor_ads_scan",
  "params": {
    "channel": "meta_ad_library",
    "active_only": true,
    "competitors": [
      { "domain": "example.com", "tier": "watch", "urls": ["https://example.com/"] }
    ]
  },
  "write_targets": {
    "tasks_table": "field_agent_tasks",
    "observations_table": "web_intelligence_external_observations",
    "screenshot_bucket": "field-agent-screenshots"
  }
}
```

助手只把正在投放的公开广告写回。写完把任务从 `running` 收到 `done` 或 `failed`。不要自己把 `review_status` 改成通过。

## 环境变量（Render 服务 `crazycontent`）

- `FIELD_AGENT_WEBHOOK_URL`
- `FIELD_AGENT_WEBHOOK_KEY`
- `FIELD_AGENT_WEBHOOK_HEADER`（可不配）

## 网页情报为什么从 9 月底停了

每日采集只跳过「上一条还不是完成或失败」的那个网址。真正把整个客户锁住的是预算函数：只要这个客户还有一条 `reconciliation`，或者上个月还有一条没写下结算金额，新的采集会被拒绝。

审计里那条停在 `reconciliation`，错误码 `capture_start_unknown`。这个码表示钱可能已经花了、但金额不知道，所以不能当成零。当时名单里又只有一个网址，于是每天都没有新采集。这个函数也不写健康日志，所以监控页上看不到它停了。

本改动在每天的原有日程里，把超过 6 小时仍没收口、且还没结算的运行标成失败：没真正开始的按 0 结算；已经开始但不知道花费的，按当初预留的上限结算，避免少计。已知花费已经超过预留的，不动它。迁移没上生产之前，这段收口会自己跳过，不让每日采集因此报错。生产上要等迁移和这段代码都上线之后的下一次自动日程，才能看到那条卡住的检查被收口。这次没有新加定时任务，也没有对生产库执行迁移。

## Reuse

复用了网页情报的观测表、竞品名单（`competitor_monitoring_metadata` 与现有竞品解析）、客户权限和经营页。新增的任务表和截图桶是平台共用的调度与附件，不写客户名。广告字段进 `payload`，不另建一套竞品广告库。旅游总览只是读取已通过的观察，不把旅游判断写进共享规则。

本次落点与层级门一致：外勤连接是 L3，观测仍在既有网页情报里。没有把首个客户的名字或名单写进共享代码。
