-- provider_outages —— 「AI 供应商账户层面断电」的落地记录。
--
-- WHY（真实事故，2026-09-20）
-- ---------------------------
-- ME 全站只有一把 OPENAI_API_KEY，它背后的账户 2026-09-20 18:01~19:11 (UTC) 余额耗尽。
-- 约 35 个调用点一起死，**三天没人知道**：全仓只有 market-intel/pipeline.ts 一条链路
-- 会把 AI 失败喊出来，其余十几处都是 catch {} 静默吞掉。
--
-- 所以需要一个**落地的地方**：失败发生在 18:01 某个 cron 里，而下发今日待办的那个进程
-- 19:01 才跑，两者之间没有任何东西能把这件事传过去 —— 不落库就等于没发生。
--
-- 形状选「按天一行的事件记录」，不是「当前活跃告警 + resolved_at」，理由有三：
--   1) **自愈**：充值之后不再有新行，告警在一天内自然消失。不需要「检测恢复」那条路径 ——
--      而那条路径是最会骗人的：拦截点在 Cloudflare AI Gateway 之后，一次 200 可能是网关
--      缓存命中，证明不了账户真的恢复了。
--   2) **能答「连续几天了」**：数一下窗口内有几个不同的 outage_date 就行，不用额外存计数。
--   3) **写入有界**：每个 provider × reason 每天最多一行（靠下面的唯一约束 + upsert），
--      断电期间成千上万次失败调用也只会更新 last_seen_at，不会把表写爆。
--
-- 刻意**不加** occurrences 计数列：写入路径带进程内节流、而生产是多进程，
-- 任何计数都必然偏低。宁可不报这个数，也不报一个会骗人的数
-- （memory: never-report-sampled-estimate-as-a-number）。
--
-- 这张表没有 client_id —— 它是 ME 自己的基础设施状态，不属于任何客户。

CREATE TABLE provider_outages (
  id             uuid primary key default gen_random_uuid(),
  -- 哪个供应商。今天只有 'openai'，留 text 是因为同一个形状对
  -- Anthropic / DataForSEO / Creatomate 完全适用（它们都有「账户没钱」这个失败形态）。
  provider       text not null,
  -- 账户级失效的原因。取值见 src/lib/ai/provider-failure.ts 的 ProviderFailureKind：
  -- account_exhausted（没钱）/ credential_invalid（钥匙不认了）/ gateway_auth_failed（卡在网关）。
  -- 🔴 用 text 不用 check 约束：多一种失败形态时要能先落库再补代码，
  --    不能因为约束挡住而让一次真实断电**又一次**没有落地记录。
  reason         text not null,
  -- 按 UTC 日历天归并。跨时区显示由读的那一侧处理（AU/NZ 市场，见 daily-todo）。
  outage_date    date not null,
  -- 最近一次的人话细节（供应商原文，截断）—— 给待办文案用，不参与判断。
  detail         text,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  -- 同一天同一个原因只留一行 —— 这也是写入侧 upsert 的冲突目标。
  -- 没有它，一次断电会写进几千行。
  unique (provider, reason, outage_date)
);

-- 读的那一侧永远是「最近 N 天、按 provider」，这个索引直接覆盖。
create index on provider_outages (provider, outage_date desc);

alter table provider_outages enable row level security;
revoke all on provider_outages from anon, authenticated;
grant all on provider_outages to service_role;

create policy provider_outages_service_role
  on provider_outages for all to service_role using (true) with check (true);
-- 不给 anon/authenticated 建任何 policy —— 写入方是 AI 客户端封装（service_role），
-- 读取方是 pm-daily-todo 的待办聚合（service_role），仅此两处。
-- CLAUDE.md §7：必须写 `TO service_role`，漏掉等于对匿名访客敞开读写
-- （2026-08-03 实测泄露 118 条策略）。
