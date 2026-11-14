# CTS 回电时间清理证据（2026-11-15）

执行：PM 在 18 号窗口回「清」后，由 76 号窗口在一个事务里执行（守卫：id 对得上且 callback_at 仍等于名单旧值，命中数必须正好 清 31 / 改 3，否则整体回滚）。
首次预览命中清 30 / 改 3：差的那 1 条是名单旧值只写到分钟（19:43），库里是 19:43:57.461，同一条记录；更正旧值后再跑，命中 31 / 3。

## 回读（执行后）
- CTS 带 callback_at 的触点：19（应为 19）
- 带留底键 callback_at_before_2026_11_15 的：34（应为 34）
- 这 34 行里 callback_at 不为空的：3（应为 3，即「改」的那 3 行）

## 撤回办法
把留底键的值写回 callback_at，再删掉留底键（只对带留底键的 34 行）。

## 执行的语句
```sql
do $$
declare nc int; nx int; cc int; cx int;
begin
  create temp table _clr(id uuid, old_ts timestamptz) on commit drop;
  create temp table _chg(id uuid, old_ts timestamptz, new_iso text) on commit drop;
  insert into _clr values
('60d94599-8517-4c0b-84b4-51a4b9fe61ec'::uuid,'2026-11-14T20:00:00.000Z'::timestamptz),
('00221e49-3655-4969-9234-f3806fc67007'::uuid,'2026-11-14T20:00:00.000Z'::timestamptz),
('76ccab9c-3f5c-41fc-9051-ff30c814308e'::uuid,'2026-11-15T20:00:00.000Z'::timestamptz),
('0f9f16c9-0023-4515-9bb6-0f631e1e4ff8'::uuid,'2026-11-16T20:00:00.000Z'::timestamptz),
('d285358b-f40d-4265-bfe1-cb1017631c00'::uuid,'2026-11-17T20:00:00.000Z'::timestamptz),
('187a5510-281a-4a11-b5f5-eb03f683ac8b'::uuid,'2026-11-17T20:00:00.000Z'::timestamptz),
('1d467381-48ae-4e1b-9d90-5e7ab79f30a5'::uuid,'2026-11-17T20:00:00.000Z'::timestamptz),
('29095fc0-ff3a-462e-bc54-690e54d1eb62'::uuid,'2026-11-19T20:00:00.000Z'::timestamptz),
('9c20a437-dcc6-4bb5-a92a-162a9b7d9a34'::uuid,'2026-11-19T20:00:00.000Z'::timestamptz),
('6e811e6d-a879-4bd2-a748-e417bb7b113b'::uuid,'2026-11-19T20:00:00.000Z'::timestamptz),
('834d815d-71ae-4998-962b-19e4f6ccdb4f'::uuid,'2026-11-24T20:00:00.000Z'::timestamptz),
('b8def17c-5cc9-4b97-a992-86f2085b8a43'::uuid,'2026-11-25T20:00:00.000Z'::timestamptz),
('d3809926-c69a-4934-8784-4b425a9f2059'::uuid,'2026-12-12T20:00:00.000Z'::timestamptz),
('d6d4c5b6-9009-47f8-9bbc-d9410f8631ee'::uuid,'2026-12-17T20:00:00.000Z'::timestamptz),
('94a265d4-53a8-4769-b846-08a19d4428eb'::uuid,'2026-11-13T20:00:00.000Z'::timestamptz),
('b88e4e30-826f-4da6-a12b-38da7bc62606'::uuid,'2026-11-13T20:00:00.000Z'::timestamptz),
('0bf03275-1a06-4def-9300-c128ae0bc5e8'::uuid,'2026-11-13T20:00:00.000Z'::timestamptz),
('fe70d983-9e7f-44c5-b13b-89083f08d760'::uuid,'2026-11-12T20:00:00.000Z'::timestamptz),
('8fc6dc48-9b2b-4f77-91b4-da67c9851e44'::uuid,'2026-11-12T20:00:00.000Z'::timestamptz),
('1c5e0ed4-68dd-4ad1-ac4a-c2ec6d0dd169'::uuid,'2026-11-12T20:00:00.000Z'::timestamptz),
('67819a68-c559-4d79-a3d7-3abe55f24981'::uuid,'2026-11-12T20:00:00.000Z'::timestamptz),
('ce44efe0-c6ae-4272-8e1a-9b198c936979'::uuid,'2026-11-12T20:00:00.000Z'::timestamptz),
('0e4b01d9-76a0-4ca1-9769-2ba1a1ed6780'::uuid,'2026-11-12T20:00:00.000Z'::timestamptz),
('713b5bf6-84a0-46f9-838b-ad96e1b1a78a'::uuid,'2026-11-12T20:00:00.000Z'::timestamptz),
('d77c824d-0393-4be9-880a-80fcc7ee3e13'::uuid,'2026-11-05T20:00:00.000Z'::timestamptz),
('74722834-eb15-4163-b1a9-7ecb5ab7b261'::uuid,'2026-11-05T20:00:00.000Z'::timestamptz),
('8c9e2149-a151-43cd-9288-b7fdc81ae507'::uuid,'2026-11-04T20:00:00.000Z'::timestamptz),
('52b44682-3e98-4b54-8a9b-d05b17ad4508'::uuid,'2026-10-31T20:00:00.000Z'::timestamptz),
('f6c23f7a-dfda-41a4-ab1b-a586bbb7b117'::uuid,'2026-10-29T19:43:57.461Z'::timestamptz),
('f69c8cd4-3c49-4294-8768-fd32cfeea412'::uuid,'2026-11-17T20:00:00.000Z'::timestamptz),
('ef82f110-16c4-4868-9f41-456e38049c04'::uuid,'2026-11-13T20:00:00.000Z'::timestamptz);
  insert into _chg values
('a8fd84fc-2a1a-4ba1-bd05-1e53df599eaf'::uuid,'2026-12-12T20:00:00.000Z'::timestamptz,'2026-11-12T20:00:00.000Z'),
('cb09afb3-163c-4bad-96e3-d5086bc4a627'::uuid,'2027-11-10T03:00:00.000Z'::timestamptz,'2026-11-10T03:00:00.000Z'),
('eb9276b9-bdf0-483b-b3d6-de37e25b5aa8'::uuid,'2026-10-31T21:00:00.000Z'::timestamptz,'2026-10-30T21:00:00.000Z');
  select count(*) into nc from contact_touchpoints t join _clr c on c.id=t.id
    where t.client_id='c0000000-0000-0000-0000-000000000000' and (t.metadata->>'callback_at')::timestamptz = c.old_ts;
  select count(*) into nx from contact_touchpoints t join _chg c on c.id=t.id
    where t.client_id='c0000000-0000-0000-0000-000000000000' and (t.metadata->>'callback_at')::timestamptz = c.old_ts;
  if nc <> 31 or nx <> 3 then raise exception 'guard mismatch: clear=% change=%', nc, nx; end if;
  update contact_touchpoints t set metadata = (t.metadata - 'callback_at') || jsonb_build_object('callback_at_before_2026_11_15', t.metadata->>'callback_at')
    from _clr c where c.id=t.id and t.client_id='c0000000-0000-0000-0000-000000000000' and (t.metadata->>'callback_at')::timestamptz = c.old_ts;
  get diagnostics cc = row_count;
  update contact_touchpoints t set metadata = t.metadata || jsonb_build_object('callback_at_before_2026_11_15', t.metadata->>'callback_at', 'callback_at', c.new_iso)
    from _chg c where c.id=t.id and t.client_id='c0000000-0000-0000-0000-000000000000' and (t.metadata->>'callback_at')::timestamptz = c.old_ts;
  get diagnostics cx = row_count;
  if cc <> 31 or cx <> 3 then raise exception 'update count mismatch: clear=% change=%', cc, cx; end if;
end $$;
```
