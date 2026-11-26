# 核对：两家「D3 自动暂停」规则已同步为要审批（2026-11-04）

卡片：`2026-11-04-ads-autonomy-human-only-resync-verify`（verify_how：两家 `ads.auto_pause_on_d3` 生效规则为 `require_approval`，且 `ads_autonomy_sync_receipts` 各有一行 `to_mode=require_approval` 回执）

- 取数时间：2026-11-04 00:52 UTC（13:52 NZ），只读 SELECT，生产库 Supabase 项目 `glbdnayojixmexgofbsd`
- 取数方式：Supabase MCP `execute_sql`；两边取数状态：两张表均查成功
- 同步触发（74 号在 Inngest 后台手动 Invoke `magic-engine-web-cloud-ads-autonomy-sync`，PR 3596 部署后）：
  - CTS `c0000000-0000-0000-0000-000000000000`：run `01M6J0DH6N826C7HABHSRD84FK`（13:47:49 NZ），applied=1，skipped=8
  - NAL `4ae76381-cd45-43bd-85cd-98cfd7604007`：run `01M6J0GVYKZFWMXKAMS4A9DHJT`（13:49:38 NZ），applied=1，skipped=8

## 1. 生效规则

```sql
select client_id, action_key, mode, policy_version, effective_from, effective_to, updated_by, updated_at
from client_automation_policies
where client_id in ('c0000000-0000-0000-0000-000000000000','4ae76381-cd45-43bd-85cd-98cfd7604007')
  and action_key like 'ads.%'
order by client_id, action_key, effective_from;
```

`ads.auto_pause_on_d3`（两家各只有一行，`effective_to` 为空 = 当前生效）：

| 客户 | mode | policy_version | updated_at (UTC) |
|---|---|---|---|
| CTS | require_approval | 5 | 2026-11-04 00:47:55 |
| NAL | require_approval | 2 | 2026-11-04 00:49:45 |

其余 8 个 `ads.*` 键：两家的 `updated_at` 全部早于 2026-11-04 00:45 UTC（最晚 2026-11-03 11:07），本次同步没有动它们。当前值：
`add_retargeting_adset` / `budget_move_plan` / `scale_unit_budget` = require_approval；`cut_campaign_budget` / `cut_unit_budget` / `pause_campaign` / `pause_unit` / `swap_creative` = auto_approve（两家相同）。

## 2. 同步回执

```sql
select id, client_id, action_key, from_mode, to_mode, skipped_reason, source_updated_at, synced_at
from ads_autonomy_sync_receipts
where client_id in ('c0000000-0000-0000-0000-000000000000','4ae76381-cd45-43bd-85cd-98cfd7604007')
  and synced_at >= '2026-11-04 00:45:00+00'
order by client_id, synced_at, action_key;
```

| 客户 | 回执 id | action_key | from → to | synced_at (UTC) |
|---|---|---|---|---|
| CTS | 08d2a282-3662-4540-a83e-ea5cecbbd062 | ads.auto_pause_on_d3 | auto_approve → require_approval | 2026-11-04 00:47:56 |
| NAL | 13c6e1f6-55ea-49ce-b3fc-4740a78ee2b0 | ads.auto_pause_on_d3 | auto_approve → require_approval | 2026-11-04 00:49:45 |

样本量：00:45 UTC 之后两家共 2 行回执，都是这个键，没有别的键的回执（与 skipped=8 一致）。

## 结论

成。两家都已是 require_approval，各有一行对应回执，回执时间与 Inngest run 时间吻合；其余 8 个键未被改动。
