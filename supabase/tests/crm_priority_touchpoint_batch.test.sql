-- Run only on a throwaway local database after the CRM migrations, with ON_ERROR_STOP=1.
begin;
insert into public.clients(id) values
  ('00000000-0000-0000-0000-00000000ba01'), ('00000000-0000-0000-0000-00000000ba02');
insert into public.contacts(id, client_id, display_name) values
  ('00000000-0000-0000-0000-00000000bc01', '00000000-0000-0000-0000-00000000ba01', 'Batch test'),
  ('00000000-0000-0000-0000-00000000bc02', '00000000-0000-0000-0000-00000000ba02', 'Other tenant');
insert into public.contact_touchpoints(id,client_id,contact_id,channel,direction,occurred_at,raw,metadata,source)
select md5('crm-priority-batch-' || g::text)::uuid, '00000000-0000-0000-0000-00000000ba01',
  '00000000-0000-0000-0000-00000000bc01', 'phone', 'outbound',
  '2026-01-01'::timestamptz + (g % 10) * interval '1 second', 'note', '{"outcome":"spoke"}'::jsonb, 'manual'
from generate_series(1,10050) g;
insert into public.contact_touchpoints(id,client_id,contact_id,channel,direction,occurred_at,raw,metadata,source)
values ('00000000-0000-0000-0000-00000000bd02', '00000000-0000-0000-0000-00000000ba02',
  '00000000-0000-0000-0000-00000000bc02', 'email', 'inbound', now(), null, '{}'::jsonb, 'manual');

do $$
declare
  first_batch jsonb := public.crm_priority_touchpoint_batch('00000000-0000-0000-0000-00000000ba01', 0);
  second_batch jsonb := public.crm_priority_touchpoint_batch('00000000-0000-0000-0000-00000000ba01', 10000);
  expected uuid[];
  actual uuid[];
begin
  if jsonb_array_length(first_batch) <> 10000 or jsonb_array_length(second_batch) <> 50 or
     jsonb_array_length(public.crm_priority_touchpoint_batch('00000000-0000-0000-0000-00000000ba02', 0)) <> 1 or
     jsonb_array_length(public.crm_priority_touchpoint_batch('00000000-0000-0000-0000-00000000ba03', 0)) <> 0 then
    raise exception 'incorrect batch size or tenant isolation';
  end if;
  select array_agg(id order by occurred_at desc, id desc) into expected from public.contact_touchpoints
    where client_id='00000000-0000-0000-0000-00000000ba01';
  select array_agg((entry->>'id')::uuid order by ord) into actual
    from jsonb_array_elements(first_batch || second_batch) with ordinality as rows(entry, ord);
  if actual is distinct from expected then raise exception 'missing, duplicated or reordered rows'; end if;
  if first_batch->0->>'raw' <> 'note' or first_batch->0->'metadata'->>'outcome' <> 'spoke' or
     first_batch->0->>'created_at' is null then
    raise exception 'required fields not preserved';
  end if;
  if has_function_privilege('anon', 'public.crm_priority_touchpoint_batch(uuid,integer)', 'execute') or
     has_function_privilege('authenticated', 'public.crm_priority_touchpoint_batch(uuid,integer)', 'execute') or
     not has_function_privilege('service_role', 'public.crm_priority_touchpoint_batch(uuid,integer)', 'execute') then
    raise exception 'incorrect function access';
  end if;
end $$;
set local role service_role;
do $$ begin
  if jsonb_array_length(public.crm_priority_touchpoint_batch('00000000-0000-0000-0000-00000000ba01', 10000)) <> 50 then
    raise exception 'service role cannot read complete second batch';
  end if;
end $$;
reset role;
set local role anon;
do $$ begin
  begin
    perform public.crm_priority_touchpoint_batch('00000000-0000-0000-0000-00000000ba01', 0);
    raise exception 'anonymous invocation unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
rollback;
