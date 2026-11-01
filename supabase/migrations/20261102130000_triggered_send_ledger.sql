-- 触发型发送（triggered send）账本：授权表 + 发送状态账本 + 原子认领函数。
-- service-role only。A 级（新表 + 触发器 + 函数，碰对外发信授权）：生产应用前必须先预检，并等 PM 回「go apply」。
-- 本迁移不含任何客户数据、邮箱、正文；只新增对象，不改任何旧表。
-- 设计稿：docs/specs/2026-11-02-me-send-gate-p2-design-v0.md §3、§4.2。
--
-- 绑定列不可变由触发器强制（service_role 能绕过 RLS，所以不能只靠代码自觉）。
-- 授权表的生命周期列只能从空写一次；发送账本的状态单调前进、影子行冻结、认领后的写一次列不可再改。

-- ────────────────────────────────────────────────────────────────────────────
-- 一、表 1：triggered_send_authorizations —— 规则快照 + 授权
-- ────────────────────────────────────────────────────────────────────────────
create table public.triggered_send_authorizations (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  client_id uuid not null references public.clients(id),
  trigger_key text not null check (trigger_key in ('welcome')),
  channel text not null check (channel in ('email')),
  account text not null check (account ~ '^[a-z][a-z0-9_]{1,30}$'),
  rule jsonb not null check (jsonb_typeof(rule) = 'object'),
  rule_sha256 text not null check (rule_sha256 ~ '^[0-9a-f]{64}$'),
  template_version integer check (template_version is null or template_version >= 1),
  template_sha256 text check (template_sha256 is null or template_sha256 ~ '^[0-9a-f]{64}$'),
  daily_cap integer not null check (daily_cap between 1 and 50),
  proposed_by_email text not null check (char_length(proposed_by_email) between 3 and 254),
  proposed_at timestamptz not null default now(),
  authorized_by_email text check (authorized_by_email is null or char_length(authorized_by_email) between 3 and 254),
  authorized_by_user_id uuid,
  authorized_at timestamptz,
  live_from timestamptz,
  expires_at timestamptz,
  activated_at timestamptz,
  revoked_at timestamptz,
  revoked_by text check (revoked_by is null or char_length(revoked_by) between 3 and 254),
  revoked_reason text check (revoked_reason is null or char_length(revoked_reason) between 1 and 300),
  created_at timestamptz not null default now(),
  constraint triggered_send_authorizations_authorized_all_or_none check (
    (authorized_by_email is null and authorized_by_user_id is null and authorized_at is null and live_from is null and expires_at is null)
    or (authorized_by_email is not null and authorized_by_user_id is not null and authorized_at is not null and live_from is not null and expires_at is not null)
  ),
  constraint triggered_send_authorizations_template_when_authorized check (
    authorized_at is null or (template_version is not null and template_sha256 is not null)
  ),
  constraint triggered_send_authorizations_expiry check (
    expires_at is null or (expires_at > authorized_at and expires_at <= authorized_at + interval '90 days')
  ),
  constraint triggered_send_authorizations_live_from check (
    live_from is null or (live_from <= authorized_at and live_from >= authorized_at - interval '36 hours')
  ),
  constraint triggered_send_authorizations_activated_needs_authorized check (
    activated_at is null or authorized_at is not null
  ),
  constraint triggered_send_authorizations_revoked_pair check (
    (revoked_at is null) = (revoked_by is null)
  )
);

create unique index triggered_send_authorizations_one_active
  on public.triggered_send_authorizations (client_id, trigger_key, channel)
  where authorized_at is not null and revoked_at is null;
create unique index triggered_send_authorizations_one_proposal
  on public.triggered_send_authorizations (client_id, trigger_key, channel)
  where authorized_at is null and revoked_at is null;

comment on table public.triggered_send_authorizations is
  '触发型发送的规则快照 + 授权，一行一份提案/授权；绑定列插入后不可变，生命周期列只能从空写一次；批准只能由 PM 本人经登录身份的接口写入。';

