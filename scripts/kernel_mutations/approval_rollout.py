"""K-WP01A 变异探针 · approval_rollout —— 第三轮收口批次的三项 blocker

盯的是三件事：
  ① 审批状态迁移 RPC 的**版本化**（新代码只打 _v2；缺 v2 fail closed，绝不回退）
  ② 签放行按**真实签发时刻**（挂钟）复核政策窗口，不按事务开始时间
  ③ 缺 v2 时保留**机器可识别**的错误码（503 kernel_not_provisioned，不是 500）

🔴 从 `approval.py` 拆出来是因为那个文件加完这批到了 866 行 > 铁律的 800。
   拆的是**文件位置，不是探针** —— 名字、目标、替换内容、目标测试全部原样。
   新模块必须同时登记进 `__init__.py` 的 `EXPECTED_MODULES`，
   漏登记会让这一批**静静地不跑**而汇总数字看起来完全正常。
"""

MUTATIONS = [
    # ── 第三轮 blocker ①：审批状态迁移 RPC 的版本化 ──────────────────────────
    dict(
        # 🔴 打回历史原名在生产上**不报错** —— 兼容壳让它静默成功打在旧实现上，
        #    而锚身份闸 / 政策行锁 / 挂钟复核在整个上线窗口里一条都不存在。
        name="K-WP01A 审批迁移打回历史原名（静默用上没有新保证的旧实现）",
        file="src/lib/kernel/store.ts",
        old="""  const { data, error } = await sb.rpc('kernel_resolve_pending_approval_v2', {""",
        new="""  const { data, error } = await sb.rpc('kernel_resolve_pending_approval', {""",
        test="src/lib/kernel-approval/__tests__/rollout-compat.test.ts",
        expect_fail_contains="打的是 _v2，历史原名一次都不打",
    ),
    dict(
        name="K-WP01A 审批迁移 v2 缺失时不再 fail closed",
        file="src/lib/kernel/store.ts",
        old="""  failClosedIfRpcMissing('kernel_resolve_pending_approval_v2', error, {""",
        new="""  if (false) failClosedIfRpcMissing('kernel_resolve_pending_approval_v2', error, {""",
        test="src/lib/kernel-approval/__tests__/rollout-compat.test.ts",
        expect_fail_contains="→ 503",
    ),
    dict(
        # 🔴 假 fail closed：先把没有新保证的旧入口打一遍，最后才抛错。
        #    只验「抛没抛错」的测试抓不到它 —— 那次降级写入已经落地了。
        name="K-WP01A 审批迁移假 fail-closed（先回退旧入口、最后再抛错）",
        file="src/lib/kernel/store.ts",
        old="""  failClosedIfRpcMissing('kernel_resolve_pending_approval_v2', error, {""",
        new="""  if (error) await sb.rpc('kernel_resolve_pending_approval', { p_run_id: args.runId })
  failClosedIfRpcMissing('kernel_resolve_pending_approval_v2', error, {""",
        test="src/lib/kernel-approval/__tests__/rollout-compat.test.ts",
        expect_fail_contains="历史原名一次都没被调用过",
    ),
    dict(
        name="K-WP01A 前向迁移 DROP 掉历史 resolve 入口",
        file="supabase/migrations/20260813000000_kernel_approval_identity_guards.sql",
        old="""CREATE OR REPLACE FUNCTION public.kernel_resolve_pending_approval_v2(""",
        new="""DROP FUNCTION IF EXISTS public.kernel_resolve_pending_approval(uuid, uuid, text, text, text, jsonb, numeric);
CREATE OR REPLACE FUNCTION public.kernel_resolve_pending_approval_v2(""",
        test="src/lib/kernel-approval/__tests__/sql-contract.test.ts",
        expect_fail_contains="历史原名不许被 DROP",
    ),
    dict(
        # 壳不转发 = 「迁移先 apply、代码还是旧的」那一格退回旧逻辑。
        name="K-WP01A 兼容壳不转发到 v2（迁移先上时旧代码拿不到新实现）",
        file="supabase/migrations/20260813000000_kernel_approval_identity_guards.sql",
        old="""  RETURN QUERY SELECT * FROM public.kernel_resolve_pending_approval_v2(
    p_run_id, p_pending_decision_id, p_resolution, p_resolved_by, p_reason,
    p_policy_snapshot, p_cost_estimate_usd);""",
        new="""  RETURN QUERY SELECT false, 'not_forwarded', NULL::uuid;""",
        test="src/lib/kernel-approval/__tests__/sql-contract.test.ts",
        expect_fail_contains="v2 是实现，历史原名是转发壳",
    ),

    # ── 第三轮 blocker ②：锁后按真实签发时刻复核 ────────────────────────────
    dict(
        # 🔴 回到 now()（事务开始时间）= 锁上排多久，判据就旧多久。
        name="K-WP01A 签放行回到事务开始时间（锁等待期间过期的政策照签）",
        file="supabase/migrations/20260813000000_kernel_approval_identity_guards.sql",
        old="""     AND p.effective_from <= v_signing_at
     AND (p.effective_to IS NULL OR p.effective_to > v_signing_at)""",
        new="""     AND p.effective_from <= now()
     AND (p.effective_to IS NULL OR p.effective_to > now())""",
        test="src/lib/kernel-approval/__tests__/sql-contract.test.ts",
        expect_fail_contains="签放行按**挂钟**判",
    ),
    dict(
        name="K-WP01A 拿到政策锁后不再复核时间窗",
        file="supabase/migrations/20260813000000_kernel_approval_identity_guards.sql",
        old="""    RETURN QUERY SELECT false, 'policy_expired_before_signing', NULL::uuid; RETURN;""",
        new="""    NULL; -- mutated: 不再复核""",
        test="src/lib/kernel-approval/__tests__/sql-contract.test.ts",
        expect_fail_contains="签放行按**挂钟**判",
    ),
    dict(
        # 有效期用 now() = 锁上排了多久，这张授权就凭空少活多久。
        name="K-WP01A 授权有效期不再从签发时刻推导",
        file="supabase/migrations/20260813000000_kernel_approval_identity_guards.sql",
        old="""     v_signing_at + (v_policy.decision_ttl_seconds * interval '1 second'))""",
        new="""     now() + (v_policy.decision_ttl_seconds * interval '1 second'))""",
        test="src/lib/kernel-approval/__tests__/sql-contract.test.ts",
        expect_fail_contains="签放行按**挂钟**判",
    ),
    dict(
        # 🔴 132 行的执行闸手抄漏一条判据，是不会有人发现的。
        name="K-WP01A begin_authorized_run 前向副本抄漏一条判据",
        file="supabase/migrations/20260813000000_kernel_approval_identity_guards.sql",
        old="""  IF v_decision.consumed_at IS NOT NULL THEN
    RETURN QUERY SELECT false, 'already_consumed'; RETURN;
  END IF;""",
        new="""  -- mutated: 抄漏了「这张授权已经被用掉了」那一条""",
        test="src/lib/kernel-approval/__tests__/sql-contract.test.ts",
        expect_fail_contains="差异恰好就是那四处时间源",
    ),
    dict(
        name="K-WP01A begin_authorized_run 挂钟取在行锁之前（等于没修）",
        file="supabase/migrations/20260813000000_kernel_approval_identity_guards.sql",
        old="""  v_now := clock_timestamp();""",
        new="""  -- mutated: 挪走了取挂钟那一句""",
        test="src/lib/kernel-approval/__tests__/sql-contract.test.ts",
        expect_fail_contains="差异恰好就是那四处时间源",
    ),

    # ── 第三轮 blocker ③：缺 v2 的机器可识别错误 ────────────────────────────
    dict(
        # 🔴 抛普通 Error = 码在抛出那一刻丢了 → 接口只能答 500，
        #    而这条路声明过它答 503。对运维是两条完全不同的指令。
        name="K-WP01A fail closed 抛普通 Error（丢掉码，503 退化成 500）",
        file="src/lib/kernel/rpc-versioning.ts",
        old="""  throw new KernelRpcMissingError({""",
        new="""  throw new Error('这个 RPC 还不存在')
  void ({""",
        test="src/lib/kernel-approval/__tests__/rollout-compat.test.ts",
        expect_fail_contains="→ 503",
    ),
    dict(
        # 判得太宽 = 真故障被说成「没 apply」，运维照着 apply 也修不好。
        name="K-WP01A 把所有失败都当成「没 apply」（权限/超时也 fail closed）",
        file="src/lib/kernel/rpc-versioning.ts",
        old="""  if (error.code === '42883' || error.code === 'PGRST202') return error.code""",
        new="""  if (error.code) return error.code""",
        test="src/lib/kernel-approval/__tests__/rollout-compat.test.ts",
        expect_fail_contains="不许把别的故障也说成「没 apply」",
    ),
    dict(
        # 另一半：把无关的码塞进「没启用」白名单 → 权限/超时被答成 503，
        # 运维照着去 apply 也修不好，而监控上只看到一条无害的 503。
        name="K-WP01A「没启用」码表放进无关故障（权限/超时被答成 503）",
        file="src/lib/kernel-approval/errors.ts",
        old="""const NOT_PROVISIONED_CODES = new Set(['42P01', '42883', 'PGRST202', 'PGRST205'])""",
        new="""const NOT_PROVISIONED_CODES = new Set(['42P01', '42883', 'PGRST202', 'PGRST205', '42501', '57014'])""",
        test="src/lib/kernel-approval/__tests__/not-provisioned.test.ts",
        expect_fail_contains="别的失败一律不算「没启用」",
    ),
    dict(
        name="K-WP01A 接口层不再把缺 RPC 映射成 503",
        file="src/lib/kernel-approval/http.ts",
        old="""  if (isKernelNotProvisioned(err)) {""",
        new="""  if (false) {""",
        test="src/lib/kernel-approval/__tests__/rollout-compat.test.ts",
        expect_fail_contains="→ 503",
    ),
    dict(
        # 🔴 本批次真实踩到的那一步：加了新 RPC 返回码，忘了同步非终态清单。
        #    后果不是报错，是它掉进兜底的 INVALID_STATE → 接口答终态的
        #    not_pending → 界面把一条还等着人点的待办抹掉。当时整套测试是全绿的。
        name="K-WP01A 新返回码没归类（非终态被答成终态，待办被抹掉）",
        file="src/lib/kernel/human-approval.ts",
        old="""  'policy_expired_before_signing',
])""",
        new="""])""",
        test="src/lib/kernel-approval/__tests__/sql-contract.test.ts",
        expect_fail_contains="每个返回码要么在两张非终态清单里",
    ),
]
