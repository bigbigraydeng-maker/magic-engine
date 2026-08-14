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
ENV_FILE="src/lib/site-audit/canonical-inventory/envelope.ts"
ATT="src/lib/site-audit/canonical-inventory/attestation.ts"
SIGN="src/lib/site-audit/canonical-inventory/signing.ts"
CANON="src/lib/site-audit/canonical-inventory/canonical-json.ts"
REVIEW="src/lib/site-audit/canonical-inventory/review.ts"
DECISIONS="src/lib/site-audit/canonical-inventory/decisions.ts"
SHAPES="src/lib/site-audit/canonical-inventory/shapes.ts"
INDEX="src/lib/site-audit/canonical-inventory/index.ts"
CRAWLSTAGE="src/lib/site-audit/canonical-inventory/crawl-stage.ts"
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

# ——— #960 · L1 生成信封（承重墙） ———
check "🔴 激活时不验 L1 生成签名（协调篡改就能一路走到写库）" "$ACT" \
  "    () => checkGenerationEnvelope(envelope, deps)," \
  "    () => [],"

check "🔴 验签器的结论被忽略（等于注入了一个恒真验签器）" "$ENV_FILE" \
  "  const check = verify({ keyId: envelope.keyId, payload, signature: envelope.generationSignature })" \
  "  const check = 'valid' as const; void verify; void payload"

check "🔴 验签前不重算 digest（留着旧签名换掉 core 就过了）" "$ENV_FILE" \
  "  if (computeGenerationDigest(envelope) !== envelope.generationDigest) return 'digest_mismatch'" \
  "  if (false) return 'digest_mismatch'"

check "🔴 digest 不覆盖 planId（L1/L2 的重放身份绑定形同虚设）" "$ENV_FILE" \
  "  planId: true," \
  "  " 

check "🔴 digest 不覆盖 issuedAt（改一下就绕过七天有效期）" "$ENV_FILE" \
  "  issuedAt: true," \
  "  " 

check "🔴 digest 不覆盖 keyId（用 A 的密钥签、声称是 B 签的）" "$ENV_FILE" \
  "  keyId: true,
  planId: true," \
  "  planId: true," 

check "🔴 digest 不覆盖 core（候选随便改）" "$ENV_FILE" \
  "  core: true,
}" \
  "}" 

check "🔴 签名原文里不带 keyId（key confusion）" "$ENV_FILE" \
  "    keyId: input.keyId,
    generationDigest: input.generationDigest," \
  "    generationDigest: input.generationDigest," 

# ——— #960 · 七天有效期 ———
check "🔴 激活时不查有效期（陈旧计划照抓）" "$ACT" \
  "    () => checkFreshness(envelope, deps)," \
  "    () => [],"

check "🔴 有效期被调大（7 天变 10 年）" "$ENV_FILE" \
  "export const PLAN_MAX_AGE_DAYS = 7" \
  "export const PLAN_MAX_AGE_DAYS = 3650"

check "🔴 有效期变成可配的入参（谁都能关掉）" "$ENV_FILE" \
  "export function checkEnvelopeFreshness(issuedAt: string, nowIso: string)" \
  "export function checkEnvelopeFreshness(issuedAt: string, nowIso: string, maxAgeDays = 7)"

check "🔴 签发时间解析不了就当没过期" "$ENV_FILE" \
  "  if (!Number.isFinite(issued) || !Number.isFinite(now)) return 'invalid_timestamp'" \
  "  if (false) return 'invalid_timestamp'"

check "🔴 未来时间的信封放行（等于永不过期）" "$ENV_FILE" \
  "  if (age < 0) return 'invalid_timestamp'" \
  "  if (false) return 'invalid_timestamp'"

# ——— #960 · L2 复核完整性凭证 ———
check "🔴 激活时不验 L2 凭证" "$ACT" \
  "    () => checkAttestation(review, deps)," \
  "    () => [],"

check "🔴 L2 验签前不重算 reviewDigest" "$ATT" \
  "  if (computeReviewDigest(review.submission) !== review.reviewDigest) return 'digest_mismatch'" \
  "  if (false) return 'digest_mismatch'"

check "🔴 reviewerIdentitySource 不进 reviewDigest（盖完章能改成「已认证」）" "$ATT" \
  "  return createHash('sha256').update(canonicalJson(submission), 'utf8').digest('hex')" \
  "  return createHash('sha256').update(canonicalJson({ ...submission, reviewerIdentitySource: undefined }), 'utf8').digest('hex')"