-- ────────────────────────────────────────────────────────────────────────────
-- 二、表 1 的触发器：插入守卫、更新守卫、只增不改不删
-- ────────────────────────────────────────────────────────────────────────────

-- 插入守卫：一条 INSERT 不能直接写成「已批准 + 已武装」，生命周期列必须全空。
create or replace function public.triggered_send_authorizations_insert_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.authorized_by_email is not null
     or new.authorized_by_user_id is not null
     or new.authorized_at is not null
     or new.live_from is not null
     or new.expires_at is not null
     or new.activated_at is not null
     or new.revoked_at is not null
     or new.revoked_by is not null
     or new.revoked_reason is not null then
    raise exception 'triggered_send_authorizations: lifecycle columns must be empty on insert'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.triggered_send_authorizations_insert_guard() from public, anon, authenticated;

create trigger triggered_send_authorizations_insert_guard
  before insert on public.triggered_send_authorizations
  for each row execute function public.triggered_send_authorizations_insert_guard();

-- 更新守卫：绑定列整行白名单比对不可变；生命周期列一旦非空不许再变；已撤销不许再批准/武装。
create or replace function public.triggered_send_authorizations_update_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- a. 整行白名单比对：除 9 个生命周期列外，其余列（含以后新加的列）一律不可变。
  if (to_jsonb(new) - array[
        'authorized_by_email',
        'authorized_by_user_id',
        'authorized_at',
        'live_from',
        'expires_at',
        'activated_at',
        'revoked_at',
        'revoked_by',
        'revoked_reason'
      ]) is distinct from
     (to_jsonb(old) - array[
        'authorized_by_email',
        'authorized_by_user_id',
        'authorized_at',
        'live_from',
        'expires_at',
        'activated_at',
        'revoked_at',
        'revoked_by',
        'revoked_reason'
      ]) then
    raise exception 'triggered_send_authorizations: bound columns are immutable'
      using errcode = 'restrict_violation';
  end if;

  -- b. 每个生命周期列一旦非空就不许再变。
  if old.authorized_by_email is not null and new.authorized_by_email is distinct from old.authorized_by_email then
    raise exception 'triggered_send_authorizations: lifecycle column authorized_by_email may only be written once'
      using errcode = 'restrict_violation';
  end if;
  if old.authorized_by_user_id is not null and new.authorized_by_user_id is distinct from old.authorized_by_user_id then
    raise exception 'triggered_send_authorizations: lifecycle column authorized_by_user_id may only be written once'
      using errcode = 'restrict_violation';
  end if;
  if old.authorized_at is not null and new.authorized_at is distinct from old.authorized_at then
    raise exception 'triggered_send_authorizations: lifecycle column authorized_at may only be written once'
      using errcode = 'restrict_violation';
  end if;
  if old.live_from is not null and new.live_from is distinct from old.live_from then
    raise exception 'triggered_send_authorizations: lifecycle column live_from may only be written once'
      using errcode = 'restrict_violation';
  end if;
  if old.expires_at is not null and new.expires_at is distinct from old.expires_at then
    raise exception 'triggered_send_authorizations: lifecycle column expires_at may only be written once'
      using errcode = 'restrict_violation';
  end if;
  if old.activated_at is not null and new.activated_at is distinct from old.activated_at then
    raise exception 'triggered_send_authorizations: lifecycle column activated_at may only be written once'
      using errcode = 'restrict_violation';
  end if;
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'triggered_send_authorizations: lifecycle column revoked_at may only be written once'
      using errcode = 'restrict_violation';
  end if;
  if old.revoked_by is not null and new.revoked_by is distinct from old.revoked_by then
    raise exception 'triggered_send_authorizations: lifecycle column revoked_by may only be written once'
      using errcode = 'restrict_violation';
  end if;
  if old.revoked_reason is not null and new.revoked_reason is distinct from old.revoked_reason then
    raise exception 'triggered_send_authorizations: lifecycle column revoked_reason may only be written once'
      using errcode = 'restrict_violation';
  end if;

  -- c. 已撤销的提案不许再批准。
  if old.revoked_at is not null and old.authorized_at is null and new.authorized_at is not null then
    raise exception 'triggered_send_authorizations: revoked proposal cannot be authorized'
      using errcode = 'restrict_violation';
  end if;

  -- d. 已撤销的不许再武装。
  if old.revoked_at is not null and old.activated_at is null and new.activated_at is not null then
    raise exception 'triggered_send_authorizations: revoked authorization cannot be activated'
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

