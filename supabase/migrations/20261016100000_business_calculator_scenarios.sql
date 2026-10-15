-- service-role only; apply only after explicit PM approval.
-- Business calculator scenarios: named what-if scenarios (inputs only, no results) for the
-- in-app travel business calculator. Internal use only.
-- Design doc: docs/specs/2026-10-16-business-calculator-in-me-design-v0.1.md

-- ---------------------------------------------------------------------------
-- 1. Scenarios: one named set of calculator inputs per client
-- ---------------------------------------------------------------------------
-- client_id has no ON DELETE action on purpose: a client that still has saved scenarios cannot be
-- deleted silently (no quiet loss of data). Rollback, if ever needed:
--   drop trigger me_calculator_scenarios_limit on public.me_calculator_scenarios;
--   drop function public.me_calculator_scenarios_enforce_limit();
--   drop table public.me_calculator_scenarios;
create table public.me_calculator_scenarios (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id),
  name text not null check (length(btrim(name)) between 1 and 60),
  inputs jsonb not null check (jsonb_typeof(inputs) = 'object' and pg_column_size(inputs) <= 8192),
  formula_version smallint not null default 1,
  created_by text not null check (length(btrim(created_by)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint me_calculator_scenarios_client_name_key unique (client_id, name)
);

alter table public.me_calculator_scenarios enable row level security;

create policy me_calculator_scenarios_service_role
  on public.me_calculator_scenarios
  for all
  to service_role
  using (true)
  with check (true);

revoke all on public.me_calculator_scenarios from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. At most 50 scenarios per client, enforced inside the database so two
-- concurrent inserts cannot both pass. The advisory lock is transaction-scoped
-- and keyed on the client, so inserts for the same client serialise.
-- ---------------------------------------------------------------------------
create function public.me_calculator_scenarios_enforce_limit()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_count integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(new.client_id::text, 0));

  select count(*)
    into v_count
    from public.me_calculator_scenarios
   where client_id = new.client_id;

  if v_count >= 50 then
    raise exception 'scenario_limit_reached' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

revoke all on function public.me_calculator_scenarios_enforce_limit() from public, anon, authenticated;
grant execute on function public.me_calculator_scenarios_enforce_limit() to service_role;

create trigger me_calculator_scenarios_limit
  before insert on public.me_calculator_scenarios
  for each row
  execute function public.me_calculator_scenarios_enforce_limit();
