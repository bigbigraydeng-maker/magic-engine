#!/usr/bin/env bash
# Product Map 变异验证 —— 逐道确认「拆掉这道闸就会有测试变红」。
#
# 🔴 为什么逐道单独拆:一道闸被另一道遮蔽时,它的测试永远不会响 ——
#    整个维度零覆盖,而套件照样全绿(canonical-inventory 同款教训)。
#
# 用法:bash scripts/product-map-mutation-check.sh
#      (merge 前手跑;退出码 0 = 每一道闸都确认会响)
#
# 判据套件只跑 src/lib/product-map —— 基线必须 0 红,否则判据失效。

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

SUITE="src/lib/product-map"
SUITE2="src/lib/product-map-sync/__tests__/console-loader.test.ts"
SUITE3="src/lib/product-map-sync/__tests__/facts-adapter.test.ts"
MAT="src/lib/product-map/maturity.ts"
VAL="src/lib/product-map/validate.ts"
GRAPH="src/lib/product-map/graph.ts"

fail_count=0
total_count=0

# 🔴 本脚本会真的改生产代码再改回来。中途被打断时盘上留的是变异版源码 ——
#    trap 负责还原;若仍见 *.orig 文件,先手动 mv 回去再提交任何东西。
CURRENT_MUTATED=""
restore_on_exit() {
  if [ -n "$CURRENT_MUTATED" ] && [ -f "$CURRENT_MUTATED.orig" ]; then
    mv "$CURRENT_MUTATED.orig" "$CURRENT_MUTATED"
    echo "⚠️  被打断 —— 已把 $CURRENT_MUTATED 还原,工作区是干净的"
  fi
}
trap restore_on_exit EXIT INT TERM

red_count() {
  npx vitest run "$SUITE" "$SUITE2" "$SUITE3" --reporter=json 2>/dev/null \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s.slice(s.indexOf("{")));console.log(j.numFailedTests??0)}catch{console.log("PARSE_ERROR")}})'
}

check() {
  local label="$1" file="$2" from="$3" to="$4"
  total_count=$((total_count+1))
  cp "$file" "$file.orig"
  CURRENT_MUTATED="$file"
  node -e '
    const fs=require("fs");
    const [f,from,to]=process.argv.slice(1);
    const src=fs.readFileSync(f,"utf8");
    if(!src.includes(from)){console.error("MUTATION_TARGET_NOT_FOUND");process.exit(3)}
    fs.writeFileSync(f,src.replace(from,to));
  ' "$file" "$from" "$to"
  if [ $? -eq 3 ]; then
    echo "❌ [$label] 变异目标没找到 —— 源码改了但脚本没跟着改,判据已失效"
    mv "$file.orig" "$file"
    CURRENT_MUTATED=""
    fail_count=$((fail_count+1))
    return
  fi
  local n
  n=$(red_count)
  mv "$file.orig" "$file"
  CURRENT_MUTATED=""
  if [ "$n" = "PARSE_ERROR" ]; then
    echo "❌ [$label] 跑不出结果"
    fail_count=$((fail_count+1))
  elif [ "$n" -gt 0 ] 2>/dev/null; then
    echo "✅ [$label] 拆掉它 → $n 条红"
  else
    echo "❌ [$label] 拆掉它 → 0 条红 —— 这道闸零覆盖"
    fail_count=$((fail_count+1))
  fi
}

echo "== 基线(必须 0 红,否则判据失效) =="
baseline=$(red_count)
if [ "$baseline" != "0" ]; then
  echo "❌ 基线就有 $baseline 条红,先修基线再跑变异"
  exit 2
fi
echo "✅ 基线 0 红"
echo

echo "== 逐道拆闸 =="

# 1. merged PR 封顶 M2:让 open PR 也算实现
check "open PR 也算 merged(拆 merged 判定)" "$MAT" \
  "return fact !== undefined && fact.state === 'merged'" \
  "return fact !== undefined"

# 2. 梯子不再累积:缺口不封顶,直通最高
check "梯子缺口不封顶(拆累积语义)" "$MAT" \
  "if (!rung.satisfied(component, facts)) {" \
  "if (false) {"

# 3. legacy 也能上 M4
check "legacy 件也给 M4(拆 origin 门)" "$MAT" \
  "return c.origin === 'me2_native' && c.productionEvidence.length > 0" \
  "return c.productionEvidence.length > 0"

# 4. M5 一条 outcome 就够
check "M5 不再要求重复 outcome" "$MAT" \
  "return days.size >= 2" \
  "return days.size >= 1"

