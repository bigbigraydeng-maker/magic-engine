-- 本机一次性沙盘的 Supabase 环境桩：只造角色和默认权限，不含任何业务表（角色是集群级的，所以要可重复执行）
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
create extension if not exists pgcrypto;
grant usage on schema public to anon, authenticated, service_role;
-- 与 Supabase 默认一致：public 里新建的表，anon / authenticated / service_role 默认拿到全部权限（所以迁移里的 revoke 才有意义）
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
