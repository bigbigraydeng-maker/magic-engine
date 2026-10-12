-- service-role only; apply only after explicit PM approval (A-level: alters a live table, adds a function).
-- CRM booking tracker: record WHERE an order came from (origin_kind) and the invoice number that proves it
-- (evidence_ref), plus an import-only create function. Design: docs/specs/2026-10-12-crm-order-record-design-v0.md (v1.2).
-- No money columns on purpose (PM 2026-10-13: "不要金额"). Existing functions keep their signatures;
-- crm_booking_create is NOT touched (changing its signature would leave two overloads and break the UI call).
--
-- Requires: 20261012200000_crm_booking_tracker.sql (and the tour catalog migrations it requires).
--
-- ROLLBACK (do not run automatically; give to the PM together with the apply approval):
--   drop trigger crm_bookings_origin_immutable on public.crm_bookings;
--   drop function public.crm_booking_origin_immutable();
--   drop function public.crm_booking_create_with_origin(uuid, uuid, uuid, uuid, date, smallint, boolean, text, text, text, text);
--   drop index public.crm_bookings_evidence_ref_active_uidx;
--   alter table public.crm_bookings drop constraint crm_bookings_company_confirmed_needs_evidence,
--     drop constraint crm_bookings_evidence_ref_shape, drop constraint crm_bookings_origin_kind_values;
--   -- restore the audit function: re-run the "create function public.crm_booking_audit_booking()" block of
--   -- 20261012200000_crm_booking_tracker.sql as "create or replace function" (it does not mention the new columns);
--   alter table public.crm_bookings drop column evidence_ref, drop column origin_kind;  -- only after confirming no data you want to keep
--   ORDER MATTERS: restore the audit function BEFORE dropping the columns (plpgsql does not track column dependencies:
--   dropping first would succeed and then every insert into crm_bookings would fail inside the trigger).
--   After a rollback there are 17 crm_booking_% functions again: set G94d in supabase/tests/crm_booking_tracker.test.sql back to 17.
--
-- NOTE: the CTS invoice format (5 digits) is checked by the import script, not here: it is a client rule, and this
-- migration is client-neutral (it only enforces 3-40 upper-case letters/digits after normalisation).

-- ---------------------------------------------------------------------------
-- 1. New nullable columns (no table rewrite; old rows stay NULL, never back-filled with guesses)
-- ---------------------------------------------------------------------------
alter table public.crm_bookings
  add column origin_kind text,
  add column evidence_ref text;

alter table public.crm_bookings
  add constraint crm_bookings_origin_kind_values
    check (origin_kind is null or origin_kind in ('company_confirmed', 'customer_stated', 'staff_entered')),
  add constraint crm_bookings_evidence_ref_shape
    -- Whitelist, not a blacklist of whitespace: zero-width characters, BOM, en dashes and full-width digits are
    -- refused, and the rule does not depend on the database locale. The create function normalises first
    -- (upper case, no whitespace / hyphens), so a stored value is always upper-case letters and digits.
    check (evidence_ref is null or evidence_ref ~ '^[A-Z0-9]{3,40}$'),
  add constraint crm_bookings_company_confirmed_needs_evidence
    check (origin_kind is distinct from 'company_confirmed' or evidence_ref is not null);

-- One invoice number per live order. Cancelled orders keep the number for the record but do not hold it,
-- so a cancelled import can be redone and a wrongly attached invoice can be cancelled and re-created.
create unique index crm_bookings_evidence_ref_active_uidx
  on public.crm_bookings (client_id, evidence_ref)
  where evidence_ref is not null and status = 'active';

-- ---------------------------------------------------------------------------
-- 2. origin_kind / evidence_ref cannot be changed after creation (wrong entry = cancel and re-create)
-- ---------------------------------------------------------------------------
create function public.crm_booking_origin_immutable()
returns trigger
language plpgsql
as $$
begin
  if old.origin_kind is distinct from new.origin_kind
     or old.evidence_ref is distinct from new.evidence_ref then
    raise exception 'origin_immutable';
  end if;
  return new;
