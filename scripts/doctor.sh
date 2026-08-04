#!/usr/bin/env bash
# Magic Engine — 系统自检
#
#   bash scripts/doctor.sh            全查
#   bash scripts/doctor.sh --env      只查环境变量
#   bash scripts/doctor.sh --api      只查外部 API 连通性
#   bash scripts/doctor.sh --cron     只查 cron 调度与最近执行
#   bash scripts/doctor.sh --md       输出 Markdown（供粘进 docs/STATE.md）
#
# 从 .env.local（存在的话）读变量。**永远不打印值，只打印掩码。**
# 参考：docs/ENV.md · docs/PITFALLS.md

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

MODE_ENV=0; MODE_API=0; MODE_CRON=0; MD=0
for a in "$@"; do
  case "$a" in
    --env)  MODE_ENV=1 ;;
    --api)  MODE_API=1 ;;
    --cron) MODE_CRON=1 ;;
    --md)   MD=1 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
  esac
done
if [ $((MODE_ENV+MODE_API+MODE_CRON)) -eq 0 ]; then MODE_ENV=1; MODE_API=1; MODE_CRON=1; fi

if [ "$MD" = 1 ]; then
  OK="OK"; WARN="WARN"; BAD="MISSING"; C0=""; C1=""; C2=""; C3=""; CR=""
else
  OK="✅"; WARN="⚠️ "; BAD="❌"
  C0="\033[0m"; C1="\033[1m"; C2="\033[32m"; C3="\033[31m"; CR="\033[0m"
fi

FAIL=0
say()  { printf '%b\n' "$*"; }
head1() { if [ "$MD" = 1 ]; then say ""; say "### $*"; say ""; else say ""; say "${C1}=== $* ===${CR}"; fi; }
row()  { if [ "$MD" = 1 ]; then say "| $1 | $2 | $3 |"; else printf '  %-4s %-38s %s\n' "$1" "$2" "$3"; fi; }
tblhead() { if [ "$MD" = 1 ]; then say "| 状态 | 项目 | 说明 |"; say "|---|---|---|"; fi; }

