-- 房源挂到楼盘上（2026-08-03）
--
-- 现实：`listings` 里同时躺着「30 Kiteroa」（楼盘本身）和「2/30 Kiteroa Terrace」
-- （楼盘里的一套房，带完整分析报告）。两者是父子关系，但表结构里表达不了，
-- 于是它们并排躺着，看起来像两套无关的房子。
--
-- 加上 project_id 之后：一个楼盘下面几套房、哪几套还没卖、这个楼盘一共带来多少客人，
-- 都是一句查询的事。此前只能靠人看地址前缀猜。
--
-- 可空：中介手上大量二手房不属于任何楼盘，那是常态，不是缺数据。

alter table public.listings
  add column if not exists project_id uuid references public.client_projects(id) on delete set null;

create index if not exists idx_listings_project on public.listings(project_id)
  where project_id is not null;

comment on column public.listings.project_id is
  '所属楼盘。为空 = 独立房源（二手房代理等），是常态不是缺数据。';
