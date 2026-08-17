"""K-WP01A 变异探针 · approval —— K-WP01A 认证过的审批/拒绝边界（身份、tier、UUID、分页、锁、SQL 契约）

🔴 **只放探针定义，不放 runner。** 判定与执行在 `scripts/kernel-mutation-check.py`。
   拆分是因为原文件到了 2501 行 > 仓库铁律的 800 —— 拆的是**文件位置，
   不是探针**：名字、目标文件、替换内容、目标测试、以及**顺序**全部原样保留。

🔴 新增探针请加到对应主题模块里，并同步 `scripts/kernel_mutations/__init__.py`
   的 `EXPECTED_MODULES` —— 漏加载一个模块会让那一批**静静地不跑**而全绿。
"""

MUTATIONS = [
    # ── K-WP01A（#881）：认证过的审批 / 拒绝边界 ──────────────────────────────
    dict(
        # 🔴 这一刀是本轮最重要的一条：只要审批接口开始执行 capability，测试必红。
        #    换掉的是**判据本身**（禁令清单），等价于「把执行入口从边界里放出来」——
        #    直接改 service.ts 的话变异脚本还得同时改 import，锚点会脆。
        #    清单一空，`approveRun → approveAndRun` 这类改法就再没有人拦。
        name="K-WP01A 审批面不再禁执行入口（approveRun 换成 approveAndRun 也没人拦）",
        file="src/lib/kernel-approval/__tests__/architecture.test.ts",
        old="""export const APPROVAL_FORBIDDEN_SYMBOLS = [
  'approveAndRun',""",
        new="""export const APPROVAL_FORBIDDEN_SYMBOLS = [
  '__never_appears_anywhere__',""",
        test="src/lib/kernel-approval/__tests__/architecture.test.ts",
        expect_fail_contains="光是出现标识符 approveAndRun 就算违规",
    ),
    dict(
        # 同一个洞的另一半：模块层禁令没了 → `import '@/lib/capabilities'` 畅通。
        name="K-WP01A 审批面不再禁 capability / runner / gateway 的导入",
        file="src/lib/kernel-approval/__tests__/architecture.test.ts",
        old="""export const APPROVAL_FORBIDDEN_IMPORTS = [
  '@/lib/capabilities',
  '@/lib/kernel/gateway',
  '@/lib/kernel/runner',
] as const""",
        new="""export const APPROVAL_FORBIDDEN_IMPORTS = ['@/lib/__never_imported__'] as const""",
        test="src/lib/kernel-approval/__tests__/architecture.test.ts",
        expect_fail_contains="必须被发现",
    ),
    dict(
        # 真·行为侧：审批层直接把 approveRun 换成 approveAndRun。
        # 行为测试里那只 capability 计数器会当场数到调用 —— 这条证明的是
        # 「不执行」不只写在架构清单里，跑起来也真的没跑。
        name="K-WP01A 审批层改调 approveAndRun（人一点头东西就发出去了）",
        file="src/lib/kernel-approval/service.ts",
        old="""import { approveRun, rejectRun } from '@/lib/kernel/human-approval'""",
        new="""import { rejectRun } from '@/lib/kernel/human-approval'
import { approveAndRun } from '@/lib/kernel/runner'
const approveRun = async (d: never, r: string, u: string) => {
  const o = await approveAndRun(d, r, u)
  return { verdict: 'allow' as const, decision: { id: 'x', reason: 'x' }, run: o.run, ctx: null }
}""",
        test="src/lib/kernel-approval/__tests__/decision.test.ts",
        expect_fail_contains="什么都没执行",
    ),
    dict(
        name="K-WP01A 从请求体读操作者身份（伪造的 actor 就生效了）",
        file="src/lib/kernel-approval/service.ts",
        old="""  const unexpected = Object.keys(record).filter((key) => !ALLOWED_BODY_KEYS.has(key))""",
        new="""  const unexpected: string[] = []""",
        test="src/lib/kernel-approval/__tests__/decision-input.test.ts",
        expect_fail_contains="伪造身份的字段一律拒",
    ),
    dict(
        # 🔴 伪造 clientId 只能从**请求体以外**的通道来 —— 请求体那条路已经被
        #    严格解析挡死了（多一个字段就 400），所以「从 body 读 clientId」那种
        #    改法在当前实现下根本走不到，拿它当探针只会永远 MISSED。
        #    真正能走通的通道是查询串，所以这一刀打那儿。
        name="K-WP01A 归属改看调用方给的 clientId（查询串通道）",
        file="src/app/api/kernel/approvals/[runId]/decision/route.ts",
        old="""    const actor = await requireApprovalActor(run.client_id)""",
        new="""    const actor = await requireApprovalActor(
      req.nextUrl.searchParams.get('clientId') ?? run.client_id,
    )""",
        test="src/app/api/kernel/approvals/__tests__/route.test.ts",
        expect_fail_contains="查询串",
    ),
    dict(
        name="K-WP01A 删掉 requiredCapabilityTier 检查（谁登录了都能批）",
        file="src/lib/kernel-approval/service.ts",
        old="""  if (!canAuthorizeAction(actorTier, found.definition.requiredCapabilityTier)) {""",
        new="""  if (false) {""",
        test="src/lib/kernel-approval/__tests__/tier-gate.test.ts",
        expect_fail_contains="self_serve / portal_only 拿到 403 forbidden_tier",
    ),
    dict(
        # 🔴 退回**否定判断**：表面上 self_serve / portal_only 照样被拒，
        #    但「未知的 required tier」会被放行 —— 注册表哪天用上一个还没分类的
        #    新门槛，paid_client 立刻获得批准权。fail closed 的默认答案必须是「不许」。
        name="K-WP01A tier 闸退回黑名单（未知档次被放行）",
        file="src/lib/kernel-approval/service.ts",
        old="""  return APPROVAL_MATRIX[actorTier]?.has(requiredTier) ?? false""",
        new="""  if (actorTier === 'self_serve' || actorTier === 'portal_only') return false
  if (actorTier === 'admin') return true
  return requiredTier !== 'admin'""",
        test="src/lib/kernel-approval/__tests__/tier-gate.test.ts",
        expect_fail_contains="未知的 required tier",
    ),
    dict(
        name="K-WP01A 删掉 expectedDecisionId 的应用层 CAS（批的是页面上早就换掉的那一份）",
        file="src/lib/kernel/human-approval.ts",
        old="""  if (run.authorization_decision_id === expectedDecisionId) return""",
        new="""  if (true) return""",
        test="src/lib/kernel-approval/__tests__/decision.test.ts",
        expect_fail_contains="拿一个别的 decision id 来批",
    ),
    dict(
        # 拒绝那条路单独一刀 —— 两处 assert 是各自独立的调用，
        # 只验批准那一条的话，拒绝这边被删掉不会有任何测试变红。
        name="K-WP01A 拒绝路径不再校验 expectedDecisionId",
        file="src/lib/kernel/human-approval.ts",
        old="""  assertDecisionStillCurrent(run, options.expectedDecisionId, rejectedByUser)""",
        new="""  void options""",
        test="src/lib/kernel-approval/__tests__/decision.test.ts",
        expect_fail_contains="拒绝也一样：过期的 id 拒不掉",
    ),
    # 🔴 **这里刻意没有「把 pendingDecisionId 换回 pending.id」那一刀。**
    #    应用层那道 CAS 保证了两个值在能走到 RPC 的每一条路径上**必然相等**
    #    （`pending` 就是按 `run.authorization_decision_id` 读出来的，而那道闸
    #    刚刚断言过它等于调用方给的 id）。所以那一刀在行为上不可观测，
    #    写进来只会永远 MISSED，把整个变异闸变成红的 —— 拿一条抓不住的探针
    #    冒充覆盖，比没有探针更糟。
    #    把调用方那个 id 一路传下去的价值是**数据来源的结构性诚实**；
    #    真正的原子保证来自数据库那道 CAS，它由既有的
    #    「R1 resolve 复刻去掉 current-decision CAS」覆盖。
    dict(
        name="K-WP01A 表不存在被吞成空列表（界面显示「没有待办，一切正常」）",
        file="src/lib/kernel-approval/errors.ts",
        old="""export function isKernelNotProvisioned(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false""",
        new="""export function isKernelNotProvisioned(error: unknown): boolean {
  return false
  if (!error || typeof error !== 'object') return false""",
        test="src/lib/kernel-approval/__tests__/not-provisioned.test.ts",
        expect_fail_contains="表不存在 → 503 kernel_not_provisioned，不是 200 []",
    ),
    dict(
        # 反方向那一刀：把任意查询错误都当成「没启用」。
        # 一次数据库超时会被答成 503「系统还没打开」—— 那是另一件事。
        name="K-WP01A 任何查询错误都当成「内核没启用」（超时被答成没打开）",
        file="src/lib/kernel-approval/errors.ts",
        old="""export function isKernelNotProvisioned(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false""",
        new="""export function isKernelNotProvisioned(error: unknown): boolean {
  return true
  if (!error || typeof error !== 'object') return false""",
        test="src/lib/kernel-approval/__tests__/not-provisioned.test.ts",
        expect_fail_contains="别的失败一律不算「没启用」",
    ),
    dict(
        name="K-WP01A 列表不再按客户过滤（跨客户的待审批全都看得到）",
        file="src/lib/kernel-approval/queries.ts",
        old="""    .eq('client_id', clientId)
    .eq('status', 'pending_approval')""",
        new="""    .eq('status', 'pending_approval')""",
        test="src/lib/kernel-approval/__tests__/decision.test.ts",
        expect_fail_contains="A 客户的待审批不出现在 B 客户的列表里",
    ),
    dict(
        name="K-WP01A reject 不再要求写原因",
        file="src/lib/kernel-approval/service.ts",
        old="""  if (resolution === 'reject' && reason.length === 0) {""",
        new="""  if (false) {""",
        test="src/lib/kernel-approval/__tests__/decision-input.test.ts",
        expect_fail_contains="reject 不写原因",
    ),
    # ── K-WP01A · Codex 第一轮四条 P2 的回归探针 ──────────────────────────────
    dict(
        name="K-WP01A P2-1 权限查不了被压成 403（系统故障伪装成没权限）",
        file="src/lib/kernel-approval/http.ts",
        old="""    if (access.status === 403 || access.status === 402) {""",
        new="""    if (access.status !== 401) {""",
        test="src/app/api/kernel/approvals/__tests__/route.test.ts",
        expect_fail_contains="权限**查不了**（500 lookup_failed）不许被伪装成 403",
    ),
    dict(
        name="K-WP01A P2-2 不再核对决策归属（跨客户元数据泄露）",
        file="src/lib/kernel-approval/service.ts",
        old="""  if (decision.action_run_id !== run.id) return false
  if (decision.client_id !== run.client_id) return false""",
        new="""  // mutated: 只看 verdict，不看它到底是谁的""",
        test="src/lib/kernel-approval/__tests__/anchor-identity.test.ts",
        expect_fail_contains="另一个客户",
    ),
    dict(
        # 只拆客户那一半 —— 两条判据各自独立，只验一条的话另一条被删掉不会红。
        name="K-WP01A P2-2 只核对 run 不核对客户",
        file="src/lib/kernel-approval/service.ts",
        old="""  if (decision.client_id !== run.client_id) return false""",
        new="""  // mutated: 不再核对客户""",
        test="src/lib/kernel-approval/__tests__/anchor-identity.test.ts",
        expect_fail_contains="另一个客户",
    ),
    dict(
        name="K-WP01A P2-3 RPC 缺失退回 500（读路径 503、写路径 500，契约自相矛盾）",
        file="src/lib/kernel-approval/service.ts",
        old="""  if (isKernelNotProvisioned(err) || isKernelNotProvisioned({ message: messageOf(err) })) {""",
        new="""  if (false) {""",
        test="src/lib/kernel-approval/__tests__/write-path-cas.test.ts",
        expect_fail_contains="RPC 缺失",
    ),
    dict(
        name="K-WP01A P2-4 截断重新变成静默的（hasMore 恒假）",
        file="src/lib/kernel-approval/queries.ts",
        old="""  const hasMore = rows.length > limit""",
        new="""  const hasMore = false""",
        test="src/lib/kernel-approval/__tests__/pagination.test.ts",
        expect_fail_contains="hasMore 是 true",
    ),
    dict(
        name="K-WP01A P2-4 退回「最新优先」（最老那几条被永远挤出去）",
        file="src/lib/kernel-approval/queries.ts",
        old="""    .order('updated_at', { ascending: true })""",
        new="""    .order('updated_at', { ascending: false })""",
        test="src/lib/kernel-approval/__tests__/pagination.test.ts",
        expect_fail_contains="等得最久的排最前",
    ),
    # ── K-WP01A · 自动修那一轮指出的另外两条（按正确方式修，含 SQL） ──────────
    dict(
        name="K-WP01A 批准备注不往下传（人写的话被静默丢弃）",
        file="src/lib/kernel-approval/service.ts",
        old="""            reason: input.reason,
          })""",
        new="""          })""",
        test="src/lib/kernel-approval/__tests__/write-path-cas.test.ts",
        expect_fail_contains="落进 append-only 决策记录",
    ),
    dict(
        name="K-WP01A 失败落地不再带决策指针（盖掉一份新的待审批请求）",
        file="src/lib/kernel/authorize.ts",
        old="""    expectedDecisionId: args.expectedDecisionId ?? null,""",
        new="""    expectedDecisionId: null,""",
        test="src/lib/kernel-approval/__tests__/write-path-cas.test.ts",
        expect_fail_contains="不许盖掉一份新的待审批请求",
    ),
    dict(
        name="K-WP01A 假件不再复刻指针闸（SQL 有、复刻没有 → 两边分家）",
        file="src/lib/kernel/__tests__/fake-supabase.ts",
        old="""      if (run.authorization_decision_id !== expectedDecisionId) return no('decision_not_current')""",
        new="""    // mutated: 不再复刻指针闸""",
        test="src/lib/kernel-approval/__tests__/write-path-cas.test.ts",
        expect_fail_contains="不许盖掉一份新的待审批请求",
    ),
    dict(
        # 🔴 这一刀验的是「假件跟 SQL 不许分家」那道守卫本身 ——
        #    自动修那一版正是只改了应用层和假件、没改 SQL，测试却全绿。
        name="K-WP01A store 传一个 SQL 里不存在的 RPC 参数（假件跟 SQL 分家）",
        file="src/lib/kernel/store.ts",
        old="""    p_expected_decision_id: expectedDecisionId,""",
        new="""    p_expected_decision_id_typo: expectedDecisionId,""",
        test="src/lib/kernel-approval/__tests__/sql-contract.test.ts",
        expect_fail_contains="store 传的每个参数在 SQL 里都声明了",
    ),
    dict(
        # 🔴 部署兼容 blocker ①：DROP 掉五参签名 = migration 一 apply
        #    就当场打死所有还没重新部署的旧代码。数据库和代码必须能各自独立上线。
        name="K-WP01A 前向迁移 DROP 掉历史五参入口（一 apply 就打死未部署的旧代码）",
        file="supabase/migrations/20260813000000_kernel_approval_identity_guards.sql",
        old="""CREATE OR REPLACE FUNCTION public.kernel_record_fenced_deny_v2(
  p_run_id              uuid,""",
        new="""DROP FUNCTION IF EXISTS public.kernel_record_fenced_deny(uuid, bigint, text, jsonb, text);
CREATE OR REPLACE FUNCTION public.kernel_record_fenced_deny_v2(
  p_run_id              uuid,""",
        test="src/lib/kernel-approval/__tests__/sql-contract.test.ts",
        expect_fail_contains="不许被 DROP",
    ),
    dict(
        # 🔴 blocker ① 的核心安全后果：退回没有 fence 的五参调用，那次迟到的
        #    「批不了」会把审批人正在看的**另一份**请求盖成 denied。
        #    注意这一刀改完**照样会抛错** —— 只验「抛没抛」的测试抓不到它。
        name="K-WP01A v2 缺失时退回无 fence 的五参入口（先写再抛错）",
        file="src/lib/kernel/store.ts",
        old="""  failClosedIfRpcMissing('kernel_record_fenced_deny_v2', result.error, {""",
        new="""  if (result.error) await sb.rpc('kernel_record_fenced_deny', {
    p_run_id: args.runId,
    p_expected_generation: args.expectedGeneration ?? null,
    p_expected_status: args.expectedStatus ?? null,
    p_decision: args.decision,
    p_reason: args.reason,
  })
  failClosedIfRpcMissing('kernel_record_fenced_deny_v2', result.error, {""",
        test="src/lib/kernel-approval/__tests__/rollout-compat.test.ts",
        expect_fail_contains="一次都没被调用过",
    ),
    dict(
        # 分流没了 = 人工审批路径打到五参入口上，指针闸整条失效。
        name="K-WP01A 拒绝路径不再分流（带指针也打历史五参入口）",
        file="src/lib/kernel/store.ts",
        old="  if (expectedDecisionId === null) {",
        new="  if (true) {",
        test="src/lib/kernel-approval/__tests__/rollout-compat.test.ts",
        expect_fail_contains="人工审批路径（带指针）打的是 v2",
    ),
    dict(
        # 🔴 blocker ②：没有这条约束，并发插进来的更晚政策会越过那把行锁当家，
        #    审计表里留下一条照着不当家的规则签出来的放行。
        name="K-WP01A 政策生效窗口可以重叠（并发插新政策越过行锁当家）",
        file="supabase/migrations/20260813000000_kernel_approval_identity_guards.sql",
        old="""  EXCLUDE USING gist (
    client_id  WITH =,""",
        new="""  EXCLUDE USING gist (
    id  WITH =,""",
        test="src/lib/kernel-approval/__tests__/sql-contract.test.ts",
        expect_fail_contains="EXCLUDE 约束按 (客户, 动作, 时间窗) 三元组建",
    ),
    dict(
        # 存量重叠自动修 = 替客户改他们的自动化规则。必须停下等人。
        name="K-WP01A 存量重叠自动截断 effective_to（替客户改规则）",
        file="supabase/migrations/20260813000000_kernel_approval_identity_guards.sql",
        old="""  IF v_conflicts IS NOT NULL THEN
    RAISE EXCEPTION""",
        new="""  IF v_conflicts IS NOT NULL THEN
    UPDATE public.client_automation_policies SET effective_to = now() WHERE false;
    RAISE NOTICE""",
        test="src/lib/kernel-approval/__tests__/sql-contract.test.ts",
        expect_fail_contains="不自动改客户数据",
    ),
    dict(
        # 版本不判 = 契约升版后拿新版 requiredCapabilityTier 去批旧请求。
        name="K-WP01A 不再核对 action_version（拿新版规则批旧请求）",
        file="src/lib/kernel-approval/service.ts",
        old="  if (definition.version !== run.action_version) {",
        new="  if (false) {",
        test="src/lib/kernel-approval/__tests__/tier-gate.test.ts",
        expect_fail_contains="契约升过版",
    ),
    dict(
        # 展示侧那一半：definitionFor 忽略版本 → 新版标题贴在旧请求上。
        name="K-WP01A 展示侧忽略版本（新版标题贴在旧请求上）",
        file="src/lib/kernel-approval/service.ts",
        old="  const found = lookupDefinition(run)\n  return found.ok ? found.definition : null",
        new="  void lookupDefinition\n  return ACTION_REGISTRY.get(run.action_key)",
        test="src/lib/kernel-approval/__tests__/anchor-identity.test.ts",
        expect_fail_contains="版本对不上时不许拿新版定义顶替",
    ),
    dict(
        # 🔴 把门槛重新挂回拒绝路径 = 契约升版后的旧请求永久卡死（铁律：管道不许断头）。
        name="K-WP01A 拒绝也要过批准门槛（旧请求永久卡在待审批里）",
        file="src/app/api/kernel/approvals/[runId]/decision/route.ts",
        old="    if (input.resolution === 'approve') {",
        new="    if (true) {",
        test="src/app/api/kernel/approvals/__tests__/route.test.ts",
        expect_fail_contains="拒绝走得通",
    ),
    dict(
        name="K-WP01A 详情对批不了的 run 重新硬拒（连看都看不到，也就没法拒）",
        file="src/app/api/kernel/approvals/[runId]/route.ts",
        old="    const permissions = approvalPermissionsFor(run, actor.tier)",
        new="    assertActorMayApprove(run, actor.tier)\n    const permissions = approvalPermissionsFor(run, actor.tier)",
        test="src/app/api/kernel/approvals/__tests__/route.test.ts",
        expect_fail_contains="批不了也照样给详情",
    ),
    dict(
        name="K-WP01A permissions 恒报「可批」（界面画出一个点不动的按钮）",
        file="src/lib/kernel-approval/service.ts",
        old="    return { canApprove: false, canReject: true, approveBlockedReason: found.reason }",
        new="    return { canApprove: true, canReject: true, approveBlockedReason: null }",
        test="src/lib/kernel-approval/__tests__/tier-gate.test.ts",
        expect_fail_contains="permissions 仍然说「可以拒绝」",
    ),
    dict(
        # 🔴 大写形式的合法 id 会被判成 STALE_DECISION —— 批准和拒绝都永远提交不上去。
        name="K-WP01A expectedDecisionId 不再归一大小写（大写提交永远批不动）",
        file="src/lib/kernel-approval/service.ts",
        old="  return trimmed.toLowerCase()",
        new="  return trimmed",
        test="src/lib/kernel-approval/__tests__/decision-input.test.ts",
        expect_fail_contains="归一成小写",
    ),
    dict(
        # 🔴 活队列上用 offset：前面的被处理掉之后结果集左移，紧接着的那几条被整段跳过。
        name="K-WP01A 分页退回 offset（活队列翻页跳条）",
        file="src/lib/kernel-approval/queries.ts",
        old="    query = query.or(",
        new="    query = query.gt('updated_at', cursor.updatedAt) && query.or(",
        test="src/lib/kernel-approval/__tests__/pagination.test.ts",
        expect_fail_contains="时间戳撞在一起时游标不整批跳过同伴",
    ),
    dict(
        name="K-WP01A 游标只比时间不比 id（撞时间戳的同伴被整批跳过）",
        file="src/lib/kernel-approval/queries.ts",
        old="      `updated_at.gt.${cursor.updatedAt},and(updated_at.eq.${cursor.updatedAt},id.gt.${cursor.id})`,",
        new="      `updated_at.gt.${cursor.updatedAt},updated_at.gt.${cursor.updatedAt}`,",
        test="src/lib/kernel-approval/__tests__/pagination.test.ts",
        expect_fail_contains="时间戳撞在一起时游标不整批跳过同伴",
    ),
    dict(
        name="K-WP01A 读不成的游标被当成某个位置（跳条）",
        file="src/lib/kernel-approval/queries.ts",
        old="  if (!isUuid(id)) return null",
        new="  if (false) return null",
        test="src/lib/kernel-approval/__tests__/pagination.test.ts",
        expect_fail_contains="游标读不成就当没给",
    ),
    dict(
        name="K-WP01A hasMore 为真却不给 nextCursor（调用方翻不过去）",
        file="src/lib/kernel-approval/queries.ts",
        old="    nextCursor: hasMore && runs.length > 0 ? encodeCursor(runs[runs.length - 1]) : null,",
        new="    nextCursor: null,",
        test="src/lib/kernel-approval/__tests__/pagination.test.ts",
        expect_fail_contains="游标能真的翻到后面去",
    ),
    dict(
        # 假件的 or 解析退回按逗号硬切 —— 嵌套 and(...) 被劈开，keyset 分页在假件里跑不了。
        # 🔴 期望的是「已经翻过去的行不许倒回来」那条：时间与 id **反向**时，
        #    劈开后的 `id > I` 会把早就翻过去的行重新捞回来。
        #    时间与 id 同向的那几条用例抓不住这一刀 —— 劈开后恰好等价。
        name="K-WP01A 假件的 or 解析退回硬切逗号（嵌套 and 被劈开）",
        file="src/lib/kernel/__tests__/fake-supabase.ts",
        old="  return splitTopLevel(expr).some((cond) => {",
        new="  return expr.split(',').some((cond) => {",
        test="src/lib/kernel-approval/__tests__/pagination.test.ts",
        expect_fail_contains="已经翻过去的行不许倒回来",
    ),
    # 🔴 **这里没有「应用层拒绝路径归属核对」那一刀。**
    #    加过，实测 MISSED：数据库那道（pending_identity_mismatch，已提到
    #    approve/reject 公共分支）会先把同一件事挡下来，两者外部表现一模一样。
    #    被遮蔽的闸拆掉也不会红 —— 那不是覆盖，是错觉。真闸在锁里，由下面
    #    「假件把身份核对退回 approve 分支」和「前向迁移里的身份核对退回 approve 分支」
    #    两刀各自盯住。
    dict(
        # 数据库那道：身份核对退回只在 approve 分支（reject 之前就返回了）。
        name="K-WP01A 假件把身份核对退回 approve 分支（reject 绕过去）",
        file="src/lib/kernel/__tests__/fake-supabase.ts",
        old="""    if (
      pending.client_id !== run.client_id ||
      pending.action_key !== run.action_key ||
      pending.action_version !== run.action_version ||
      pending.idempotency_key !== run.idempotency_key
    ) {
      return no('pending_identity_mismatch')
    }""",
        new="    // mutated: 身份核对退回 approve 分支",
        test="src/lib/kernel-approval/__tests__/anchor-identity.test.ts",
        expect_fail_contains="数据库那道也拦",
    ),
    dict(
        name="K-WP01A 前向迁移里的身份核对退回 approve 分支",
        file="supabase/migrations/20260813000000_kernel_approval_identity_guards.sql",
        old="""  IF v_pending.client_id <> v_run.client_id
     OR v_pending.action_key <> v_run.action_key
     OR v_pending.action_version <> v_run.action_version
     OR v_pending.idempotency_key <> v_run.idempotency_key THEN
    RETURN QUERY SELECT false, 'pending_identity_mismatch', NULL::uuid; RETURN;
  END IF;

  IF p_resolution = 'reject' THEN""",
        new="""  IF p_resolution = 'reject' THEN""",
        test="src/lib/kernel-approval/__tests__/sql-contract.test.ts",
        expect_fail_contains="身份核对必须在 approve / reject 的公共分支",
    ),
    dict(
        # 🔴 锁内指针变化被压成 INVALID_STATE → 界面说「已经有结论了」，
        #    而 run 其实还停在 pending_approval 等着人点。
        name="K-WP01A 锁内指针变化不再保留 STALE_DECISION（说成「已有结论」）",
        file="src/lib/kernel/human-approval.ts",
        old="  if (reason === 'decision_not_current') {",
        new="  if (false) {",
        test="src/lib/kernel-approval/__tests__/decision.test.ts",
        expect_fail_contains="比完之后、RPC 之前 run 换了另一份审批请求",
    ),
    dict(
        # 🔴 政策竞态被压成 INVALID_STATE → 接口答 not_pending「已经有结论了」，
        #    而 run 其实还停在 pending_approval 等着人点，界面会把它抹掉。
        name="K-WP01A 政策竞态被说成「已经有结论了」（还活着的待办被抹掉）",
        file="src/lib/kernel/human-approval.ts",
        old="  if (POLICY_RACE_REASONS.has(reason)) {",
        new="  if (false) {",
        test="src/lib/kernel-approval/__tests__/write-path-cas.test.ts",
        expect_fail_contains="不是「已经有结论了」",
    ),
    dict(
        name="K-WP01A 政策竞态清单漏一条（那一条又变回「已有结论」）",
        file="src/lib/kernel/human-approval.ts",
        old="  'policy_mode_changed',",
        new="",
        test="src/lib/kernel-approval/__tests__/write-path-cas.test.ts",
        expect_fail_contains="不是「已经有结论了」",
    ),
    dict(
        # 🔴 身份闸原因被压成终态 → 一条既没结论、又还没人理顺的 run 被界面抹掉。
        name="K-WP01A 身份闸原因被说成「已经有结论了」（run 从列表里消失）",
        file="src/lib/kernel/human-approval.ts",
        old="  if (PENDING_INCONSISTENT_REASONS.has(reason)) {",
        new="  if (false) {",
        test="src/lib/kernel-approval/__tests__/anchor-identity.test.ts",
        expect_fail_contains="拒绝的写路径",
    ),
    dict(
        # 800 行上限那道守卫本身：判据写成永真就等于没有。
        name="K-WP01A 行数上限守卫空跑（清单为空照样绿）",
        file="src/lib/kernel-approval/__tests__/architecture.test.ts",
        old="  const lineCount = (file: string): number =>",
        new="  const lineCount = (_file: string): number => 1 as number\n  const _unusedLineCount = (file: string): number =>",
        test="src/lib/kernel-approval/__tests__/architecture.test.ts",
        expect_fail_contains="800 行",
    ),
    dict(
        # 🔴 拒绝旧版请求时写进新版契约快照 → append-only 审计记录自己跟自己打架。
        name="K-WP01A 拒绝旧版请求时写新版契约快照（审计记录自相矛盾）",
        file="src/lib/kernel/human-approval.ts",
        old="  return registered && registered.version === run.action_version ? registered : null",
        new="  return registered",
        test="src/lib/kernel-approval/__tests__/anchor-identity.test.ts",
        expect_fail_contains="不许写新版的契约快照",
    ),
    dict(
        # 函数行数守卫本身：抠取写坏 = 一个函数都数不到，然后「全都合规」地变绿。
        name="K-WP01A 函数行数守卫空跑（一个函数都数不到照样绿）",
        file="src/lib/kernel-approval/__tests__/architecture.test.ts",
        old="      const m = /^(export )?(async )?function (\\w+)/.exec(src[i])",
        new="      const m = /^__never_matches__(\\w+)/.exec(src[i])",
        test="src/lib/kernel-approval/__tests__/architecture.test.ts",
        expect_fail_contains="真的数得出函数长度",
    ),
    dict(
        # 🔴 还活着的不一致用终态码报 → 调用方把待办划掉 → 那条 run 永远没人处理。
        name="K-WP01A 还活着的不一致退回终态码 not_pending（活待办从管道消失）",
        file="src/lib/kernel-approval/service.ts",
        old="      'pending_inconsistent',",
        new="      'not_pending',",
        test="src/lib/kernel-approval/__tests__/anchor-identity.test.ts",
        expect_fail_contains="还活着的不一致不许用终态码报",
    ),
    dict(
        # 🔴 函数长度守卫漏掉 human-approval.ts —— 看起来盖住了审批链路，实际没有。
        name="K-WP01A 函数长度守卫漏掉 human-approval.ts（假安心）",
        file="src/lib/kernel-approval/__tests__/architecture.test.ts",
        old="  'src/lib/kernel/human-approval.ts',\n] as const",
        new="] as const",
        test="src/lib/kernel-approval/__tests__/architecture.test.ts",
        expect_fail_contains="扫描清单不许被悄悄改短",
    ),
    # ── K-WP01A · round 10（Build Control Room 裁决） ─────────────────────────
    dict(
        name="K-WP01A SQL 锚身份：不再核对 action_run_id（跨 run 错挂放行）",
        file="supabase/migrations/20260813000000_kernel_approval_identity_guards.sql",
        old="""    IF v_pending.action_run_id <> v_run.id THEN
      RETURN QUERY SELECT false, 'pending_run_mismatch', NULL::uuid; RETURN;
    END IF;""",
        new="""    IF false THEN
      RETURN QUERY SELECT false, 'pending_run_mismatch', NULL::uuid; RETURN;
    END IF;""",
        test="src/lib/kernel-approval/__tests__/sql-contract.test.ts",
        expect_fail_contains="锚身份判据",
    ),
    dict(
        name="K-WP01A 假件锚身份：不再核对 action_run_id",
        file="src/lib/kernel/__tests__/fake-supabase.ts",
        old="      if (pending.action_run_id !== run.id) return no('pending_run_mismatch')",
        new="      // mutated: 不再核对 action_run_id",
        test="src/lib/kernel-approval/__tests__/anchor-identity.test.ts",
        expect_fail_contains="同客户、另一条 run",
    ),
    dict(
        name="K-WP01A 假件锚身份：不再核对 client_id / action_key / version / 幂等键",
        file="src/lib/kernel/__tests__/fake-supabase.ts",
        old="""      if (
        pending.client_id !== run.client_id ||
        pending.action_key !== run.action_key ||
        pending.action_version !== run.action_version ||
        pending.idempotency_key !== run.idempotency_key
      ) {
        return no('pending_identity_mismatch')
      }""",
        new="      // mutated: 不再核对四元身份",
        test="src/lib/kernel-approval/__tests__/anchor-identity.test.ts",
        expect_fail_contains="只有客户不对",
    ),
    dict(
        name="K-WP01A 假件锚身份：不再要求锚是 require_approval",
        file="src/lib/kernel/__tests__/fake-supabase.ts",
        old="      if (pending.verdict !== 'require_approval') return no('not_require_approval')",
        new="      // mutated: 什么 verdict 都当审批请求",
        test="src/lib/kernel-approval/__tests__/anchor-identity.test.ts",
        expect_fail_contains="锚不是 require_approval",
    ),
    dict(
        # 🔴 锚身份对不上被压成终态 → 界面把一条还活着的待办抹掉。
        name="K-WP01A 锚身份不一致被压成终态 INVALID_STATE（活待办被抹掉）",
        file="src/lib/kernel/authorize.ts",
        old="    if (PENDING_NOT_TERMINAL_REASONS.has(written.reason)) {",
        new="    if (false) {",
        test="src/lib/kernel-approval/__tests__/anchor-identity.test.ts",
        expect_fail_contains="零新决策、run 状态与指针一个字没动",
    ),
    dict(
        # 🔴 误伤检查：把这道闸也套到自动授权路径上 = preflight 失败的自动 run 落不了 deny。
        name="K-WP01A 锚身份闸误伤自动授权路径（不带 expectedDecisionId 也卡）",
        file="src/lib/kernel/__tests__/fake-supabase.ts",
        old="    if (expectedDecisionId !== null) {\n      if (run.authorization_decision_id !== expectedDecisionId) return no('decision_not_current')",
        new="    if (true) {\n      if (run.authorization_decision_id !== expectedDecisionId) return no('decision_not_current')",
        test="src/lib/kernel-approval/__tests__/anchor-identity.test.ts",
        expect_fail_contains="自动授权路径",
    ),
    dict(
        name="K-WP01A 文件行数守卫的清单漏掉一个真实文件（给它免检）",
        file="src/lib/kernel-approval/__tests__/architecture.test.ts",
        old="    'src/lib/kernel-approval/__tests__/pagination.test.ts',\n",
        new="",
        test="src/lib/kernel-approval/__tests__/architecture.test.ts",
        expect_fail_contains="清单盖住审批面上每一个真实文件",
    ),
    dict(
        name="K-WP01A 读路径不比 action_key（错挂的 key 被当成正常待办）",
        file="src/lib/kernel-approval/service.ts",
        old="  if (decision.action_key !== run.action_key) return false",
        new="  // mutated: 不再比 action_key",
        test="src/lib/kernel-approval/__tests__/anchor-identity.test.ts",
        expect_fail_contains="action_key 对不上",
    ),
    dict(
        name="K-WP01A 读路径不比 action_version",
        file="src/lib/kernel-approval/service.ts",
        old="  if (decision.action_version !== run.action_version) return false",
        new="  // mutated: 不再比 action_version",
        test="src/lib/kernel-approval/__tests__/anchor-identity.test.ts",
        expect_fail_contains="action_version 对不上",
    ),
    dict(
        name="K-WP01A 读路径不比 idempotency_key",
        file="src/lib/kernel-approval/service.ts",
        old="  if (decision.idempotency_key !== run.idempotency_key) return false",
        new="  // mutated: 不再比 idempotency_key",
        test="src/lib/kernel-approval/__tests__/anchor-identity.test.ts",
        expect_fail_contains="idempotency_key 对不上",
    ),
    dict(
        # 🔴 判据写得再全，列没读回来就是拿 undefined 去比。
        name="K-WP01A DECISION_COLUMNS 少选身份三件套（判据静静地永远为真）",
        file="src/lib/kernel-approval/queries.ts",
        old="  'id, action_run_id, client_id, action_key, action_version, idempotency_key, ' +",
        new="  'id, action_run_id, client_id, ' +",
        test="src/lib/kernel-approval/__tests__/anchor-identity.test.ts",
        expect_fail_contains="真的选了这三个身份字段",
    ),
    # ── K-WP01A · round 12（Build Control Room 裁决）：政策行锁 ────────────────
    dict(
        # 🔴 不锁的话：Settings 在 SELECT 之后、allow 写入之前提交改动，
        #    这个函数拿旧快照照签 allow —— append-only 审计表留下一条
        #    **签发当时就已失效**的放行。
        name="K-WP01A 签放行前不锁政策行（拿旧快照签出已失效的 allow）",
        file="supabase/migrations/20260813000000_kernel_approval_identity_guards.sql",
        old="""   ORDER BY p.effective_from DESC
   LIMIT 1
     FOR UPDATE;""",
        new="""   ORDER BY p.effective_from DESC
   LIMIT 1;""",
        test="src/lib/kernel-approval/__tests__/sql-contract.test.ts",
        expect_fail_contains="active policy 的 SELECT 带 FOR UPDATE",
    ),
    dict(
        # 锁顺序成环 = 死锁。把政策锁挪到 run 锁之前就会跟只拿前两把锁的
        # kernel_record_fenced_deny 形成不同顺序。
        name="K-WP01A 锁顺序守卫空跑（三把锁顺序不再被盯着）",
        file="src/lib/kernel-approval/__tests__/sql-contract.test.ts",
        old="""  return runLock < pendingLock && pendingLock < policyLock""",
        new="""  return true""",
        test="src/lib/kernel-approval/__tests__/sql-contract.test.ts",
        expect_fail_contains="判据本身有效",
    ),
    dict(
        # reject 一旦读政策，政策被删/改之后人就说不了「不做」—— run 永久卡住。
        name="K-WP01A reject 分支开始读政策（政策漂移后连拒绝都做不了）",
        file="supabase/migrations/20260813000000_kernel_approval_identity_guards.sql",
        old="""  IF p_resolution = 'reject' THEN
    -- 拒绝不查政策：政策被删了、变了，人依然有权说「不做」。""",
        new="""  IF p_resolution = 'reject' THEN
    PERFORM 1 FROM public.client_automation_policies WHERE client_id = v_run.client_id;""",
        test="src/lib/kernel-approval/__tests__/sql-contract.test.ts",
        expect_fail_contains="reject 分支仍然不读、也不锁政策",
    ),
    # ── K-WP01A · UUID 边界（Codex round 2 · P2） ─────────────────────────────
    dict(
        name="K-WP01A 详情/决定路由不再校验 runId（畸形路径变成 500）",
        file="src/lib/kernel-approval/http.ts",
        old="  if (isUuid(value)) return value.toLowerCase()",
        new="  if (true) return String(value)",
        test="src/app/api/kernel/approvals/__tests__/route.test.ts",
        expect_fail_contains="非法 runId",
    ),
    dict(
        name="K-WP01A 请求体的 expectedDecisionId 不再校验 UUID",
        file="src/lib/kernel-approval/service.ts",
        old="  if (!isUuid(trimmed)) {",
        new="  if (false) {",
        test="src/lib/kernel-approval/__tests__/decision-input.test.ts",
        expect_fail_contains="不是合法 UUID",
    ),
    dict(
        # 🔴 校验挪到读库之后 —— 状态码仍是 400，但 DB 已经被打过一次了。
        #    只断言状态码的用例抓不住这一刀；断言「零查询零鉴权」的才抓得住。
        name="K-WP01A runId 校验挪到读库之后（顺序退化）",
        file="src/app/api/kernel/approvals/[runId]/route.ts",
        old="    const runId = requireUuid(rawRunId, 'runId')",
        new="    const runId = rawRunId\n    await loadRunForApproval(supabaseAdmin, rawRunId)\n    requireUuid(rawRunId, 'runId')",
        test="src/app/api/kernel/approvals/__tests__/route.test.ts",
        expect_fail_contains="非法 runId",
    ),
    dict(
        name="K-WP01A 列表不再校验 clientId 的 UUID 语法",
        file="src/app/api/kernel/approvals/route.ts",
        old="    const clientId = requireUuid(rawClientId, 'clientId')",
        new="    const clientId = rawClientId",
        test="src/app/api/kernel/approvals/__tests__/route.test.ts",
        expect_fail_contains="非法 clientId",
    ),
    dict(
        # 判据比数据库还严 = 把库里真实存在的行判成非法输入。
        name="K-WP01A UUID 判据加上 version/variant 位（比数据库还严）",
        file="src/lib/validation-utils.ts",
        old="const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i",
        new="const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i",
        test="src/lib/kernel-approval/__tests__/decision-input.test.ts",
        expect_fail_contains="全零 UUID 也是合法的",
    ),
    dict(
        name="K-WP01A 指针闸用 <> 而不是 IS DISTINCT FROM（遇 NULL 等于没判）",
        file="supabase/migrations/20260813000000_kernel_approval_identity_guards.sql",
        old="""    IF v_run.authorization_decision_id IS DISTINCT FROM p_expected_decision_id THEN""",
        new="""    IF v_run.authorization_decision_id <> p_expected_decision_id THEN""",
        test="src/lib/kernel-approval/__tests__/sql-contract.test.ts",
        expect_fail_contains="跟 resolve_pending_approval 那道同源",
    ),
]