# 5. 悬空依赖不检查
check "忽略悬空依赖" "$VAL" \
  "for (const d of findDanglingDependencies(components)) {" \
  "for (const d of findDanglingDependencies([])) {"

# 6. 声明 M4 无证据不再是 error
check "M4 无生产证据也放行" "$VAL" \
  "&& c.productionEvidence.length === 0" \
  "&& false"

# 7. provider-write 路径不归一化(检查静默失效)
check "别名不归一化(module 摸对外写入口查不出来)" "$VAL" \
  "PROVIDER_WRITE_MODULES.map((m) => m.replace(/^@\\//, 'src/'))" \
  "PROVIDER_WRITE_MODULES.map((m) => m)"

# 8. 环检测恒假
check "环检测恒假" "$GRAPH" \
  "if (onStack.has(next)) {" \
  "if (false) {"

# 9/10 打在登记数据上:证明 registry.test 的对账闸对「假证据」真的会响
#    (魏征二轮:前 8 条探针全在推导层,对账层零探针 —— 而两个真洞都出在那)
SHARED_REG="src/lib/product-map/registry/shared.ts"
GEO_REG="src/lib/product-map/registry/geo.ts"

# 9. 把 adapter.meta 的 importer 证据换成隔一层的 cron(登记期真实存在过的假证据形状)
check "间接调用方冒充 importer 证据" "$SHARED_REG" \
  "ref: 'src/lib/ads-strategy/readback-sweep.ts'," \
  "ref: 'src/app/api/cron/ad-readback-sweep/route.ts',"

# 10. 把 geo 契约的 importer 换成只 import 兄弟模块 -store 的文件(前缀子串洞回归探针)
check "同前缀兄弟模块冒充 importer 证据" "$GEO_REG" \
  "ref: 'src/lib/geo-baseline/parser.ts'," \
  "ref: 'src/lib/geo-baseline/store.ts',"

# 11. observedAt 不验日期(Codex P2:'foo'/'bar' 字面去重绕开 M5 双日硬门)
#     变异 = 精确还原修复前的调用点(只查非空,不查日期合法性)
check "M5 观察日不验格式" "$MAT" \
  ".filter((e) => e.kind === 'recurring_outcome' && isValidObservationDay(e.observedAt))" \
  ".filter((e) => e.kind === 'recurring_outcome' && !!e.observedAt)"

# ── PR3 控制台的承重墙(presenter / 载入层)──────────────────────────────
PRES="src/lib/product-map/presenter.ts"
LOADER="src/lib/product-map-sync/console-loader.ts"

# 12. 「在不在跑」不再优先于成熟度(legacy 在跑的件被归成「还在建」)
check "在跑的件不归 operating" "$PRES" \
  "if (c.operationalStatus !== 'not_operating') return 'operating'" \
  "if (false) return 'operating'"

# 13. coverageGap 恒空(同步没覆盖到 → 被显示成活儿没干完)
check "coverageGap 恒空" "$PRES" \
  "const syncActive = input.loadOutcome === 'ok' && input.prFacts.length > 0" \
  "const syncActive = false"

# 14. targeted 轮冒充全量核对(健康度撒谎)
check "targeted 冒充全量核对" "$PRES" \
  "if (!input.lastFullRunAt) return 'unknown'" \
  "if (!input.lastFullRunAt) return 'fresh'"

# 15. 鲜度取 max 而不是 min(拿最新一条冒充整体鲜度;闸在 facts-adapter)
ADAPTER="src/lib/product-map-sync/facts-adapter.ts"
check "鲜度取 max 不取 min" "$ADAPTER" \
  "if (row.observed_at < oldest) oldest = row.observed_at" \
  "if (row.observed_at > oldest) oldest = row.observed_at"

# 16. 载入层把「表没建」吞成正常(降级不明示)
check "not_provisioned 被吞成 ok" "$LOADER" \
  "loadOutcome = 'not_provisioned'" \
  "loadOutcome = 'ok'"

# 17. 零行被显示成「同步结果为空」而不是「从没同步过」
check "零行不报 never_synced" "$LOADER" \
  "loadOutcome = 'never_synced'" \
  "loadOutcome = 'ok'"

echo
if [ "$fail_count" -gt 0 ]; then
  echo "❌ $total_count 道闸里 $fail_count 道没响"
  exit 1
fi
echo "✅ 全部 $total_count 道闸都会响"
