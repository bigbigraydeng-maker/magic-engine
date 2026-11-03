# 闭环升级第 1 步暂停的依据（2026-11-03 生产库只读查询）

库：老应用库（`glbdnayojixmexgofbsd`），只读 SELECT，只记汇总数字。

| 查的是什么 | 结果 |
|---|---|
| D3 自动暂停提议（`flywheel_actions` 里 `ads.auto_pause_on_d3`），全部历史 | 2 行，都是 `dry_run_logged`（演练），1 个客户，10-27 和 10-29；**从没被批准、从没执行** |
| 内核执行过的广告动作（`action_runs` 里 `ads.%`），全部历史 | 2 次，都是 `ads.pause_campaign`，10-18，手动止损，不是 D3 |
| O1 加预算机会（`ads_growth_states.payload.opportunities`），近 90 天 | 命中 0 次；只有 1 次「样本太少判不了」 |
| D3 花钱没结果命中，近 30 天 | 11 次，2 个客户；其中 5 次落在 72 小时内刚改过设置的广告组上（3 天） |

结论：第 1 步要接的两条线——「真执行后出结论」和「下一次决定先看刚做过什么」——在生产上几乎没有流量。影子跑 28 天预计不到 10 条差异，验证不了，按设计稿 §3.2 的停止线不做。

## 重启条件（满足任一就重开第 1 步）

1. O1 近 30 天命中 ≥ 3 次；
2. D3 自动暂停有 ≥ 1 次真的被批准并执行（`payload.status = 'paused'`）；
3. 内核执行的广告动作近 30 天 ≥ 5 次。

## 复查用的查询（复制即可跑）

```sql
-- 1. O1 近 30 天
select f->>'status' status, count(*) from ads_growth_states s, jsonb_array_elements(coalesce(s.payload->'opportunities','[]'::jsonb)) f
where s.date > current_date - 30 and f->>'code' = 'O1' group by 1;
-- 2. D3 自动暂停各状态
select payload->>'status' status, count(*) from flywheel_actions where action_type = 'ads.auto_pause_on_d3' group by 1;
-- 3. 内核执行的广告动作近 30 天
select action_key, status, count(*) from action_runs where action_key like 'ads.%' and created_at > now() - interval '30 days' group by 1, 2;
```

已写好的第 1 步代码（结论只认真执行 + 刚动过的组影子判断）没有推送，保存在会话补丁里；重启时从它开始，不用重写。