revoke all on function public.triggered_send_authorizations_update_guard() from public, anon, authenticated;

create trigger triggered_send_authorizations_update_guard
  before update on public.triggered_send_authorizations
  for each row execute function public.triggered_send_authorizations_update_guard();

-- 只增不改不删：行级 DELETE + 语句级 TRUNCATE 一律拒绝。
create or replace function public.triggered_send_authorizations_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception '% is append-only: % is not allowed', tg_table_name, tg_op
    using errcode = 'restrict_violation';
end;
$$;

revoke all on function public.triggered_send_authorizations_append_only() from public, anon, authenticated;

create trigger triggered_send_authorizations_no_delete
  before delete on public.triggered_send_authorizations
  for each row execute function public.triggered_send_authorizations_append_only();
create trigger triggered_send_authorizations_no_truncate
  before truncate on public.triggered_send_authorizations
  for each statement execute function public.triggered_send_authorizations_append_only();

-- ────────────────────────────────────────────────────────────────────────────
-- 三、表 2：triggered_sends —— 发送状态账本
-- ────────────────────────────────────────────────────────────────────────────
create table public.triggered_sends (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  trigger_key text not null check (trigger_key in ('welcome')),
  channel text not null check (channel in ('email')),
  contact_id uuid not null,
  dedupe_scope text not null check (dedupe_scope in ('lifetime', 'shadow')),
  status text not null check (status in ('shadow','blocked','skipped','pending','unknown_outcome','sent','delivery_delayed','delivered','suppressed','failed','bounced','complained')),
  reason_code text check (reason_code is null or char_length(reason_code) between 1 and 60),
  last_block_reason text check (last_block_reason is null or char_length(last_block_reason) between 1 and 60),
  bounce_kind text check (bounce_kind is null or bounce_kind in ('permanent','transient','undetermined')),
  authorization_id uuid references public.triggered_send_authorizations(id),
  template_key text check (template_key is null or char_length(template_key) between 1 and 80),
  template_version integer check (template_version is null or template_version >= 1),
  template_sha256 text check (template_sha256 is null or template_sha256 ~ '^[0-9a-f]{64}$'),
  rendered_sha256 text check (rendered_sha256 is null or rendered_sha256 ~ '^[0-9a-f]{64}$'),
  to_email_sha256 text check (to_email_sha256 is null or to_email_sha256 ~ '^[0-9a-f]{64}$'),
  provider_account text check (provider_account is null or provider_account ~ '^[a-z][a-z0-9_]{1,30}$'),
  provider_message_id text check (provider_message_id is null or char_length(provider_message_id) between 1 and 200),
  idempotency_key text check (idempotency_key is null or char_length(idempotency_key) between 1 and 256),
  provider_impact text not null default 'NONE' check (provider_impact in ('NONE','RESEND_ACCEPTED','RESEND_UNKNOWN')),
  consent_basis text check (consent_basis is null or char_length(consent_basis) between 1 and 80),
  source_ref text check (source_ref is null or char_length(source_ref) between 1 and 200),
  annotations jsonb not null default '{}'::jsonb check (jsonb_typeof(annotations) = 'object'),
  local_day date,
  claimed_at timestamptz,
  first_attempt_at timestamptz,
  lease_expires_at timestamptz,
  attempts integer not null default 0 check (attempts >= 0),
  sent_at timestamptz,
  last_event_type text check (last_event_type is null or char_length(last_event_type) between 1 and 80),
  last_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint triggered_sends_dedupe_key unique (client_id, trigger_key, channel, contact_id, dedupe_scope),
  constraint triggered_sends_scope_status check (
    (dedupe_scope = 'shadow' and status in ('shadow','blocked','skipped'))
    or (dedupe_scope = 'lifetime' and status <> 'shadow')
  ),
  constraint triggered_sends_claimed_has_key check (
    status not in ('pending','unknown_outcome','sent','delivery_delayed','delivered','suppressed','failed','bounced','complained')
    or (idempotency_key is not null and first_attempt_at is not null)
  )
);

