#!/bin/bash
# 触发型发送账本迁移（20261102130000_triggered_send_ledger.sql）的 DB 行为试跑。
# 不进 CI（CI 只重放迁移与安全不变量）：改这两张表或认领函数之前/之后，在本机一次性 Postgres 上手动跑。
# 用法：先起一个一次性 Postgres（initdb；不要连生产库），再
#   DB=triggered_send_ledger_behavior PORT=55433 bash scripts/db-behavior/triggered-send-ledger.sh [迁移文件路径]
# 脚本会 drop / create 同名库、造 Supabase 环境桩（角色与默认权限）、应用迁移、逐项断言并发/触发器/权限/认领函数行为。
# 退出码 0 = 全部通过。做法与坑见记忆 reference-local-postgrest-e2e-trial-recipe（zsh 下用 bash 跑本脚本）。
export LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8
[ -d /opt/homebrew/opt/postgresql@17/bin ] && export PATH=/opt/homebrew/opt/postgresql@17/bin:$PATH
HERE="$(cd "$(dirname "$0")" && pwd)"
DB=${DB:-triggered_send_ledger_behavior}
PORT=${PORT:-5432}
MIG=${1:-"$HERE/../../supabase/migrations/20261102130000_triggered_send_ledger.sql"}
STUB="$HERE/supabase-env-stub.sql"
TMPD="$(mktemp -d)"
PASS=0; FAIL=0
PSQL=(psql -h 127.0.0.1 -p "$PORT" -U postgres -X -q -t -A)
ok()  { PASS=$((PASS+1)); echo "PASS  $1"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL  $1  -- $2"; }
q()   { "${PSQL[@]}" -d "$DB" -c "$1" 2>&1 | tr -d '\r'; }
# 以某角色执行并期望某个 SQLSTATE（verbose 输出形如 "ERROR:  23001: ..."）
expect_err() { local out; out=$("${PSQL[@]}" -d "$DB" -v VERBOSITY=verbose -c "set role $2; $3" 2>&1); if echo "$out" | grep -q "ERROR:  $4"; then ok "$1"; else bad "$1" "want $4 got: $(echo "$out" | head -2 | tr '\n' ' ')"; fi; }
# 期望 CHECK 违反（23514）且点名是哪一条约束——只看错误码，会被「别的 CHECK 先报错」或「假数据本身不合法」蒙混过关
expect_chk() { local out; out=$("${PSQL[@]}" -d "$DB" -v VERBOSITY=verbose -c "set role $2; $3" 2>&1); if echo "$out" | grep -q "ERROR:  23514" && echo "$out" | grep -q "violates check constraint \"$4\""; then ok "$1"; else bad "$1" "want 23514 on $4 got: $(echo "$out" | head -2 | tr '\n' ' ' | cut -c1-220)"; fi; }
expect_match() { local out; out=$("${PSQL[@]}" -d "$DB" -v VERBOSITY=verbose -c "set role $2; $3" 2>&1); if echo "$out" | grep -Eq "$4"; then ok "$1"; else bad "$1" "want /$4/ got: $(echo "$out" | head -3 | tr '\n' ' ')"; fi; }
expect_ok()  { local out; out=$("${PSQL[@]}" -d "$DB" -v VERBOSITY=verbose -c "set role $2; $3" 2>&1); if echo "$out" | grep -q "ERROR"; then bad "$1" "unexpected error: $(echo "$out" | head -2 | tr '\n' ' ')"; else ok "$1"; fi; }
# 并发用例用「闸门法」，不靠计时：另起会话持有顾问锁 424242；认领会话在认领之后去要同一把锁，于是停在事务中间
# （认领拿到的锁都还握着），直到我们放闸。观察「第二个会话是否停在锁上」是确定性的，机器再忙也不会错位。
gate_close() {
  PGAPPNAME=gate "${PSQL[@]}" -d "$DB" -c "select pg_advisory_lock(424242); select pg_sleep(120);" >/dev/null 2>&1 &
  GATE_JOB=$!
  local i n
  for i in $(seq 1 200); do
    n=$("${PSQL[@]}" -d "$DB" -c "select count(*) from pg_locks where locktype = 'advisory' and objid = 424242 and granted" 2>/dev/null | tr -d '\r\n ')
    if [ "${n:-0}" -ge 1 ] 2>/dev/null; then return 0; fi
    sleep 0.05
  done
  return 1
}
gate_open() {
  "${PSQL[@]}" -d "$DB" -c "select pg_terminate_backend(pid) from pg_stat_activity where application_name = 'gate' and datname = '$DB'" >/dev/null 2>&1
  wait "$GATE_JOB" 2>/dev/null
}
# 等某个应用名的会话停在锁上（wait_event_type = Lock）；第二个参数 = 最多轮询几次（每次 0.05 秒）
wait_blocked() {
  local app=$1 tries=${2:-200} i n
  for i in $(seq 1 "$tries"); do
    n=$("${PSQL[@]}" -d "$DB" -c "select count(*) from pg_stat_activity where datname = '$DB' and application_name = '$app' and wait_event_type = 'Lock'" 2>/dev/null | tr -d '\r\n ')
    if [ "${n:-0}" -ge 1 ] 2>/dev/null; then return 0; fi
    sleep 0.05
  done
  return 1
}
expect_eq()  { local got; got=$(q "$3"); if [ "$got" = "$2" ]; then ok "$1"; else bad "$1" "want '$2' got '$got'"; fi; }

echo "== 建库 + 环境桩 + 迁移 =="
"${PSQL[@]}" -d postgres -c "drop database if exists $DB with (force)" >/dev/null 2>&1
"${PSQL[@]}" -d postgres -c "create database $DB" >/dev/null || exit 1
"${PSQL[@]}" -d "$DB" -f "$STUB" >/dev/null || exit 1
"${PSQL[@]}" -d "$DB" -c "create table public.clients (id uuid primary key default gen_random_uuid(), name text)" >/dev/null || exit 1
if ! "${PSQL[@]}" -d "$DB" -v ON_ERROR_STOP=1 -f "$MIG" >$TMPD/mig-apply.log 2>&1; then echo "迁移应用失败："; cat $TMPD/mig-apply.log | head -20; exit 2; fi
echo "迁移已应用"

C1=11111111-1111-1111-1111-111111111111
C2=22222222-2222-2222-2222-222222222222
A=aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa
B=bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb
q "insert into public.clients(id,name) values ('$C1','c1'),('$C2','c2')" >/dev/null
H64=$(printf 'a%.0s' $(seq 1 64)); T64=$(printf 'b%.0s' $(seq 1 64)); R64=$(printf 'c%.0s' $(seq 1 64))
HX1=$(printf '1%.0s' $(seq 1 64)); HX2=$(printf '2%.0s' $(seq 1 64)); HX3=$(printf '3%.0s' $(seq 1 64)); HX4=$(printf '4%.0s' $(seq 1 64))
mkprop() { # id client [cap]
  q "insert into public.triggered_send_authorizations(id,request_id,client_id,trigger_key,channel,account,rule,rule_sha256,template_version,template_sha256,daily_cap,proposed_by_email) values ('$1',gen_random_uuid(),'$2','welcome','email','cts','{\"schedule\":{\"timezone\":\"Pacific/Auckland\"}}','$H64',1,'$T64',${3:-2},'agent@example.test')" 2>&1; }
authz() { # id
  q "update public.triggered_send_authorizations set authorized_by_email='pm@example.test', authorized_by_user_id=gen_random_uuid(), authorized_at=now(), live_from=now()-interval '1 hour', expires_at=now()+interval '90 days' where id='$1'" 2>&1; }
activate() { q "update public.triggered_send_authorizations set activated_at=now() where id='$1'" 2>&1; }

echo; echo "== 表 1：授权表 =="
expect_err "INSERT 预填已批准被拒" postgres "insert into public.triggered_send_authorizations(request_id,client_id,trigger_key,channel,account,rule,rule_sha256,daily_cap,proposed_by_email,authorized_by_email,authorized_by_user_id,authorized_at,live_from,expires_at,template_version,template_sha256) values (gen_random_uuid(),'$C1','welcome','email','cts','{}','$H64',1,'agent@example.test','pm@example.test',gen_random_uuid(),now(),now(),now()+interval '1 day',1,'$T64')" 23001
expect_err "INSERT 预填 activated_at 被拒" postgres "insert into public.triggered_send_authorizations(request_id,client_id,trigger_key,channel,account,rule,rule_sha256,daily_cap,proposed_by_email,activated_at) values (gen_random_uuid(),'$C1','welcome','email','cts','{}','$H64',1,'agent@example.test',now())" 23001
expect_err "INSERT 预填 revoked 被拒" postgres "insert into public.triggered_send_authorizations(request_id,client_id,trigger_key,channel,account,rule,rule_sha256,daily_cap,proposed_by_email,revoked_at,revoked_by) values (gen_random_uuid(),'$C1','welcome','email','cts','{}','$H64',1,'agent@example.test',now(),'x@example.test')" 23001
mkprop $A $C1 2 >/dev/null; expect_eq "提案 A 写入" "1" "select count(*) from public.triggered_send_authorizations where id='$A'"
expect_err "同 key 第二份待批提案被拒（部分唯一）" postgres "insert into public.triggered_send_authorizations(request_id,client_id,trigger_key,channel,account,rule,rule_sha256,daily_cap,proposed_by_email) values (gen_random_uuid(),'$C1','welcome','email','cts','{}','$H64',1,'agent@example.test')" 23505
for col in "account='zzz'" "rule='{\"x\":1}'" "rule_sha256='$T64'" "template_version=2" "template_sha256='$R64'" "daily_cap=3" "trigger_key='welcome'" "proposed_by_email='evil@example.test'" "request_id=gen_random_uuid()" "created_at=now()-interval '1 day'" "client_id='$C2'"; do
  if [ "$col" = "trigger_key='welcome'" ]; then continue; fi
  expect_err "绑定列不可变：$(echo "$col" | cut -c1-30)" postgres "update public.triggered_send_authorizations set $col where id='$A'" 23001
done
# 批准前后：CHECK
# 构造一份缺模板的提案来测 CHECK
mkprop $B $C2 2 >/dev/null
q "alter table public.triggered_send_authorizations disable trigger triggered_send_authorizations_update_guard" >/dev/null
q "update public.triggered_send_authorizations set template_version=null, template_sha256=null where id='$B'" >/dev/null
q "alter table public.triggered_send_authorizations enable trigger triggered_send_authorizations_update_guard" >/dev/null
expect_chk "批准时模板为空被拒（CHECK）" postgres "update public.triggered_send_authorizations set authorized_by_email='pm@example.test', authorized_by_user_id=gen_random_uuid(), authorized_at=now(), live_from=now(), expires_at=now()+interval '1 day' where id='$B'" "triggered_send_authorizations_template_when_authorized"
expect_chk "批准只写一半（缺 expires_at）被拒（CHECK）" postgres "update public.triggered_send_authorizations set authorized_by_email='pm@example.test', authorized_by_user_id=gen_random_uuid(), authorized_at=now(), live_from=now() where id='$A'" "triggered_send_authorizations_authorized_all_or_none"
expect_chk "有效期 >90 天被拒（CHECK）" postgres "update public.triggered_send_authorizations set authorized_by_email='pm@example.test', authorized_by_user_id=gen_random_uuid(), authorized_at=now(), live_from=now(), expires_at=now()+interval '91 days' where id='$A'" "triggered_send_authorizations_expiry"
expect_chk "live_from 晚于批准时刻被拒（CHECK）" postgres "update public.triggered_send_authorizations set authorized_by_email='pm@example.test', authorized_by_user_id=gen_random_uuid(), authorized_at=now(), live_from=now()+interval '1 hour', expires_at=now()+interval '1 day' where id='$A'" "triggered_send_authorizations_live_from"
expect_chk "live_from 早于批准前 36 小时被拒（CHECK）" postgres "update public.triggered_send_authorizations set authorized_by_email='pm@example.test', authorized_by_user_id=gen_random_uuid(), authorized_at=now(), live_from=now()-interval '37 hours', expires_at=now()+interval '1 day' where id='$A'" "triggered_send_authorizations_live_from"
expect_err "未批准就写 activated_at 被拒（触发器）" postgres "update public.triggered_send_authorizations set activated_at=now() where id='$A'" 23001
authz $A >/dev/null; expect_eq "A 批准成功" "1" "select count(*) from public.triggered_send_authorizations where id='$A' and authorized_at is not null"
for col in "authorized_at=now()-interval '1 minute'" "expires_at=expires_at+interval '1 hour'" "live_from=live_from-interval '1 minute'" "authorized_by_email='other@example.test'"; do
  expect_err "生命周期列只写一次：$(echo "$col" | cut -c1-28)" postgres "update public.triggered_send_authorizations set $col where id='$A'" 23001
done
activate $A >/dev/null; expect_eq "A 武装成功" "1" "select count(*) from public.triggered_send_authorizations where id='$A' and activated_at is not null"
expect_err "武装时间不可再改" postgres "update public.triggered_send_authorizations set activated_at=now()+interval '1 hour' where id='$A'" 23001
# 一份生效 + 新提案 + 第二份批准冲突
mkprop $B $C1 2 >/dev/null 2>&1 || true
q "select count(*) from public.triggered_send_authorizations where client_id='$C1' and authorized_at is null and revoked_at is null" >/dev/null
# 重新建一份 c1 的提案（B 已建在 c2，换 id）
BB=bbbbbbbb-0000-0000-0000-000000000001
mkprop $BB $C1 2 >/dev/null
expect_err "已有生效授权时再批准第二份被拒（部分唯一）" postgres "update public.triggered_send_authorizations set authorized_by_email='pm@example.test', authorized_by_user_id=gen_random_uuid(), authorized_at=now(), live_from=now(), expires_at=now()+interval '1 day' where id='$BB'" 23505
q "update public.triggered_send_authorizations set revoked_at=now(), revoked_by='pm@example.test', revoked_reason='test' where id='$BB'" >/dev/null
expect_err "已撤销的提案不能再批准" postgres "update public.triggered_send_authorizations set authorized_by_email='pm@example.test', authorized_by_user_id=gen_random_uuid(), authorized_at=now(), live_from=now(), expires_at=now()+interval '1 day' where id='$BB'" 23001
expect_chk "revoked_at 与 revoked_by 必须成对（CHECK）" postgres "update public.triggered_send_authorizations set revoked_at=now() where id='$A'" "triggered_send_authorizations_revoked_pair"
expect_err "DELETE 被拒" postgres "delete from public.triggered_send_authorizations where id='$A'" 23001
expect_err "TRUNCATE 授权表被拒（被外键引用，PG 先拒）" postgres "truncate public.triggered_send_authorizations" 0A000
expect_match "TRUNCATE ... CASCADE 授权表：被授权表自己的触发器拒（不是被账本的触发器顺带拒）" postgres "truncate public.triggered_send_authorizations cascade" "ERROR:  23001: triggered_send_authorizations is append-only: TRUNCATE"

echo; echo "== 权限与 RLS =="
for r in anon authenticated; do
  expect_err "$r 读授权表被拒" "$r" "select * from public.triggered_send_authorizations limit 1" 42501
  expect_err "$r 写授权表被拒" "$r" "insert into public.triggered_send_authorizations(request_id) values (gen_random_uuid())" 42501
  expect_err "$r 读账本被拒" "$r" "select * from public.triggered_sends limit 1" 42501
  expect_err "$r 写账本被拒" "$r" "insert into public.triggered_sends(client_id) values ('$C1')" 42501
  expect_err "$r 调认领函数被拒" "$r" "select * from public.triggered_send_claim('$A','c0000000-0000-0000-0000-000000000001','$H64','k','t',1,'$T64','$R64','s','b')" 42501
done
expect_ok "service_role 读授权表" service_role "select count(*) from public.triggered_send_authorizations"
expect_ok "service_role 调认领函数（有权限；用未武装的 B，不占 A 的日上限）" service_role "select * from public.triggered_send_claim('$B','c0000000-0000-0000-0000-0000000000ff','$H64','kperm','t',1,'$T64','$R64','s','b')"
expect_eq "两张表都开了 RLS" "2" "select count(*) from pg_class where oid in ('public.triggered_send_authorizations'::regclass,'public.triggered_sends'::regclass) and relrowsecurity"
expect_eq "策略只给 service_role" "service_role" "select string_agg(distinct array_to_string(roles,','), '|' order by array_to_string(roles,',')) from pg_policies where tablename in ('triggered_send_authorizations','triggered_sends')"
expect_eq "函数无 security definer" "0" "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'triggered_send%') and p.prosecdef"
expect_eq "认领函数 anon/authenticated/public 不可执行" "false|false" "select has_function_privilege('anon','public.triggered_send_claim(uuid,uuid,text,text,text,integer,text,text,text,text,integer)','execute') || '|' || has_function_privilege('authenticated','public.triggered_send_claim(uuid,uuid,text,text,text,integer,text,text,text,text,integer)','execute')"
expect_eq "触发器函数 anon 不可执行" "0" "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'triggered_send%' and has_function_privilege('anon', p.oid, 'execute')"

echo; echo "== 表 2：账本触发器与约束 =="
K1=c0000000-0000-0000-0000-000000000001
ins_live() { # contact status [extra cols vals...]
  q "insert into public.triggered_sends(client_id,trigger_key,channel,contact_id,dedupe_scope,status) values ('$C1','welcome','email','$1','lifetime','$2')" 2>&1; }
expect_err "真发行不许直接以 sent 插入" postgres "insert into public.triggered_sends(client_id,trigger_key,channel,contact_id,dedupe_scope,status,idempotency_key,first_attempt_at) values ('$C1','welcome','email','$K1','lifetime','sent','k0',now())" 23001
expect_chk "影子行用 pending 且缺认领列被拒（claimed_columns 先于 scope_status 报错）" postgres "insert into public.triggered_sends(client_id,trigger_key,channel,contact_id,dedupe_scope,status) values ('$C1','welcome','email','$K1','shadow','pending')" "triggered_sends_claimed_columns"
expect_chk "影子行带齐认领列也不许是 pending（此时只有 scope/status CHECK 能拦）" postgres "insert into public.triggered_sends(client_id,trigger_key,channel,contact_id,dedupe_scope,status,idempotency_key,first_attempt_at,authorization_id,template_key,template_version,template_sha256,rendered_sha256,to_address_sha256,local_day,claimed_at,lease_expires_at) values ('$C1','welcome','email','$K1','shadow','pending','kshadow',now(),'$A','welcome-auto',1,'$T64','$R64','$HX1',current_date,now(),now()+interval '10 minutes')" "triggered_sends_scope_status"
expect_chk "影子行带齐认领列也不许是 sent（只有 scope/status CHECK 能拦）" postgres "insert into public.triggered_sends(client_id,trigger_key,channel,contact_id,dedupe_scope,status,idempotency_key,first_attempt_at,authorization_id,template_key,template_version,template_sha256,rendered_sha256,to_address_sha256,local_day,claimed_at,lease_expires_at) values ('$C1','welcome','email','$K1','shadow','sent','kshadow2',now(),'$A','welcome-auto',1,'$T64','$R64','$HX1',current_date,now(),now()+interval '10 minutes')" "triggered_sends_scope_status"
expect_err "真发行用 shadow 插入被拒（插入守卫）" postgres "insert into public.triggered_sends(client_id,trigger_key,channel,contact_id,dedupe_scope,status) values ('$C1','welcome','email','$K1','lifetime','shadow')" 23001
expect_chk "pending 缺认领列被拒（CHECK；带认领标记才轮得到它）" postgres "set app.triggered_send_claim='on'; insert into public.triggered_sends(client_id,trigger_key,channel,contact_id,dedupe_scope,status) values ('$C1','welcome','email','$K1','lifetime','pending')" "triggered_sends_claimed_columns"
expect_err "真发行直接插 pending（无认领标记）被拒" postgres "insert into public.triggered_sends(client_id,trigger_key,channel,contact_id,dedupe_scope,status,idempotency_key,first_attempt_at,authorization_id,template_key,template_version,template_sha256,rendered_sha256,to_address_sha256,local_day,claimed_at,lease_expires_at) values ('$C1','welcome','email','$K1','lifetime','pending','kdirect',now(),'$A','welcome-auto',1,'$T64','$R64','$HX1',current_date,now(),now()+interval '10 minutes')" 23001
q "insert into public.triggered_sends(client_id,trigger_key,channel,contact_id,dedupe_scope,status,annotations) values ('$C1','welcome','email','$K1','shadow','shadow','{\"would_send\":true}')" >/dev/null
expect_eq "影子行写入" "1" "select count(*) from public.triggered_sends where contact_id='$K1' and dedupe_scope='shadow'"
expect_err "影子行冻结（UPDATE 被拒）" postgres "update public.triggered_sends set annotations='{}' where contact_id='$K1' and dedupe_scope='shadow'" 23001
expect_err "同联系人同 scope 重复被拒" postgres "insert into public.triggered_sends(client_id,trigger_key,channel,contact_id,dedupe_scope,status) values ('$C1','welcome','email','$K1','shadow','shadow')" 23505
q "insert into public.triggered_sends(client_id,trigger_key,channel,contact_id,dedupe_scope,status) values ('$C1','welcome','email','$K1','lifetime','blocked')" >/dev/null
expect_eq "同联系人可同时有影子行与真发行" "2" "select count(*) from public.triggered_sends where contact_id='$K1'"
expect_err "blocked → sent 非法" postgres "update public.triggered_sends set status='sent' where contact_id='$K1' and dedupe_scope='lifetime'" 23001
q "update public.triggered_sends set status='skipped', reason_code='sales_email_exists' where contact_id='$K1' and dedupe_scope='lifetime'" >/dev/null
expect_err "skipped 是终态" postgres "update public.triggered_sends set status='blocked' where contact_id='$K1' and dedupe_scope='lifetime'" 23001
expect_err "身份列不可变（contact_id）" postgres "update public.triggered_sends set contact_id=gen_random_uuid() where contact_id='$K1' and dedupe_scope='lifetime'" 23001
expect_err "DELETE 账本被拒" postgres "delete from public.triggered_sends where contact_id='$K1'" 23001
expect_err "TRUNCATE 账本被拒" postgres "truncate public.triggered_sends" 23001

echo; echo "== 认领函数 =="
claim() { # contact [authz] [to_hash] [key]
  q "select outcome||'|'||coalesce(row_status,'') from public.triggered_send_claim('${2:-$A}','$1','${3:-$H64}','${4:-key-$1}','welcome-auto',1,'$T64','$R64','src-1','form_disclosure_attested')"; }
K2=c0000000-0000-0000-0000-000000000002; K3=c0000000-0000-0000-0000-000000000003; K4=c0000000-0000-0000-0000-000000000004; K5=c0000000-0000-0000-0000-000000000005
# HX1..HX4 已在文件开头定义（之前定义得太晚，早先的影子行测试拿到空串，靠「哈希格式不合法」蒙混过关）
expect_eq "未武装的授权 → auth_inactive" "auth_inactive|" "select outcome||'|'||coalesce(row_status,'') from public.triggered_send_claim('$B','$K2','$HX1','k-b','t',1,'$T64','$R64','s','b')"
expect_eq "不存在的授权 → auth_inactive" "auth_inactive|" "select outcome||'|'||coalesce(row_status,'') from public.triggered_send_claim('99999999-9999-9999-9999-999999999999','$K2','$HX1','k-x','t',1,'$T64','$R64','s','b')"
expect_eq "首次认领 → claimed|pending" "claimed|pending" "select outcome||'|'||coalesce(row_status,'') from public.triggered_send_claim('$A','$K2','$HX1','key-k2','welcome-auto',1,'$T64','$R64','src-1','form_disclosure_attested')"
expect_eq "认领后行真的落库（pending，含幂等键、首次时刻、本地日）" "1|key-k2" "select count(*)||'|'||min(idempotency_key) from public.triggered_sends where contact_id='$K2' and dedupe_scope='lifetime' and status='pending' and first_attempt_at is not null and local_day is not null and authorization_id='$A'"
expect_eq "本地日 = 规则时区的今天" "t" "select local_day = (now() at time zone 'Pacific/Auckland')::date from public.triggered_sends where contact_id='$K2' and dedupe_scope='lifetime'"
expect_eq "同联系人再认领 → in_flight" "in_flight|pending" "select outcome||'|'||coalesce(row_status,'') from public.triggered_send_claim('$A','$K2','$HX1','key-other','welcome-auto',1,'$T64','$R64','src-1','b')"
q "alter table public.triggered_sends disable trigger triggered_sends_update_guard" >/dev/null
q "update public.triggered_sends set lease_expires_at = now() - interval '1 minute' where contact_id='$K2' and dedupe_scope='lifetime'" >/dev/null
q "alter table public.triggered_sends enable trigger triggered_sends_update_guard" >/dev/null
expect_eq "租约过期 → takeover，幂等键与首次时刻不变" "takeover|pending|key-k2" "select outcome||'|'||row_status||'|'||(select idempotency_key from public.triggered_sends where contact_id='$K2' and dedupe_scope='lifetime') from public.triggered_send_claim('$A','$K2','$HX1','key-new','welcome-auto',1,'$T64','$R64','src-1','b')"
expect_eq "接管后 attempts=2" "2" "select attempts from public.triggered_sends where contact_id='$K2' and dedupe_scope='lifetime'"
# 20 小时
q "alter table public.triggered_sends disable trigger triggered_sends_update_guard" >/dev/null
q "update public.triggered_sends set first_attempt_at = now() - interval '21 hours', lease_expires_at = now() - interval '1 minute' where contact_id='$K2' and dedupe_scope='lifetime'" >/dev/null
q "alter table public.triggered_sends enable trigger triggered_sends_update_guard" >/dev/null
expect_eq "超 20 小时 → expired_unknown，绝不再发" "expired_unknown|unknown_outcome" "select outcome||'|'||coalesce(row_status,'') from public.triggered_send_claim('$A','$K2','$HX1','key-new','welcome-auto',1,'$T64','$R64','src-1','b')"
expect_eq "unknown_outcome 行带 provider_impact=PROVIDER_UNKNOWN" "PROVIDER_UNKNOWN" "select provider_impact from public.triggered_sends where contact_id='$K2' and dedupe_scope='lifetime'"
expect_eq "再认领 → exists_terminal" "exists_terminal|unknown_outcome" "select outcome||'|'||coalesce(row_status,'') from public.triggered_send_claim('$A','$K2','$HX1','key-new','welcome-auto',1,'$T64','$R64','src-1','b')"
# 地址重复
expect_eq "同地址被欢迎过 → address_duplicate" "address_duplicate|" "select outcome||'|'||coalesce(row_status,'') from public.triggered_send_claim('$A','$K3','$HX1','key-k3','welcome-auto',1,'$T64','$R64','src-1','b')"
# 日上限（A 的 daily_cap=2；K2 已占 1：unknown_outcome 算占用）
expect_eq "第 2 个（不同地址）→ claimed" "claimed|pending" "select outcome||'|'||coalesce(row_status,'') from public.triggered_send_claim('$A','$K3','$HX2','key-k3','welcome-auto',1,'$T64','$R64','src-1','b')"
expect_eq "第 3 个 → cap_reached" "cap_reached|" "select outcome||'|'||coalesce(row_status,'') from public.triggered_send_claim('$A','$K4','$HX3','key-k4','welcome-auto',1,'$T64','$R64','src-1','b')"
expect_eq "cap_reached 不插行" "0" "select count(*) from public.triggered_sends where contact_id='$K4'"
# blocked 行重新认领（先清上限：用另一份授权/客户）
q "alter table public.triggered_sends disable trigger triggered_sends_update_guard" >/dev/null
q "update public.triggered_sends set local_day = (now() at time zone 'Pacific/Auckland')::date - 1 where contact_id in ('$K2','$K3') and dedupe_scope='lifetime'" >/dev/null
q "alter table public.triggered_sends enable trigger triggered_sends_update_guard" >/dev/null
q "insert into public.triggered_sends(client_id,trigger_key,channel,contact_id,dedupe_scope,status,reason_code) values ('$C1','welcome','email','$K4','lifetime','blocked','quiet_hours')" >/dev/null
expect_eq "blocked 行重新认领 → claimed，复用同一行" "claimed|pending|1" "select outcome||'|'||row_status||'|'||(select count(*) from public.triggered_sends where contact_id='$K4' and dedupe_scope='lifetime') from public.triggered_send_claim('$A','$K4','$HX3','key-k4','welcome-auto',1,'$T64','$R64','src-1','b')"
expect_eq "重新认领后 reason_code 清空、幂等键写入" "|key-k4" "select coalesce(reason_code,'')||'|'||idempotency_key from public.triggered_sends where contact_id='$K4' and dedupe_scope='lifetime'"
# 撤销后认领
q "update public.triggered_send_authorizations set revoked_at=now(), revoked_by='pm@example.test', revoked_reason='t' where id='$A'" >/dev/null
expect_eq "授权被撤销 → auth_inactive" "auth_inactive|" "select outcome||'|'||coalesce(row_status,'') from public.triggered_send_claim('$A','$K5','$HX4','key-k5','welcome-auto',1,'$T64','$R64','src-1','b')"
# 隔离级别断言
out=$("${PSQL[@]}" -d "$DB" -v VERBOSITY=verbose -c "begin isolation level repeatable read; select * from public.triggered_send_claim('$A','$K5','$HX4','k','t',1,'$T64','$R64','s','b'); rollback;" 2>&1)
if echo "$out" | grep -q "READ COMMITTED"; then ok "REPEATABLE READ 下拒绝执行"; else bad "REPEATABLE READ 下拒绝执行" "$out"; fi

echo; echo "== 状态机（账本）=="
# 新授权 C 给 c2 用，造一条 pending 行
CA=cccccccc-cccc-cccc-cccc-cccccccccccc
C6=66666666-6666-6666-6666-666666666666
q "insert into public.clients(id,name) values ('$C6','c6')" >/dev/null
mkprop $CA $C6 5 >/dev/null; authz $CA >/dev/null; activate $CA >/dev/null
S1=d0000000-0000-0000-0000-000000000001
q "select * from public.triggered_send_claim('$CA','$S1','$HX1','key-s1','welcome-auto',1,'$T64','$R64','src-1','b')" >/dev/null
st() { q "select status from public.triggered_sends where contact_id='$S1' and dedupe_scope='lifetime'"; }
setst() { q "update public.triggered_sends set status='$1' where contact_id='$S1' and dedupe_scope='lifetime'" 2>&1; }
expect_err "pending → blocked 非法" postgres "update public.triggered_sends set status='blocked' where contact_id='$S1' and dedupe_scope='lifetime'" 23001
expect_err "pending → skipped 非法" postgres "update public.triggered_sends set status='skipped' where contact_id='$S1' and dedupe_scope='lifetime'" 23001
setst sent >/dev/null; expect_eq "pending → sent" "sent" "select status from public.triggered_sends where contact_id='$S1' and dedupe_scope='lifetime'"
setst delivered >/dev/null; expect_eq "sent → delivered" "delivered" "select status from public.triggered_sends where contact_id='$S1' and dedupe_scope='lifetime'"
expect_err "delivered → sent 回退被拒" postgres "update public.triggered_sends set status='sent' where contact_id='$S1' and dedupe_scope='lifetime'" 23001
expect_err "delivered → delivery_delayed 回退被拒" postgres "update public.triggered_sends set status='delivery_delayed' where contact_id='$S1' and dedupe_scope='lifetime'" 23001
setst bounced >/dev/null; expect_eq "delivered → bounced（晚到的退信可前进）" "bounced" "select status from public.triggered_sends where contact_id='$S1' and dedupe_scope='lifetime'"
expect_err "bounced → delivered 被拒（乱序收敛）" postgres "update public.triggered_sends set status='delivered' where contact_id='$S1' and dedupe_scope='lifetime'" 23001
setst complained >/dev/null; expect_eq "bounced → complained" "complained" "select status from public.triggered_sends where contact_id='$S1' and dedupe_scope='lifetime'"
expect_err "complained 最高级不可再变" postgres "update public.triggered_sends set status='bounced' where contact_id='$S1' and dedupe_scope='lifetime'" 23001
# failed <-> suppressed 同级互转被拒
S2=d0000000-0000-0000-0000-000000000002
q "select * from public.triggered_send_claim('$CA','$S2','$HX2','key-s2','welcome-auto',1,'$T64','$R64','src-1','b')" >/dev/null
q "update public.triggered_sends set status='suppressed' where contact_id='$S2' and dedupe_scope='lifetime'" >/dev/null
expect_err "suppressed → failed（同级）被拒" postgres "update public.triggered_sends set status='failed' where contact_id='$S2' and dedupe_scope='lifetime'" 23001
# pending 直接收到高等级事件（崩溃后用地址指纹配对）
S3=d0000000-0000-0000-0000-000000000003
q "select * from public.triggered_send_claim('$CA','$S3','$HX3','key-s3','welcome-auto',1,'$T64','$R64','src-1','b')" >/dev/null
q "update public.triggered_sends set status='delivered' where contact_id='$S3' and dedupe_scope='lifetime'" >/dev/null
expect_eq "pending → delivered（直接跳级，来自回执）" "delivered" "select status from public.triggered_sends where contact_id='$S3' and dedupe_scope='lifetime'"
# unknown_outcome 出口
S4=d0000000-0000-0000-0000-000000000004
q "select * from public.triggered_send_claim('$CA','$S4','$HX4','key-s4','welcome-auto',1,'$T64','$R64','src-1','b')" >/dev/null
q "update public.triggered_sends set status='unknown_outcome' where contact_id='$S4' and dedupe_scope='lifetime'" >/dev/null
q "update public.triggered_sends set status='sent' where contact_id='$S4' and dedupe_scope='lifetime'" >/dev/null
expect_eq "unknown_outcome → sent（人确认「已发出」）" "sent" "select status from public.triggered_sends where contact_id='$S4' and dedupe_scope='lifetime'"
# 写一次列
expect_ok "provider_message_id 从空写入" postgres "update public.triggered_sends set provider_message_id='msg-1', provider_account='cts' where contact_id='$S1' and dedupe_scope='lifetime'"
expect_err "provider_message_id 写入后不可改" postgres "update public.triggered_sends set provider_message_id='msg-2' where contact_id='$S1' and dedupe_scope='lifetime'" 23001
expect_err "幂等键不可改" postgres "update public.triggered_sends set idempotency_key='other' where contact_id='$S1' and dedupe_scope='lifetime'" 23001
expect_err "first_attempt_at 不可改" postgres "update public.triggered_sends set first_attempt_at=now() where contact_id='$S1' and dedupe_scope='lifetime'" 23001
expect_err "rendered_sha256 不可改" postgres "update public.triggered_sends set rendered_sha256='$H64' where contact_id='$S1' and dedupe_scope='lifetime'" 23001
expect_err "(account,message_id) 部分唯一" postgres "update public.triggered_sends set provider_message_id='msg-1', provider_account='cts' where contact_id='$S3' and dedupe_scope='lifetime'" 23505
expect_err "同址终身唯一（绕过函数直插，带认领标记）" postgres "set app.triggered_send_claim='on'; insert into public.triggered_sends(client_id,trigger_key,channel,contact_id,dedupe_scope,status,idempotency_key,first_attempt_at,authorization_id,template_key,template_version,template_sha256,rendered_sha256,to_address_sha256,local_day,claimed_at,lease_expires_at) values ('$C6','welcome','email','d0000000-0000-0000-0000-0000000000aa','lifetime','pending','kdup',now(),'$A','welcome-auto',1,'$T64','$R64','$HX1',current_date,now(),now()+interval '10 minutes')" 23505
expect_eq "updated_at 随更新前进" "t" "select updated_at > created_at from public.triggered_sends where contact_id='$S1' and dedupe_scope='lifetime'"

echo; echo "== 并发 =="
# 同联系人并发：会话 1 认领后停 1.5 秒再提交；会话 2 稍后开始同一联系人
CA2=eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee
C3=33333333-3333-3333-3333-333333333333
q "insert into public.clients(id,name) values ('$C3','c3')" >/dev/null
mkprop $CA2 $C3 1 >/dev/null; authz $CA2 >/dev/null; activate $CA2 >/dev/null
P1C=f0000000-0000-0000-0000-000000000001; P2C=f0000000-0000-0000-0000-000000000002
gate_close || bad "闸门：持锁会话没起来" "gate_close timeout"
( PGAPPNAME=s1 "${PSQL[@]}" -d "$DB" -c "begin; select outcome from public.triggered_send_claim('$CA2','$P1C','$HX1','kc1','t',1,'$T64','$R64','s','b'); select pg_advisory_xact_lock(424242); commit;" > $TMPD/c1.out 2>&1 ) &
wait_blocked s1 || bad "并发用例：认领会话 1 没有停在闸门上" "timeout"
( PGAPPNAME=s2 "${PSQL[@]}" -d "$DB" -c "select outcome from public.triggered_send_claim('$CA2','$P1C','$HX1','kc2','t',1,'$T64','$R64','s','b')" > $TMPD/c2.out 2>&1 ) &
if wait_blocked s2 100; then ok "并发认领同一联系人：第二个认领被咨询锁挡在外面（确定性观察）"; else bad "并发认领同一联系人：第二个认领被咨询锁挡在外面" "s2 was not blocked"; fi
gate_open
wait
R1=$(grep -E "claimed|in_flight|cap_reached|exists_terminal|address_duplicate" $TMPD/c1.out | head -1); R2=$(cat $TMPD/c2.out | tr -d '\r\n')
if [ "$R1" = "claimed" ] && [ "$R2" = "in_flight" ]; then ok "并发认领同一联系人：一个 claimed、一个 in_flight（咨询锁串行）"; else bad "并发认领同一联系人" "s1='$R1' s2='$R2'"; fi
# 日上限并发：上限 1，两个不同联系人、不同地址并发
CA3=eeeeeeee-0000-0000-0000-000000000001; C4=44444444-4444-4444-4444-444444444444
q "insert into public.clients(id,name) values ('$C4','c4')" >/dev/null
mkprop $CA3 $C4 1 >/dev/null; authz $CA3 >/dev/null; activate $CA3 >/dev/null
Q1=f1000000-0000-0000-0000-000000000001; Q2=f1000000-0000-0000-0000-000000000002
gate_close || bad "闸门：持锁会话没起来" "gate_close timeout"
( PGAPPNAME=s1 "${PSQL[@]}" -d "$DB" -c "begin; select outcome from public.triggered_send_claim('$CA3','$Q1','$HX1','kq1','t',1,'$T64','$R64','s','b'); select pg_advisory_xact_lock(424242); commit;" > $TMPD/d1.out 2>&1 ) &
wait_blocked s1 || bad "并发用例：认领会话 1 没有停在闸门上" "timeout"
( PGAPPNAME=s2 "${PSQL[@]}" -d "$DB" -c "select outcome from public.triggered_send_claim('$CA3','$Q2','$HX2','kq2','t',1,'$T64','$R64','s','b')" > $TMPD/d2.out 2>&1 ) &
if wait_blocked s2 100; then ok "并发日上限：第二个认领被咨询锁挡在外面（确定性观察）"; else bad "并发日上限：第二个认领被咨询锁挡在外面" "s2 was not blocked"; fi
gate_open
wait
D1=$(grep -E "claimed|cap_reached" $TMPD/d1.out | head -1); D2=$(cat $TMPD/d2.out | tr -d '\r\n')
if [ "$D1" = "claimed" ] && [ "$D2" = "cap_reached" ]; then ok "并发日上限=1：一个 claimed、一个 cap_reached"; else bad "并发日上限" "s1='$D1' s2='$D2'"; fi
expect_eq "并发后只有 1 行占用上限" "1" "select count(*) from public.triggered_sends where client_id='$C4' and dedupe_scope='lifetime'"
# 并发撤销：认领持有授权的共享锁，撤销要等它提交（时间戳证明：撤销完成时刻 >= 认领提交前时刻）
CA4=eeeeeeee-0000-0000-0000-000000000002; C5=55555555-5555-5555-5555-555555555555
q "insert into public.clients(id,name) values ('$C5','c5')" >/dev/null
mkprop $CA4 $C5 5 >/dev/null; authz $CA4 >/dev/null; activate $CA4 >/dev/null
R1C=f2000000-0000-0000-0000-000000000001; R2C=f2000000-0000-0000-0000-000000000002
gate_close || bad "闸门：持锁会话没起来" "gate_close timeout"
( PGAPPNAME=s1 "${PSQL[@]}" -d "$DB" -c "begin; select outcome from public.triggered_send_claim('$CA4','$R1C','$HX1','kr1','t',1,'$T64','$R64','s','b'); select pg_advisory_xact_lock(424242); commit;" > $TMPD/e1.out 2>&1 ) &
wait_blocked s1 || bad "并发用例：认领会话 1 没有停在闸门上" "timeout"
( PGAPPNAME=s2 "${PSQL[@]}" -d "$DB" -c "update public.triggered_send_authorizations set revoked_at=now(), revoked_by='pm@example.test' where id='$CA4'" > $TMPD/e2.out 2>&1 ) &
if wait_blocked s2 100; then ok "撤销被还没提交的认领事务挡住（认领对授权行持有 FOR SHARE；确定性观察）"; else bad "撤销被还没提交的认领事务挡住（FOR SHARE）" "revoke was not blocked"; fi
gate_open
wait
if grep -q "claimed" $TMPD/e1.out; then ok "认领会话 1 的结果是 claimed"; else bad "认领会话 1 的结果是 claimed" "$(head -3 $TMPD/e1.out | tr '\n' ' ')"; fi
expect_eq "撤销在认领提交之后生效：之后的认领 → auth_inactive" "auth_inactive" "select outcome from public.triggered_send_claim('$CA4','$R2C','$HX2','kr2','t',1,'$T64','$R64','s','b')"

echo; echo "== 认领函数：授权状态 / 时区 / 幂等键唯一 =="
C7=77777777-7777-7777-7777-777777777777; C8=88888888-8888-8888-8888-888888888888; C9=99999999-9999-9999-9999-999999999999
q "insert into public.clients(id,name) values ('$C7','c7'),('$C8','c8'),('$C9','c9')" >/dev/null
# 已批准但未武装
EA=ee000000-0000-0000-0000-0000000000a1
mkprop $EA $C7 5 >/dev/null; authz $EA >/dev/null
expect_eq "已批准但未武装 → auth_inactive" "auth_inactive" "select outcome from public.triggered_send_claim('$EA','a0000000-0000-0000-0000-000000000001','$HX1','ke-a','t',1,'$T64','$R64','s','b')"
# 已过期：批准时刻 100 天前，有效期 90 天 → 10 天前到期
EB=ee000000-0000-0000-0000-0000000000a2
mkprop $EB $C8 5 >/dev/null
q "alter table public.triggered_send_authorizations disable trigger triggered_send_authorizations_update_guard" >/dev/null
q "update public.triggered_send_authorizations set authorized_by_email='pm@example.test', authorized_by_user_id=gen_random_uuid(), authorized_at=now()-interval '100 days', live_from=now()-interval '100 days', expires_at=now()-interval '10 days', activated_at=now()-interval '99 days' where id='$EB'" >/dev/null
q "alter table public.triggered_send_authorizations enable trigger triggered_send_authorizations_update_guard" >/dev/null
expect_eq "已过期 → auth_inactive" "auth_inactive" "select outcome from public.triggered_send_claim('$EB','a0000000-0000-0000-0000-000000000002','$HX1','ke-b','t',1,'$T64','$R64','s','b')"
# 时区取自规则：UTC-12 与 UTC+14 的本地日一定不同
mkprop_tz() { q "insert into public.triggered_send_authorizations(id,request_id,client_id,trigger_key,channel,account,rule,rule_sha256,template_version,template_sha256,daily_cap,proposed_by_email) values ('$1',gen_random_uuid(),'$2','welcome','email','cts','{\"schedule\":{\"timezone\":\"$3\"}}','$H64',1,'$T64',5,'agent@example.test')" 2>&1; }
TZ1=ee000000-0000-0000-0000-0000000000b1; TZ2=ee000000-0000-0000-0000-0000000000b2
C10=10101010-1010-1010-1010-101010101010; C11=11111111-0000-0000-0000-000000000011
q "insert into public.clients(id,name) values ('$C10','c10'),('$C11','c11')" >/dev/null
mkprop_tz $TZ1 $C10 "Etc/GMT+12" >/dev/null; authz $TZ1 >/dev/null; activate $TZ1 >/dev/null
mkprop_tz $TZ2 $C11 "Pacific/Kiritimati" >/dev/null; authz $TZ2 >/dev/null; activate $TZ2 >/dev/null
q "select outcome from public.triggered_send_claim('$TZ1','a0000000-0000-0000-0000-000000000003','$HX1','ke-tz1','t',1,'$T64','$R64','s','b')" >/dev/null
q "select outcome from public.triggered_send_claim('$TZ2','a0000000-0000-0000-0000-000000000004','$HX1','ke-tz2','t',1,'$T64','$R64','s','b')" >/dev/null
expect_eq "本地日取规则时区（UTC-12）" "t" "select local_day = (now() at time zone 'Etc/GMT+12')::date from public.triggered_sends where contact_id='a0000000-0000-0000-0000-000000000003'"
expect_eq "本地日取规则时区（UTC+14）" "t" "select local_day = (now() at time zone 'Pacific/Kiritimati')::date from public.triggered_sends where contact_id='a0000000-0000-0000-0000-000000000004'"
# 幂等键全局唯一
expect_err "幂等键重复被拒（部分唯一，带认领标记）" postgres "set app.triggered_send_claim='on'; insert into public.triggered_sends(client_id,trigger_key,channel,contact_id,dedupe_scope,status,idempotency_key,first_attempt_at,authorization_id,template_key,template_version,template_sha256,rendered_sha256,to_address_sha256,local_day,claimed_at,lease_expires_at) values ('$C9','welcome','email','a0000000-0000-0000-0000-0000000000f1','lifetime','pending','ke-tz1',now(),'$A','welcome-auto',1,'$T64','$R64','$HX3',current_date,now(),now()+interval '10 minutes')" 23505

echo; echo "== v2 新增：认领标记 / 入参 / 模板与规则 / 时间钉死 / 权限 =="
mkprop_rule() { q "insert into public.triggered_send_authorizations(id,request_id,client_id,trigger_key,channel,account,rule,rule_sha256,template_version,template_sha256,daily_cap,proposed_by_email) values ('$1',gen_random_uuid(),'$2','welcome','email','cts','$3','$H64',1,'$T64',${4:-5},'agent@example.test')" 2>&1; }
newclient() { q "insert into public.clients(id,name) values ('$1','$2')" >/dev/null; }
actv() { mkprop_rule "$1" "$2" "$3" "${4:-5}" >/dev/null; authz "$1" >/dev/null; activate "$1" >/dev/null; }
VA=ff000000-0000-0000-0000-0000000000c1; VC=12121212-1212-1212-1212-121212121212
newclient $VC c12
actv $VA $VC '{"schedule":{"timezone":"Pacific/Auckland"}}' 5
HD=$(printf 'd%.0s' $(seq 1 64)); HE=$(printf 'e%.0s' $(seq 1 64)); HF=$(printf 'f%.0s' $(seq 1 64)); H7=$(printf '7%.0s' $(seq 1 64)); H8=$(printf '8%.0s' $(seq 1 64))
cl() { # auth contact hash key [tpl_version] [tpl_sha] [lease]
  q "select outcome||'|'||coalesce(row_status,'')||'|'||coalesce(row_idempotency_key,'') from public.triggered_send_claim('$1','$2','$3','$4','welcome-auto',${5:-1},'${6:-$T64}','$R64','src','b',${7:-10})"; }
V1=ee100000-0000-0000-0000-000000000001; V2=ee100000-0000-0000-0000-000000000002; V3=ee100000-0000-0000-0000-000000000003
# 入参校验
for spec in "null|null::text|'k'|1|10|地址指纹为空" ; do :; done
expect_err "认领：地址指纹为空被拒（22023）" postgres "select * from public.triggered_send_claim('$VA','$V1',null,'k','t',1,'$T64','$R64','s','b')" 22023
expect_err "认领：幂等键为空被拒" postgres "select * from public.triggered_send_claim('$VA','$V1','$HD',null,'t',1,'$T64','$R64','s','b')" 22023
expect_err "认领：模板 key 为空被拒" postgres "select * from public.triggered_send_claim('$VA','$V1','$HD','k',null,1,'$T64','$R64','s','b')" 22023
expect_err "认领：渲染指纹为空被拒" postgres "select * from public.triggered_send_claim('$VA','$V1','$HD','k','t',1,'$T64',null,'s','b')" 22023
expect_err "认领：租约 0 分钟被拒" postgres "select * from public.triggered_send_claim('$VA','$V1','$HD','k','t',1,'$T64','$R64','s','b',0)" 22023
expect_err "认领：租约 31 分钟被拒" postgres "select * from public.triggered_send_claim('$VA','$V1','$HD','k','t',1,'$T64','$R64','s','b',31)" 22023
expect_err "认领：租约为空被拒" postgres "select * from public.triggered_send_claim('$VA','$V1','$HD','k','t',1,'$T64','$R64','s','b',null)" 22023
expect_eq "入参被拒时没有写任何行" "0" "select count(*) from public.triggered_sends where contact_id='$V1'"
# 模板指纹
expect_eq "模板版本不一致 → template_mismatch" "template_mismatch||" "$(echo "select outcome||'|'||coalesce(row_status,'')||'|'||coalesce(row_idempotency_key,'') from public.triggered_send_claim('$VA','$V1','$HD','k-tm','welcome-auto',2,'$T64','$R64','s','b')")"
expect_eq "模板指纹不一致 → template_mismatch" "template_mismatch||" "select outcome||'|'||coalesce(row_status,'')||'|'||coalesce(row_idempotency_key,'') from public.triggered_send_claim('$VA','$V1','$HD','k-tm','welcome-auto',1,'$H64','$R64','s','b')"
expect_eq "指纹不一致时没有写行" "0" "select count(*) from public.triggered_sends where contact_id='$V1'"
# 返回幂等键
expect_eq "首次认领返回传入的幂等键" "claimed|pending|kv2-a" "$(echo "select outcome||'|'||row_status||'|'||row_idempotency_key from public.triggered_send_claim('$VA','$V1','$HD','kv2-a','welcome-auto',1,'$T64','$R64','s','b')")"
expect_eq "在途再认领返回已存的幂等键（不是新传的）" "in_flight|pending|kv2-a" "select outcome||'|'||row_status||'|'||row_idempotency_key from public.triggered_send_claim('$VA','$V1','$HD','kv2-b','welcome-auto',1,'$T64','$R64','s','b')"
q "alter table public.triggered_sends disable trigger triggered_sends_update_guard" >/dev/null
q "update public.triggered_sends set lease_expires_at = now() - interval '1 minute' where contact_id='$V1' and dedupe_scope='lifetime'" >/dev/null
q "alter table public.triggered_sends enable trigger triggered_sends_update_guard" >/dev/null
expect_eq "接管返回已存的幂等键" "takeover|pending|kv2-a" "select outcome||'|'||row_status||'|'||row_idempotency_key from public.triggered_send_claim('$VA','$V1','$HD','kv2-c','welcome-auto',1,'$T64','$R64','s','b')"
# 认领标记
expect_err "blocked → pending 直接 UPDATE（无认领标记）被拒" postgres "insert into public.triggered_sends(client_id,trigger_key,channel,contact_id,dedupe_scope,status) values ('$VC','welcome','email','$V2','lifetime','blocked'); update public.triggered_sends set status='pending', idempotency_key='kdirect2', first_attempt_at=now(), authorization_id='$VA', template_key='t', template_version=1, template_sha256='$T64', rendered_sha256='$R64', to_address_sha256='$HE', local_day=current_date, claimed_at=now(), lease_expires_at=now()+interval '10 minutes' where contact_id='$V2' and dedupe_scope='lifetime'" 23001
q "delete from public.triggered_sends where false" >/dev/null
# blocked 行重新认领：陈旧字段被清掉（先造一条带陈旧字段的 blocked 行）
V4=ee100000-0000-0000-0000-000000000004
q "insert into public.triggered_sends(client_id,trigger_key,channel,contact_id,dedupe_scope,status,reason_code,last_block_reason,bounce_kind,sent_at,last_event_type,last_event_at) values ('$VC','welcome','email','$V4','lifetime','blocked','quiet_hours','lock_busy','permanent',now(),'email.bounced',now())" >/dev/null
q "select outcome from public.triggered_send_claim('$VA','$V4','$HF','kv2-d','welcome-auto',1,'$T64','$R64','s','b')" >/dev/null
expect_eq "重新认领清掉 reason/last_block/bounce_kind/sent_at/last_event" "t" "select reason_code is null and last_block_reason is null and bounce_kind is null and sent_at is null and last_event_type is null and last_event_at is null from public.triggered_sends where contact_id='$V4' and dedupe_scope='lifetime'"
# 认领后写一次：authorization_id、claimed_at
expect_err "authorization_id 认领后不可改" postgres "update public.triggered_sends set authorization_id='$A' where contact_id='$V1' and dedupe_scope='lifetime'" 23001
expect_err "claimed_at 认领后不可改" postgres "update public.triggered_sends set claimed_at=now()+interval '1 hour' where contact_id='$V1' and dedupe_scope='lifetime'" 23001
# 规则缺时区 / 非法时区
VB=ff000000-0000-0000-0000-0000000000c2; VD=13131313-1313-1313-1313-131313131313
newclient $VD c13; actv $VB $VD '{}' 5
expect_eq "规则缺时区 → rule_invalid（不回落奥克兰）" "rule_invalid||" "select outcome||'|'||coalesce(row_status,'')||'|'||coalesce(row_idempotency_key,'') from public.triggered_send_claim('$VB','$V3','$HD','kv2-e','welcome-auto',1,'$T64','$R64','s','b')"
expect_eq "规则缺时区时没有写行" "0" "select count(*) from public.triggered_sends where contact_id='$V3'"
VX=ff000000-0000-0000-0000-0000000000c3; VE=14141414-1414-1414-1414-141414141414
newclient $VE c14; actv $VX $VE '{"schedule":{"timezone":"Mars/Phobos"}}' 5
expect_eq "非法时区名（Mars/Phobos）→ rule_invalid（fail-closed，不再靠报错）" "rule_invalid||" "select outcome||'|'||coalesce(row_status,'')||'|'||coalesce(row_idempotency_key,'') from public.triggered_send_claim('$VX','$V3','$HD','kv2-f','welcome-auto',1,'$T64','$R64','s','b')"
expect_eq "非法时区时没有写行" "0" "select count(*) from public.triggered_sends where contact_id='$V3'"
# 授权撤销后，超 20 小时的 pending 仍转 unknown_outcome
VF=ff000000-0000-0000-0000-0000000000c4; VG=15151515-1515-1515-1515-151515151515; V5=ee100000-0000-0000-0000-000000000005
newclient $VG c15; actv $VF $VG '{"schedule":{"timezone":"Pacific/Auckland"}}' 5
q "select outcome from public.triggered_send_claim('$VF','$V5','$H7','kv2-g','welcome-auto',1,'$T64','$R64','s','b')" >/dev/null
q "update public.triggered_send_authorizations set revoked_at=now(), revoked_by='pm@example.test' where id='$VF'" >/dev/null
q "alter table public.triggered_sends disable trigger triggered_sends_update_guard" >/dev/null
q "update public.triggered_sends set first_attempt_at = now() - interval '21 hours' where contact_id='$V5' and dedupe_scope='lifetime'" >/dev/null
q "alter table public.triggered_sends enable trigger triggered_sends_update_guard" >/dev/null
expect_eq "授权已撤销时 21 小时的 pending → expired_unknown（不是 auth_inactive）" "expired_unknown|unknown_outcome|kv2-g" "select outcome||'|'||row_status||'|'||row_idempotency_key from public.triggered_send_authorizations a, public.triggered_send_claim('$VF','$V5','$H7','kv2-h','welcome-auto',1,'$T64','$R64','s','b') where a.id='$VF'"
# 时间由数据库定
VH=ff000000-0000-0000-0000-0000000000c5; VI=16161616-1616-1616-1616-161616161616
newclient $VI c16; mkprop $VH $VI 5 >/dev/null
q "update public.triggered_send_authorizations set authorized_by_email='pm@example.test', authorized_by_user_id=gen_random_uuid(), authorized_at=now()+interval '400 days', live_from=now()-interval '1 hour', expires_at=now()+interval '90 days' where id='$VH'" >/dev/null
expect_eq "批准时刻被覆盖成数据库的 now()（客户端填 400 天后也没用）" "t" "select abs(extract(epoch from (authorized_at - now()))) < 5 from public.triggered_send_authorizations where id='$VH'"
expect_eq "有效期最长仍是批准后 90 天" "t" "select expires_at <= authorized_at + interval '90 days' from public.triggered_send_authorizations where id='$VH'"
q "update public.triggered_send_authorizations set activated_at='2000-01-01' where id='$VH'" >/dev/null
expect_eq "武装时刻被覆盖成 now()" "t" "select abs(extract(epoch from (activated_at - now()))) < 5 from public.triggered_send_authorizations where id='$VH'"
q "update public.triggered_send_authorizations set revoked_at='2000-01-01', revoked_by='pm@example.test' where id='$VH'" >/dev/null
expect_eq "撤销时刻被覆盖成 now()" "t" "select abs(extract(epoch from (revoked_at - now()))) < 5 from public.triggered_send_authorizations where id='$VH'"
VJ=ff000000-0000-0000-0000-0000000000c6; VK=17171717-1717-1717-1717-171717171717
newclient $VK c17; mkprop $VJ $VK 5 >/dev/null
expect_err "批准与武装在同一条语句里被拒" postgres "update public.triggered_send_authorizations set authorized_by_email='pm@example.test', authorized_by_user_id=gen_random_uuid(), authorized_at=now(), live_from=now(), expires_at=now()+interval '1 day', activated_at=now() where id='$VJ'" 23001
# 权限
expect_err "service_role 不能建触发器" service_role "create trigger zzz_after before update on public.triggered_sends for each row execute function public.triggered_sends_update_guard()" 42501
expect_err "service_role 不能 TRUNCATE 账本" service_role "truncate public.triggered_sends" 42501
expect_eq "service_role 没有 TRIGGER/REFERENCES/TRUNCATE，仍有读写" "false|false|false|true|true|true|true" "select has_table_privilege('service_role','public.triggered_sends','TRIGGER')::text||'|'||has_table_privilege('service_role','public.triggered_sends','REFERENCES')::text||'|'||has_table_privilege('service_role','public.triggered_sends','TRUNCATE')::text||'|'||has_table_privilege('service_role','public.triggered_sends','SELECT')::text||'|'||has_table_privilege('service_role','public.triggered_sends','INSERT')::text||'|'||has_table_privilege('service_role','public.triggered_sends','UPDATE')::text||'|'||has_table_privilege('service_role','public.triggered_send_authorizations','UPDATE')::text"
expect_eq "辅助函数：service_role 可执行、anon 不可" "true|true|false|false" "select has_function_privilege('service_role','public.triggered_send_status_rank(text)','execute')::text||'|'||has_function_privilege('service_role','public.triggered_send_status_edge_ok(text,text)','execute')::text||'|'||has_function_privilege('anon','public.triggered_send_status_rank(text)','execute')::text||'|'||has_function_privilege('anon','public.triggered_send_status_edge_ok(text,text)','execute')::text"
# 状态：failed(not_sent_confirmed) 可被真实回执覆盖；其余 regress 带 hint
VL=ff000000-0000-0000-0000-0000000000c7; VM=18181818-1818-1818-1818-181818181818
newclient $VM c18; actv $VL $VM '{"schedule":{"timezone":"Pacific/Auckland"}}' 9
N1=ee200000-0000-0000-0000-000000000001; N2=ee200000-0000-0000-0000-000000000002; N3=ee200000-0000-0000-0000-000000000003; N4=ee200000-0000-0000-0000-000000000004
HA=$(printf '9%.0s' $(seq 1 64)); HB=$(printf '0%.0s' $(seq 1 64)); HC=$(printf '1%.0s' $(seq 1 64)); HD2=$(printf '2%.0s' $(seq 1 64))
q "select outcome from public.triggered_send_claim('$VL','$N1','$HA','kn-1','welcome-auto',1,'$T64','$R64','s','b')" >/dev/null
q "update public.triggered_sends set status='unknown_outcome' where contact_id='$N1' and dedupe_scope='lifetime'" >/dev/null
q "update public.triggered_sends set status='failed', reason_code='not_sent_confirmed' where contact_id='$N1' and dedupe_scope='lifetime'" >/dev/null
expect_ok "failed(not_sent_confirmed) → delivered（真实回执覆盖 PM 的误判）" postgres "update public.triggered_sends set status='delivered' where contact_id='$N1' and dedupe_scope='lifetime'"
q "select outcome from public.triggered_send_claim('$VL','$N2','$HB','kn-2','welcome-auto',1,'$T64','$R64','s','b')" >/dev/null
q "update public.triggered_sends set status='failed', reason_code='provider_rejected' where contact_id='$N2' and dedupe_scope='lifetime'" >/dev/null
expect_match "普通 failed → delivered 被拒且 hint=status_regress" postgres "update public.triggered_sends set status='delivered' where contact_id='$N2' and dedupe_scope='lifetime'" "HINT:  status_regress"
expect_match "blocked → sent 被拒且 hint=status_illegal" postgres "insert into public.triggered_sends(client_id,trigger_key,channel,contact_id,dedupe_scope,status) values ('$VM','welcome','email','$N3','lifetime','blocked'); update public.triggered_sends set status='sent' where contact_id='$N3' and dedupe_scope='lifetime'" "HINT:  status_illegal"
# failed 释放同址、suppressed 不释放
q "select outcome from public.triggered_send_claim('$VL','$N4','$HB','kn-4','welcome-auto',1,'$T64','$R64','s','b')" >/dev/null
expect_eq "failed 释放同址：另一个联系人同址可再认领" "1" "select count(*) from public.triggered_sends where contact_id='$N4' and status='pending'"
q "update public.triggered_sends set status='suppressed' where contact_id='$N4' and dedupe_scope='lifetime'" >/dev/null
N5=ee200000-0000-0000-0000-000000000005
expect_eq "suppressed 不释放同址 → address_duplicate" "address_duplicate" "select outcome from public.triggered_send_claim('$VL','$N5','$HB','kn-5','welcome-auto',1,'$T64','$R64','s','b')"

echo; echo "== v2 补充：标记不外泄 / 每个认领列都必填 =="
# 认领标记只在认领函数内有效：同一事务里认领之后，再直接插 pending 仍被拒
LK=ee300000-0000-0000-0000-000000000001; LK2=ee300000-0000-0000-0000-000000000002
out=$("${PSQL[@]}" -d "$DB" -v VERBOSITY=verbose -c "begin; select outcome from public.triggered_send_claim('$VA','$LK','$H8','klk-1','welcome-auto',1,'$T64','$R64','s','b'); insert into public.triggered_sends(client_id,trigger_key,channel,contact_id,dedupe_scope,status,idempotency_key,first_attempt_at,authorization_id,template_key,template_version,template_sha256,rendered_sha256,to_address_sha256,local_day,claimed_at,lease_expires_at) values ('$VC','welcome','email','$LK2','lifetime','pending','klk-2',now(),'$VA','welcome-auto',1,'$T64','$R64','$HC',current_date,now(),now()+interval '10 minutes'); rollback;" 2>&1)
if echo "$out" | grep -q "ERROR:  23001"; then ok "认领之后标记已复位：同事务里再直接插 pending 仍被拒"; else bad "认领之后标记已复位" "$(echo "$out" | head -3 | tr '\n' ' ')"; fi
# 每个认领列单独为空都被 CHECK 拦（带认领标记，其余列齐全）
i=0
for col in idempotency_key first_attempt_at to_address_sha256 rendered_sha256 template_key template_version template_sha256 authorization_id local_day claimed_at lease_expires_at; do
  i=$((i+1))
  cols="idempotency_key,first_attempt_at,authorization_id,template_key,template_version,template_sha256,rendered_sha256,to_address_sha256,local_day,claimed_at,lease_expires_at"
  vals="'kcol-$i',now(),'$VA','welcome-auto',1,'$T64','$R64','$(python3 -c "print(('%02x' % $i) * 32)")',current_date,now(),now()+interval '10 minutes'"
  # 把该列的取值换成 null（按列顺序定位）
  idx=$(echo "$cols" | tr ',' '\n' | grep -n -x "$col" | cut -d: -f1)
  vals2=$(python3 - "$vals" "$idx" <<'PY2'
import sys,re
vals=sys.argv[1]; idx=int(sys.argv[2])
parts=[];depth=0;cur=''
for ch in vals:
    if ch=='(':depth+=1
    if ch==')':depth-=1
    if ch==',' and depth==0: parts.append(cur);cur=''
    else: cur+=ch
parts.append(cur)
parts[idx-1]='null'
print(','.join(parts))
PY2
)
  expect_chk "已认领行缺 $col 被 claimed_columns CHECK 拦" postgres "set app.triggered_send_claim='on'; insert into public.triggered_sends(client_id,trigger_key,channel,contact_id,dedupe_scope,status,$cols) values ('$VC','welcome','email','ee300000-0000-0000-0000-0000000001$(printf '%02d' $i)','lifetime','pending',$vals2)" triggered_sends_claimed_columns
done

echo; echo "== v2.1 补充（第二轮审查后）=="
# (1) 已撤销的提案：不填 authorized_at、只写其它批准列，也不能批准（审查员发现：判据曾只看 authorized_at，被绕过）
RV=a1000000-0000-0000-0000-000000000001; RVC=a0000001-0000-0000-0000-000000000001
newclient $RVC cv1; mkprop $RV $RVC 5 >/dev/null
q "update public.triggered_send_authorizations set revoked_at=now(), revoked_by='pm@example.test' where id='$RV'" >/dev/null
expect_match "已撤销的提案：不填 authorized_at、只写其它批准列也不能批准" postgres "update public.triggered_send_authorizations set authorized_by_email='pm@example.test', authorized_by_user_id=gen_random_uuid(), live_from=now(), expires_at=now()+interval '1 day' where id='$RV'" "ERROR:  23001: triggered_send_authorizations: revoked proposal cannot be authorized"
expect_eq "且该提案仍没有批准时间" "0" "select count(*) from public.triggered_send_authorizations where id='$RV' and authorized_at is not null"

# (2) failed + not_sent_confirmed 不释放同址；迟到的送达 / 投诉回执仍写得进去
NBC=a0000001-0000-0000-0000-000000000002; NBA=a1000000-0000-0000-0000-000000000002
NS1=a2000000-0000-0000-0000-000000000001; NS2=a2000000-0000-0000-0000-000000000002; NS3=a2000000-0000-0000-0000-000000000003
HN1=$(printf '5%.0s' $(seq 1 64)); HN2=$(printf '6%.0s' $(seq 1 64))
newclient $NBC cv2; actv $NBA $NBC '{"schedule":{"timezone":"Pacific/Auckland"}}' 9
expect_eq "联系人 A 认领成功" "claimed" "select outcome from public.triggered_send_claim('$NBA','$NS1','$HN1','kv21-1','welcome-auto',1,'$T64','$R64','s','b')"
q "update public.triggered_sends set status='unknown_outcome' where contact_id='$NS1' and dedupe_scope='lifetime'" >/dev/null
q "update public.triggered_sends set status='failed', reason_code='not_sent_confirmed' where contact_id='$NS1' and dedupe_scope='lifetime'" >/dev/null
expect_eq "failed + not_sent_confirmed 不释放同址：同址的联系人 B 认领 → address_duplicate" "address_duplicate" "select outcome from public.triggered_send_claim('$NBA','$NS2','$HN1','kv21-2','welcome-auto',1,'$T64','$R64','s','b')"
expect_ok "迟到的真实送达回执仍写得进去（failed + not_sent_confirmed → delivered）" postgres "update public.triggered_sends set status='delivered' where contact_id='$NS1' and dedupe_scope='lifetime'"
expect_ok "迟到的投诉回执同样写得进去（delivered → complained）" postgres "update public.triggered_sends set status='complained' where contact_id='$NS1' and dedupe_scope='lifetime'"
expect_eq "该客户下这个地址仍只占一个位置" "1" "select count(*) from public.triggered_sends where client_id='$NBC' and to_address_sha256='$HN1' and dedupe_scope='lifetime' and status in ('pending','unknown_outcome','sent','delivery_delayed','delivered','suppressed','bounced','complained')"

# (2b) 唯一索引本身也要钉住（绕过认领函数直插）：failed + not_sent_confirmed 仍占着地址
NS4=a2000000-0000-0000-0000-000000000004; NS5=a2000000-0000-0000-0000-000000000005; HN3=$(printf '9%.0s' $(seq 1 64))
q "select outcome from public.triggered_send_claim('$NBA','$NS4','$HN3','kv21-5','welcome-auto',1,'$T64','$R64','s','b')" >/dev/null
q "update public.triggered_sends set status='unknown_outcome' where contact_id='$NS4' and dedupe_scope='lifetime'" >/dev/null
q "update public.triggered_sends set status='failed', reason_code='not_sent_confirmed' where contact_id='$NS4' and dedupe_scope='lifetime'" >/dev/null
expect_match "唯一索引：failed + not_sent_confirmed 仍占着地址（绕过函数直插同址 pending → 撞唯一索引）" postgres "set app.triggered_send_claim='on'; insert into public.triggered_sends(client_id,trigger_key,channel,contact_id,dedupe_scope,status,idempotency_key,first_attempt_at,authorization_id,template_key,template_version,template_sha256,rendered_sha256,to_address_sha256,local_day,claimed_at,lease_expires_at) values ('$NBC','welcome','email','$NS5','lifetime','pending','kv21-6',now(),'$NBA','welcome-auto',1,'$T64','$R64','$HN3',current_date,now(),now()+interval '10 minutes')" 'violates unique constraint "triggered_sends_lifetime_address_idx"'

# (3) failed 状态下 reason_code 只许写一次（不能先改成 not_sent_confirmed 再借例外把状态往前推）
q "select outcome from public.triggered_send_claim('$NBA','$NS3','$HN2','kv21-3','welcome-auto',1,'$T64','$R64','s','b')" >/dev/null
q "update public.triggered_sends set status='failed', reason_code='provider_rejected' where contact_id='$NS3' and dedupe_scope='lifetime'" >/dev/null
expect_match "failed 状态下改 reason_code 被拒（不能先改成 not_sent_confirmed）" postgres "update public.triggered_sends set reason_code='not_sent_confirmed' where contact_id='$NS3' and dedupe_scope='lifetime'" "ERROR:  23001: triggered_sends: reason_code may not change while status is failed"
expect_match "provider_rejected 的 failed 想一步改成 suppressed（同时偷改 reason_code）被拒" postgres "update public.triggered_sends set reason_code='not_sent_confirmed', status='suppressed' where contact_id='$NS3' and dedupe_scope='lifetime'" "HINT:  status_regress"
expect_eq "该行仍是 failed + provider_rejected" "failed|provider_rejected" "select status||'|'||reason_code from public.triggered_sends where contact_id='$NS3' and dedupe_scope='lifetime'"
expect_eq "普通 failed 仍释放同址：另一个联系人同址可认领" "claimed" "select outcome from public.triggered_send_claim('$NBA','$NS2','$HN2','kv21-4','welcome-auto',1,'$T64','$R64','s','b')"

# (4) 租约过期的 pending 只在「同一份授权、同一份渲染结果」时才接管
TKC=a0000001-0000-0000-0000-000000000003; TKA=a1000000-0000-0000-0000-000000000003; TKB=a1000000-0000-0000-0000-000000000004
TK1=a2000000-0000-0000-0000-000000000011; TK2=a2000000-0000-0000-0000-000000000012
HT1=$(printf '3%.0s' $(seq 1 64)); HT2=$(printf '7%.0s' $(seq 1 64)); R2X=$(printf '8%.0s' $(seq 1 64))
newclient $TKC cv3; actv $TKA $TKC '{"schedule":{"timezone":"Pacific/Auckland"}}' 9
q "select outcome from public.triggered_send_claim('$TKA','$TK1','$HT1','kt-1','welcome-auto',1,'$T64','$R64','s','b')" >/dev/null
q "select outcome from public.triggered_send_claim('$TKA','$TK2','$HT2','kt-2','welcome-auto',1,'$T64','$R64','s','b')" >/dev/null
q "alter table public.triggered_sends disable trigger triggered_sends_update_guard" >/dev/null
q "update public.triggered_sends set lease_expires_at = now() - interval '1 minute' where contact_id in ('$TK1','$TK2') and dedupe_scope='lifetime'" >/dev/null
q "alter table public.triggered_sends enable trigger triggered_sends_update_guard" >/dev/null
expect_eq "租约过期但重新渲染的结果变了 → in_flight（不接管、不重发）" "in_flight|pending|kt-1" "select outcome||'|'||row_status||'|'||row_idempotency_key from public.triggered_send_claim('$TKA','$TK1','$HT1','kt-1b','welcome-auto',1,'$T64','$R2X','s','b')"
expect_eq "租约过期且渲染一致 → takeover（沿用原幂等键）" "takeover|pending|kt-1" "select outcome||'|'||row_status||'|'||row_idempotency_key from public.triggered_send_claim('$TKA','$TK1','$HT1','kt-1c','welcome-auto',1,'$T64','$R64','s','b')"
q "update public.triggered_send_authorizations set revoked_at=now(), revoked_by='pm@example.test' where id='$TKA'" >/dev/null
actv $TKB $TKC '{"schedule":{"timezone":"Pacific/Auckland"}}' 9
expect_eq "租约过期但授权已换（旧内容 + 新授权）→ in_flight，不接管" "in_flight|pending|kt-2" "select outcome||'|'||row_status||'|'||row_idempotency_key from public.triggered_send_claim('$TKB','$TK2','$HT2','kt-2b','welcome-auto',1,'$T64','$R64','s','b')"

# (5) 时区必须是 IANA 名字：POSIX 写法的正负号是反的，会把本地日算错一天
TZC1=a0000001-0000-0000-0000-000000000004; TZA1=a1000000-0000-0000-0000-000000000005
TZC2=a0000001-0000-0000-0000-000000000005; TZA2=a1000000-0000-0000-0000-000000000006
TZK=a2000000-0000-0000-0000-000000000021
newclient $TZC1 cv4; actv $TZA1 $TZC1 '{"schedule":{"timezone":"+13"}}' 5
newclient $TZC2 cv5; actv $TZA2 $TZC2 '{"schedule":{"timezone":"UTC+13"}}' 5
expect_eq "时区写成 '+13'（POSIX 写法，符号反）→ rule_invalid" "rule_invalid" "select outcome from public.triggered_send_claim('$TZA1','$TZK','$HT1','ktz-1','welcome-auto',1,'$T64','$R64','s','b')"
expect_eq "时区写成 'UTC+13' → rule_invalid" "rule_invalid" "select outcome from public.triggered_send_claim('$TZA2','$TZK','$HT1','ktz-2','welcome-auto',1,'$T64','$R64','s','b')"
expect_eq "这两种情况都没写行" "0" "select count(*) from public.triggered_sends where contact_id='$TZK'"

echo; echo "== 汇总 =="
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