check "🔴 不查 L1/L2 绑定（一份合法凭证能配另一份信封）" "$ACT" \
  "    () => checkBinding(envelope, review, submission)," \
  "    () => [],"

# ——— #960 · 密钥边界 ———
check "🔴 未知 keyId 放行（作废的密钥还能用）" "$SIGN" \
  "    if (secret === undefined) return 'unknown_key'" \
  "    if (secret === undefined) return 'valid'"

check "🔴 一把密钥都没配时直接放行（缺密钥被当成验过了）" "$SIGN" \
  "  if (keys.size === 0) return () => 'key_unavailable'" \
  "  if (keys.size === 0) return () => 'valid'"

check "🔴 短密钥放行（随手填的占位串也能签）" "$SIGN" \
  "    if (bytes.length < MIN_SIGNING_SECRET_BYTES) {" \
  "    if (false) {"

check "🔴 签名比较不是常量时间（退化成字符串相等）" "$SIGN" \
  "  return a.length === b.length && timingSafeEqual(a, b)" \
  "  return expected === provided"

check "🔴 本层自己去读环境变量（密钥可能随序列化混进工件）" "$SIGN" \
  "export function createUnavailableVerifier(): SignatureVerifier {" \
  "export function readEnvSecret(): string { return String(process.env.INVENTORY_PLAN_SIGNING_KEYS) }