create unique index triggered_sends_idempotency_key_idx on public.triggered_sends (idempotency_key) where idempotency_key is not null;
create unique index triggered_sends_provider_message_idx on public.triggered_sends (provider_account, provider_message_id) where provider_message_id is not null;
create unique index triggered_sends_lifetime_address_idx on public.triggered_sends (client_id, trigger_key, channel, to_email_sha256)
  where dedupe_scope = 'lifetime' and to_email_sha256 is not null
    and status in ('pending','unknown_outcome','sent','delivery_delayed','delivered','suppressed','bounced','complained');
create index triggered_sends_cap_idx on public.triggered_sends (client_id, trigger_key, local_day) where dedupe_scope = 'lifetime';
create index triggered_sends_to_hash_idx on public.triggered_sends (client_id, to_email_sha256) where to_email_sha256 is not null;

comment on table public.triggered_sends is
  '触发型发送的状态账本，可更新但状态单调前进；影子行冻结；不存邮箱和正文，只存哈希与代号。';

-- ────────────────────────────────────────────────────────────────────────────
-- 四、表 2 的辅助函数与触发器
-- ────────────────────────────────────────────────────────────────────────────

-- 状态等级：发送组内单调前进用；shadow/blocked/skipped 及未知状态返回 null。
create or replace function public.triggered_send_status_rank(s text)
returns integer
language sql
immutable
set search_path = public
as $$
  select case s
    when 'pending' then 1
    when 'unknown_outcome' then 2
    when 'sent' then 3
    when 'delivery_delayed' then 4
    when 'delivered' then 5
    when 'suppressed' then 6
    when 'failed' then 6
    when 'bounced' then 7
    when 'complained' then 8
    else null
  end;
$$;

revoke all on function public.triggered_send_status_rank(text) from public, anon, authenticated;

