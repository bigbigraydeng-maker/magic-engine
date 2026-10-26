#!/bin/bash
# =============================================================================
# 从零重放全部 supabase/migrations，然后断言数据库安全不变量（#1326）
#
# 为什么要从零重放而不是查生产库：
#   1. CI 不该连生产库
#   2. 真正要防的是「下次有人再写一条漏 TO 的策略」—— 那种问题只有在
#      从零重建时才会以「末态不干净」的形式暴露出来
#
# 用法：
#   DATABASE_URL=postgres://... bash scripts/db-replay-and-verify.sh
# 本机（用 brew 装的 postgresql@17）：
#   bash scripts/db-replay-and-verify.sh          # 默认建 me_ci_verify 库
# =============================================================================
set -euo pipefail

MIGRATIONS_DIR="${MIGRATIONS_DIR:-supabase/migrations}"
DB="${DB:-me_ci_verify}"
PSQL_BASE=(psql -v ON_ERROR_STOP=1 -q)

if [ -n "${DATABASE_URL:-}" ]; then
  # CI：连 service 容器，库已存在
  RUN=("${PSQL_BASE[@]}" -d "$DATABASE_URL")
  ADMIN_RUN=("${PSQL_BASE[@]}" -d "$DATABASE_URL")
else
  # 本机：brew 的 postgresql@17
  export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
  export LC_ALL="${LC_ALL:-en_US.UTF-8}" LANG="${LANG:-en_US.UTF-8}"
  dropdb --if-exists "$DB" 2>/dev/null || true
  createdb "$DB"
  RUN=("${PSQL_BASE[@]}" -d "$DB")
  ADMIN_RUN=("${PSQL_BASE[@]}" -d "$DB")
fi

echo "==> 1/3 造 Supabase 环境桩"
# 本机 Postgres 没有这些；不造的话失败的是桩不是 migration，会误判。
# ⚠️ ALTER DEFAULT PRIVILEGES 必须在重放**之前**设 —— 真实 Supabase 建库时就配好，
#    之后每个 migration 建的对象自动继承 anon/authenticated 授权。
#    重放之后再 GRANT 是错的：会把 migration 里的 REVOKE 覆盖掉，
#    让「已经收紧了」的假象通过检查（2026-09-03 实测踩过这个坑）。
"${ADMIN_RUN[@]}" <<'SQL'
do $$ begin create role service_role;  exception when duplicate_object then null; end $$;
do $$ begin create role anon;          exception when duplicate_object then null; end $$;
do $$ begin create role authenticated; exception when duplicate_object then null; end $$;

create extension if not exists pgcrypto;

create schema if not exists storage;
create table if not exists storage.buckets(
  id text primary key, name text, public boolean,
  file_size_limit bigint, allowed_mime_types text[], owner uuid,
  created_at timestamptz default now(), updated_at timestamptz default now());
create table if not exists storage.objects(
  id uuid primary key default gen_random_uuid(), bucket_id text, name text,
  owner uuid, metadata jsonb, path_tokens text[],
  created_at timestamptz default now(), updated_at timestamptz default now(),
  last_accessed_at timestamptz);

create schema if not exists auth;
create or replace function auth.uid()  returns uuid  language sql stable as $$ select null::uuid $$;
create or replace function auth.jwt()  returns jsonb language sql stable as $$ select '{}'::jsonb $$;
create or replace function auth.role() returns text  language sql stable as $$ select null::text $$;

-- 忠实还原 Supabase 的默认授权（service_role 同样拿到 ALL，含 DELETE/TRUNCATE ——
-- 不还原这一条，「migration 收回了 service_role 的删除权」这类断言在沙盘上永远是假通过）
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all     on tables    to anon, authenticated, service_role;
alter default privileges in schema public grant all     on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
SQL

echo "==> 2/3 按时间序重放 migration"
PASS=0; FAIL=0; FAILED_LIST=""
for f in $(ls "$MIGRATIONS_DIR"/*.sql | sort); do
  b=$(basename "$f")
  # 协作仓专属：带 app.collab_environment 守卫，在 CI 沙盘上必然失败且不该跑
  case "$b" in 202608270001_*) continue;; esac
  if err=$("${RUN[@]}" -f "$f" 2>&1); then
    PASS=$((PASS+1))
  else
    FAIL=$((FAIL+1))
    FAILED_LIST="${FAILED_LIST}
  ${b}
      $(echo "$err" | grep -iE 'ERROR' | head -1)"
  fi
done
echo "    通过 $PASS / 失败 $FAIL"
if [ "$FAIL" -ne 0 ]; then
  echo ""
  echo "🛑 migration 重放失败：$FAILED_LIST"
  exit 1
fi

echo "==> 3/3 断言数据库安全不变量"
"${RUN[@]}" -f scripts/db-invariants.sql

echo ""
echo "✅ 重放 $PASS 个 migration + 全部安全不变量通过"