export function createUnavailableVerifier(): SignatureVerifier {"

check "🔴 复用 Kernel 的 canonicalJson（依赖方向反了，序列化规则也不再自己版本化）" "$CANON" \
  "export function canonicalJson(value: unknown): string {" \
  "export type { KernelErrorCode } from '@/lib/kernel/errors'
export function canonicalJson(value: unknown): string {"

check "🔴 稳定序列化不排序键（同一份内容两个 digest）" "$CANON" \
  "    .sort(([a], [b]) => compareStrings(a, b))" \
  "    "

# ——— #960 · 签名 oracle ———
check "🔴 生成入口开始接受调用方传进来的候选清单（退化成签名 oracle）" "$ADAPTERS" \
  "export interface GeneratePlanInput {
  readonly clientId: string" \
  "export interface GeneratePlanInput {
  readonly discoveredUrls?: readonly string[]
  readonly clientId: string"

check "🔴 公开门面把封签器导出去（把 oracle 摆上台面）" "$INDEX" \
  "export { PLAN_MAX_AGE_DAYS } from './envelope'" \
  "export { PLAN_MAX_AGE_DAYS, sealEnvelope } from './envelope'"

# ——— 计划核心 ———
check "🔴 撞车的候选悄悄丢掉（审计里就看不见了）" "$PLAN" \
  "    const primary = claimed.get(result.canonicalUrl)" \
  "    const primary = undefined; void claimed"

check "主候选按发现顺序定（digest 不再稳定）" "$PLAN" \
  "  ).sort(compareStrings)" \
  "  )"

check "🔴 逐主机发现不进计划（缺整个站没人看得见）" "$PLAN" \
  "  const discovery = summariseDiscovery(input.discovery.perHost, approvedHosts)" \
  "  const discovery = approvedHosts.map((host) => ({ host, count: 0, foreignCount: 0, error: null })); void summariseDiscovery"

check "🔴 批准了却没发现记录的主机也放行" "$PLAN" \
  "    if (row === undefined) {" \
  "    if (false) {"

check "🔴 生成时不核对摘要计数与实际候选" "$PLAN" \
  "  assertDiscoveryMatchesCandidates(discovery, input.discovery.urls)" \
  "  void assertDiscoveryMatchesCandidates"

check "🔴 assertCoreIntact 不重新构造机器候选" "$PLAN" \
  "  assertCandidatesMachineDerived(core)" \
  "  void assertCandidatesMachineDerived"

check "🔴 assertCoreIntact 不核对计数" "$PLAN" \
  "  assertCountsMachineDerived(core)" \
  "  void assertCountsMachineDerived"

check "assertCoreIntact 不核对发现覆盖" "$PLAN" \
  "  assertDiscoveryCoverage(core)" \
  "  void assertDiscoveryCoverage"

check "assertCoreIntact 不核对摘要与候选计数" "$PLAN" \
  "  assertDiscoveryMatchesCandidates(
    core.discovery,
    core.candidates.map((c) => c.originalUrl),
  )" \
  "  void assertDiscoveryMatchesCandidates"

check "🔴 时间戳只查非空、不验 ISO（留下证明不了时间的凭据）" "$PLAN" \
  "  const parsed = Date.parse(trimmed)" \
  "  const parsed = 0; void trimmed"

# ——— 复核盖章 ———
check "🔴 盖章前不验 L1（回到「拿到什么就给什么盖章」）" "$REVIEW" \
  "  assertEnvelopeTrusted(envelope, deps.verifyGenerationSignature)" \
  "  void assertEnvelopeTrusted"

check "盖章前不验 core 的机器一致性" "$REVIEW" \
  "  assertCoreIntact(envelope.core)" \
  "  void assertCoreIntact"

check "🔴 盖章时不查 L1/L2 绑定" "$REVIEW" \
  "  assertSubmissionBindsEnvelope(envelope, submission)" \
  "  void assertSubmissionBindsEnvelope"

check "🔴 reviewerIdentitySource 不做逐字校验（agent 可以谎称已认证）" "$REVIEW" \
  "  if (submission.reviewerIdentitySource !== ALLOWED_REVIEWER_IDENTITY_SOURCE) {" \
  "  if (false) {"

check "复核不要求署名" "$REVIEW" \
  "  if (typeof submission.reviewedBy !== 'string' || submission.reviewedBy.trim().length === 0) {" \
  "  if (false) {"

check "🔴 盖章前不看决策 / 认账里的问题" "$REVIEW" \
  "  if (problems.length > 0) {" \
  "  if (false) {"

# ——— 决策与认账 ———
check "🔴 决策值不做运行时校验（拼错的值带着凭证溜下去）" "$DECISIONS" \
  "  if (!ALLOWED_REVIEWER_DECISIONS.includes(entry.decision)) {" \
  "  if (false) {"

check "🔴 人工原因码不做运行时校验" "$DECISIONS" \
  "    if (!ALLOWED_REASON_CODES.includes(code)) {" \
  "    if (false) {"

check "🔴 规则自动拒的候选允许人工覆盖" "$DECISIONS" \
  "      if (entry !== undefined) problems.push(autoRejectedProblem(candidate))" \
  "      void autoRejectedProblem"

check "🔴 没人判的候选被默认当成 accepted（漏判 = 批准）" "$DECISIONS" \
  "    const entry = table[candidate.originalUrl]" \
  "    const entry = table[candidate.originalUrl] ?? ({ decision: 'accepted' } as ReviewDecisionEntry)"

check "🔴 0 条 / 出错的主机不要求认账" "$DECISIONS" \
  "    if (row.error === null && row.count > 0) continue" \
  "    continue"

check "认账不要求署名（没署名的「我知道了」等于没人认过）" "$DECISIONS" \
  "  if (typeof ack.acknowledgedBy !== 'string' || ack.acknowledgedBy.trim().length === 0) {" \
  "  if (false) {"

check "认账不要求写理由" "$DECISIONS" \
  "  if (typeof ack.reason !== 'string' || ack.reason.trim().length === 0) {" \
  "  if (false) {"

# ——— 结构闸 ———
check "🔴 结构闸不在解引用之前（缺字段直接抛，调用方拿不到审计）" "$ACT" \
  "  const shape = checkActivationShape(input)" \
  "  const shape: ActivationBlocker[] = []; void checkActivationShape"

check "🔴 增量激活不再 fail closed（防重放当前只靠空库闸）" "$SHAPES" \
  "  if (input.mode !== 'first_activation') {" \
  "  if (false) {"

check "🔴 候选数组只查容器、不查每一项（一个 null 就直接抛）" "$SHAPES" \
  "  const badCandidate = core.candidates.findIndex((c) => !isMachineCandidateShape(c))" \
  "  const badCandidate = -1; void isMachineCandidateShape"

check "decisions / acknowledgements 是数组也放行" "$SHAPES" \
  "  if (!isPlainRecord(submission.decisions)) return bad('复核提交的 decisions 不是对象（数组也不行）')" \
  "  if (false) return bad('复核提交的 decisions 不是对象（数组也不行）')"

# ——— 激活闸 ———
check "🔴 激活侧不查身份（A 客户的计划能激活到 B 客户）" "$ACT" \
  "    () => checkIdentity(core, expected)," \
  "    () => [],"

check "🔴 激活侧不查版本（旧批准套新语义）" "$ACT" \
  "    () => checkVersions(core)," \
  "    () => [],"

check "🔴 激活侧不查发现覆盖与认账（手写计划可以缺整个站）" "$ACT" \
  "    () => checkDiscoveryAndAcknowledgements(core, submission)," \
  "    () => [],"

check "🔴 激活侧不查被接受集合" "$ACT" \
  "    () => checkAcceptedSet(resolved, core.boundary.approvedHosts)," \
  "    () => [],"

check "🔴 推导校验退化成「只要串本身规范就行」（换成另一页也认）" "$ACT" \
  "  const derived = deriveCanonicalUrl(candidate.originalUrl, { approvedHosts })" \
  "  const derived = url; void approvedHosts"

check "🔴 空库闸被拆（首次激活能覆盖已有台账）" "$ACT" \
  "  return { blockers: await checkInventoryEmpty(deps.store, core.clientId), resolved }" \
  "  void checkInventoryEmpty; return { blockers: [], resolved }"

check "🔴 写入前不复查台账仍为空" "$ACT" \
  "  const stillEmpty = await recheckInventoryEmpty(input)" \
  "  const stillEmpty = null; void recheckInventoryEmpty"

check "🔴 写入时不要求 store 在事务里再确认一次" "$ACT" \
  "      requireEmptyInventory: true," \
  "      requireEmptyInventory: false,"

check "🔴 写入结果不做精确对账（少写 / 多写都报完成）" "$ACT" \
  "  const mismatch = reconcileWriteSet(records, write.written)" \
  "  const mismatch = null; void reconcileWriteSet"

check "🔴 一页抓取失败也照常写入（部分成功报成完成）" "$ACT" \
  "  if (failures.length > 0) {
    return buildAudit({" \
  "  if (false) {
    return buildAudit({"

check "🔴 抓取结果里的 error 被忽略（反爬挑战页当成真页面）" "$CRAWLSTAGE" \
  "    if (result.error !== undefined && result.error.length > 0) {" \
  "    if (false) {"

check "🔴 分类失败的页面也写进台账（拿兜底的 other 蒙混）" "$CRAWLSTAGE" \
  "  if (!enriched.classified) {" \
  "  if (false) {"

check "审计构造器不滤掉畸形候选（最需要账的时候交不出账）" "$ACT" \
  "    .filter((c): c is MachineCandidate => isMachineCandidateShape(c))" \
  "    .filter((): boolean => true)"
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

# 🔴 锚点必须**唯一**：`if (links.length >= MAX_BFS_LINKS) {` 在 crawler.ts 里出现两次
#    （直连路径 + Jina 路径），只写这一行会靠行序碰巧命中第一处 ——
#    将来函数顺序一调，这道探针会静默改测另一个东西。带上下一行的 report 名字。
check "🔴 首页 BFS 截到上限不上报（直连路径；其余页面静默缺席）" "$CRAWLER" \
  "      if (links.length >= MAX_BFS_LINKS) {
        report('homepage-bfs-truncated'" \
  "      if (false) {
        report('homepage-bfs-truncated'"

check "🔴 首页 BFS 截到上限不上报（Jina 路径）" "$CRAWLER" \
  "      if (links.length >= MAX_BFS_LINKS) {
        report('jina-homepage-truncated'" \
  "      if (false) {
        report('jina-homepage-truncated'"

# ——— #960 补测：更具体的子判据（整道闸换成 [] 的粗粒度探针盖不住它们）———
check "🔴 身份闸不比 approvedHosts（只比租户和域名）" "$ACT" \
  "  if (!sameHostSet(core.boundary.approvedHosts, expected.approvedHosts)) {" \
  "  if (false) {"

check "🔴 身份闸不比租户" "$ACT" \
  "  if (core.clientId !== expected.clientId) {" \
  "  if (false) {"

check "身份闸不比域名" "$ACT" \
  "  if (core.boundary.requestedDomain.trim().toLowerCase() !== expected.requestedDomain.trim().toLowerCase()) {" \
  "  if (false) {"

check "版本闸不比契约版本" "$ACT" \
  "  if (core.contractVersion !== INVENTORY_PLAN_CONTRACT_VERSION) {" \
  "  if (false) {"

check "版本闸不比归一规则版本" "$ACT" \
  "  if (core.normalizationRuleVersion !== NORMALIZATION_RULE_VERSION) {" \
  "  if (false) {"

check "🔴 绑定闸不比 planId" "$ACT" \
  "  if (submission.planId !== envelope.planId) {" \
  "  if (false) {"

check "🔴 绑定闸不比 generationDigest" "$ACT" \
  "  if (submission.generationDigest !== envelope.generationDigest) {" \
  "  if (false) {"

check "🔴 绑定闸不查 L1/L2 是否共用同一把密钥" "$ACT" \
  "  if (review.keyId === envelope.keyId) {" \
  "  if (false) {"

check "🔴 绑定闸不查 reviewerIdentitySource" "$ACT" \
  "  if (submission.reviewerIdentitySource !== ALLOWED_REVIEWER_IDENTITY_SOURCE) {" \
  "  if (false) {"

check "🔴 被接受但没有 canonical 也放行" "$ACT" \
  "  if (url === null) {" \
  "  if (false) {"

check "🔴 被接受集合里的重复 canonical 不查" "$ACT" \
  "  if (seen.has(url)) {" \
  "  if (false) {"

check "🔴 发现记录里的未批准主机不查" "$ACT" \
  "  if (extra.length > 0) {" \
  "  if (false) {"

check "🔴 core 机器一致性兜底闸被拆" "$ACT" \
  "    () => checkCoreMachineDerived(core)," \
  "    () => [],"

check "🔴 抓取器少返回一条被当成「跳过」" "$CRAWLSTAGE" \
  "    if (result === undefined) {" \
  "    if (false) {"

check "🔴 抓取结果的 crawledAt 不是 Date 也照写（会把整个调用炸掉，账交不出来）" "$CRAWLSTAGE" \
  "    const shapeError = crawlResultShapeError(result)" \
  "    const shapeError = null; void crawlResultShapeError"

check "🔴 写入抛错不记 blocker" "$ACT" \
  "        code: 'write_failed'," \
  "        code: 'ignored'," 

check "🔴 落库口返回非数组时不兜（写入已发生却交不出账）" "$ACT" \
  "  if (!Array.isArray(written)) {" \
  "  if (false) {"

check "🔴 信封结构版本不比对（升版本 = 旧信封立刻失效，是空承诺）" "$ENV_FILE" \
  "  if (envelope.envelopeVersion !== INVENTORY_ENVELOPE_VERSION) return 'version_mismatch'" \
  "  if (false) return 'version_mismatch'"

check "🔴 凭证结构版本不比对" "$ATT" \
  "  if (review.envelopeVersion !== INVENTORY_ENVELOPE_VERSION) return 'version_mismatch'" \
  "  if (false) return 'version_mismatch'"

check "🔴 盖章时不查 L1/L2 共用密钥" "$REVIEW" \
  "  assertDistinctSigningKeys(envelope, deps.signer)" \
  "  void assertDistinctSigningKeys"

check "🔴 稳定序列化对 Date/Map 静默塌成 {}（两份不同内容同一个 digest）" "$CANON" \
  "  assertPlainContainer(value)" \
  "  void assertPlainContainer"

check "🔴 时间戳不要求显式时区（留下证明不了自己是几点的凭据）" "$PLAN" \
  "  if (!Number.isFinite(parsed) || !ISO_WITH_TIMEZONE.test(trimmed)) {" \
  "  if (!Number.isFinite(parsed)) {"

check "🔴 机器决策不做运行时白名单" "$SHAPES" \
  "    ALLOWED_MACHINE_DECISIONS.includes(value.machineDecision as MachineDecision) &&" \
  "    typeof value.machineDecision === 'string' &&"

check "🔴 decisions 的值不查（null 会抛裸 TypeError，把已知形状报成未知形状）" "$SHAPES" \
  "  return [...checkDecisionValues(submission.decisions), ...checkAcknowledgementValues(submission.acknowledgements)]" \
  "  return []"


echo "───────────────────────────────────────────────"
# 🔴 两类判据必须分开报，不许混着凑一个数字：
#    「运行时闸」拆掉会改变程序行为，红的是行为测试；
#    「架构守卫」拆掉不改变任何运行时行为，红的是 architecture.test.ts 的 grep。
#    后者同样是真判据（有些性质只有它抓得到，比如常量时间比较），
#    但把两者算成同一个「N 道闸」是类别混淆。
echo "统计口径：共 $total_count 道探针（含运行时闸与架构守卫两类，逐道单独确认）"
if [ "$fail_count" -eq 0 ]; then
  echo "✅ 全部 $total_count 道探针各自单独确认会响"
  exit 0
fi
echo "❌ $fail_count / $total_count 道探针没有确认"
exit 1
