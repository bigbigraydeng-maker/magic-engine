# SEO 闭环第 0 步（清场部分）执行回执 — 2026-10-04

- 授权：PM 在对话里回「合」（2026-10-04，会话 cdd5dbf9）。范围仅限 CTS（client `c0000000-0000-0000-0000-000000000000`）。
- 执行方式：生产库单个事务（先失败回滚一次：`execution_logs.author` 只允许 system/luban/fde；改用 `system` 后一次成功）。
- 结果（执行后回读）：17 张旧卡 pending→skipped（`steps_json.skip_reason='legacy_cleanup'`，每张一条 `execution_logs` status_change）；16 条计划项归档（`is_archived=true`，挂在过期目标 `c5816200-6a3b-45f7-8989-3f3f2aee46f7` 下）。CTS 剩余 pending SEO 卡 8 张（5 张新巡检卡、1 张 generate_blog_post、2 张 meta_cycle_manual_review，均有意保留）；CTS 未归档计划项剩 7 条（均属广告线目标）。
- **未做**：没有建新目标（新指标 `seo_gsc_clicks_28d` 还不在指标目录，要等 WP-3a 上线）。

## 被清的卡（17）
2417e89b-1d9d-4188-8ee7-5911ba7f06b7 · 55b97116-ee9c-4016-b363-caa88d1136fa · 9d27c967-11b3-4f1e-916c-55f7e7d1d2a1 · d9dbefe6-2b63-4b35-a180-653fea571a3d · 50233204-bbe9-48ff-93d4-026d74377710 · f37fa760-2237-454b-bc90-ee09f35448d0 · 4a942148-fb6b-426d-baa0-c8235e8645d7 · 95e9eebe-ec52-4be7-ba02-8b7dca0d159b · 283c1c64-8815-40ea-be4e-248e45e348d8 · aef7207a-cd68-4edf-a760-ec8e7bade339 · 08381cdd-a8cb-4532-9740-2a472c92516a · e666948f-b46d-4e48-9be8-2c875e7eed77 · 8b6b5a62-ac59-42a6-af7e-fbc751027f05 · aa9e8db2-af8e-4c00-a171-85f70871d47a · c22050d9-8d1d-44a4-a26b-1ac3fb1456a0 · bc5fd8bf-4159-4792-abbb-2b19aacfc77b · 7ad1b71b-a348-44d4-a7bf-ed8886bbc165

## 被归档的计划项（16）
ea930444-3f50-4552-885e-9c19c3305244 · c9211075-c1d1-41a6-839c-b145ff8c1228 · 8e85fe0b-cb45-4fd6-b4f4-58f5ff0c4021 · b9bd07ef-43ba-4443-a620-5c41183f7bf3 · 64dccc82-e82b-4a3b-bc04-1ac688c4c749 · 9d954516-d29a-4bab-a9ad-def422c38499 · 53276fab-ee0e-48c5-865d-b90142686aae · a567806a-af1c-4578-a20f-161030961b41 · 47886368-1ba5-4c88-baeb-f360f5b07345 · d35c71a1-7158-45ce-8baf-cbdfe84af98d · 9a135a57-982a-407f-899b-67700ec6614a · 7da0a58a-b04b-4337-9c22-fe5202f75b97 · 0347d9ea-5062-458d-b6c4-5d2fa8cf9b73 · a1bcf82b-3fd1-46df-a5bf-adc033a18f5d · ae0fb59f-caec-4d8a-987a-2ee261a5b7a7 · 09c7b553-e23c-466f-9120-b3038dbf71eb

## 回滚（需 PM 同意再执行）
```sql
update execution_items set status='pending', steps_json = steps_json - 'skip_reason' - 'prev_status' - 'skipped_on', updated_at=now()
 where client_id='c0000000-0000-0000-0000-000000000000' and steps_json->>'skip_reason'='legacy_cleanup' and status='skipped';
update initiatives set is_archived=false, updated_at=now() where id in (<上面 16 个计划项 id>);
```
（`execution_logs` 的 17 条记录保留，作为清场与回滚的审计痕迹。）
