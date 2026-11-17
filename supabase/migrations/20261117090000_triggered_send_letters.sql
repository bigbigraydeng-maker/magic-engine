-- 触发型发送：第二种信「AI 跟进信」（crm_ai_followup）——一位客人可以收几封不同的信，每封一辈子最多一次。
-- service-role only。A 级（改发信账本的守卫与约束、新增认领函数）：生产应用前必须先预检，并等 PM 回「go apply」；
-- 本迁移留给 Ray 亲手合。只加不删：不改任何已有行（11-17 生产库真发行 0 行、生效授权 0 行），欢迎信的认领函数一字不改。
-- 设计稿：docs/specs/2026-11-17-me-send-crm-ai-followup-cut1.md §3。

-- ────────────────────────────────────────────────────────────────────────────
-- 一、两张表的 trigger_key 改成格式检查（不再逐个列名单：倒计时信 countdown_… 等以后不必再动库）
-- ────────────────────────────────────────────────────────────────────────────
alter table public.triggered_send_authorizations drop constraint triggered_send_authorizations_trigger_key_check;
alter table public.triggered_send_authorizations add constraint triggered_send_authorizations_trigger_key_check
  check (trigger_key ~ '^[a-z][a-z0-9_]{1,40}$');

alter table public.triggered_sends drop constraint triggered_sends_trigger_key_check;
alter table public.triggered_sends add constraint triggered_sends_trigger_key_check
  check (trigger_key ~ '^[a-z][a-z0-9_]{1,40}$');

-- ────────────────────────────────────────────────────────────────────────────
-- 二、账本范围：'letter:<代号>' = 某一封信的真发行（与 'lifetime' 同等对待）
-- ────────────────────────────────────────────────────────────────────────────
alter table public.triggered_sends drop constraint triggered_sends_dedupe_scope_check;
alter table public.triggered_sends add constraint triggered_sends_dedupe_scope_check
  check (dedupe_scope in ('lifetime', 'shadow') or dedupe_scope ~ '^letter:[a-z][a-z0-9_]{1,40}$');

alter table public.triggered_sends drop constraint triggered_sends_scope_status;
alter table public.triggered_sends add constraint triggered_sends_scope_status check (
  (dedupe_scope = 'shadow' and status in ('shadow','blocked','skipped'))
  or (dedupe_scope <> 'shadow' and status <> 'shadow')
);

-- 同一客户、同一封信、同一收件地址只能有一行在途或已发（谓词与 lifetime 那条相同，理由见原迁移）。
create unique index triggered_sends_letter_address_idx
  on public.triggered_sends (client_id, trigger_key, channel, dedupe_scope, to_address_sha256)
  where dedupe_scope like 'letter:%' and to_address_sha256 is not null
    and (status in ('pending','unknown_outcome','sent','delivery_delayed','delivered','suppressed','bounced','complained')
         or (status = 'failed' and reason_code = 'not_sent_confirmed'));
create index triggered_sends_letter_cap_idx
  on public.triggered_sends (client_id, trigger_key, local_day) where dedupe_scope like 'letter:%';

-- ────────────────────────────────────────────────────────────────────────────
-- 三、插入守卫：所有真发行（不是 shadow 的行）都只能以 blocked / skipped / pending 插入，pending 只能经认领函数。
--     旧版只认 dedupe_scope = 'lifetime'：不改的话 letter:* 行可以直接插成 sent，绕过认领。
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.triggered_sends_insert_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.dedupe_scope <> 'shadow' and new.status not in ('blocked','skipped','pending') then
    raise exception 'triggered_sends: live rows may only be inserted as blocked, skipped or pending'
      using errcode = 'restrict_violation';
  end if;
  if new.dedupe_scope <> 'shadow' and new.status = 'pending'
     and coalesce(current_setting('app.triggered_send_claim', true), '') <> 'on' then
    raise exception 'triggered_sends: live pending rows may only be inserted by a claim function'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.triggered_sends_insert_guard() from public, anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────────
