-- service-role only; apply only after explicit PM approval.
-- CRM booking payment tracker: bookings, per-booking payment milestones (deposit / balance),
-- and an append-only audit log. Progress only — no money amounts are stored anywhere.
-- Design doc: docs/specs/2026-10-12-crm-booking-payment-tracker-design-v0.2.md
-- Requires: public.contacts(id uuid, client_id uuid) and the tour catalog tables
-- (public.tour_catalog_tours, public.tour_catalog_departures) must already exist.

-- ---------------------------------------------------------------------------
-- 1. Who may use the booking tracker besides Magic Engine global admins (default: nobody)
-- ---------------------------------------------------------------------------
create table public.crm_booking_members (
  client_id uuid not null references public.clients(id),
  email text not null check (email = lower(btrim(email)) and length(email) between 3 and 254),
  granted_by text not null check (length(btrim(granted_by)) > 0),
  created_at timestamptz not null default now(),
  primary key (client_id, email)
);

alter table public.crm_booking_members enable row level security;

create policy crm_booking_members_service_role
  on public.crm_booking_members
  for all
  to service_role
  using (true)
  with check (true);

revoke all on public.crm_booking_members from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Bookings: one contact booked one tour (optionally a specific departure)
-- ---------------------------------------------------------------------------
create table public.crm_bookings (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  contact_id uuid not null references public.contacts(id) on delete cascade,
  -- No foreign key: the tour catalog hard-deletes rows.
  tour_id uuid not null,
  -- No foreign key: same reason as tour_id.
  departure_id uuid,
  -- Snapshot of the catalog depart_on, copied on write; survives catalog deletion and
  -- records which departure date the due dates were confirmed against.
  departure_depart_on date,
  booked_on date not null,
  party_size smallint check (party_size is null or party_size between 1 and 60),
  is_cruise boolean not null default false,
  status text not null default 'active' check (status in ('active','cancelled')),
  cancel_note text check (cancel_note is null or length(cancel_note) <= 200),
  note text check (note is null or length(note) <= 500),
  created_by text not null check (length(btrim(created_by)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (status = 'active' and cancel_note is null)
    or (status = 'cancelled' and cancel_note is not null and length(btrim(cancel_note)) > 0)
  ),
  check (departure_id is null or departure_depart_on is not null)
);

-- One active booking per contact / tour / departure; a null departure is treated as its own slot.
create unique index crm_bookings_one_active_idx
  on public.crm_bookings (
    client_id,
    contact_id,
    tour_id,
    coalesce(departure_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where status = 'active';

create index crm_bookings_client_contact_idx
  on public.crm_bookings (client_id, contact_id);

create index crm_bookings_client_tour_idx
  on public.crm_bookings (client_id, tour_id);

alter table public.crm_bookings enable row level security;

create policy crm_bookings_service_role
  on public.crm_bookings
  for all
  to service_role
  using (true)
  with check (true);

revoke all on public.crm_bookings from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Milestones: exactly two rows per booking (deposit, balance)
-- ---------------------------------------------------------------------------
create table public.crm_booking_milestones (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.crm_bookings(id) on delete cascade,
  client_id uuid not null references public.clients(id),
  kind text not null check (kind in ('deposit','balance')),
  state text not null default 'unpaid' check (state in ('unpaid','paid')),
  paid_on date,
  paid_source text check (paid_source is null or paid_source in ('staff','email')),
  -- Email reference (<message_id>:<kind>); kept when a milestone is un-paid so the same
  -- email can never tick it a second time. Evidence ref is permanent per email by design; staff tick is the recovery path.
  paid_evidence_ref text check (paid_evidence_ref is null or length(paid_evidence_ref) <= 300),
  due_override_on date,
  due_override_depart_on date,
  remind_after date,
  nudged_on date,
  quiet boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (booking_id, kind),
  check (
    (state = 'paid' and paid_on is not null and paid_source is not null)
    or (state = 'unpaid' and paid_on is null and paid_source is null)
  ),
  -- An email tick must always carry its email reference (staff ticks may keep an old one).
  check (paid_source is distinct from 'email' or paid_evidence_ref is not null)
);

-- One email reference may tick at most one milestone per client.
create unique index crm_booking_milestones_evidence_idx
  on public.crm_booking_milestones (client_id, paid_evidence_ref)
  where paid_evidence_ref is not null;

create index crm_booking_milestones_client_state_idx
  on public.crm_booking_milestones (client_id, state);

alter table public.crm_booking_milestones enable row level security;

create policy crm_booking_milestones_service_role
  on public.crm_booking_milestones
  for all
  to service_role
  using (true)
  with check (true);

revoke all on public.crm_booking_milestones from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Audit log: append-only history of booking and milestone changes
-- ---------------------------------------------------------------------------
create table public.crm_booking_events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  -- Plain uuid, no foreign key: deleting a contact cascades the booking away, but the
  -- audit rows must survive (and must not block the delete).
  booking_id uuid not null,
  milestone_kind text check (milestone_kind is null or milestone_kind in ('deposit','balance')),
  action text not null check (action in (
    'created','edited','cancelled','milestone_paid','milestone_unpaid','due_overridden',
    'departure_confirmed','auto_tick_proposed','auto_tick_rejected',
    'milestone_created','milestone_deleted','booking_deleted','actor_erased'
  )),
  detail jsonb not null default '{}',
  actor_email text,
  source text not null check (source in ('staff','email','system')),
  created_at timestamptz not null default clock_timestamp()  -- real order for events written in one transaction
);

create index crm_booking_events_client_booking_created_idx
  on public.crm_booking_events (client_id, booking_id, created_at);

alter table public.crm_booking_events enable row level security;

create policy crm_booking_events_service_role
  on public.crm_booking_events
  for all
  to service_role
  using (true)
  with check (true);

revoke all on public.crm_booking_events from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. updated_at touch trigger
-- ---------------------------------------------------------------------------
create function public.crm_booking_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

revoke all on function public.crm_booking_touch_updated_at() from public, anon, authenticated;
grant execute on function public.crm_booking_touch_updated_at() to service_role;

create trigger crm_bookings_touch_updated_at
  before update on public.crm_bookings
  for each row
  execute function public.crm_booking_touch_updated_at();

create trigger crm_booking_milestones_touch_updated_at
  before update on public.crm_booking_milestones
  for each row
  execute function public.crm_booking_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 5b. Clear the transaction-local session settings the write functions set.
-- (Function-level SET on custom settings needs elevated rights on hosted Postgres, so each
-- write function calls this right before it returns.)
-- ---------------------------------------------------------------------------
create function public.crm_booking_clear_settings()
returns void
language plpgsql
as $$
begin
  perform set_config('crm_booking.actor', '', true);
  perform set_config('crm_booking.source', '', true);
  perform set_config('crm_booking.action', '', true);
end;
$$;

revoke all on function public.crm_booking_clear_settings() from public, anon, authenticated;
grant execute on function public.crm_booking_clear_settings() to service_role;

-- ---------------------------------------------------------------------------
-- 6. Audit triggers
-- Session settings (transaction-local, set by the write functions):
--   crm_booking.actor  -> events.actor_email
--   crm_booking.source -> events.source ('staff' | 'email' | 'system')
--   crm_booking.action -> optional action hint for booking UPDATE events
-- ---------------------------------------------------------------------------
create function public.crm_booking_audit_booking()
returns trigger
language plpgsql
as $$
declare
  v_actor text := nullif(current_setting('crm_booking.actor', true), '');
  v_source text := coalesce(nullif(current_setting('crm_booking.source', true), ''), 'system');
  v_action text;
  v_changed text[] := array[]::text[];
  v_detail jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.crm_booking_events (
      client_id, booking_id, action, detail, actor_email, source
    )
    values (
      new.client_id,
      new.id,
      'created',
      jsonb_build_object(
        'tour_id', new.tour_id,
        'departure_id', new.departure_id,
        'departure_depart_on', new.departure_depart_on,
        'booked_on', new.booked_on,
        'party_size', new.party_size,
        'is_cruise', new.is_cruise,
        'has_note', new.note is not null
      ),
      v_actor,
      v_source
    );
    return new;
  end if;

  if tg_op = 'DELETE' then
    insert into public.crm_booking_events (
      client_id, booking_id, action, detail, actor_email, source
    )
    values (
      old.client_id,
      old.id,
      'booking_deleted',
      jsonb_build_object(
        'status', old.status,
        'tour_id', old.tour_id,
        'departure_id', old.departure_id,
        'has_note', old.note is not null
      ),
      v_actor,
      v_source
    );
    return old;
  end if;

  if old.tour_id is distinct from new.tour_id then
    v_changed := v_changed || 'tour_id'::text;
  end if;
  if old.departure_id is distinct from new.departure_id then
    v_changed := v_changed || 'departure_id'::text;
  end if;
  if old.departure_depart_on is distinct from new.departure_depart_on then
    v_changed := v_changed || 'departure_depart_on'::text;
  end if;
  if old.booked_on is distinct from new.booked_on then
    v_changed := v_changed || 'booked_on'::text;
  end if;
  if old.party_size is distinct from new.party_size then
    v_changed := v_changed || 'party_size'::text;
  end if;
  if old.is_cruise is distinct from new.is_cruise then
    v_changed := v_changed || 'is_cruise'::text;
  end if;
  if old.note is distinct from new.note then
    v_changed := v_changed || 'note'::text;
  end if;
  if old.status is distinct from new.status then
    v_changed := v_changed || 'status'::text;
  end if;
  if old.cancel_note is distinct from new.cancel_note then
    v_changed := v_changed || 'cancel_note'::text;
  end if;

  if array_length(v_changed, 1) is null then
    return new;
  end if;

  if old.status = 'active' and new.status = 'cancelled' then
    v_action := 'cancelled';
  else
    v_action := coalesce(nullif(current_setting('crm_booking.action', true), ''), 'edited');
  end if;

  -- Note and cancel_note text is never copied into detail; only the field name appears.
  v_detail := jsonb_build_object('changed_fields', to_jsonb(v_changed));

  if old.departure_depart_on is distinct from new.departure_depart_on then
    v_detail := v_detail || jsonb_build_object(
      'old_departure_depart_on', old.departure_depart_on,
      'new_departure_depart_on', new.departure_depart_on
    );
  end if;
  if old.booked_on is distinct from new.booked_on then
    v_detail := v_detail || jsonb_build_object(
      'old_booked_on', old.booked_on,
      'new_booked_on', new.booked_on
    );
  end if;
  if old.party_size is distinct from new.party_size then
    v_detail := v_detail || jsonb_build_object(
      'old_party_size', old.party_size,
      'new_party_size', new.party_size
    );
  end if;
  if old.is_cruise is distinct from new.is_cruise then
    v_detail := v_detail || jsonb_build_object(
      'old_is_cruise', old.is_cruise,
      'new_is_cruise', new.is_cruise
    );
  end if;
  if old.tour_id is distinct from new.tour_id then
    v_detail := v_detail || jsonb_build_object(
      'old_tour_id', old.tour_id,
      'new_tour_id', new.tour_id
    );
  end if;
  if old.departure_id is distinct from new.departure_id then
    v_detail := v_detail || jsonb_build_object(
      'old_departure_id', old.departure_id,
      'new_departure_id', new.departure_id
    );
  end if;
  if old.status = 'active' and new.status = 'cancelled' then
    v_detail := v_detail || jsonb_build_object('has_cancel_note', true);
  end if;

  insert into public.crm_booking_events (
    client_id, booking_id, action, detail, actor_email, source
  )
  values (
    new.client_id,
    new.id,
    v_action,
    v_detail,
    v_actor,
    v_source
  );

  return new;
end;
$$;

revoke all on function public.crm_booking_audit_booking() from public, anon, authenticated;
grant execute on function public.crm_booking_audit_booking() to service_role;

create trigger crm_bookings_audit
  after insert or update or delete on public.crm_bookings
  for each row
  execute function public.crm_booking_audit_booking();

create function public.crm_booking_audit_milestone()
returns trigger
language plpgsql
as $$
declare
  v_actor text := nullif(current_setting('crm_booking.actor', true), '');
  v_source text := coalesce(nullif(current_setting('crm_booking.source', true), ''), 'system');
  v_changed text[] := array[]::text[];
begin
  if tg_op = 'INSERT' then
    insert into public.crm_booking_events (
      client_id, booking_id, milestone_kind, action, detail, actor_email, source
    )
    values (
      new.client_id,
      new.booking_id,
      new.kind,
      'milestone_created',
      jsonb_build_object('kind', new.kind),
      v_actor,
      v_source
    );
    return new;
  end if;

  if tg_op = 'DELETE' then
    insert into public.crm_booking_events (
      client_id, booking_id, milestone_kind, action, detail, actor_email, source
    )
    values (
      old.client_id,
      old.booking_id,
      old.kind,
      'milestone_deleted',
      jsonb_build_object(
        'kind', old.kind,
        'state', old.state,
        'had_evidence_ref', old.paid_evidence_ref is not null
      ),
      v_actor,
      v_source
    );
    return old;
  end if;

  if old.state = 'unpaid' and new.state = 'paid' then
    insert into public.crm_booking_events (
      client_id, booking_id, milestone_kind, action, detail, actor_email, source
    )
    values (
      new.client_id,
      new.booking_id,
      new.kind,
      'milestone_paid',
      jsonb_build_object(
        'paid_on', new.paid_on,
        'paid_source', new.paid_source,
        'has_evidence_ref', new.paid_evidence_ref is not null
      ),
      v_actor,
      v_source
    );
  end if;

  if old.state = 'paid' and new.state = 'unpaid' then
    insert into public.crm_booking_events (
      client_id, booking_id, milestone_kind, action, detail, actor_email, source
    )
    values (
      new.client_id,
      new.booking_id,
      new.kind,
      'milestone_unpaid',
      jsonb_build_object(
        'previous_paid_on', old.paid_on,
        'previous_paid_source', old.paid_source
      ),
      v_actor,
      v_source
    );
  end if;

  if old.due_override_on is distinct from new.due_override_on then
    insert into public.crm_booking_events (
      client_id, booking_id, milestone_kind, action, detail, actor_email, source
    )
    values (
      new.client_id,
      new.booking_id,
      new.kind,
      'due_overridden',
      jsonb_build_object(
        'old_due_override_on', old.due_override_on,
        'new_due_override_on', new.due_override_on,
        'due_override_depart_on', new.due_override_depart_on
      ),
      v_actor,
      v_source
    );
  end if;

  if old.remind_after is distinct from new.remind_after then
    v_changed := v_changed || 'remind_after'::text;
  end if;
  if old.nudged_on is distinct from new.nudged_on then
    v_changed := v_changed || 'nudged_on'::text;
  end if;
  if old.quiet is distinct from new.quiet then
    v_changed := v_changed || 'quiet'::text;
  end if;

  if array_length(v_changed, 1) is not null then
    insert into public.crm_booking_events (
      client_id, booking_id, milestone_kind, action, detail, actor_email, source
    )
    values (
      new.client_id,
      new.booking_id,
      new.kind,
      'edited',
      jsonb_build_object(
        'changed_fields', to_jsonb(v_changed),
        'remind_after', new.remind_after,
        'nudged_on', new.nudged_on,
        'quiet', new.quiet
      ),
      v_actor,
      v_source
    );
  end if;

  return new;
end;
$$;

revoke all on function public.crm_booking_audit_milestone() from public, anon, authenticated;
grant execute on function public.crm_booking_audit_milestone() to service_role;

create trigger crm_booking_milestones_audit
  after insert or update or delete on public.crm_booking_milestones
  for each row
  execute function public.crm_booking_audit_milestone();

-- ---------------------------------------------------------------------------
-- 7. The audit log is history: rows can be added, never changed or removed.
-- The one exception is the erasure path: the UPDATE row trigger lets a statement through
-- only when the transaction-local flag crm_booking.erase = 'on' (set solely by the erase
-- function) AND the only change is actor_email -> null. Chosen over SECURITY DEFINER
-- because the repo has a convention (and a test) of no SECURITY DEFINER functions.
-- ---------------------------------------------------------------------------
create function public.crm_booking_events_append_only()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE'
     and current_setting('crm_booking.erase', true) = 'on'
     and new.actor_email is null
     and new.id = old.id
     and new.client_id = old.client_id
     and new.booking_id = old.booking_id
     and new.milestone_kind is not distinct from old.milestone_kind
     and new.action = old.action
     and new.detail = old.detail
     and new.source = old.source
     and new.created_at = old.created_at then
    return new;
  end if;

  raise exception 'crm_booking_events_append_only';
end;
$$;

revoke all on function public.crm_booking_events_append_only() from public, anon, authenticated;
grant execute on function public.crm_booking_events_append_only() to service_role;

create trigger crm_booking_events_append_only_row
  before update or delete on public.crm_booking_events
  for each row
  execute function public.crm_booking_events_append_only();

create trigger crm_booking_events_append_only_truncate
  before truncate on public.crm_booking_events
  for each statement
  execute function public.crm_booking_events_append_only();


-- ---------------------------------------------------------------------------
-- 8. Same-client reference check helper
--    Returns the departure's live depart_on (null when no departure is given).
-- ---------------------------------------------------------------------------
create function public.crm_booking_check_refs(
  p_client_id uuid,
  p_contact_id uuid,
  p_tour_id uuid,
  p_departure_id uuid
)
returns date
language plpgsql
as $$
declare
  v_depart_on date;
begin
  if p_contact_id is not null then
    if not exists (
      select 1 from public.contacts
       where id = p_contact_id
         and client_id = p_client_id
    ) then
      raise exception 'contact_not_found';
    end if;
  end if;

  if not exists (
    select 1 from public.tour_catalog_tours
     where id = p_tour_id
       and client_id = p_client_id
  ) then
    raise exception 'tour_not_found';
  end if;

  if p_departure_id is not null then
    select depart_on
      into v_depart_on
      from public.tour_catalog_departures
     where id = p_departure_id
       and client_id = p_client_id
       and tour_id = p_tour_id;

    if not found then
      raise exception 'departure_not_found';
    end if;
  end if;

  return v_depart_on;
end;
$$;

revoke all on function public.crm_booking_check_refs(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.crm_booking_check_refs(uuid, uuid, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 9. Create a booking (and its two milestones)
-- ---------------------------------------------------------------------------
create function public.crm_booking_create(
  p_client_id uuid,
  p_contact_id uuid,
  p_tour_id uuid,
  p_departure_id uuid,
  p_booked_on date,
  p_party_size smallint,
  p_is_cruise boolean,
  p_note text,
  p_actor text
)
returns jsonb
language plpgsql
as $$
declare
  v_actor text;
  v_depart_on date;
  v_booked_on date;
  v_note text;
  v_row public.crm_bookings;
  v_deposit_at timestamptz;
  v_balance_at timestamptz;
begin
  if p_actor is null or length(btrim(p_actor)) = 0 then
    raise exception 'invalid_actor';
  end if;

  v_actor := lower(btrim(p_actor));
  perform set_config('crm_booking.actor', v_actor, true);
  perform set_config('crm_booking.source', 'staff', true);

  v_depart_on := public.crm_booking_check_refs(p_client_id, p_contact_id, p_tour_id, p_departure_id);

  v_booked_on := coalesce(p_booked_on, (now() at time zone 'Pacific/Auckland')::date);
  v_note := nullif(btrim(coalesce(p_note, '')), '');

  begin
    insert into public.crm_bookings (
      client_id, contact_id, tour_id, departure_id, departure_depart_on,
      booked_on, party_size, is_cruise, note, created_by
    )
    values (
      p_client_id, p_contact_id, p_tour_id, p_departure_id, v_depart_on,
      v_booked_on, p_party_size, coalesce(p_is_cruise, false), v_note, v_actor
    )
    returning * into v_row;
  exception
    when unique_violation then
      raise exception 'duplicate_booking';
  end;

  -- Each object must get a distinct updated_at token: the booking and its two milestones are
  -- written in one transaction, so default now() would make all three identical and let a
  -- token taken from the wrong object pass the stale check.
  v_deposit_at := greatest(clock_timestamp(), v_row.updated_at + interval '1 microsecond');
  insert into public.crm_booking_milestones (booking_id, client_id, kind, updated_at)
  values (v_row.id, p_client_id, 'deposit', v_deposit_at);

  v_balance_at := greatest(clock_timestamp(), v_deposit_at + interval '1 microsecond');
  insert into public.crm_booking_milestones (booking_id, client_id, kind, updated_at)
  values (v_row.id, p_client_id, 'balance', v_balance_at);

  perform public.crm_booking_clear_settings();

  return to_jsonb(v_row);
end;
$$;

revoke all on function public.crm_booking_create(uuid, uuid, uuid, uuid, date, smallint, boolean, text, text) from public, anon, authenticated;
grant execute on function public.crm_booking_create(uuid, uuid, uuid, uuid, date, smallint, boolean, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 10. Edit a booking (milestones are untouched)
-- ---------------------------------------------------------------------------
create function public.crm_booking_update(
  p_client_id uuid,
  p_booking_id uuid,
  p_expected_updated_at timestamptz,
  p_patch jsonb,
  p_actor text
)
returns jsonb
language plpgsql
as $$
declare
  v_actor text;
  v_key text;
  v_row public.crm_bookings;
  v_next public.crm_bookings;
  v_tour_id uuid;
  v_departure_id uuid;
  v_depart_on date;
  v_party_size smallint;
  v_note text;
begin
  if p_actor is null or length(btrim(p_actor)) = 0 then
    raise exception 'invalid_actor';
  end if;

  if p_patch is not null and jsonb_typeof(p_patch) <> 'object' then
    raise exception 'invalid_patch:patch';
  end if;

  v_actor := lower(btrim(p_actor));
  perform set_config('crm_booking.actor', v_actor, true);
  perform set_config('crm_booking.source', 'staff', true);

  for v_key in select jsonb_object_keys(coalesce(p_patch, '{}'::jsonb))
  loop
    if v_key not in ('tour_id', 'departure_id', 'booked_on', 'party_size', 'is_cruise', 'note') then
      raise exception 'field_not_editable:%', v_key;
    end if;
  end loop;

  if p_patch ? 'tour_id' and p_patch->'tour_id' = 'null'::jsonb then
    raise exception 'invalid_null:%', 'tour_id';
  end if;

  if p_patch ? 'booked_on' and p_patch->'booked_on' = 'null'::jsonb then
    raise exception 'invalid_null:%', 'booked_on';
  end if;

  if p_patch ? 'is_cruise' and p_patch->'is_cruise' = 'null'::jsonb then
    raise exception 'invalid_null:%', 'is_cruise';
  end if;

  -- Validate patch values up front so malformed input never reaches a raw cast error.
  if p_patch ? 'tour_id' then
    begin
      v_tour_id := (p_patch->>'tour_id')::uuid;
    exception
      when data_exception then
        raise exception 'invalid_patch:tour_id';
    end;
  end if;

  if p_patch ? 'departure_id' then
    begin
      v_departure_id := nullif(p_patch->>'departure_id', '')::uuid;
    exception
      when data_exception then
        raise exception 'invalid_patch:departure_id';
    end;
  end if;

  if p_patch ? 'booked_on' then
    begin
      perform (p_patch->>'booked_on')::date;
    exception
      when data_exception then
        raise exception 'invalid_patch:booked_on';
    end;
  end if;

  if p_patch ? 'party_size' then
    begin
      v_party_size := nullif(p_patch->>'party_size', '')::smallint;
    exception
      when data_exception then
        raise exception 'invalid_patch:party_size';
    end;

    if v_party_size is not null and (v_party_size < 1 or v_party_size > 60) then
      raise exception 'invalid_patch:party_size';
    end if;
  end if;

  if p_patch ? 'is_cruise' then
    begin
      perform (p_patch->>'is_cruise')::boolean;
    exception
      when data_exception then
        raise exception 'invalid_patch:is_cruise';
    end;
  end if;

  if p_patch ? 'note' then
    if jsonb_typeof(p_patch->'note') not in ('string', 'null') then
      raise exception 'invalid_patch:note';
    end if;

    v_note := nullif(btrim(coalesce(p_patch->>'note', '')), '');

    if v_note is not null and length(v_note) > 500 then
      raise exception 'invalid_patch:note';
    end if;
  end if;

  select *
    into v_row
    from public.crm_bookings
   where id = p_booking_id
     and client_id = p_client_id
   for update;

  if not found then
    raise exception 'booking_not_found';
  end if;

  if v_row.status <> 'active' then
    raise exception 'booking_not_active';
  end if;

  if v_row.updated_at is distinct from p_expected_updated_at then
    raise exception 'conflict:stale:%', p_booking_id;
  end if;

  -- What the row would become. The expressions mirror the UPDATE below one for one.
  v_next := v_row;
  v_next.tour_id := case when p_patch ? 'tour_id' then (p_patch->>'tour_id')::uuid else v_row.tour_id end;
  v_next.departure_id := case when p_patch ? 'departure_id' then nullif(p_patch->>'departure_id', '')::uuid else v_row.departure_id end;
  v_next.booked_on := case when p_patch ? 'booked_on' then (p_patch->>'booked_on')::date else v_row.booked_on end;
  v_next.party_size := case when p_patch ? 'party_size' then nullif(p_patch->>'party_size', '')::smallint else v_row.party_size end;
  v_next.is_cruise := case when p_patch ? 'is_cruise' then (p_patch->>'is_cruise')::boolean else v_row.is_cruise end;
  v_next.note := case when p_patch ? 'note' then nullif(btrim(coalesce(p_patch->>'note', '')), '') else v_row.note end;

  -- The final (tour_id, departure_id) pair must be valid for this client, but only when it
  -- changed: a note or party-size edit must keep working after the catalog hard-deleted a row.
  v_tour_id := v_next.tour_id;
  v_departure_id := v_next.departure_id;
  if v_tour_id is distinct from v_row.tour_id or v_departure_id is distinct from v_row.departure_id then
    v_depart_on := public.crm_booking_check_refs(p_client_id, null, v_tour_id, v_departure_id);
  end if;

  -- Snapshot rules: re-read when the departure is new or the tour changed; clear when the
  -- departure is cleared; leave alone when the departure is unchanged.
  if v_departure_id is null then
    v_next.departure_depart_on := null;
  elsif v_departure_id is distinct from v_row.departure_id
     or v_tour_id is distinct from v_row.tour_id then
    v_next.departure_depart_on := v_depart_on;
  else
    v_next.departure_depart_on := v_row.departure_depart_on;
  end if;

  if to_jsonb(v_next) = to_jsonb(v_row) then
    perform public.crm_booking_clear_settings();
    return to_jsonb(v_row);
  end if;

  begin
    update public.crm_bookings
       set tour_id = v_next.tour_id,
           departure_id = v_next.departure_id,
           departure_depart_on = v_next.departure_depart_on,
           booked_on = v_next.booked_on,
           party_size = v_next.party_size,
           is_cruise = v_next.is_cruise,
           note = v_next.note
     where id = p_booking_id
       and client_id = p_client_id
     returning * into v_row;
  exception
    when unique_violation then
      raise exception 'duplicate_booking';
  end;

  perform public.crm_booking_clear_settings();

  return to_jsonb(v_row);
end;
$$;

revoke all on function public.crm_booking_update(uuid, uuid, timestamptz, jsonb, text) from public, anon, authenticated;
grant execute on function public.crm_booking_update(uuid, uuid, timestamptz, jsonb, text) to service_role;

-- ---------------------------------------------------------------------------
-- 11. Mark a milestone paid
-- ---------------------------------------------------------------------------
create function public.crm_booking_set_paid(
  p_client_id uuid,
  p_booking_id uuid,
  p_kind text,
  p_expected_updated_at timestamptz,
  p_paid_on date,
  p_paid_source text,
  p_evidence_ref text,
  p_server_detector boolean,
  p_actor text
)
returns jsonb
language plpgsql
as $$
declare
  v_actor text;
  v_booking public.crm_bookings;
  v_row public.crm_booking_milestones;
  v_paid_on date;
  v_evidence text;
begin
  if p_actor is null or length(btrim(p_actor)) = 0 then
    raise exception 'invalid_actor';
  end if;

  -- Checked before any row is read.
  if p_paid_source = 'email' and p_server_detector is not true then
    raise exception 'email_source_requires_server_detector';
  end if;

  if p_kind is null or p_kind not in ('deposit', 'balance') then
    raise exception 'invalid_kind';
  end if;

  if p_paid_source is null or p_paid_source not in ('staff', 'email') then
    raise exception 'invalid_paid_source';
  end if;

  v_evidence := nullif(btrim(coalesce(p_evidence_ref, '')), '');

  if p_paid_source = 'email' and v_evidence is null then
    raise exception 'evidence_required';
  end if;

  if p_paid_source = 'staff' and p_evidence_ref is not null then
    raise exception 'evidence_only_for_email';
  end if;

  v_actor := lower(btrim(p_actor));
  perform set_config('crm_booking.actor', v_actor, true);
  perform set_config('crm_booking.source', p_paid_source, true);

  select *
    into v_booking
    from public.crm_bookings
   where id = p_booking_id
     and client_id = p_client_id
   for update;

  if not found then
    raise exception 'booking_not_found';
  end if;

  if v_booking.status <> 'active' then
    raise exception 'booking_not_active';
  end if;

  select *
    into v_row
    from public.crm_booking_milestones
   where booking_id = p_booking_id
     and kind = p_kind
     and client_id = p_client_id
   for update;

  if not found then
    raise exception 'milestone_not_found';
  end if;

  if v_row.updated_at is distinct from p_expected_updated_at then
    raise exception 'conflict:stale:%', v_row.id;
  end if;

  if v_row.state = 'paid' then
    perform public.crm_booking_clear_settings();
    return jsonb_build_object('changed', false, 'reason', 'already_paid', 'milestone', to_jsonb(v_row));
  end if;

  if v_evidence is not null then
    if v_evidence = v_row.paid_evidence_ref then
      perform public.crm_booking_clear_settings();
      return jsonb_build_object('changed', false, 'reason', 'evidence_already_used', 'milestone', to_jsonb(v_row));
    end if;

    if exists (
      select 1 from public.crm_booking_milestones
       where client_id = p_client_id
         and paid_evidence_ref = v_evidence
    ) then
      perform public.crm_booking_clear_settings();
      return jsonb_build_object('changed', false, 'reason', 'evidence_already_used', 'milestone', to_jsonb(v_row));
    end if;
  end if;

  v_paid_on := coalesce(p_paid_on, (now() at time zone 'Pacific/Auckland')::date);

  begin
    update public.crm_booking_milestones
       set state = 'paid',
           paid_on = v_paid_on,
           paid_source = p_paid_source,
           paid_evidence_ref = coalesce(v_evidence, v_row.paid_evidence_ref)
     where id = v_row.id
       and client_id = p_client_id
     returning * into v_row;
  exception
    when unique_violation then
      perform public.crm_booking_clear_settings();
      return jsonb_build_object('changed', false, 'reason', 'evidence_already_used', 'milestone', to_jsonb(v_row));
  end;

  perform public.crm_booking_clear_settings();

  return jsonb_build_object('changed', true, 'reason', null, 'milestone', to_jsonb(v_row));
end;
$$;

revoke all on function public.crm_booking_set_paid(uuid, uuid, text, timestamptz, date, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.crm_booking_set_paid(uuid, uuid, text, timestamptz, date, text, text, boolean, text) to service_role;

-- ---------------------------------------------------------------------------
-- 12. Mark a milestone unpaid (the evidence ref is deliberately kept)
-- ---------------------------------------------------------------------------
create function public.crm_booking_unset_paid(
  p_client_id uuid,
  p_booking_id uuid,
  p_kind text,
  p_expected_updated_at timestamptz,
  p_actor text
)
returns jsonb
language plpgsql
as $$
declare
  v_actor text;
  v_booking public.crm_bookings;
  v_row public.crm_booking_milestones;
begin
  if p_actor is null or length(btrim(p_actor)) = 0 then
    raise exception 'invalid_actor';
  end if;

  if p_kind is null or p_kind not in ('deposit', 'balance') then
    raise exception 'invalid_kind';
  end if;

  v_actor := lower(btrim(p_actor));
  perform set_config('crm_booking.actor', v_actor, true);
  perform set_config('crm_booking.source', 'staff', true);

  select *
    into v_booking
    from public.crm_bookings
   where id = p_booking_id
     and client_id = p_client_id
   for update;

  if not found then
    raise exception 'booking_not_found';
  end if;

  if v_booking.status <> 'active' then
    raise exception 'booking_not_active';
  end if;

  select *
    into v_row
    from public.crm_booking_milestones
   where booking_id = p_booking_id
     and kind = p_kind
     and client_id = p_client_id
   for update;

  if not found then
    raise exception 'milestone_not_found';
  end if;

  if v_row.updated_at is distinct from p_expected_updated_at then
    raise exception 'conflict:stale:%', v_row.id;
  end if;

  if v_row.state <> 'paid' then
    raise exception 'not_paid';
  end if;

  update public.crm_booking_milestones
     set state = 'unpaid',
         paid_on = null,
         paid_source = null
   where id = v_row.id
     and client_id = p_client_id
   returning * into v_row;

  perform public.crm_booking_clear_settings();

  return to_jsonb(v_row);
end;
$$;

revoke all on function public.crm_booking_unset_paid(uuid, uuid, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.crm_booking_unset_paid(uuid, uuid, text, timestamptz, text) to service_role;


-- ---------------------------------------------------------------------------
-- 13. Override a milestone's due date
-- ---------------------------------------------------------------------------
create function public.crm_booking_override_due(
  p_client_id uuid,
  p_booking_id uuid,
  p_kind text,
  p_expected_updated_at timestamptz,
  p_due_override_on date,
  p_actor text
)
returns jsonb
language plpgsql
as $$
declare
  v_actor text;
  v_booking public.crm_bookings;
  v_row public.crm_booking_milestones;
  v_depart_on date;
begin
  if p_actor is null or length(btrim(p_actor)) = 0 then
    raise exception 'invalid_actor';
  end if;

  if p_kind is null or p_kind not in ('deposit', 'balance') then
    raise exception 'invalid_kind';
  end if;

  v_actor := lower(btrim(p_actor));
  perform set_config('crm_booking.actor', v_actor, true);
  perform set_config('crm_booking.source', 'staff', true);

  select *
    into v_booking
    from public.crm_bookings
   where id = p_booking_id
     and client_id = p_client_id
   for update;

  if not found then
    raise exception 'booking_not_found';
  end if;

  if v_booking.status <> 'active' then
    raise exception 'booking_not_active';
  end if;

  select *
    into v_row
    from public.crm_booking_milestones
   where booking_id = p_booking_id
     and kind = p_kind
     and client_id = p_client_id
   for update;

  if not found then
    raise exception 'milestone_not_found';
  end if;

  if v_row.updated_at is distinct from p_expected_updated_at then
    raise exception 'conflict:stale:%', v_row.id;
  end if;

  if p_due_override_on is null then
    if v_row.due_override_on is null and v_row.due_override_depart_on is null then
      perform public.crm_booking_clear_settings();
      return to_jsonb(v_row);
    end if;

    update public.crm_booking_milestones
       set due_override_on = null,
           due_override_depart_on = null
     where id = v_row.id
       and client_id = p_client_id
     returning * into v_row;

    perform public.crm_booking_clear_settings();

    return to_jsonb(v_row);
  end if;

  -- Prefer the live catalog depart_on; fall back to the booking's snapshot.
  v_depart_on := null;
  if v_booking.departure_id is not null then
    select depart_on
      into v_depart_on
      from public.tour_catalog_departures
     where id = v_booking.departure_id
       and client_id = p_client_id
       and tour_id = v_booking.tour_id;
  end if;

  if v_depart_on is null then
    v_depart_on := v_booking.departure_depart_on;
  end if;

  if v_row.due_override_on is not distinct from p_due_override_on
     and v_row.due_override_depart_on is not distinct from v_depart_on then
    perform public.crm_booking_clear_settings();
    return to_jsonb(v_row);
  end if;

  update public.crm_booking_milestones
     set due_override_on = p_due_override_on,
         due_override_depart_on = v_depart_on
   where id = v_row.id
     and client_id = p_client_id
   returning * into v_row;

  perform public.crm_booking_clear_settings();

  return to_jsonb(v_row);
end;
$$;

revoke all on function public.crm_booking_override_due(uuid, uuid, text, timestamptz, date, text) from public, anon, authenticated;
grant execute on function public.crm_booking_override_due(uuid, uuid, text, timestamptz, date, text) to service_role;

-- ---------------------------------------------------------------------------
-- 14. Confirm a booking's departure date against the live catalog
-- ---------------------------------------------------------------------------
create function public.crm_booking_confirm_departure(
  p_client_id uuid,
  p_booking_id uuid,
  p_expected_updated_at timestamptz,
  p_actor text
)
returns jsonb
language plpgsql
as $$
declare
  v_actor text;
  v_row public.crm_bookings;
  v_depart_on date;
begin
  if p_actor is null or length(btrim(p_actor)) = 0 then
    raise exception 'invalid_actor';
  end if;

  v_actor := lower(btrim(p_actor));
  perform set_config('crm_booking.actor', v_actor, true);
  perform set_config('crm_booking.source', 'staff', true);

  select *
    into v_row
    from public.crm_bookings
   where id = p_booking_id
     and client_id = p_client_id
   for update;

  if not found then
    raise exception 'booking_not_found';
  end if;

  if v_row.status <> 'active' then
    raise exception 'booking_not_active';
  end if;

  if v_row.updated_at is distinct from p_expected_updated_at then
    raise exception 'conflict:stale:%', v_row.id;
  end if;

  if v_row.departure_id is null then
    raise exception 'departure_not_found';
  end if;

  select depart_on
    into v_depart_on
    from public.tour_catalog_departures
   where id = v_row.departure_id
     and client_id = p_client_id
     and tour_id = v_row.tour_id;

  if not found then
    raise exception 'departure_not_found';
  end if;

  if v_row.departure_depart_on is not distinct from v_depart_on then
    perform public.crm_booking_clear_settings();
    return to_jsonb(v_row);
  end if;

  perform set_config('crm_booking.action', 'departure_confirmed', true);

  update public.crm_bookings
     set departure_depart_on = v_depart_on
   where id = p_booking_id
     and client_id = p_client_id
   returning * into v_row;

  perform public.crm_booking_clear_settings();

  return to_jsonb(v_row);
end;
$$;

revoke all on function public.crm_booking_confirm_departure(uuid, uuid, timestamptz, text) from public, anon, authenticated;
grant execute on function public.crm_booking_confirm_departure(uuid, uuid, timestamptz, text) to service_role;

-- ---------------------------------------------------------------------------
-- 15. Nudge / snooze / quiet a milestone
-- ---------------------------------------------------------------------------
create function public.crm_booking_nudge(
  p_client_id uuid,
  p_booking_id uuid,
  p_kind text,
  p_expected_updated_at timestamptz,
  p_mode text,
  p_days integer,
  p_actor text
)
returns jsonb
language plpgsql
as $$
declare
  v_actor text;
  v_booking public.crm_bookings;
  v_row public.crm_booking_milestones;
  v_today date;
begin
  if p_actor is null or length(btrim(p_actor)) = 0 then
    raise exception 'invalid_actor';
  end if;

  if p_kind is null or p_kind not in ('deposit', 'balance') then
    raise exception 'invalid_kind';
  end if;

  if p_mode is null or p_mode not in ('nudged_today', 'snooze', 'quiet') then
    raise exception 'invalid_mode';
  end if;

  if p_mode = 'snooze' and (p_days is null or p_days not in (3, 7, 14)) then
    raise exception 'invalid_days';
  end if;

  v_actor := lower(btrim(p_actor));
  perform set_config('crm_booking.actor', v_actor, true);
  perform set_config('crm_booking.source', 'staff', true);

  select *
    into v_booking
    from public.crm_bookings
   where id = p_booking_id
     and client_id = p_client_id
   for update;

  if not found then
    raise exception 'booking_not_found';
  end if;

  if v_booking.status <> 'active' then
    raise exception 'booking_not_active';
  end if;

  select *
    into v_row
    from public.crm_booking_milestones
   where booking_id = p_booking_id
     and kind = p_kind
     and client_id = p_client_id
   for update;

  if not found then
    raise exception 'milestone_not_found';
  end if;

  if v_row.updated_at is distinct from p_expected_updated_at then
    raise exception 'conflict:stale:%', v_row.id;
  end if;

  v_today := (now() at time zone 'Pacific/Auckland')::date;

  if p_mode = 'nudged_today' then
    if v_row.nudged_on is not distinct from v_today
       and v_row.remind_after is not distinct from (v_today + 1) then
      perform public.crm_booking_clear_settings();
      return to_jsonb(v_row);
    end if;

    update public.crm_booking_milestones
       set nudged_on = v_today,
           remind_after = v_today + 1
     where id = v_row.id
       and client_id = p_client_id
     returning * into v_row;

    perform public.crm_booking_clear_settings();

    return to_jsonb(v_row);
  end if;

  if p_mode = 'snooze' then
    if v_row.remind_after is not distinct from (v_today + p_days) then
      perform public.crm_booking_clear_settings();
      return to_jsonb(v_row);
    end if;

    update public.crm_booking_milestones
       set remind_after = v_today + p_days
     where id = v_row.id
       and client_id = p_client_id
     returning * into v_row;

    perform public.crm_booking_clear_settings();

    return to_jsonb(v_row);
  end if;

  -- quiet
  if v_row.quiet then
    perform public.crm_booking_clear_settings();
    return to_jsonb(v_row);
  end if;

  update public.crm_booking_milestones
     set quiet = true
   where id = v_row.id
     and client_id = p_client_id
   returning * into v_row;

  perform public.crm_booking_clear_settings();

  return to_jsonb(v_row);
end;
$$;

revoke all on function public.crm_booking_nudge(uuid, uuid, text, timestamptz, text, integer, text) from public, anon, authenticated;
grant execute on function public.crm_booking_nudge(uuid, uuid, text, timestamptz, text, integer, text) to service_role;

-- ---------------------------------------------------------------------------
-- 16. Cancel a booking (a cancel note is required; no amounts are stored)
-- ---------------------------------------------------------------------------
create function public.crm_booking_cancel(
  p_client_id uuid,
  p_booking_id uuid,
  p_expected_updated_at timestamptz,
  p_cancel_note text,
  p_actor text
)
returns jsonb
language plpgsql
as $$
declare
  v_actor text;
  v_row public.crm_bookings;
  v_note text;
begin
  if p_actor is null or length(btrim(p_actor)) = 0 then
    raise exception 'invalid_actor';
  end if;

  v_note := nullif(btrim(coalesce(p_cancel_note, '')), '');

  if v_note is null or length(v_note) > 200 then
    raise exception 'invalid_cancel_note';
  end if;

  v_actor := lower(btrim(p_actor));
  perform set_config('crm_booking.actor', v_actor, true);
  perform set_config('crm_booking.source', 'staff', true);

  select *
    into v_row
    from public.crm_bookings
   where id = p_booking_id
     and client_id = p_client_id
   for update;

  if not found then
    raise exception 'booking_not_found';
  end if;

  if v_row.status <> 'active' then
    raise exception 'booking_not_active';
  end if;

  if v_row.updated_at is distinct from p_expected_updated_at then
    raise exception 'conflict:stale:%', v_row.id;
  end if;

  update public.crm_bookings
     set status = 'cancelled',
         cancel_note = v_note
   where id = p_booking_id
     and client_id = p_client_id
   returning * into v_row;

  perform public.crm_booking_clear_settings();

  return to_jsonb(v_row);
end;
$$;

revoke all on function public.crm_booking_cancel(uuid, uuid, timestamptz, text, text) from public, anon, authenticated;
grant execute on function public.crm_booking_cancel(uuid, uuid, timestamptz, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 17. Erase an actor's email from the audit log.
-- This is the ONLY path allowed to touch the append-only crm_booking_events table, and
-- even then the append-only trigger permits nothing but actor_email -> null. The
-- transaction-local flag crm_booking.erase is set here and reset immediately after.
-- ---------------------------------------------------------------------------
create function public.crm_booking_erase_actor_email(
  p_client_id uuid,
  p_email text,
  p_actor text
)
returns integer
language plpgsql
as $$
declare
  v_actor text;
  v_email text;
  v_count integer;
  v_bookings_count integer;
  v_members_count integer;
begin
  if p_actor is null or length(btrim(p_actor)) = 0 then
    raise exception 'invalid_actor';
  end if;

  v_email := nullif(btrim(coalesce(p_email, '')), '');

  if v_email is null then
    raise exception 'invalid_email';
  end if;

  v_actor := lower(btrim(p_actor));
  perform set_config('crm_booking.actor', v_actor, true);
  perform set_config('crm_booking.source', 'staff', true);

  perform set_config('crm_booking.erase', 'on', true);

  update public.crm_booking_events
     set actor_email = null
   where client_id = p_client_id
     and actor_email = lower(v_email);

  get diagnostics v_count = row_count;

  update public.crm_bookings
     set created_by = '(erased)'
   where client_id = p_client_id
     and lower(created_by) = lower(v_email);

  get diagnostics v_bookings_count = row_count;

  update public.crm_booking_members
     set granted_by = '(erased)'
   where client_id = p_client_id
     and lower(granted_by) = lower(v_email);

  get diagnostics v_members_count = row_count;

  -- One audit event for the erasure itself; the erased email is never stored here.
  insert into public.crm_booking_events (
    client_id, booking_id, action, detail, actor_email, source
  )
  values (
    p_client_id,
    '00000000-0000-0000-0000-000000000000'::uuid,
    'actor_erased',
    jsonb_build_object('rows', v_count),
    v_actor,
    'staff'
  );

  perform set_config('crm_booking.erase', '', true);

  perform public.crm_booking_clear_settings();

  return v_count;
end;
$$;

revoke all on function public.crm_booking_erase_actor_email(uuid, text, text) from public, anon, authenticated;
grant execute on function public.crm_booking_erase_actor_email(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 18. Same-client integrity for direct table writes
-- ---------------------------------------------------------------------------
create function public.crm_booking_enforce_same_client()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE'
     and new.client_id is not distinct from old.client_id
     and new.contact_id is not distinct from old.contact_id
     and new.tour_id is not distinct from old.tour_id
     and new.departure_id is not distinct from old.departure_id then
    return new;
  end if;

  if not exists (
    select 1 from public.contacts
     where id = new.contact_id
       and client_id = new.client_id
  ) then
    raise exception 'cross_client_reference:%', 'contact_id';
  end if;

  if not exists (
    select 1 from public.tour_catalog_tours
     where id = new.tour_id
       and client_id = new.client_id
  ) then
    raise exception 'cross_client_reference:%', 'tour_id';
  end if;

  if new.departure_id is not null then
    if not exists (
      select 1 from public.tour_catalog_departures
       where id = new.departure_id
         and client_id = new.client_id
         and tour_id = new.tour_id
    ) then
      raise exception 'cross_client_reference:%', 'departure_id';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.crm_booking_enforce_same_client() from public, anon, authenticated;
grant execute on function public.crm_booking_enforce_same_client() to service_role;

create trigger crm_bookings_enforce_same_client
  before insert or update on public.crm_bookings
  for each row
  execute function public.crm_booking_enforce_same_client();

-- crm_booking_milestones: the booking must exist and belong to the same client.
-- On UPDATE check only when client_id or booking_id changed.
create function public.crm_booking_milestone_enforce_client()
returns trigger
language plpgsql
as $$
declare
  v_booking_client_id uuid;
begin
  if tg_op = 'UPDATE'
     and new.client_id is not distinct from old.client_id
     and new.booking_id is not distinct from old.booking_id then
    return new;
  end if;

  select client_id
    into v_booking_client_id
    from public.crm_bookings
   where id = new.booking_id;

  if not found or v_booking_client_id is distinct from new.client_id then
    raise exception 'cross_client_reference:%', 'booking';
  end if;

  return new;
end;
$$;

revoke all on function public.crm_booking_milestone_enforce_client() from public, anon, authenticated;
grant execute on function public.crm_booking_milestone_enforce_client() to service_role;

create trigger crm_booking_milestones_enforce_client
  before insert or update on public.crm_booking_milestones
  for each row
  execute function public.crm_booking_milestone_enforce_client();
