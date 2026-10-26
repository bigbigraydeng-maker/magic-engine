# 证据 · 2026-09-22-kernel-claim-rpc-ambiguous-column-fix · 2026-10-14
fetched_at: 2026-10-14T21:40:59+13:00

查了什么：生产数据库里那两个函数当前的真实写法，是否跟 pr:1905 那份修复一致（不只是代码合并）。

数字（带样本量、两边取数状态）：
- pr:1905 已合并（2026-09-22T12:29:26Z），只改一个文件：
  supabase/migrations/20260923000000_kernel_fix_ambiguous_column_refs.sql。
  仓库里全目录搜索确认只有两份 migration 定义过这两个函数：原始的 20260808000003 和这份修复，没有第三份覆盖。
- 生产库 public.kernel_claim_or_takeover_run 的 pg_get_functiondef：
  · 含修复后的那行 "reclaim_count       = v_run.reclaim_count + CASE WHEN v_reclaimed" → true
  · 仍含裸写 bug 形态（正则 '[^.]\breclaim_count\s*=\s*reclaim_count'）→ false
- 生产库 public.kernel_claim_run_step 的 pg_get_functiondef：
  · 含修复后的 "attempt = v_step.attempt + 1"（正则 'attempt\s*=\s*v_step\.attempt\s*\+\s*1'）→ true
  · 仍含裸写 bug 形态（正则 '[^.]\battempt\s*=\s*attempt\s*\+\s*1'）→ false
- 两个函数各只有一个同名重载，样本 = 全部（各 1 个）。

顺手发现（不改这张卡的结论，仅记录）：supabase_migrations.schema_migrations 里没有这份修复的登记行
（按 name 搜 '%ambiguous%' / '%kernel_fix%' 均 0 行）。即函数体确实已经是修复后的写法，
但这次变更没在 migration 台账里留痕。影响有限（这份 migration 全是 CREATE OR REPLACE，重跑无副作用），
但「生产库跟 migration 登记表不对账」这件事本身值得单独开卡，不在本卡判据内。

来源/命令：
- gh pr view 1905 --json title,state,mergedAt,files
- grep -rln 'kernel_claim_or_takeover_run|kernel_claim_run_step' supabase/migrations/
- Supabase 只读 SQL：select proname, pg_get_functiondef(p.oid) like/~ ... from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in ('kernel_claim_or_takeover_run','kernel_claim_run_step')
- Supabase 只读 SQL：select version, name from supabase_migrations.schema_migrations where name ilike '%ambiguous%' or name ilike '%kernel_fix%'

结论：成。生产库两个函数的当前写法跟这份修复完全一致，裸写歧义的 bug 形态都已不存在。