-- 四、AI 跟进信的原子认领函数：public.triggered_send_claim_letter
--     逐行照抄 triggered_send_claim，差别只有：
--       ① 范围是 'letter:' || p_letter_key，只接受规则里带信清单（rule.send.letters）的授权；
--       ② 模板核对改为：参数里的模板必须等于授权规则 rule.send.letters 里这封信登记的那一组；
--       ③ 日上限数这个 trigger 下所有信当天的认领数（几封信合计）。
--     加锁顺序不变：先 advisory lock（与欢迎信同一个键形状），再账本行（FOR UPDATE），最后授权行（FOR SHARE）。
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.triggered_send_claim_letter(
  p_authorization_id uuid,
  p_letter_key text,
  p_contact_id uuid,
  p_to_address_sha256 text,
  p_idempotency_key text,
  p_template_key text,
  p_template_version integer,
  p_template_sha256 text,
  p_rendered_sha256 text,
  p_source_ref text,
  p_consent_basis text,
  p_lease_minutes integer default 10
) returns table (outcome text, send_id uuid, row_status text, row_idempotency_key text)
language plpgsql
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_client_id uuid;
  v_trigger_key text;
  v_channel text;
  v_scope text;
  v_auth public.triggered_send_authorizations;
  v_letter jsonb;
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
    raise exception 'triggered_send_claim_letter requires READ COMMITTED'
      using errcode = 'restrict_violation';
  end if;

  -- 2. 入参校验（p_source_ref、p_consent_basis 允许为空）。
  if p_authorization_id is null
     or p_letter_key is null
     or p_letter_key !~ '^[a-z][a-z0-9_]{1,40}$'
     or p_contact_id is null
     or p_to_address_sha256 is null
     or p_idempotency_key is null
     or p_template_key is null
     or p_template_version is null
     or p_template_sha256 is null
     or p_rendered_sha256 is null
     or p_lease_minutes is null
     or p_lease_minutes not between 1 and 30 then
    raise exception 'triggered_send_claim_letter: invalid arguments'
      using errcode = 'invalid_parameter_value';
  end if;
  v_scope := 'letter:' || p_letter_key;

  -- 3. 先取 client_id / trigger_key / channel 用于加锁键。
  select client_id, trigger_key, channel into v_client_id, v_trigger_key, v_channel
    from public.triggered_send_authorizations
   where id = p_authorization_id;
  if v_client_id is null then
    return query select 'auth_inactive'::text, null::uuid, null::text, null::text;
    return;
  end if;

  -- 4. 事务级 advisory lock：同一 client+trigger_key 串行化（几封信共用一把，日上限才数得准）。
  perform pg_advisory_xact_lock(hashtextextended(v_client_id::text || ':' || v_trigger_key, 0));

  -- 5. 找这位客人这封信已有的真发行并锁住。
  select * into v_row
    from public.triggered_sends
   where client_id = v_client_id
     and trigger_key = v_trigger_key
     and channel = v_channel
     and contact_id = p_contact_id
     and dedupe_scope = v_scope
   for update;
  v_has_row := (v_row.id is not null);

  -- 6. 先判 20 小时（即使授权已撤销也要判）。
  if v_has_row
     and v_row.status = 'pending'
     and v_row.first_attempt_at is not null
     and now() - v_row.first_attempt_at > interval '20 hours' then
    update public.triggered_sends
       set status = 'unknown_outcome',
           provider_impact = 'PROVIDER_UNKNOWN',
           reason_code = 'expired_20h'
     where id = v_row.id;
    return query select 'expired_unknown'::text, v_row.id, 'unknown_outcome'::text, v_row.idempotency_key;
    return;
  end if;

  -- 7. 锁内重读授权并加共享锁，校验仍有效。
  select * into v_auth
    from public.triggered_send_authorizations
   where id = p_authorization_id
   for share;
  if v_auth.revoked_at is not null
     or v_auth.activated_at is null
     or v_auth.authorized_at is null
     or v_auth.expires_at <= now() then
    return query select 'auth_inactive'::text, null::uuid, null::text, null::text;
    return;
  end if;

  -- 8. 规则时区必须存在且是 IANA 时区名（同欢迎信）。
  v_tz := nullif(btrim(coalesce(v_auth.rule #>> '{schedule,timezone}', '')), '');
  if v_tz is null or not exists (select 1 from pg_catalog.pg_timezone_names n where n.name = v_tz) then
    return query select 'rule_invalid'::text, v_row.id, v_row.status, v_row.idempotency_key;
    return;
  end if;
  v_day := (now() at time zone v_tz)::date;

  -- 9a. 只认带信清单的授权（单封信的授权走 triggered_send_claim）。
  if jsonb_typeof(v_auth.rule #> '{send,letters}') is distinct from 'array' then
    return query select 'auth_inactive'::text, null::uuid, null::text, null::text;
    return;
  end if;

  -- 9. 这封信必须在授权的信清单里，模板指纹必须与清单登记的一致（清单在规则里，规则不可改）。
  select l into v_letter
    from jsonb_array_elements(coalesce(v_auth.rule #> '{send,letters}', '[]'::jsonb)) as l
   where l ->> 'letter_key' = p_letter_key
   limit 1;
  if v_letter is null then
    return query select 'letter_not_authorized'::text, v_row.id, v_row.status, v_row.idempotency_key;
    return;
  end if;
  if p_template_key is distinct from (v_letter ->> 'template_key')
     or p_template_version is distinct from (v_letter ->> 'template_version')::integer
     or p_template_sha256 is distinct from (v_letter ->> 'template_sha256') then
    return query select 'template_mismatch'::text, v_row.id, v_row.status, v_row.idempotency_key;
    return;
  end if;

  -- 10. 已有行：pending 走租约/接管；终态直接返回；blocked 继续往下重新认领。
  if v_has_row then
    if v_row.status = 'pending' then
      if v_row.lease_expires_at is not null and v_row.lease_expires_at > now() then
        return query select 'in_flight'::text, v_row.id, 'pending'::text, v_row.idempotency_key;
        return;
      else
        if v_row.authorization_id is distinct from p_authorization_id
           or v_row.rendered_sha256 is distinct from p_rendered_sha256 then
          return query select 'in_flight'::text, v_row.id, 'pending'::text, v_row.idempotency_key;
          return;
        end if;
        update public.triggered_sends
           set lease_expires_at = now() + make_interval(mins => p_lease_minutes),
               attempts = attempts + 1
         where id = v_row.id;
        return query select 'takeover'::text, v_row.id, 'pending'::text, v_row.idempotency_key;
        return;
      end if;
    elsif v_row.status <> 'blocked' then
      return query select 'exists_terminal'::text, v_row.id, v_row.status, v_row.idempotency_key;
      return;
    end if;
  end if;

  -- 11. 同一地址是否已收过这封信（别的联系人）。
  select count(*) into v_dup
    from public.triggered_sends
   where client_id = v_client_id
     and trigger_key = v_trigger_key
     and channel = v_channel
     and dedupe_scope = v_scope
     and to_address_sha256 = p_to_address_sha256
     and (v_row.id is null or id <> v_row.id)
     and (status in ('pending','unknown_outcome','sent','delivery_delayed','delivered','suppressed','bounced','complained')
          or (status = 'failed' and reason_code = 'not_sent_confirmed'));
  if v_dup > 0 then
    return query select 'address_duplicate'::text, v_row.id, v_row.status, null::text;
    return;
  end if;

  -- 12. 日上限：几封信合计，上限取授权行里的 daily_cap，不信调用方。
  select count(*) into v_used
    from public.triggered_sends
   where client_id = v_client_id
     and trigger_key = v_trigger_key
     and channel = v_channel
     and dedupe_scope like 'letter:%'
     and local_day = v_day
     and status in ('pending','unknown_outcome','sent','delivery_delayed','delivered','suppressed','bounced','complained');
  if v_used >= v_auth.daily_cap then
    return query select 'cap_reached'::text, v_row.id, v_row.status, null::text;
    return;
  end if;

  -- 13. 认领（先设认领标记，写完立刻复位）。
  perform set_config('app.triggered_send_claim', 'on', true);

  if v_has_row then
    update public.triggered_sends
       set status = 'pending',
           authorization_id = p_authorization_id,
           template_key = p_template_key,
           template_version = p_template_version,
           template_sha256 = p_template_sha256,
           rendered_sha256 = p_rendered_sha256,
           to_address_sha256 = p_to_address_sha256,
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
           last_block_reason = null,
           bounce_kind = null,
           sent_at = null,
           last_event_type = null,
           last_event_at = null
     where id = v_row.id;
    get diagnostics v_n = row_count;
    if v_n <> 1 then
      raise exception 'triggered_send_claim_letter: expected to update exactly one row';
    end if;
    v_id := v_row.id;
  else
    insert into public.triggered_sends (
      client_id, trigger_key, channel, contact_id, dedupe_scope, status,
      authorization_id, template_key, template_version, template_sha256,
      rendered_sha256, to_address_sha256, idempotency_key, consent_basis,
      source_ref, local_day, first_attempt_at, claimed_at, lease_expires_at, attempts
    ) values (
      v_client_id, v_trigger_key, v_channel, p_contact_id, v_scope, 'pending',
      p_authorization_id, p_template_key, p_template_version, p_template_sha256,
      p_rendered_sha256, p_to_address_sha256, p_idempotency_key, p_consent_basis,
      p_source_ref, v_day, now(), now(), now() + make_interval(mins => p_lease_minutes), 1
    )
    returning id into v_id;
  end if;

  perform set_config('app.triggered_send_claim', '', true);

  return query select 'claimed'::text, v_id, 'pending'::text, p_idempotency_key;
  return;
end;
$$;

revoke execute on function public.triggered_send_claim_letter(uuid, text, uuid, text, text, text, integer, text, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.triggered_send_claim_letter(uuid, text, uuid, text, text, text, integer, text, text, text, text, integer) to service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 五、重建单封信的认领函数 triggered_send_claim：与 20261102130000 逐字相同，只在第 7 步后加 7a——
--     规则里带信清单（多封信）的授权一律 auth_inactive，防止把多封信的授权喂给单封信的认领。
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.triggered_send_claim(
  p_authorization_id uuid,
  p_contact_id uuid,
  p_to_address_sha256 text,
  p_idempotency_key text,
  p_template_key text,
  p_template_version integer,
  p_template_sha256 text,
  p_rendered_sha256 text,
  p_source_ref text,
  p_consent_basis text,
  p_lease_minutes integer default 10
) returns table (outcome text, send_id uuid, row_status text, row_idempotency_key text)
language plpgsql
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_client_id uuid;
  v_trigger_key text;
  v_channel text;
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

  -- 2. 入参校验（p_source_ref、p_consent_basis 允许为空）。
  if p_authorization_id is null
     or p_contact_id is null
     or p_to_address_sha256 is null
     or p_idempotency_key is null
     or p_template_key is null
     or p_template_version is null
     or p_template_sha256 is null
     or p_rendered_sha256 is null
     or p_lease_minutes is null
     or p_lease_minutes not between 1 and 30 then
    raise exception 'triggered_send_claim: invalid arguments'
      using errcode = 'invalid_parameter_value';
  end if;

  -- 3. 先取 client_id / trigger_key / channel 用于加锁键。
  select client_id, trigger_key, channel into v_client_id, v_trigger_key, v_channel
    from public.triggered_send_authorizations
   where id = p_authorization_id;
  if v_client_id is null then
    return query select 'auth_inactive'::text, null::uuid, null::text, null::text;
    return;
  end if;

  -- 4. 事务级 advisory lock：同一 client+trigger_key 串行化。
  perform pg_advisory_xact_lock(hashtextextended(v_client_id::text || ':' || v_trigger_key, 0));

  -- 5. 找已有的真发行并锁住。
  select * into v_row
    from public.triggered_sends
   where client_id = v_client_id
     and trigger_key = v_trigger_key
     and channel = v_channel
     and contact_id = p_contact_id
     and dedupe_scope = 'lifetime'
   for update;
  v_has_row := (v_row.id is not null);

  -- 6. 先判 20 小时（即使授权已撤销也要判）。
  if v_has_row
     and v_row.status = 'pending'
     and v_row.first_attempt_at is not null
     and now() - v_row.first_attempt_at > interval '20 hours' then
    update public.triggered_sends
       set status = 'unknown_outcome',
           provider_impact = 'PROVIDER_UNKNOWN',
           reason_code = 'expired_20h'
     where id = v_row.id;
    return query select 'expired_unknown'::text, v_row.id, 'unknown_outcome'::text, v_row.idempotency_key;
    return;
  end if;

  -- 7. 锁内重读授权并加共享锁，校验仍有效。
  select * into v_auth
    from public.triggered_send_authorizations
   where id = p_authorization_id
   for share;
  if v_auth.revoked_at is not null
     or v_auth.activated_at is null
     or v_auth.authorized_at is null
     or v_auth.expires_at <= now() then
    return query select 'auth_inactive'::text, null::uuid, null::text, null::text; -- 授权无效
    return;
  end if;

  -- 7a.（20261117 新增）带信清单的授权只能走 triggered_send_claim_letter，不许在这里写 lifetime 行。
  if v_auth.rule #> '{send,letters}' is not null then
    return query select 'auth_inactive'::text, null::uuid, null::text, null::text;
    return;
  end if;

  -- 8. 规则时区必须存在且是 IANA 时区名（缺了或写法不对就拒，不回落默认）。
  v_tz := nullif(btrim(coalesce(v_auth.rule #>> '{schedule,timezone}', '')), '');
  -- 只接受 pg_timezone_names 里有的名字：'+13'、'UTC+13' 这类 POSIX 写法的正负号是反的，会把本地日算错一天。
  if v_tz is null or not exists (select 1 from pg_catalog.pg_timezone_names n where n.name = v_tz) then
    return query select 'rule_invalid'::text, v_row.id, v_row.status, v_row.idempotency_key;
    return;
  end if;
  v_day := (now() at time zone v_tz)::date;

  -- 9. 模板指纹必须与授权绑定的一致。
  if p_template_version is distinct from v_auth.template_version
     or p_template_sha256 is distinct from v_auth.template_sha256 then
    return query select 'template_mismatch'::text, v_row.id, v_row.status, v_row.idempotency_key;
    return;
  end if;

  -- 10. 已有行：pending 走租约/接管；终态直接返回；blocked 继续往下重新认领。
  if v_has_row then
    if v_row.status = 'pending' then
      if v_row.lease_expires_at is not null and v_row.lease_expires_at > now() then
        return query select 'in_flight'::text, v_row.id, 'pending'::text, v_row.idempotency_key;
        return;
      else
        -- 接管只发生在「同一份授权、同一份渲染结果」时：换了授权（旧内容 + 新授权）或重新渲染的结果变了，
        -- 都不许用原幂等键重发；行继续留在 pending，20 小时后转 unknown_outcome 由人核对。
        if v_row.authorization_id is distinct from p_authorization_id
           or v_row.rendered_sha256 is distinct from p_rendered_sha256 then
          return query select 'in_flight'::text, v_row.id, 'pending'::text, v_row.idempotency_key;
          return;
        end if;
        -- 接管：不改 first_attempt_at 和 idempotency_key。
        update public.triggered_sends
           set lease_expires_at = now() + make_interval(mins => p_lease_minutes),
               attempts = attempts + 1
         where id = v_row.id;
        return query select 'takeover'::text, v_row.id, 'pending'::text, v_row.idempotency_key;
        return;
      end if;
    elsif v_row.status <> 'blocked' then
      return query select 'exists_terminal'::text, v_row.id, v_row.status, v_row.idempotency_key;
      return;
    end if;
    -- status = 'blocked'：继续往下走重新认领。
  end if;

  -- 11. 同一地址是否已被欢迎过（别的联系人）。
  select count(*) into v_dup
    from public.triggered_sends
   where client_id = v_client_id
     and trigger_key = v_trigger_key
     and channel = v_channel
     and dedupe_scope = 'lifetime'
     and to_address_sha256 = p_to_address_sha256
     and (v_row.id is null or id <> v_row.id)
     and (status in ('pending','unknown_outcome','sent','delivery_delayed','delivered','suppressed','bounced','complained')
          or (status = 'failed' and reason_code = 'not_sent_confirmed'));
  if v_dup > 0 then
    return query select 'address_duplicate'::text, v_row.id, v_row.status, null::text;
    return;
  end if;

  -- 12. 日上限：上限取授权行里的 daily_cap，不信调用方。
  select count(*) into v_used
    from public.triggered_sends
   where client_id = v_client_id
     and trigger_key = v_trigger_key
     and channel = v_channel
     and dedupe_scope = 'lifetime'
     and local_day = v_day
     and status in ('pending','unknown_outcome','sent','delivery_delayed','delivered','suppressed','bounced','complained');
  if v_used >= v_auth.daily_cap then
    return query select 'cap_reached'::text, v_row.id, v_row.status, null::text;
    return;
  end if;

  -- 13. 认领（先设认领标记，写完立刻复位）。
  perform set_config('app.triggered_send_claim', 'on', true);

  if v_has_row then
    -- blocked 行重新认领：清掉陈旧字段。
    update public.triggered_sends
       set status = 'pending',
           authorization_id = p_authorization_id,
           template_key = p_template_key,
           template_version = p_template_version,
           template_sha256 = p_template_sha256,
           rendered_sha256 = p_rendered_sha256,
           to_address_sha256 = p_to_address_sha256,
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
           last_block_reason = null,
           bounce_kind = null,
           sent_at = null,
           last_event_type = null,
           last_event_at = null
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
      rendered_sha256, to_address_sha256, idempotency_key, consent_basis,
      source_ref, local_day, first_attempt_at, claimed_at, lease_expires_at, attempts
    ) values (
      v_client_id, v_trigger_key, v_channel, p_contact_id, 'lifetime', 'pending',
      p_authorization_id, p_template_key, p_template_version, p_template_sha256,
      p_rendered_sha256, p_to_address_sha256, p_idempotency_key, p_consent_basis,
      p_source_ref, v_day, now(), now(), now() + make_interval(mins => p_lease_minutes), 1
    )
    returning id into v_id;
  end if;

  perform set_config('app.triggered_send_claim', '', true);

  -- 14. 认领成功。
  return query select 'claimed'::text, v_id, 'pending'::text, p_idempotency_key;
  return;
end;
$$;

revoke execute on function public.triggered_send_claim(uuid, uuid, text, text, text, integer, text, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.triggered_send_claim(uuid, uuid, text, text, text, integer, text, text, text, text, integer) to service_role;