# ── 载入 .env.local（不覆盖已存在的进程变量）────────────────────────────
ENV_SRC="进程环境"
if [ -f .env.local ]; then
  ENV_SRC=".env.local + 进程环境"
  # 按 dotenv 语义解析：去 `export ` 前缀、去引号、去行内注释、去首尾空白。
  # 不这么做的话，直接拷 .env.example 得到的 `KEY=   # [必需] 说明` 会被当成「已配置」，
  # 一份完全没填的模板也能让全部核心检查显示绿色并 exit 0。
  while IFS= read -r line; do
    case "$line" in ''|\#*) continue ;; esac
    line=${line#export }
    key=${line%%=*}
    key=${key#"${key%%[![:space:]]*}"}; key=${key%"${key##*[![:space:]]}"}
    case "$key" in *[!A-Za-z0-9_]*|'') continue ;; esac
    val=${line#*=}
    val=${val#"${val%%[![:space:]]*}"}
    case "$val" in
      \"*) val=${val#\"}; val=${val%%\"*} ;;          # 双引号值：取到收尾引号
      \'*) val=${val#\'}; val=${val%%\'*} ;;          # 单引号值：同上
      \#*) val="" ;;                                  # 整行只有注释（`KEY=   # 说明`）→ 空值
      *)   val=${val%%[[:space:]]#*}                  # 裸值：去掉「空白 + #」之后的行内注释
           val=${val%"${val##*[![:space:]]}"} ;;      # 再去尾部空白
    esac
    if [ -z "${!key:-}" ] && [ -n "$val" ]; then export "$key=$val"; fi
  done < .env.local
fi

mask() {  # 只暴露长度和首尾各 2 位
  local v="$1" n=${#1}
  if [ "$n" -le 8 ]; then echo "set (len=$n)"; else echo "${v:0:2}…${v: -2} (len=$n)"; fi
}

check_env() {  # $1=名字 $2=required|optional $3=说明
  local name="$1" req="$2" note="${3:-}" val="${!1:-}"
  if [ -n "$val" ]; then
    row "$OK" "$name" "$(mask "$val")"
  elif [ "$req" = required ]; then
    row "$BAD" "$name" "未设置 — $note"; FAIL=1
  else
    row "$WARN" "$name" "未设置 — $note"
  fi
}

# ══════════════════════════════════════════════════════════════════════
if [ "$MODE_ENV" = 1 ]; then
say ""
if [ "$MD" = 1 ]; then say "## 1. 环境变量（来源：$ENV_SRC）"; else say "${C1}Magic Engine Doctor${CR} — 环境变量来源：$ENV_SRC"; fi

head1 "核心基础设施（缺一个就起不来）"; tblhead
check_env NEXT_PUBLIC_SUPABASE_URL       required "Supabase 项目 URL"
check_env NEXT_PUBLIC_SUPABASE_ANON_KEY  required "Supabase 匿名 key"
check_env SUPABASE_SERVICE_ROLE_KEY      required "服务端全权 key，ME 全部数据访问走它"
check_env CRON_SECRET                    required "所有 /api/cron/* 的 Bearer 鉴权"
check_env APP_URL                        optional "应用自身域名，邮件/OAuth 回调拼接用"
check_env NEXT_PUBLIC_APP_URL            optional "同上，前端可见版本"

head1 "AI 模型"; tblhead
check_env OPENAI_API_KEY     required "GPT-4o-mini 文案 / Vision / Realtime"
check_env ANTHROPIC_API_KEY  required "Claude Sonnet — Brief / 策略 / 诸葛亮"
check_env PERPLEXITY_API_KEY optional "AI 可见度追踪引擎之一"
check_env GEMINI_API_KEY     optional "AI 可见度追踪第 4 引擎"
check_env CF_AIG_TOKEN       optional "Cloudflare AI Gateway 鉴权"

head1 "视觉 / 视频"; tblhead
if [ -n "${ATLAS_CLOUD_API_KEY:-}" ]; then
  row "$OK" "ATLAS_CLOUD_API_KEY" "$(mask "$ATLAS_CLOUD_API_KEY")"
elif [ -n "${ATLAS_API_KEY:-}" ]; then
  row "$BAD" "ATLAS_CLOUD_API_KEY" "只设了 ATLAS_API_KEY — 代码读的是 ATLAS_CLOUD_API_KEY，图片/视频会挂。见 PITFALLS A1"
  FAIL=1
else
  row "$BAD" "ATLAS_CLOUD_API_KEY" "未设置 — WaveSpeed 图片 + Seedance 视频"; FAIL=1
fi
check_env MODELSLAB_API_KEY   optional "Muapi 图/视频引擎（P21.J 后主用）"
check_env HEYGEN_API_KEY      optional "数字人头像视频"
check_env UNSPLASH_ACCESS_KEY optional "免费商用图库，素材抓取首选源"
if [ -n "${APIFY_API_KEY:-}" ] && [ -n "${APIFY_TOKEN:-}" ]; then
  row "$OK" "APIFY_API_KEY/_TOKEN" "两个都已设置"
elif [ -n "${APIFY_API_KEY:-}${APIFY_TOKEN:-}" ]; then
  row "$WARN" "APIFY_API_KEY/_TOKEN" "只设了其中一个 — 代码两个名字都在读，见 PITFALLS A3"
else
  row "$WARN" "APIFY_API_KEY/_TOKEN" "都未设置 — Apify scraper 不可用"
fi

head1 "SEO / 数据源"; tblhead
check_env DATAFORSEO_LOGIN    required "主数据源：关键词量/KD/SERP/外链"
check_env DATAFORSEO_PASSWORD required "同上"
check_env SEMRUSH_DB          optional "市场库 au/nz（注意：这个还在用，别跟 SEMRUSH_API_KEY 一起删）"
check_env SERPAPI_API_KEY     optional "SERP 抓取 / Google AI Overviews"
check_env GOOGLE_SERVICE_ACCOUNT_CREDENTIALS optional "GA4 / GSC 服务账号 JSON"
check_env GOOGLE_CLIENT_ID    optional "Google OAuth（客户授权 GSC/GA4/GBP）"
if [ -n "${SEMRUSH_API_KEY:-}" ]; then
  row "$WARN" "SEMRUSH_API_KEY" "已设置但全仓无代码读取 — 已被 DataForSEO 取代，可清理"
fi

head1 "广告平台"; tblhead
check_env META_SYSTEM_USER_TOKEN      optional "Meta 长效 token — 缺了执行看板「直接执行」返回 424"
check_env FACEBOOK_APP_ID             optional "Meta OAuth 应用"
check_env GOOGLE_ADS_DEVELOPER_TOKEN  optional "Google Ads API（等审核，ROADMAP P18.B.0）"
check_env TIKTOK_ADS_ACCESS_TOKEN     optional "TikTok Ads"

head1 "发布 / 计费 / 安全"; tblhead
check_env PUBLER_API_KEY        optional "多平台排期发布"
check_env RESEND_API_KEY        optional "全部事务邮件"
check_env STRIPE_SECRET_KEY     optional "MTC 充值"
check_env STRIPE_WEBHOOK_SECRET optional "Stripe webhook 签名校验"
check_env CMS_TOKEN_ENCRYPTION_KEY optional "客户 CMS token 加密"
check_env INTERNAL_API_KEY      optional "内部服务间调用"
check_env FACTORY_WORKER_TOKEN  optional "Factory worker 认领工单鉴权"
if [ -n "${UPLOAD_LINK_SECRET:-}" ]; then
  row "$OK" "UPLOAD_LINK_SECRET" "$(mask "$UPLOAD_LINK_SECRET")"
else
  row "$WARN" "UPLOAD_LINK_SECRET" "未设置 — 会 fallback 到 CRON_SECRET，轮换 CRON_SECRET 将作废全部上传链接（PITFALLS A4）"
fi

head1 "危险开关（确认是你要的状态）"; tblhead
row "$([ "${FACTORY_PUBLISH_LIVE:-}" = "true" ] && echo "$OK" || echo "$WARN")" \
    "FACTORY_PUBLISH_LIVE" "= ${FACTORY_PUBLISH_LIVE:-<未设>} · 非 true 时片子只发 DRAFT（PITFALLS A2）"
row "$([ "${OUTBOUND_CALLING_ENABLED:-}" = "true" ] && echo "$WARN" || echo "$OK")" \
    "OUTBOUND_CALLING_ENABLED" "= ${OUTBOUND_CALLING_ENABLED:-<未设>} · true 表示外呼总闸已开"
row "$([ "${ADMIN_KEY_KILL_SWITCH:-}" = "true" ] && echo "$WARN" || echo "$OK")" \
    "ADMIN_KEY_KILL_SWITCH" "= ${ADMIN_KEY_KILL_SWITCH:-<未设>} · true 表示全部 admin key 已被关停"
row "$([ -n "${MOCK_EXTERNAL_SERVICES:-}" ] && echo "$WARN" || echo "$OK")" \
    "MOCK_EXTERNAL_SERVICES" "= ${MOCK_EXTERNAL_SERVICES:-<未设>} · 有值表示外部 API 全被 mock"
fi

# ══════════════════════════════════════════════════════════════════════
probe() {  # $1=名字 $2=url $3=期望状态码(逗号分隔) $4... = curl 额外参数
  local name="$1" url="$2" want="$3"; shift 3
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 12 "$@" "$url" 2>/dev/null)
  code=${code:-000}
  if [ "$code" = 000 ]; then
    row "$BAD" "$name" "连不上（超时 / DNS / 网络 / 代理）"; FAIL=1; return 1
  fi
  case ",$want," in
    *",$code,"*) row "$OK" "$name" "HTTP $code" ;;
    *)           row "$WARN" "$name" "HTTP $code（期望 $want）" ;;
  esac
}

if [ "$MODE_API" = 1 ]; then
say ""
if [ "$MD" = 1 ]; then say "## 2. 外部 API 连通性"; fi
head1 "外部 API 连通性"; tblhead

BASE="${APP_URL:-https://app.magicengine.com.au}"
probe "Magic Engine web ($BASE)" "$BASE" "200,301,302,307,308"

if [ -n "${NEXT_PUBLIC_SUPABASE_URL:-}" ] && [ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
  probe "Supabase REST" "${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/clients?select=id&limit=1" "200" \
        -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}"
else
  row "$WARN" "Supabase REST" "跳过 — 缺 URL 或 service role key"
fi

[ -n "${OPENAI_API_KEY:-}" ] \
  && probe "OpenAI" "https://api.openai.com/v1/models" "200" -H "Authorization: Bearer ${OPENAI_API_KEY}" \
  || row "$WARN" "OpenAI" "跳过 — 缺 OPENAI_API_KEY"

[ -n "${ANTHROPIC_API_KEY:-}" ] \
  && probe "Anthropic" "https://api.anthropic.com/v1/models" "200" \
       -H "x-api-key: ${ANTHROPIC_API_KEY}" -H "anthropic-version: 2023-06-01" \
  || row "$WARN" "Anthropic" "跳过 — 缺 ANTHROPIC_API_KEY"

if [ -n "${DATAFORSEO_LOGIN:-}" ] && [ -n "${DATAFORSEO_PASSWORD:-}" ]; then
  probe "DataForSEO" "https://api.dataforseo.com/v3/appendix/user_data" "200" \
        -u "${DATAFORSEO_LOGIN}:${DATAFORSEO_PASSWORD}"
else
  row "$WARN" "DataForSEO" "跳过 — 缺 login/password"
fi

[ -n "${PERPLEXITY_API_KEY:-}" ] \
  && probe "Perplexity" "https://api.perplexity.ai/chat/completions" "400,401,422" \
       -H "Authorization: Bearer ${PERPLEXITY_API_KEY}" \
  || row "$WARN" "Perplexity" "跳过 — 缺 PERPLEXITY_API_KEY"

[ -n "${PUBLER_API_KEY:-}" ] \
  && probe "Publer" "https://app.publer.io/api/v1/users/me" "200" \
       -H "Authorization: Bearer-API ${PUBLER_API_KEY}" \
  || row "$WARN" "Publer" "跳过 — 缺 PUBLER_API_KEY"

[ -n "${RESEND_API_KEY:-}" ] \
  && probe "Resend" "https://api.resend.com/domains" "200" -H "Authorization: Bearer ${RESEND_API_KEY}" \
  || row "$WARN" "Resend" "跳过 — 缺 RESEND_API_KEY"

[ -n "${META_SYSTEM_USER_TOKEN:-}" ] \
  && probe "Meta Graph" "https://graph.facebook.com/v21.0/me?access_token=${META_SYSTEM_USER_TOKEN}" "200" \
  || row "$WARN" "Meta Graph" "跳过 — 缺 META_SYSTEM_USER_TOKEN"

[ -n "${UNSPLASH_ACCESS_KEY:-}" ] \
  && probe "Unsplash" "https://api.unsplash.com/photos?per_page=1" "200" \
       -H "Authorization: Client-ID ${UNSPLASH_ACCESS_KEY}" \
  || row "$WARN" "Unsplash" "跳过 — 缺 UNSPLASH_ACCESS_KEY"
fi

# ══════════════════════════════════════════════════════════════════════
if [ "$MODE_CRON" = 1 ]; then
say ""
if [ "$MD" = 1 ]; then say "## 3. Cron 调度覆盖"; fi
head1 "Cron 调度覆盖（路由 vs 调度器）"; tblhead

ROUTES=$(ls src/app/api/cron 2>/dev/null | sort)
SCHED=$( { grep -ohE '/api/cron/[a-zA-Z0-9_-]+' render.yaml 2>/dev/null;
           grep -rohE '/api/cron/[a-zA-Z0-9_-]+' .github/workflows 2>/dev/null;
           grep -rohE 'for path in [a-zA-Z0-9_-]+' .github/workflows 2>/dev/null | sed 's|for path in |/api/cron/|'; } \
         | sed 's|/api/cron/||' | sort -u )

n_r=$(echo "$ROUTES" | grep -c . || true)
n_s=$(echo "$SCHED"  | grep -c . || true)
row "$OK" "cron 路由总数" "$n_r 个 (src/app/api/cron/)"
row "$OK" "已被调度" "$n_s 个 (render.yaml + .github/workflows)"

ORPHAN=$(comm -23 <(echo "$ROUTES") <(echo "$SCHED"))
if [ -n "$ORPHAN" ]; then
  while read -r j; do
    [ -z "$j" ] && continue
    if [ "$j" = "factory-review-sweeper" ]; then
      row "$WARN" "$j" "无调度 — 已知有意退役（Airtable 停用）"
    else
      row "$BAD" "$j" "有路由但没有任何调度器 → 永远不会自动跑（PITFALLS F1）"; FAIL=1
    fi
  done <<< "$ORPHAN"
else
  row "$OK" "孤儿 cron" "无"
fi

GHOST=$(comm -13 <(echo "$ROUTES") <(echo "$SCHED"))
[ -n "$GHOST" ] && while read -r j; do
  [ -z "$j" ] && continue
  row "$BAD" "$j" "被调度但路由不存在 → 每次触发都 404"; FAIL=1
done <<< "$GHOST"

say ""
if [ "$MD" = 1 ]; then say "## 4. Cron 最近执行"; fi
head1 "Cron 最近执行（cron_run_logs）"; tblhead

if [ -z "${NEXT_PUBLIC_SUPABASE_URL:-}" ] || [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
  row "$WARN" "cron_run_logs" "跳过 — 缺 Supabase 凭证"
else
  LOGS=$(curl -s --max-time 20 \
    -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    "${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/cron_run_logs?select=job_name,status,started_at&order=started_at.desc&limit=500" 2>/dev/null)

  if [ -z "$LOGS" ] || [ "${LOGS:0:1}" != "[" ]; then
    row "$BAD" "cron_run_logs" "查询失败（表不存在或凭证无效）"
  elif [ "$LOGS" = "[]" ]; then
    row "$WARN" "cron_run_logs" "表是空的 — 没有任何 cron 记录过执行"
  else
    printf '%s' "$LOGS" | DOCTOR_MD=$MD node -e '
      let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
        const rows=JSON.parse(s), now=Date.now(), seen=new Map();
        for (const r of rows) if (!seen.has(r.job_name)) seen.set(r.job_name, r);
        const md = process.env.DOCTOR_MD === "1";
        [...seen.values()].sort((a,b)=>a.job_name.localeCompare(b.job_name)).forEach(r=>{
          const h=(now-Date.parse(r.started_at))/36e5;
          const age = h<1 ? Math.round(h*60)+" 分钟前" : h<48 ? h.toFixed(1)+" 小时前" : (h/24).toFixed(1)+" 天前";
          const bad = r.status==="failed" || h>36;
          const icon = md ? (bad?"WARN":"OK") : (bad?"⚠️ ":"✅");
          const line = `${r.status} · ${age}`;
          if (md) console.log(`| ${icon} | ${r.job_name} | ${line} |`);
          else console.log(`  ${icon}  ${r.job_name.padEnd(38)}${line}`);
        });
      });' 2>/dev/null || row "$WARN" "cron_run_logs" "解析失败（需要 node）"
  fi
fi
fi

say ""
if [ "$MD" = 1 ]; then
  say "> 生成时间：$(date -u '+%Y-%m-%d %H:%M UTC') · 命令：\`bash scripts/doctor.sh --md\`"
else
  if [ "$FAIL" = 0 ]; then say "${C2}体检通过 — 没有 ❌${CR}"
  else say "${C3}有 ❌ 项，见上方${CR}"; fi
fi
exit $FAIL
