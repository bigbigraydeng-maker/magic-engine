-- 10 分钟花费样本补链接点击和成效，给以后算点击率、单次点击成本用。
-- 两列都可空。不设默认值，不回填已有行（旧行保持空，不能把「没上报」写成 0）。
-- link_clicks = Meta inline_link_clicks。
-- results = 表单阶梯取一个类型、私信阶梯取一个类型，再取较大值。重叠的父子类型不累加。
-- 不改已有列，不改行级策略（仍是整表 service_role）。
-- 不含广告级样本，也不含版位。
-- 生产库先不要执行。等 Ray 同意后再套用。

alter table public.ad_intraday_spend_samples
  add column link_clicks integer check (link_clicks is null or link_clicks >= 0),
  add column results integer check (results is null or results >= 0);

comment on column public.ad_intraday_spend_samples.link_clicks is
  'Meta inline_link_clicks for this sample. Null when the field was not reported. Not backfilled.';

comment on column public.ad_intraday_spend_samples.results is
  'max of one lead action type and one messaging action type. Null when actions were not reported. Not a sum. Not backfilled.';