-- 状态转移是否合法。
create or replace function public.triggered_send_status_edge_ok(old_s text, new_s text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case
    when old_s = new_s then true
    when old_s = 'blocked' then new_s in ('skipped','pending')
    when old_s in ('shadow','skipped') then false
    else public.triggered_send_status_rank(new_s) is not null
         and public.triggered_send_status_rank(new_s) > public.triggered_send_status_rank(old_s)
  end;
$$;

revoke all on function public.triggered_send_status_edge_ok(text, text) from public, anon, authenticated;

-- 插入守卫：真发行只能以 blocked / skipped / pending 插入。
create or replace function public.triggered_sends_insert_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.dedupe_scope = 'lifetime' and new.status not in ('blocked','skipped','pending') then
    raise exception 'triggered_sends: live rows may only be inserted as blocked, skipped or pending'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.triggered_sends_insert_guard() from public, anon, authenticated;

create trigger triggered_sends_insert_guard
  before insert on public.triggered_sends
  for each row execute function public.triggered_sends_insert_guard();

-- 更新守卫：身份列不可变；影子行冻结；认领后的写一次列不可再改；状态单调前进。
create or replace function public.triggered_sends_update_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- a. 身份列不许变。
  if new.id is distinct from old.id
     or new.client_id is distinct from old.client_id
     or new.trigger_key is distinct from old.trigger_key
     or new.channel is distinct from old.channel
     or new.contact_id is distinct from old.contact_id
     or new.dedupe_scope is distinct from old.dedupe_scope
     or new.created_at is distinct from old.created_at then
    raise exception 'triggered_sends: identity columns are immutable'
      using errcode = 'restrict_violation';
  end if;

  -- b. 影子行冻结。
  if old.dedupe_scope = 'shadow' then
    raise exception 'triggered_sends: shadow rows are frozen'
      using errcode = 'restrict_violation';
  end if;

  -- c. 认领之后的写一次列。
  if old.status <> 'blocked' and old.template_key is not null and new.template_key is distinct from old.template_key then
    raise exception 'triggered_sends: column template_key may only be written once after claim'
      using errcode = 'restrict_violation';
  end if;
  if old.status <> 'blocked' and old.template_version is not null and new.template_version is distinct from old.template_version then
    raise exception 'triggered_sends: column template_version may only be written once after claim'
      using errcode = 'restrict_violation';
  end if;
  if old.status <> 'blocked' and old.template_sha256 is not null and new.template_sha256 is distinct from old.template_sha256 then
    raise exception 'triggered_sends: column template_sha256 may only be written once after claim'
      using errcode = 'restrict_violation';
  end if;
  if old.status <> 'blocked' and old.rendered_sha256 is not null and new.rendered_sha256 is distinct from old.rendered_sha256 then
    raise exception 'triggered_sends: column rendered_sha256 may only be written once after claim'
      using errcode = 'restrict_violation';
  end if;
  if old.status <> 'blocked' and old.to_email_sha256 is not null and new.to_email_sha256 is distinct from old.to_email_sha256 then
    raise exception 'triggered_sends: column to_email_sha256 may only be written once after claim'
      using errcode = 'restrict_violation';
  end if;
  if old.status <> 'blocked' and old.provider_account is not null and new.provider_account is distinct from old.provider_account then
    raise exception 'triggered_sends: column provider_account may only be written once after claim'
      using errcode = 'restrict_violation';
  end if;
  if old.status <> 'blocked' and old.provider_message_id is not null and new.provider_message_id is distinct from old.provider_message_id then
    raise exception 'triggered_sends: column provider_message_id may only be written once after claim'
      using errcode = 'restrict_violation';
  end if;
  if old.status <> 'blocked' and old.idempotency_key is not null and new.idempotency_key is distinct from old.idempotency_key then
    raise exception 'triggered_sends: column idempotency_key may only be written once after claim'
      using errcode = 'restrict_violation';
  end if;
  if old.status <> 'blocked' and old.consent_basis is not null and new.consent_basis is distinct from old.consent_basis then
    raise exception 'triggered_sends: column consent_basis may only be written once after claim'
      using errcode = 'restrict_violation';
  end if;
  if old.status <> 'blocked' and old.source_ref is not null and new.source_ref is distinct from old.source_ref then
    raise exception 'triggered_sends: column source_ref may only be written once after claim'
      using errcode = 'restrict_violation';
  end if;
  if old.status <> 'blocked' and old.local_day is not null and new.local_day is distinct from old.local_day then
    raise exception 'triggered_sends: column local_day may only be written once after claim'
      using errcode = 'restrict_violation';
  end if;
  if old.status <> 'blocked' and old.first_attempt_at is not null and new.first_attempt_at is distinct from old.first_attempt_at then
    raise exception 'triggered_sends: column first_attempt_at may only be written once after claim'
      using errcode = 'restrict_violation';
  end if;

  -- d. 状态转移必须合法。
  if new.status is distinct from old.status and not public.triggered_send_status_edge_ok(old.status, new.status) then
    raise exception 'triggered_sends: illegal status transition % -> %', old.status, new.status
      using errcode = 'restrict_violation';
  end if;

  -- e. 刷新 updated_at。
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.triggered_sends_update_guard() from public, anon, authenticated;

create trigger triggered_sends_update_guard
  before update on public.triggered_sends
  for each row execute function public.triggered_sends_update_guard();

-- 只增不改不删：行级 DELETE + 语句级 TRUNCATE 一律拒绝。
create or replace function public.triggered_sends_append_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception '% is append-only: % is not allowed', tg_table_name, tg_op
    using errcode = 'restrict_violation';
end;
$$;

revoke all on function public.triggered_sends_append_only() from public, anon, authenticated;

create trigger triggered_sends_no_delete
  before delete on public.triggered_sends
  for each row execute function public.triggered_sends_append_only();
create trigger triggered_sends_no_truncate
  before truncate on public.triggered_sends
  for each statement execute function public.triggered_sends_append_only();

-- ────────────────────────────────────────────────────────────────────────────
-- 五、RLS：service-role 模板（必须带 TO service_role，漏掉 = 对匿名访客敞开读写）
-- ────────────────────────────────────────────────────────────────────────────
alter table public.triggered_send_authorizations enable row level security;

create policy triggered_send_authorizations_service_role
  on public.triggered_send_authorizations
  for all
  to service_role
  using (true)
  with check (true);

revoke all on public.triggered_send_authorizations from anon, authenticated;

alter table public.triggered_sends enable row level security;

create policy triggered_sends_service_role
  on public.triggered_sends
  for all
  to service_role
  using (true)
  with check (true);

revoke all on public.triggered_sends from anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 六、原子认领函数：public.triggered_send_claim
--     必须在 READ COMMITTED 下运行；按 client+trigger_key 取事务级 advisory lock；
--     日上限取授权行里的 daily_cap，不信调用方。
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.triggered_send_claim(
  p_authorization_id uuid,
  p_contact_id uuid,
  p_to_email_sha256 text,
  p_idempotency_key text,
  p_template_key text,
  p_template_version integer,
  p_template_sha256 text,
  p_rendered_sha256 text,
  p_source_ref text,
  p_consent_basis text,
  p_lease_minutes integer default 10
) returns table (outcome text, send_id uuid, row_status text)
language plpgsql
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_client_id uuid;
  v_trigger_key text;
  v_auth public.triggered_send_authorizations;
  v_tz text;
  v_day date;
  v_row public.triggered_sends;
  v_has_row boolean;
  v_used integer;
  v_dup integer;
  v_n integer;
  v_id uuid;
begin
  -- 1. 只允许 READ COMMITTED。
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'triggered_send_claim requires READ COMMITTED'
      using errcode = 'restrict_violation';
  end if;

  -- 2. 先取 client_id / trigger_key 用于加锁键。
  select client_id, trigger_key into v_client_id, v_trigger_key
    from public.triggered_send_authorizations
   where id = p_authorization_id;
  if v_client_id is null then
    return query select 'auth_inactive'::text, null::uuid, null::text;
    return;
  end if;

  -- 3. 事务级 advisory lock：同一 client+trigger_key 串行化。
  perform pg_advisory_xact_lock(hashtextextended(v_client_id::text || ':' || v_trigger_key, 0));

  -- 4. 锁内重读授权并加共享锁，校验仍有效。
  select * into v_auth
    from public.triggered_send_authorizations
   where id = p_authorization_id
   for share;
  if v_auth.revoked_at is not null
     or v_auth.activated_at is null
     or v_auth.authorized_at is null
     or v_auth.expires_at <= now() then
    return query select 'auth_inactive'::text, null::uuid, null::text;
    return;
  end if;

  -- 5. 本地日：时区名非法会自己抛错（有意的 fail-closed，不 catch）。
  v_tz := coalesce(v_auth.rule #>> '{schedule,timezone}', 'Pacific/Auckland');
  v_day := (now() at time zone v_tz)::date;

  -- 6. 找已有的真发行并锁住。
  select * into v_row
    from public.triggered_sends
   where client_id = v_client_id
     and trigger_key = v_trigger_key
     and channel = v_auth.channel
     and contact_id = p_contact_id
     and dedupe_scope = 'lifetime'
   for update;
  v_has_row := (v_row.id is not null);

  -- 7. 已有行：pending 走租约/接管/过期；终态直接返回；blocked 继续往下重新认领。
  if v_has_row then
    if v_row.status = 'pending' then
      if v_row.first_attempt_at is not null
         and now() - v_row.first_attempt_at > interval '20 hours' then
        update public.triggered_sends
           set status = 'unknown_outcome',
               provider_impact = 'RESEND_UNKNOWN',
               reason_code = 'expired_20h'
         where id = v_row.id;
        return query select 'expired_unknown'::text, v_row.id, 'unknown_outcome'::text;
        return;
      elsif v_row.lease_expires_at is not null and v_row.lease_expires_at > now() then
        return query select 'in_flight'::text, v_row.id, 'pending'::text;
        return;
      else
        -- 接管：不改 first_attempt_at 和 idempotency_key。
        update public.triggered_sends
           set lease_expires_at = now() + make_interval(mins => p_lease_minutes),
               attempts = attempts + 1
         where id = v_row.id;
        return query select 'takeover'::text, v_row.id, 'pending'::text;
        return;
      end if;
    elsif v_row.status <> 'blocked' then
      return query select 'exists_terminal'::text, v_row.id, v_row.status;
      return;
    end if;
    -- status = 'blocked'：继续往下走重新认领。
  end if;

  -- 8. 同一地址是否已被欢迎过（别的联系人）。
  select count(*) into v_dup
    from public.triggered_sends
   where client_id = v_client_id
     and trigger_key = v_trigger_key
     and channel = v_auth.channel
     and dedupe_scope = 'lifetime'
     and to_email_sha256 = p_to_email_sha256
     and (v_row.id is null or id <> v_row.id)
     and status in ('pending','unknown_outcome','sent','delivery_delayed','delivered','suppressed','bounced','complained');
  if v_dup > 0 then
    return query select 'address_duplicate'::text, v_row.id, v_row.status;
    return;
  end if;

  -- 9. 日上限：上限取授权行里的 daily_cap，不信调用方。
  select count(*) into v_used
    from public.triggered_sends
   where client_id = v_client_id
     and trigger_key = v_trigger_key
     and channel = v_auth.channel
     and dedupe_scope = 'lifetime'
     and local_day = v_day
     and status in ('pending','unknown_outcome','sent','delivery_delayed','delivered','suppressed','bounced','complained');
  if v_used >= v_auth.daily_cap then
    return query select 'cap_reached'::text, v_row.id, v_row.status;
    return;
  end if;

  -- 10. 认领。
  if v_has_row then
    -- blocked 行重新认领。
    update public.triggered_sends
       set status = 'pending',
           authorization_id = p_authorization_id,
           template_key = p_template_key,
           template_version = p_template_version,
           template_sha256 = p_template_sha256,
           rendered_sha256 = p_rendered_sha256,
           to_email_sha256 = p_to_email_sha256,
           idempotency_key = p_idempotency_key,
           consent_basis = p_consent_basis,
           source_ref = p_source_ref,
           local_day = v_day,
           first_attempt_at = now(),
           claimed_at = now(),
           lease_expires_at = now() + make_interval(mins => p_lease_minutes),
           attempts = attempts + 1,
           provider_impact = 'NONE',
           reason_code = null,
           last_block_reason = null
     where id = v_row.id;
    get diagnostics v_n = row_count;
    if v_n <> 1 then
      raise exception 'triggered_send_claim: expected to update exactly one row';
    end if;
    v_id := v_row.id;
  else
    insert into public.triggered_sends (
      client_id, trigger_key, channel, contact_id, dedupe_scope, status,
      authorization_id, template_key, template_version, template_sha256,
      rendered_sha256, to_email_sha256, idempotency_key, consent_basis,
      source_ref, local_day, first_attempt_at, claimed_at, lease_expires_at, attempts
    ) values (
      v_client_id, v_trigger_key, v_auth.channel, p_contact_id, 'lifetime', 'pending',
      p_authorization_id, p_template_key, p_template_version, p_template_sha256,
      p_rendered_sha256, p_to_email_sha256, p_idempotency_key, p_consent_basis,
      p_source_ref, v_day, now(), now(), now() + make_interval(mins => p_lease_minutes), 1
    )
    returning id into v_id;
  end if;

  -- 11. 认领成功。
  return query select 'claimed'::text, v_id, 'pending'::text;
  return;
end;
$$;

revoke execute on function public.triggered_send_claim(uuid, uuid, text, text, text, integer, text, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.triggered_send_claim(uuid, uuid, text, text, text, integer, text, text, text, text, integer) to service_role;
