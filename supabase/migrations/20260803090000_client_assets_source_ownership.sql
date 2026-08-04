-- client_assets 加「来源」与「归属」两个正交标记（2026-08-03）
--
-- 为什么必须是两个字段而不是一个：
--   source    = 这东西哪来的 → 决定**能不能打真实价格**
--   ownership = 谁能看见它   → 决定**能不能给同行共用**
-- 上一版设计把两者混成一个字段，会出现「AI 衍生物归了客户 → 被当成真料去打价格」
-- 这类误用。红线只认 source，永远不认 ownership。
--
-- 存量 81 行一律回填 'unknown'：它们分不清是客户上传还是 FDE 上传，
-- 而 'unknown' 打不了真价 —— 保守是对的，需要时由 FDE 逐张升级。

alter table public.client_assets
  add column if not exists source text not null default 'unknown',
  add column if not exists ownership text not null default 'client_exclusive',
  add column if not exists verified_by text,
  add column if not exists verified_at timestamptz;

comment on column public.client_assets.source is
  'client_verified=FDE逐张确认过的客户实拍 | client_provided=上传链接进来的未核实 | fde_shot=我们拍的 | stock=图库或抓取 | ai_generated=AI生成或改写 | unknown=来源不明。只有 client_verified 与 fde_shot 能给真实价格背书。';

comment on column public.client_assets.ownership is
  'client_exclusive=该客户专属，绝不跨客户 | industry_shared=行业共用。PM 2026-08-02 拍板：客户自己实拍的素材坚决不可共用。';

comment on column public.client_assets.verified_by is
  '把 client_provided 升为 client_verified 的人（邮箱）。审计用，出事要能追到人。';

alter table public.client_assets
  drop constraint if exists client_assets_source_check;
alter table public.client_assets
  add constraint client_assets_source_check
  check (source in ('client_verified', 'client_provided', 'fde_shot', 'stock', 'ai_generated', 'unknown'));

alter table public.client_assets
  drop constraint if exists client_assets_ownership_check;
alter table public.client_assets
  add constraint client_assets_ownership_check
  check (ownership in ('client_exclusive', 'industry_shared'));

-- 「已核实」必须留下是谁、什么时候核实的。
-- 没有这条，任何人都能把网图静默升成"真料"且无从追溯 —— 这是踩客户红线的路径。
alter table public.client_assets
  drop constraint if exists client_assets_verified_audit_check;
alter table public.client_assets
  add constraint client_assets_verified_audit_check
  check (source <> 'client_verified' or (verified_by is not null and verified_at is not null));

-- 现有 (client_id, status) 索引已覆盖出片取料的查询路径，本次不新增索引。
