# 第 1 步第二次停下的依据（2026-11-03 生产库只读 + 本机回放）

库：老应用库（`glbdnayojixmexgofbsd`），只读 SELECT，只记汇总数字和去身份的编号尾号。

## 回放怎么做的

- 代码：分支 `feat/agent-loop-step1-ads` 提交 `05c58ec58` 的 `src/lib/ads-strategy/portfolio/change-review.ts`（没合并）。
- 数据：CTS、NAL 两个在投客户 2026-09-26 → 11-02 的快照真实改动（Meta 修改时间变了才算）、相关广告组 / 系列的日花费和结果数、各广告组真实的优化目标和目的地。
- 方式：本机 `tsx` 按天调用纯函数 `reviewMaturedChanges`，跟每日定时任务同一个入口；不连库、不写库、不发信。
- 时间：2026-11-03 08:49 NZDT，退出码 0。

## 结果

| | 处数 |
|---|---|
| 清理型暂停（跳过） | 16 |
| 回看 | 17 |
| 有结论 | 0 |
| 说不清：不是出结果的单位 | 6 |
| 说不清：前后 7 天有别的改动 | 5 |
| 说不清：暂停 WhatsApp 组但客户主结果是留资 | 3 |
| 说不清：系列下各组目标不一样 | 3 |

第一版规则（没按广告组自己的结果种类判）回放出「止损成立 5」，逐条查优化目标：系列 `…528325`、`…123525`、`…035473` 是视频播放（THRUPLAY），广告组 `…493473` 和系列 `…358873` 是 WhatsApp 开聊（CONVERSATIONS）——全是误判。

## 复查用的查询（12-03 复看时复制即可跑）

```sql
-- 近 30 天每个在投客户「真改过」的广告组 / 系列设置（Meta 修改时间变了）
with s as (
  select client_id, level, entity_id, source_updated_time sut, captured_at, capture_reason,
    lag(source_updated_time) over (partition by client_id, level, entity_id order by captured_at) p_sut
  from ad_entity_snapshots where level in ('adset','campaign') and capture_reason <> 'disappeared' and captured_at > now() - interval '40 days')
select client_id, level, count(*) real_changes, count(distinct date(sut)) change_days
from s where capture_reason in ('changed','kernel_post') and p_sut is not null and sut is not null and sut <> p_sut and captured_at > now() - interval '30 days'
group by 1, 2 order by 1, 2;
```