end;
$$;

revoke all on function public.crm_booking_origin_immutable() from public, anon, authenticated;
grant execute on function public.crm_booking_origin_immutable() to service_role;

create trigger crm_bookings_origin_immutable
  before update on public.crm_bookings
  for each row
  execute function public.crm_booking_origin_immutable();

-- ---------------------------------------------------------------------------
-- 3. Audit trigger function: the created event also records origin_kind and whether an invoice number
--    exists (never the number itself); the update branch also watches the two columns.
--    The function keeps its name, signature and privileges; the trigger itself is untouched.
--    The write functions (not this trigger) call crm_booking_clear_settings() before returning.
-- ---------------------------------------------------------------------------
create or replace function public.crm_booking_audit_booking()
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
        'has_note', new.note is not null,
        'origin_kind', new.origin_kind,
        'has_evidence_ref', new.evidence_ref is not null
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
  if old.origin_kind is distinct from new.origin_kind then
    v_changed := v_changed || 'origin_kind'::text;
  end if;
  if old.evidence_ref is distinct from new.evidence_ref then
    v_changed := v_changed || 'evidence_ref'::text;
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

-- ---------------------------------------------------------------------------
-- 4. Import-only create function: same behaviour as crm_booking_create plus origin_kind / evidence_ref.
--    A departure is required (an import must hang on a real departure). Invoice-number conflicts are
--    reported as duplicate_evidence_ref, same-guest-same-departure conflicts stay duplicate_booking.
-- ---------------------------------------------------------------------------
create function public.crm_booking_create_with_origin(
  p_client_id uuid,
  p_contact_id uuid,
  p_tour_id uuid,
  p_departure_id uuid,
  p_booked_on date,
  p_party_size smallint,
  p_is_cruise boolean,
  p_note text,
  p_origin_kind text,
  p_evidence_ref text,
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
  v_ref text;
  v_row public.crm_bookings;
  v_deposit_at timestamptz;
  v_balance_at timestamptz;
  v_constraint text;
begin
  if p_actor is null or length(btrim(p_actor)) = 0 then
    raise exception 'invalid_actor';
  end if;
  if p_departure_id is null then
    raise exception 'departure_required';
  end if;
  -- An import must say where the order came from (a NULL origin is what old, hand-entered orders have).
  if p_origin_kind is null or p_origin_kind not in ('company_confirmed', 'customer_stated', 'staff_entered') then
    raise exception 'invalid_origin_kind';
  end if;

  -- Normalised form: upper case, no whitespace or hyphens (same rule as the payment-email invoice extractor).
  v_ref := nullif(regexp_replace(upper(coalesce(p_evidence_ref, '')), '[\s-]+', '', 'g'), '');
  if v_ref is not null and v_ref !~ '^[A-Z0-9]{3,40}$' then
    raise exception 'invalid_evidence_ref';
  end if;
  if p_origin_kind = 'company_confirmed' and v_ref is null then
    raise exception 'evidence_required';
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
      booked_on, party_size, is_cruise, note, created_by, origin_kind, evidence_ref
    )
    values (
      p_client_id, p_contact_id, p_tour_id, p_departure_id, v_depart_on,
      v_booked_on, p_party_size, coalesce(p_is_cruise, false), v_note, v_actor, p_origin_kind, v_ref
    )
    returning * into v_row;
  exception
    when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'crm_bookings_evidence_ref_active_uidx' then
        raise exception 'duplicate_evidence_ref';
      end if;
      raise exception 'duplicate_booking';
  end;

  -- Distinct updated_at tokens for the booking and its two milestones (see crm_booking_create).
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

revoke all on function public.crm_booking_create_with_origin(uuid, uuid, uuid, uuid, date, smallint, boolean, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.crm_booking_create_with_origin(uuid, uuid, uuid, uuid, date, smallint, boolean, text, text, text, text)
  to service_role;
