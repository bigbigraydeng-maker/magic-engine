#!/usr/bin/env bash
# 台账层（Issue #930）变异验证 —— 每一道闸单独确认「拆掉它就会有测试变红」。
#
# 🔴 为什么必须逐道单独拆：一道闸被另一道遮蔽时，它的测试永远不会响 ——
#    整个维度零覆盖，而套件照样全绿。
#
# 用法：bash scripts/canonical-inventory-mutation-check.sh
# 退出码 0 = 每一道闸都确认会响。
#
# 注意：判据套件跑 canonical-inventory 目录 + crawler 单测。台账的「发现是否完整」
#      这一维的闸装在 crawler.ts 里（被吞掉的失败要报出来），不把它的测试算进来，
#      那几道闸拆掉也不会红。job-executor 有 2 条**先于本分支就红**的历史用例，
#      混进来会让基线不为 0，判据就失去意义 —— 所以只加 crawler.test.ts 这一个文件。

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

SUITE="src/lib/site-audit/canonical-inventory"
RULES="src/lib/site-audit/canonical-inventory/url-rules.ts"
PLAN="src/lib/site-audit/canonical-inventory/plan.ts"
ACT="src/lib/site-audit/canonical-inventory/activation.ts"
ADAPTERS="src/lib/site-audit/canonical-inventory/adapters.ts"
CRAWLER="src/lib/site-audit/crawler.ts"
CRAWLER_SUITE="src/lib/site-audit/__tests__/crawler.test.ts"

fail_count=0
total_count=0

# 🔴 这个脚本会**真的改生产代码**再改回来。中途被打断（Ctrl-C / 超时被 kill）时，
#    留在盘上的就是一份被变异过的源码 + 一个 .orig 备份 —— 长得跟正常工作区一样，
#    `git add -A` 会把「闸被拆掉」的那一版一起提交，而且测试还是绿的
#    （拆的就是那道闸，红的是它自己的用例，容易被当成已知失败放过去）。
#    2026-08-12 实际发生过一次：activation.ts 的分类失败闸被以 `if (false)` 提交进来。
CURRENT_MUTATED=""
restore_on_exit() {
  if [ -n "$CURRENT_MUTATED" ] && [ -f "$CURRENT_MUTATED.orig" ]; then
    mv "$CURRENT_MUTATED.orig" "$CURRENT_MUTATED"
    echo "⚠️  被打断 —— 已把 $CURRENT_MUTATED 还原回原文，工作区是干净的"
  fi
}
trap restore_on_exit EXIT INT TERM

