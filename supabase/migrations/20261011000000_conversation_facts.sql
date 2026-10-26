-- service-role only; apply only after explicit PM approval (A-level: new table + new SQL function).
-- 「AI 读对话得出的事实」缓存：每段对话一行，覆盖写，可重算（不是审计证据）。PM 2026-10-11 点头。

create table public.conversation_facts (
  conversation_id uuid primary key references public.conversations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  status text not null check (status in ('pending', 'ready', 'failed')),
  claimed_at timestamptz,
  retry_after timestamptz,
  error text,
  schema_version int not null default 1,
  prompt_version text,
  model text,
  -- the seven yes/no facts (separate columns so readers never have to pull the jsonb)
  is_spam_or_unrelated boolean,
  customer_gave_specifics boolean,
  we_gave_price boolean,
  next_step_arranged boolean,
  ordered_or_paid boolean,
  we_declined boolean,
  customer_said_not_now boolean,
  last_speaker text check (last_speaker in ('customer', 'us')),
  last_message_at timestamptz,
  source_message_count int,
  -- quotes / reasons contain customer text: service_role only, never returned by any API
  evidence jsonb,
  cost_usd numeric(10, 6),
  generated_at timestamptz
);

create index conversation_facts_client_status_idx
  on public.conversation_facts (client_id, status, generated_at);

create table public.conversation_facts_daily (
  client_id uuid not null references public.clients(id) on delete cascade,
  day date not null,
  used int not null default 0,
  primary key (client_id, day)
);

alter table public.conversation_facts enable row level security;
alter table public.conversation_facts_daily enable row level security;

create policy conversation_facts_service_role
  on public.conversation_facts for all to service_role using (true) with check (true);
create policy conversation_facts_daily_service_role
  on public.conversation_facts_daily for all to service_role using (true) with check (true);

revoke all on public.conversation_facts from anon, authenticated;
revoke all on public.conversation_facts_daily from anon, authenticated;

-- Atomically: (1) take one unit of today's budget, (2) claim the conversation. Both or neither.
-- Prevents two concurrent runs (Inngest retry + hourly cron) from both reading "5 left".
create or replace function public.claim_conversation_facts(
  p_conversation_id uuid,
  p_client_id uuid,
  p_daily_limit int
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_day date := (now() at time zone 'Pacific/Auckland')::date;
  v_used int;
  v_claimed uuid;
begin
  if p_daily_limit <= 0 then
    return false; -- limit 0 means off: do not let the very first insert slip through
  end if;

  insert into public.conversation_facts_daily as d (client_id, day, used)
  values (p_client_id, v_day, 1)
  on conflict (client_id, day) do update set used = d.used + 1
  where d.used < p_daily_limit
  returning d.used into v_used;
  if v_used is null then
    return false; -- today's budget is spent
  end if;

  insert into public.conversation_facts as f (conversation_id, client_id, status, claimed_at)
  values (p_conversation_id, p_client_id, 'pending', now())
  on conflict (conversation_id) do update
    set status = 'pending', claimed_at = now(), error = null
  where f.status <> 'pending' or f.claimed_at < now() - interval '15 minutes'
  returning f.conversation_id into v_claimed;
  if v_claimed is null then
    -- someone else holds a fresh claim: give the budget unit back
    update public.conversation_facts_daily set used = used - 1
    where client_id = p_client_id and day = v_day;
    return false;
  end if;
  return true;
end;
$$;

revoke all on function public.claim_conversation_facts(uuid, uuid, int) from public, anon, authenticated;
grant execute on function public.claim_conversation_facts(uuid, uuid, int) to service_role;