red_count() {
  npx vitest run "$SUITE" "$CRAWLER_SUITE" --reporter=json 2>/dev/null \
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
    echo "❌ [$label] 变异目标没找到 —— 代码改了但这个脚本没跟着改，判据已失效"
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

# 🔴 基线必须严格为 0 红，否则整个判据是假的：
#    只要有一条测试本来就红，后面每一次变异都会「有红」，36 道闸会一律显示会响，
#    脚本还照样以 0 退出 —— 那正是这套验证要防的那种「看着全绿其实零覆盖」。
baseline=$(red_count)
if [ "$baseline" != "0" ]; then
  echo "❌ 基线不是 0 红（实际：$baseline）—— 先把基线修绿，否则本脚本的结论没有意义"
  exit 1
fi
echo "基线（未变异）：0 红 ✅"
echo "───────────────────────────────────────────────"

# ——— 主机边界 ———
check "🔴 主机判定退回成后缀匹配（www / 子域会混进来）" "$RULES" \
  "  return approvedHosts.some((approved) => approved === host)" \
  "  return approvedHosts.some((approved) => host.endsWith(approved))"

check "🔴 主机判定退回成 crawler 那套前缀比较" "$RULES" \
  "  return approvedHosts.some((approved) => approved === host)" \
  "  return approvedHosts.some((approved) => host.startsWith(approved))"

check "批准清单不校验（带 scheme / 通配符的写法混进来）" "$RULES" \
  "    if (/[:/\\\\?#@*]/.test(host) || host.startsWith('.') || host.endsWith('.')) {" \
  "    if (false) {"

check "空批准清单也放行（等于没有边界）" "$RULES" \
  "  if (hosts.length === 0) {" \
  "  if (false) {"

# ——— URL 归一 ———
check "http 也当合法（替对方假设会跳 https）" "$RULES" \
  "  if (parsed.protocol === 'http:') return 'insecure_scheme'" \
  "  if (parsed.protocol === 'http:') return null"

check "带凭据的 URL 放行" "$RULES" \
  "  if (parsed.username.length > 0 || parsed.password.length > 0) {" \
  "  if (false) {"

check "非默认端口放行" "$RULES" \
  "  if (parsed.port.length > 0) return { ok: false, reasonCodes: ['non_default_port'], notes }" \
  "  if (false) return { ok: false, reasonCodes: ['non_default_port'], notes }"

check "尾斜杠不归一（同一页面留下两条身份）" "$RULES" \
  "  if (path.length > 1 && path.endsWith('/')) {" \
  "  if (false) {"

check "片段不去掉" "$RULES" \
  "https://\${parsed.hostname}\${path}\${query.search}" \
  "https://\${parsed.hostname}\${path}\${query.search}\${parsed.hash}"

check "🔴 有意义的查询参数被一并删掉（两个真实页面合并成一条）" "$RULES" \
  "    kept.push([key, value])" \
  "    if (false) kept.push([key, value])"

check "查询参数不排序（顺序不同就多出一条候选）" "$RULES" \
  "  const sorted = [...kept].sort((a, b) => compare(a[0], b[0]))" \
  "  const sorted = [...kept]"

check "🔴 同名重复参数按值排（两个真实页面被合并成一条）" "$RULES" \
  "  const sorted = [...kept].sort((a, b) => compare(a[0], b[0]))" \
  "  const sorted = [...kept].sort((a, b) => (a[0] === b[0] ? compare(a[1], b[1]) : compare(a[0], b[0])))"

check "🔴 百分号转义大小写不统一（同一页面两个身份，撞车检测看不见）" "$RULES" \
  "  let path = parsed.pathname.replace(/%([0-9a-fA-F]{2})/g, (_m, hex: string) => \`%\${hex.toUpperCase()}\`)" \
  "  let path = parsed.pathname"

check "推导退化成「只要能归一就行」（换成另一页也认）" "$RULES" \
  "  return result.ok ? result.canonicalUrl : null" \
  "  return result.ok ? result.canonicalUrl : originalUrl"

# ——— 计划 ———
check "🔴 合规候选直接给 accepted（回到「发现即接受」）" "$PLAN" \
  "      decision: 'pending',
      reasonCodes: [],
      notes: result.notes," \
  "      decision: 'accepted',
      reasonCodes: [],
      notes: result.notes,"

check "撞车的候选悄悄丢掉（审计里就看不见了）" "$PLAN" \
  "    const primary = claimed.get(result.canonicalUrl)
    if (primary !== undefined) {" \
  "    const primary = claimed.get(result.canonicalUrl)
    if (primary !== undefined) {
      void primary; continue
    }
    if (false) {"

check "主候选按发现顺序定（哈希不再稳定）" "$PLAN" \
  "  uniqueOriginals.sort(compareStrings)" \
  "  void compareStrings"

check "🔴 规则自动拒的候选允许人工改成 accepted" "$PLAN" \
  "    if (candidate.decision !== 'pending') {" \
  "    if (false) {"

check "🔴 哈希不覆盖决策（批准后改决策查不出来）" "$PLAN" \
  "      decision: c.decision," \
  "      decision: 'x',"

check "哈希不覆盖复核签名" "$PLAN" \
  "    review: plan.review === null ? null : {
      reviewedBy: plan.review.reviewedBy,
      reviewedAt: plan.review.reviewedAt,
      note: plan.review.note ?? null,
    }," \
  "    review: null,"

check "哈希不覆盖计数" "$PLAN" \
  "    counts: {
      discovered: plan.counts.discovered,
      pending: plan.counts.pending,
      accepted: plan.counts.accepted,
      rejected: plan.counts.rejected,
      deferred: plan.counts.deferred,
    }," \
  "    counts: null as never,"

check "🔴 盖章前不验来料（替任意输入重新背书）" "$PLAN" \
  "  assertPlanIntact(plan)" \
  "  void assertPlanIntact"

check "🔴 不重新构造机器候选（预置 accepted + 重算哈希就能混过去）" "$PLAN" \
  "  assertCandidatesMachineDerived(plan)" \
  "  void assertCandidatesMachineDerived"

check "🔴 重构比对不看决策（只比 canonical，预置 accepted 照样过）" "$PLAN" \
  "  if (actual.decision !== expected.decision) return 'decision'" \
  "  if (false) return 'decision'"

check "重构比对不看原因码 / 留痕 / 撞车指向" "$PLAN" \
  "  if ((actual.duplicateOf ?? null) !== (expected.duplicateOf ?? null)) return 'duplicateOf'" \
  "  if (false) return 'duplicateOf'"

check "同一条原始 URL 出现多次也放行" "$PLAN" \
  "  if (new Set(originals).size !== originals.length) {" \
  "  if (false) {"

check "🔴 盖章前不核对计数与候选清单（malformed / 未批准主机的候选被整条删掉也不响）" "$PLAN" \
  "  assertCandidatesMachineDerived(plan)
  assertCountsMachineDerived(plan)" \
  "  assertCandidatesMachineDerived(plan)
  void assertCountsMachineDerived"

check "🔴 已签名的计划还能再盖一次章" "$PLAN" \
  "  if (plan.review !== null) {" \
  "  if (false) {"

check "盖章前不验计划哈希" "$PLAN" \
  "  if (!verifyPlanHash(plan)) {
    throw new InventoryPlanError('plan_hash_mismatch'" \
  "  if (false) {
    throw new InventoryPlanError('plan_hash_mismatch'"

check "盖章前不验规则版本（旧计划被悄悄升级）" "$PLAN" \
  "  if (plan.normalizationRuleVersion !== NORMALIZATION_RULE_VERSION) {
    throw new InventoryPlanError(" \
  "  if (false) {
    throw new InventoryPlanError("

check "复核不要求署名" "$PLAN" \
  "  if (input.review.reviewedBy.trim().length === 0) {" \
  "  if (false) {"

check "🔴 逐主机发现不进计划（缺整个站没人看得见）" "$PLAN" \
  "  const discovery = summariseDiscovery(input, approvedHosts)" \
  "  const discovery = approvedHosts.map((host) => ({ host, count: 0, error: null, acknowledged: true })); void summariseDiscovery"

check "🔴 不核对摘要计数与实际候选（摘要说有、清单里没有，整站静默缺席）" "$PLAN" \
  "  assertDiscoveryMatchesCandidates(discovery, input.discoveredUrls)" \
  "  void assertDiscoveryMatchesCandidates"

check "🔴 批准了却没发现记录的主机也放行" "$PLAN" \
  "    if (row === undefined) {" \
  "    if (false) {"

check "🔴 0 条 / 出错的主机不要求人认过" "$PLAN" \
  "    if (incomplete && !ack) {" \
  "    if (false) {"

check "盖章时不核对发现记录与批准主机" "$PLAN" \
  "  assertDiscoveryConsistent(plan)" \
  "  void assertDiscoveryConsistent"

check "🔴 盖章时不核对发现摘要与候选计数（整条删掉一个主机的候选，剩下的字段全自洽）" "$PLAN" \
  "  assertDiscoveryMatchesCandidates(
    plan.discovery,
    plan.candidates.map((c) => c.originalUrl),
  )" \
  "  void assertDiscoveryMatchesCandidates"

check "🔴 复核时间只查非空、不验 ISO（留下证明不了时间的凭据）" "$PLAN" \
  "  const parsed = Date.parse(trimmed)" \
  "  const parsed = 0; void trimmed"

check "🔴 决策值不做运行时校验（拼错的值带着签名溜下去）" "$PLAN" \
  "    if (!ALLOWED_REVIEW_DECISIONS.includes(decision.decision)) {" \
  "    if (false) {"

check "🔴 人工原因码不做运行时校验（拼错的原因码带着签名溜下去）" "$PLAN" \
  "    if (!ALLOWED_REASON_CODES.includes(code)) {" \
  "    if (false) {"

check "🔴 复核不签名（自带哈希谁都能重算，等于没有凭据）" "$PLAN" \
  "  const reviewSignature = input.sign(finalised.planHash)" \
  "  const reviewSignature = 'unsigned'"

# ——— 激活闸 ———
check "🔴 结构闸不在解引用之前（缺字段直接抛，调用方拿不到审计）" "$ACT" \
  "  const shape = checkPlanShape(plan)" \
  "  const shape: ActivationBlocker[] = []; void checkPlanShape"

check "🔴 候选数组只查容器、不查每一项（一个 null 就直接抛）" "$ACT" \
  "  const badCandidate = plan.candidates.findIndex((c) => !isCandidateShape(c))" \
  "  const badCandidate = -1; void isCandidateShape"

check "审计构造器不滤掉畸形候选（最需要账的时候交不出账）" "$ACT" \
  "    (c): c is InventoryCandidate => isCandidateShape(c)," \
  "    (): boolean => true,"

check "🔴 激活侧不查发现覆盖（手写计划可以缺整个站）" "$ACT" \
  "    ...checkDiscoveryCoverage(plan)," \
  "    ...[],"

check "复核信息结构不查（缺 review 时 .trim() 抛出去）" "$ACT" \
  "  return checkReviewShape(plan)" \
  "  return []"

check "审计对象自己也会抛（候选不是数组时连账都交不出来）" "$ACT" \
  "(Array.isArray(plan.candidates) ? plan.candidates : []).filter(" \
  "(plan.candidates as InventoryCandidate[]).filter("

check "🔴 不验复核签名（成对改 URL + 自己重算哈希就能混进去）" "$ACT" \
  "    ...checkReviewSignature(plan, verifySignature)," \
  "    ...[],"

check "签名验不过也放行" "$ACT" \
  "  if (!ok) {" \
  "  if (false) {"

check "签名缺失也放行" "$ACT" \
  "  if (typeof signature !== 'string' || signature.trim().length === 0) {" \
  "  if (false) {"

check "验签自己抛错当成验过了" "$ACT" \
  "    return [
      {
        code: 'review_signature_unverifiable'," \
  "    return [] || [
      {
        code: 'review_signature_unverifiable',"

check "🔴 不校验计划哈希" "$ACT" \
  "  if (!verifyPlanHash(plan)) {" \
  "  if (false) {"

check "🔴 不校验租户" "$ACT" \
  "  if (plan.clientId !== expected.clientId) {" \
  "  if (false) {"

check "不校验域名" "$ACT" \
  "  if (!sameDomain(plan.boundary.requestedDomain, expected.requestedDomain)) {" \
  "  if (false) {"

check "🔴 不校验批准主机清单" "$ACT" \
  "  if (!sameHostSet(plan.boundary.approvedHosts, expected.approvedHosts)) {" \
  "  if (false) {"

check "不校验归一规则版本（旧批准套新语义）" "$ACT" \
  "  if (plan.normalizationRuleVersion !== NORMALIZATION_RULE_VERSION) {" \
  "  if (false) {"

check "不校验契约版本" "$ACT" \
  "  if (plan.contractVersion !== INVENTORY_PLAN_CONTRACT_VERSION) {" \
  "  if (false) {"

check "🔴 认不出来的决策值也放行（那条候选从每一份账里消失）" "$ACT" \
  "  if (unknown.length > 0) {" \
  "  if (false) {"

check "🔴 抓取之后的失败被记成 rejected（读审计的人以为没花过网络成本）" "$ACT" \
  "    buildAudit({ plan, accepted, status: 'failed', blockers: [blocker], failures: [], written, touched })" \
  "    buildAudit({ plan, accepted, status: touched ? 'failed' : 'rejected', blockers: [blocker], failures: [], written, touched })"

check "🔴 带 pending 的计划也放行（没判过当成不要）" "$ACT" \
  "  if (pending.length > 0) {" \
  "  if (false) {"

check "🔴 被接受的 URL 不再按原始 URL 重新推导（手改的能进台账）" "$ACT" \
  "  if (derived === null || derived !== url) {" \
  "  if (false) {"

check "🔴 写入前不复查台账是否仍为空（抓取那几分钟里的并发写就漏了）" "$ACT" \
  "  if (recheck !== 0) {" \
  "  if (false) {"

check "🔴 不把「必须仍为空」的要求传给 store（实现方无从在事务里再确认）" "$ACT" \
  "      requireEmptyInventory: true," \
  "      requireEmptyInventory: false,"

check "被接受集合里的重复不拦" "$ACT" \
  "  if (seen.has(url)) {" \
  "  if (false) {"

check "🔴 台账非空也照写（首次激活闸失效）" "$ACT" \
  "  if (existing !== 0) {" \
  "  if (false) {"

check "🔴 读不到台账行数当成 0" "$ACT" \
  "    return [
      {
        code: 'inventory_count_unavailable'," \
  "    return [] || [
      {
        code: 'inventory_count_unavailable',"

check "🔴 有页面失败照样写（部分成功被报成完成）" "$ACT" \
  "  if (failures.length > 0) {" \
  "  if (false) {"

check "🔴 分类失败的页面拿兜底 other 混进台账" "$ACT" \
  "    if (!enriched.classified) {" \
  "    if (false) {"

check "🔴 富集抛错直接炸掉整个调用（调用方拿不到审计）" "$ACT" \
  "      failures.push({ url, error: \`enrichment threw: \${err instanceof Error ? err.message : String(err)}\` })
      continue" \
  "      throw err"

check "抓取器少返回的 URL 当成跳过而不是失败" "$ACT" \
  "    if (result === undefined) {" \
  "    if (result === undefined) { continue }
    if (false) {"

check "抓取结果带 error 也照写（反爬挑战页进台账）" "$ACT" \
  "    if (result.error !== undefined && result.error.length > 0) {" \
  "    if (false) {"

check "🔴 写入结果不做精确对账（少写/多写都报完成）" "$ACT" \
  "  if (missing.length === 0 && unexpected.length === 0) return null" \
  "  if (true) return null"

check "写入抛错也报完成" "$ACT" \
  "    return {
      written: [],
      blocker: {
        code: 'write_failed'," \
  "    return {
      written: records.map((r) => r.canonicalUrl),
      blocker: null && {
        code: 'write_failed',"

# ——— 复用适配器 ———
check "🔴 只发现第一个批准主机（第二个站的页面静默缺席）" "$ADAPTERS" \
  "  for (const host of normaliseApprovedHosts(approvedHosts)) {" \
  "  for (const host of normaliseApprovedHosts(approvedHosts).slice(0, 1)) {"

check "逐主机条数不留痕（某个站 0 条被合并结果盖住）" "$ADAPTERS" \
  "    perHost.push(await discoverOneHost(host, seen))" \
  "    perHost.push({ host, count: 1, foreignCount: 0, error: null }); await discoverOneHost(host, seen)"

check "一个主机挂掉不留痕（跟「这个站没有页面」长得一样）" "$ADAPTERS" \
  "    return { host, count: 0, foreignCount: 0, error: err instanceof Error ? err.message : String(err) }" \
  "    void err; return { host, count: 0, foreignCount: 0, error: null }"

check "🔴 按返回总条数记账，不按精确主机归属（只带回别家 URL 也算「有页面」）" "$ADAPTERS" \
  "    if (hostnameOf(url) === host) own.add(url)" \
  "    own.add(url)"

check "🔴 批准主机不先归一（带大写就永远比不上，逼人认假的「不完整」）" "$ADAPTERS" \
  "  for (const host of normaliseApprovedHosts(approvedHosts)) {" \
  "  for (const host of approvedHosts) {"

check "🔴 sitemap 文件被当成页面记账（真实页面静默缺席）" "$ADAPTERS" \
  "    if (isSitemapFile(url)) {" \
  "    if (false) {"

check "🔴 裸主机不补 https（httpbin.org 这类主机一次请求都发不出去）" "$ADAPTERS" \
  "    found = await discoverSitemapUrls(\`https://\${host}\`, {" \
  "    found = await discoverSitemapUrls(host, {"

check "🔴 被吞掉的发现失败不记 error（部分结果被当成完整结果）" "$ADAPTERS" \
  "    swallowed.length > 0" \
  "    false"

check "🔴 抓取上限吃 crawlPages 的默认 100（超过 100 的批准清单被截断）" "$ADAPTERS" \
  "    return crawlPages([...urls], { ...opts, limit: urls.length })" \
  "    return crawlPages([...urls], opts)"

check "显式给的上限比清单还小也照跑（截断后跑出来的不是那份清单）" "$ADAPTERS" \
  "    if (opts?.limit !== undefined && opts.limit < urls.length) {" \
  "    if (false) {"

check "🔴 主机名不归一就比归属（Example.COM 一条都对不上，好端端的站被要求人工认）" "$ADAPTERS" \
  "  for (const host of normaliseApprovedHosts(approvedHosts)) {" \
  "  for (const host of approvedHosts) {"

# ——— 发现完整性（闸装在 crawler.ts，靠 crawler.test.ts 判据） ———
check "🔴 子 sitemap 返回非 2xx 不报（一棵子树没取到，跟空 sitemap 长得一样）" "$CRAWLER" \
  "            report('child-sitemap', \`HTTP \${childRes.status}\`, childUrl)" \
  "            void childRes"

check "🔴 直连路径的深度截断不报（截断跟「这棵子树是空的」长得一样）" "$CRAWLER" \
  "    report('sitemap-depth-limit', \`depth limit \${MAX_SITEMAP_DEPTH} reached\`, url)" \
  "    void url"

check "🔴 Jina 路径的深度截断不报" "$CRAWLER" \
  "    report('jina-sitemap-depth-limit', \`depth limit \${MAX_SITEMAP_DEPTH} reached\`, url)" \
  "    void url"

check "🔴 首页 BFS 凑出来的结果不上报（尽力而为被当成完整结果）" "$CRAWLER" \
  "        report('homepage-bfs-only', 'discovery fell back to homepage links (not a sitemap)', origin)" \
  "        void origin"

check "🔴 首页 BFS 截到上限不上报（其余页面静默缺席）" "$CRAWLER" \
  "      if (links.length >= MAX_BFS_LINKS) {" \
  "      if (false) {"

echo "───────────────────────────────────────────────"
if [ "$fail_count" -eq 0 ]; then
  echo "✅ 全部 $total_count 道闸各自单独确认会响"
  exit 0
fi
echo "❌ $fail_count / $total_count 道闸没有确认"
exit 1
