/**
 * K-WP01A 守卫 · **SQL 契约**。
 *
 * 从 `architecture.test.ts` 拆出来（那个文件已经 816 行 > 铁律的 800）。
 * 拆的是**文件位置，不是判据** —— 每一条断言原样搬过来。
 *
 * 这里只盯 SQL 那一侧的三件事：
 *   · RPC 参数在应用层 / 假件 / SQL 三处不许分家
 *   · 审批锚的身份判据在两个写 RPC 里逐条对齐
 *   · 人工批准签放行之前必须锁住它依据的那一行政策
 *
 * 🔴 这些断言证明的是 **SQL 文本里有这些判据**，**不是**「真实 Postgres 并发下
 *    真的拿到了锁」。内存假件没有事务、没有行锁 —— 真实并发验证留给
 *    K-WP01D（apply 之后）。这一点不许含糊过去。
 */

import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = process.cwd()

/**
 * 🔴 **应用层调 RPC 的参数，必须在 SQL 里真的存在。**
 *
 * 这条不是理论问题：K-WP01A 复审那一轮，自动修给
 * `kernel_record_fenced_deny` 的调用加了 `p_expected_decision_id`，
 * 同时改了内存假件 —— **但没改 SQL**。于是整套测试全绿，而生产上
 * PostgREST 会因为找不到匹配签名直接报「函数不存在」。
 * 假件跟 SQL 分家的那一刻，测试就从「证据」变成了「安慰」。
 */
describe('🔴 RPC 参数：应用层 / 假件 / SQL 三处不许分家', () => {
  const KERNEL_MIGRATION = 'supabase/migrations/20260808000003_me2_execution_kernel_v1.sql'
  const FORWARD_MIGRATION = 'supabase/migrations/20260813000000_kernel_approval_identity_guards.sql'

  const readSql = (): string =>
    readFileSync(join(ROOT, KERNEL_MIGRATION), 'utf8') +
    '\n' +
    readFileSync(join(ROOT, FORWARD_MIGRATION), 'utf8')

  /** `sb.rpc('name', { p_x: … })` 里出现的所有 `p_*` 参数名。 */
  function rpcParamsIn(code: string, rpcName: string): string[] {
    const found = new Set<string>()
    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'rpc' &&
        node.arguments[0] &&
        ts.isStringLiteralLike(node.arguments[0]) &&
        (node.arguments[0] as ts.StringLiteralLike).text === rpcName &&
        node.arguments[1] &&
        ts.isObjectLiteralExpression(node.arguments[1])
      ) {
        for (const prop of (node.arguments[1] as ts.ObjectLiteralExpression).properties) {
          const name = prop.name && ts.isIdentifier(prop.name) ? prop.name.text : null
          if (name && name.startsWith('p_')) found.add(name)
        }
      }
      node.forEachChild(visit)
    }
    visit(
      ts.createSourceFile('store.ts', code, ts.ScriptTarget.Latest, false),
    )
    return Array.from(found)
  }

  const STORE = 'src/lib/kernel/store.ts'
  const GUARDED_RPCS = [
    'kernel_record_fenced_deny',
    'kernel_record_fenced_deny_v2',
    // 🔴 是 `_v2`，不是历史原名 —— store 只许打版本化入口。
    //    历史原名今天仍然存在（兼容壳），所以打错名字不会报错，会静默
    //    成功打在旧实现上；那条由 rollout-compat 的行为断言盯着。
    'kernel_resolve_pending_approval_v2',
    'kernel_claim_run_recovery',
  ] as const

  it.each([...GUARDED_RPCS])('%s：store 传的每个参数在 SQL 里都声明了', (rpcName) => {
    const store = readFileSync(join(ROOT, STORE), 'utf8')
    const params = rpcParamsIn(store, rpcName)
    expect(params.length, `没在 ${STORE} 里找到 ${rpcName} 的调用 —— 判据空跑了`).toBeGreaterThan(0)

    const sql = readSql()
    const missing = params.filter((p) => !new RegExp(`\\b${p}\\b`).test(sql))
    expect(
      missing,
      `${rpcName} 的这些参数只存在于应用层（可能连假件也一起改了），SQL 里没有 ——\n` +
        'PostgREST 找不到匹配签名会直接报「函数不存在」，而测试因为假件同步改了照样全绿。\n' +
        `缺的是：${missing.join('、')}`,
    ).toEqual([])
  })

  it('🔴 判据本身有效：编一个 SQL 里不存在的参数，必须被抓出来', () => {
    const fake = `sb.rpc('kernel_record_fenced_deny', { p_run_id: id, p_totally_made_up: 1 })`
    const params = rpcParamsIn(fake, 'kernel_record_fenced_deny')
    expect(params).toContain('p_totally_made_up')
    expect(new RegExp('\\bp_totally_made_up\\b').test(readSql())).toBe(false)
  })

  it('🔴 历史五参入口**不许被 DROP** —— 数据库和代码必须能各自独立上线', () => {
    const forward = readFileSync(join(ROOT, FORWARD_MIGRATION), 'utf8')
    expect(
      /DROP\s+FUNCTION[^;]*\bkernel_record_fenced_deny\b/i.test(forward),
      'DROP 掉五参签名 = migration 一 apply 就当场打死所有还没重新部署的旧代码。' +
        '新行为必须挂在新名字上（_v2），不是把老入口拆了。',
    ).toBe(false)
  })

  it('🔴 两个入口都在，且五参那个签名一字未改', () => {
    const forward = readFileSync(join(ROOT, FORWARD_MIGRATION), 'utf8')
    const bodyOf = (name: string): string => {
      const start = forward.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`)
      expect(start, `${name} 必须在这条前向迁移里`).toBeGreaterThan(-1)
      const end = forward.indexOf('$$;', start)
      expect(end, `${name} 的函数体没闭合`).toBeGreaterThan(start)
      return forward.slice(start, end)
    }
    // 五参：参数列表里**不许**出现 p_expected_decision_id
    const legacy = bodyOf('kernel_record_fenced_deny')
    expect(legacy).not.toContain('p_expected_decision_id uuid')
    // 六参：新名字、新参数
    expect(bodyOf('kernel_record_fenced_deny_v2')).toContain('p_expected_decision_id uuid')
    // 老入口是转发壳，逻辑只有一份 —— 两处逐字抄必然漂移
    expect(legacy).toContain('kernel_record_fenced_deny_v2(')
  })

  it('🔴 两个入口的 EXECUTE 都收了口（anon key 印在浏览器 bundle 里）', () => {
    const forward = readFileSync(join(ROOT, FORWARD_MIGRATION), 'utf8')
    const cases: [string, string][] = [
      ['kernel_record_fenced_deny_v2', String.raw`\(uuid,\s*bigint,\s*text,\s*jsonb,\s*text,\s*uuid\)`],
      ['kernel_record_fenced_deny', String.raw`\(uuid,\s*bigint,\s*text,\s*jsonb,\s*text\)`],
    ]
    for (const [fn, sig] of cases) {
      expect(
        new RegExp(
          String.raw`REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.${fn}${sig}\s*\n?\s*FROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated`,
          'i',
        ).test(forward),
        `${fn} 没 REVOKE`,
      ).toBe(true)
      expect(
        new RegExp(
          String.raw`GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.${fn}${sig}\s*\n?\s*TO\s+service_role`,
          'i',
        ).test(forward),
        `${fn} 没 GRANT`,
      ).toBe(true)
    }
  })

  it('🔴 「政策竞态」清单跟 SQL 不许分家', () => {
    // human-approval.ts 里那份 POLICY_RACE_REASONS 说的是「RPC 这几条分支只读返回」。
    // SQL 里真有这几条，判据才站得住 —— 两处各写一份必然分家。
    const sql = readSql()
    for (const reason of [
      'no_active_policy',
      'policy_identity_changed',
      'stale_policy_version',
      'policy_mode_changed',
    ]) {
      expect(sql.includes(reason), `SQL 里必须真有 ${reason} 这条分支`).toBe(true)
    }
    const src = readFileSync(join(ROOT, 'src/lib/kernel/human-approval.ts'), 'utf8')
    const block = src.slice(src.indexOf('POLICY_RACE_REASONS'))
    for (const reason of [
      'no_active_policy',
      'policy_identity_changed',
      'stale_policy_version',
      'policy_mode_changed',
    ]) {
      expect(block.includes(reason), `human-approval.ts 的清单里少了 ${reason}`).toBe(true)
    }
  })

  it('🔴 身份核对必须在 approve / reject 的公共分支（reject 不许绕过去）', () => {
    // 🔴 只在 approve 分支里判的话，一条 client_id 属于别人的错挂决策
    //    可以被当前客户拒掉，而新签的 deny 会把对方的 policy_id / 版本抄过来。
    const forward = readFileSync(join(ROOT, FORWARD_MIGRATION), 'utf8')
    const idAt = forward.indexOf('pending_identity_mismatch')
    const rejectAt = forward.indexOf("IF p_resolution = 'reject' THEN")
    expect(idAt, '前向迁移里必须有身份核对').toBeGreaterThan(-1)
    expect(rejectAt, '前向迁移里必须有 reject 分支').toBeGreaterThan(-1)
    expect(
      idAt < rejectAt,
      '身份核对必须排在 reject 分支**之前** —— 排在后面等于 reject 整条路绕过它',
    ).toBe(true)
  })

  it('🔴 SQL 里的指针闸判据跟 resolve_pending_approval 那道同源', () => {
    const forward = readFileSync(join(ROOT, FORWARD_MIGRATION), 'utf8')
    expect(
      /authorization_decision_id\s+IS\s+DISTINCT\s+FROM\s+p_expected_decision_id/i.test(forward),
      '指针闸必须用 IS DISTINCT FROM（`<>` 遇到 NULL 是 NULL，等于没判）',
    ).toBe(true)
    expect(/decision_not_current/.test(forward)).toBe(true)
  })
})

/**
 * 🔴 **锚身份判据：SQL / 假件 / 应用层三处不许分家。**（Codex round 10 · P2）
 *
 * `kernel_record_fenced_deny` 和 `kernel_resolve_pending_approval` 是**两条写路径**。
 * 一条严一条松的话，松的那条就是被绕过去的那条 —— 而失败落地恰恰是
 * 「政策漂移 / preflight 失败」时才走的路，最容易被忽略。
 */
describe('🔴 锚身份判据在 SQL 两个 RPC 里逐条对齐', () => {
  const FORWARD_MIGRATION = 'supabase/migrations/20260813000000_kernel_approval_identity_guards.sql'
  const sql = (): string => readFileSync(join(ROOT, FORWARD_MIGRATION), 'utf8')

  /** 抠出某个函数体（到下一个 `$$;` 为止）。 */
  function functionBody(name: string): string {
    const src = sql()
    const start = src.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`)
    expect(start, `${name} 必须在这条前向迁移里`).toBeGreaterThan(-1)
    const end = src.indexOf('$$;', start)
    expect(end, `${name} 的函数体没闭合`).toBeGreaterThan(start)
    return src.slice(start, end)
  }

  /** 锚身份的五条判据 —— 两个 RPC 都必须**逐条**具备。 */
  const ANCHOR_IDENTITY_CHECKS: ReadonlyArray<[label: string, needle: string]> = [
    ['锚必须存在', "'pending_not_found'"],
    ['锚属于这条 run', 'v_pending.action_run_id <> v_run.id'],
    ['锚是 require_approval', "v_pending.verdict <> 'require_approval'"],
    ['四元身份（客户 / 动作 / 版本 / 幂等键）', 'v_pending.idempotency_key <> v_run.idempotency_key'],
    ['身份不一致的机器可读原因', "'pending_identity_mismatch'"],
  ]

  it.each([...ANCHOR_IDENTITY_CHECKS])(
    'kernel_resolve_pending_approval_v2 有「%s」',
    (_label, needle) => {
      expect(functionBody('kernel_resolve_pending_approval_v2')).toContain(needle)
    },
  )

  it.each([...ANCHOR_IDENTITY_CHECKS])(
    '🔴 kernel_record_fenced_deny 也有「%s」（失败落地这条路不许更松）',
    (_label, needle) => {
      expect(functionBody('kernel_record_fenced_deny_v2')).toContain(needle)
    },
  )

  it('🔴 四元身份四个字段一个都不少', () => {
    const body = functionBody('kernel_record_fenced_deny_v2')
    for (const field of ['client_id', 'action_key', 'action_version', 'idempotency_key']) {
      expect(body, `锚身份少比了 ${field}`).toContain(`v_pending.${field} <> v_run.${field}`)
    }
  })

  it('🔴 锚身份闸只在带 expectedDecisionId 时生效（不许误伤自动授权路径）', () => {
    const body = functionBody('kernel_record_fenced_deny_v2')
    expect(
      body,
      '整段必须包在 `IF p_expected_decision_id IS NOT NULL THEN` 里 —— ' +
        '否则 preflight 失败的自动 run 再也落不了 deny，那是误伤不是更严',
    ).toContain('IF p_expected_decision_id IS NOT NULL THEN')
  })

  it('🔴 **不**镜像政策三连（那会让政策漂移的 deny 永远落不了地）', () => {
    const body = functionBody('kernel_record_fenced_deny_v2')
    for (const forbidden of ['policy_identity_changed', 'stale_policy_version', 'policy_mode_changed']) {
      expect(
        body,
        `失败落地这条路正是为了记下「政策变了所以做不了」—— 镜像 ${forbidden} 会让它自锁`,
      ).not.toContain(forbidden)
    }
  })

  it('🔴 身份核对必须在 approve / reject 的公共分支（reject 不许绕过去）', () => {
    // 🔴 这段原来只在 approve 分支里。于是一次错挂之后 reject 会一路走到底：
    //    新签的 deny 把**别人那份决策**的 policy_id / 版本抄进这个客户的审计记录。
    //    「这份请求是不是这条 run 的」跟批不批准无关 —— 判据必须排在
    //    `IF p_resolution = 'reject'` **之前**，两条路都过。
    const body = functionBody('kernel_resolve_pending_approval_v2')
    const identityAt = body.indexOf("'pending_identity_mismatch'")
    const rejectBranchAt = body.indexOf("IF p_resolution = 'reject' THEN")
    expect(identityAt, '身份核对没找到').toBeGreaterThan(-1)
    expect(rejectBranchAt, 'reject 分支没找到').toBeGreaterThan(-1)
    expect(
      identityAt,
      '身份核对被挪进了 approve 分支 —— reject 那条路就绕过去了',
    ).toBeLessThan(rejectBranchAt)
  })

  it('🔴 指针闸用 IS DISTINCT FROM（跟 resolve_pending_approval 那道同源）', () => {
    // `<>` 遇到 NULL 求值成 NULL（不是 true）——指针为空时那道闸等于没判。
    expect(functionBody('kernel_record_fenced_deny_v2')).toContain(
      'v_run.authorization_decision_id IS DISTINCT FROM p_expected_decision_id',
    )
  })
})

/**
 * 三把锁是不是按 run → pending decision → active policy 的固定顺序拿的。
 *
 * 🔴 抽成共用判据，**真实文件和合成源码用同一个函数**。判据被放宽时，
 *    合成那条会红；各写一份的话，改真实那条的断言不会让任何测试变红（空跑）。
 */
export function locksInFixedOrder(sql: string): boolean {
  const runLock = sql.indexOf('FROM public.action_runs')
  const pendingLock = sql.indexOf('FROM public.authorization_decisions')
  const policyLock = sql.indexOf('FROM public.client_automation_policies')
  if (runLock < 0 || pendingLock < 0 || policyLock < 0) return false
  return runLock < pendingLock && pendingLock < policyLock
}

/**
 * 🔴 **签放行之前必须锁住它依据的那一行政策。**（Codex round 12 · P2）
 *
 * 不锁的话有一个真实窗口：Settings 在 `SELECT` 之后、allow 写入之前提交改动
 * （例如把模式改成 `deny`）。RPC 拿着旧快照照签 allow、把 run 改成
 * `authorized`、向审批人回「成功」—— 而客户的规则此刻已经是「禁止」。
 * Gateway 开跑前会重读政策再拦一次，所以不会真的执行；但 append-only 的
 * 审计表里已经留下一条**签发当时就已失效**的放行，那条 run 还得再走一次
 * 重新授权才能恢复。审计记录说的必须是当时的事实。
 *
 * 🔴 下面断言证明的是 **SQL 文本里有锁**，**不是**「真实 Postgres 并发下拿到了锁」。
 *    内存假件没有事务、没有行锁，证明不了锁竞争 —— 真实并发验证留给
 *    K-WP01D（apply 之后）。这一点不许含糊过去。
 */
describe('🔴 人工批准的政策行锁', () => {
  const MIGRATION = 'supabase/migrations/20260813000000_kernel_approval_identity_guards.sql'

  const resolveBody = (): string => {
    const src = readFileSync(join(ROOT, MIGRATION), 'utf8')
    const start = src.indexOf('CREATE OR REPLACE FUNCTION public.kernel_resolve_pending_approval_v2(')
    expect(start, 'kernel_resolve_pending_approval 必须在这条前向迁移里').toBeGreaterThan(-1)
    return src.slice(start, src.indexOf('$$;', start))
  }

  it('🔴 active policy 的 SELECT 带 FOR UPDATE', () => {
    const body = resolveBody()
    const sel = body.indexOf('FROM public.client_automation_policies')
    expect(sel, '找不到 active policy 查询').toBeGreaterThan(-1)
    const stmt = body.slice(sel, body.indexOf(';', sel))
    expect(
      stmt,
      'active policy 查询没带 FOR UPDATE —— 签放行依据的那一行可能在写入前被改掉',
    ).toContain('FOR UPDATE')
  })

  it('🔴 锁顺序固定：run → pending decision → active policy（不许成环）', () => {
    expect(
      locksInFixedOrder(resolveBody()),
      '三把锁顺序一致才不会跟别的路径成环 —— 政策锁必须排在 run / pending 之后',
    ).toBe(true)
  })

  it('🔴 判据本身有效：顺序反过来的合成 SQL 必须被判违规（防判据空跑）', () => {
    // 上面那条扫的是真实迁移，而真实迁移现在是对的 —— 它**永远绿**，
    // 绿得跟「判据被放宽成恒真」一模一样。这里用顺序反过来的合成 SQL 证明
    // 判据真的在比位置；两条用的是**同一个** locksInFixedOrder。
    const wrongOrder = [
      'SELECT * INTO v_policy FROM public.client_automation_policies FOR UPDATE;',
      'SELECT * INTO v_run FROM public.action_runs WHERE id = p_run_id FOR UPDATE;',
      'SELECT * INTO v_pending FROM public.authorization_decisions FOR UPDATE;',
    ].join('\n')
    expect(
      locksInFixedOrder(wrongOrder),
      '判据必须能判出「政策锁排在最前」这种成环顺序 —— 判不出就是空跑',
    ).toBe(false)
  })

  it('🔴 政策三连在**拿到锁之后**才核对（锁前比等于比一份可能马上过期的快照）', () => {
    const body = resolveBody()
    const policySelect = body.indexOf('FROM public.client_automation_policies')
    for (const code of ['policy_identity_changed', 'stale_policy_version', 'policy_mode_changed']) {
      expect(body.indexOf(code), `${code} 必须排在政策 SELECT 之后`).toBeGreaterThan(policySelect)
    }
  })

  it('🔴 锁一路盖到 allow INSERT 与 run → authorized（中间不许提交）', () => {
    const body = resolveBody()
    const policySelect = body.indexOf('FROM public.client_automation_policies')
    expect(body.indexOf("'allow'"), 'allow INSERT 必须在政策锁之后').toBeGreaterThan(policySelect)
    expect(
      body.indexOf("SET status = 'authorized'"),
      'run → authorized 必须在政策锁之后',
    ).toBeGreaterThan(policySelect)
    // plpgsql 函数跑在调用方事务里，写一句 COMMIT 会把锁提前放掉。
    expect(body, '函数体里不许出现 COMMIT').not.toContain('COMMIT')
  })

  it('🔴 reject 分支仍然不读、也不锁政策（政策漂移也能说「不做」）', () => {
    const body = resolveBody()
    const rejectBranch = body.indexOf("IF p_resolution = 'reject' THEN")
    const rejectEnd = body.indexOf('-- ── approve', rejectBranch)
    expect(rejectBranch).toBeGreaterThan(-1)
    expect(rejectEnd).toBeGreaterThan(rejectBranch)
    expect(
      body.slice(rejectBranch, rejectEnd),
      'reject 分支一旦读政策，政策被删/改之后人就说不了「不做」—— 那条 run 会永久卡住',
    ).not.toContain('client_automation_policies')
  })

  it('🔴 `kernel_record_fenced_deny` 不碰政策（它只拿前两把锁）', () => {
    const src = readFileSync(join(ROOT, MIGRATION), 'utf8')
    const start = src.indexOf('CREATE OR REPLACE FUNCTION public.kernel_record_fenced_deny_v2(')
    expect(
      src.slice(start, src.indexOf('$$;', start)),
      '失败落地那条路正是为了记下「政策变了所以做不了」—— 它读政策就会自锁',
    ).not.toContain('FROM public.client_automation_policies')
  })
})

/**
 * 🔴 **同一个 客户+动作 不许有两条同时生效的政策。**（Build Control Room blocker ②）
 *
 * 光有 `ORDER BY effective_from DESC LIMIT 1 FOR UPDATE` 是不够的：锁 SELECT
 * 拦不住 INSERT。并发事务可以插进一条 `effective_from` 更晚、此刻已经生效的新政策，
 * 于是审批这边拿着被锁住的旧行签出 allow，而按那句 SQL 的口径当家的已经换人了 ——
 * 审计表里留下一条**照着不当家的规则**签出来的放行。
 *
 * 根治靠数据模型：让「同时有效」在库里根本表示不出来。
 */
describe('🔴 政策生效窗口不许重叠', () => {
  const FORWARD_MIGRATION = 'supabase/migrations/20260813000000_kernel_approval_identity_guards.sql'
  const sql = (): string => readFileSync(join(ROOT, FORWARD_MIGRATION), 'utf8')

  it('EXCLUDE 约束按 (客户, 动作, 时间窗) 三元组建', () => {
    const src = sql()
    const at = src.indexOf('EXCLUDE USING gist')
    expect(at, '必须有 EXCLUDE 约束 —— 唯一索引管不了「区间相交」').toBeGreaterThan(-1)
    const block = src.slice(at, at + 400)
    expect(block).toMatch(/client_id\s+WITH\s+=/i)
    expect(block).toMatch(/action_key\s+WITH\s+=/i)
    // 半开区间 [from, to)：跟 RPC 里 `effective_from <= now() AND (effective_to IS NULL
    // OR effective_to > now())` 的口径必须逐字一致，差一个端点就是差一条边界记录。
    expect(block).toMatch(/tstzrange\(\s*effective_from\s*,\s*effective_to\s*,\s*'\[\)'\s*\)\s*WITH\s+&&/i)
  })

  it('btree_gist 必须显式装上（gist 原生不认 uuid / text 的 `=`）', () => {
    expect(sql()).toMatch(/CREATE\s+EXTENSION\s+IF\s+NOT\s+EXISTS\s+btree_gist/i)
  })

  it('🔴 存量重叠让迁移当场失败，且**不自动改客户数据**', () => {
    const src = sql()
    const check = src.indexOf('tstzrange(a.effective_from')
    const addConstraint = src.indexOf('EXCLUDE USING gist')
    expect(check, '必须先自己查一遍存量重叠').toBeGreaterThan(-1)
    expect(
      check < addConstraint,
      '存量检查必须排在 ADD CONSTRAINT **之前** —— 排在后面的话，' +
        '人看到的是一条只带内部行号的约束冲突，不知道是哪个客户、哪两行',
    ).toBe(true)

    const block = src.slice(check - 1200, addConstraint)
    expect(block, '查出来必须 RAISE 掉，不能只是记一笔').toMatch(/RAISE\s+EXCEPTION/i)

    // 🔴 「顺手修一下」是这里最大的诱惑，也是最不能干的事：
    //    自动截断某一行的 effective_to = 替客户改他们的自动化规则，
    //    而哪一行才是他们真正想要的那条只有他们自己知道。
    expect(block).not.toMatch(/UPDATE\s+public\.client_automation_policies/i)
    expect(block).not.toMatch(/DELETE\s+FROM\s+public\.client_automation_policies/i)
  })

  it('🔴 判据本身有效：把 EXCLUDE 换成普通唯一索引，上面那条必须挂', () => {
    // 唯一索引只能保证「同一个 (客户,动作,起点) 不重复」，两条起点不同、
    // 区间相交的行它一条都拦不住 —— 这正是要防的那种。
    const notEnough = 'CREATE UNIQUE INDEX ON client_automation_policies (client_id, action_key)'
    expect(/EXCLUDE\s+USING\s+gist/i.test(notEnough)).toBe(false)
  })
})

/**
 * 🔴 **审批状态迁移 RPC 的版本化 + 挂钟复核。**
 * （Build Control Room blocker ① / ②）
 */
describe('🔴 kernel_resolve_pending_approval 版本化与签发时刻', () => {
  const HIST = 'supabase/migrations/20260808000003_me2_execution_kernel_v1.sql'
  const FWD = 'supabase/migrations/20260813000000_kernel_approval_identity_guards.sql'
  const fwd = (): string => readFileSync(join(ROOT, FWD), 'utf8')

  function bodyOf(src: string, name: string): string {
    const start = src.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`)
    expect(start, `${name} 必须在这份 SQL 里`).toBeGreaterThan(-1)
    const end = src.indexOf('$$;', start)
    expect(end, `${name} 的函数体没闭合`).toBeGreaterThan(start)
    return src.slice(start, end)
  }

  it('两个入口都在：v2 是实现，历史原名是转发壳', () => {
    const v2 = bodyOf(fwd(), 'kernel_resolve_pending_approval_v2')
    const legacy = bodyOf(fwd(), 'kernel_resolve_pending_approval')
    // v2 里有真逻辑
    expect(v2).toContain('pending_identity_mismatch')
    // 历史原名只转发 —— 逻辑写两份必然漂移
    expect(legacy).toContain('kernel_resolve_pending_approval_v2(')
    expect(legacy).not.toContain('pending_identity_mismatch')
  })

  it('🔴 历史原名不许被 DROP（迁移先 apply 时旧代码还得能调）', () => {
    expect(/DROP\s+FUNCTION[^;]*\bkernel_resolve_pending_approval\b/i.test(fwd())).toBe(false)
  })

  it('🔴 转发壳的签名跟历史逐字一致（不一致 CREATE OR REPLACE 直接失败）', () => {
    const sig = (src: string, name: string): string => {
      const b = bodyOf(src, name)
      return b
        .slice(b.indexOf('('), b.indexOf('AS $$'))
        .replace(new RegExp(name, 'g'), 'FN')
        .replace(/--[^\n]*/g, '')
        .replace(/\s+/g, ' ')
        .trim()
    }
    expect(sig(fwd(), 'kernel_resolve_pending_approval')).toBe(
      sig(readFileSync(join(ROOT, HIST), 'utf8'), 'kernel_resolve_pending_approval'),
    )
  })

  it('🔴 两个入口的 EXECUTE 都收了口', () => {
    const sig = String.raw`\(uuid,\s*uuid,\s*text,\s*text,\s*text,\s*jsonb,\s*numeric\)`
    for (const fn of ['kernel_resolve_pending_approval_v2', 'kernel_resolve_pending_approval']) {
      expect(
        new RegExp(String.raw`REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.${fn}${sig}\s*\n?\s*FROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated`, 'i').test(fwd()),
        `${fn} 没 REVOKE`,
      ).toBe(true)
      expect(
        new RegExp(String.raw`GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.${fn}${sig}\s*\n?\s*TO\s+service_role`, 'i').test(fwd()),
        `${fn} 没 GRANT`,
      ).toBe(true)
    }
  })

  it('🔴 签放行按**挂钟**判，不按事务开始时间', () => {
    const v2 = bodyOf(fwd(), 'kernel_resolve_pending_approval_v2')
    // 锁之后重新取挂钟，并且用它复核窗口
    expect(v2).toContain('v_signing_at := clock_timestamp()')
    expect(v2).toContain('policy_expired_before_signing')
    // 有效期从**同一个**签发时刻推导 —— 用 now() 的话锁上排多久就少活多久
    expect(v2).toContain('v_signing_at + (v_policy.decision_ttl_seconds')

    // 🔴 政策时间窗一个 now() 都不许剩下：剩一个就等于这道闸没修
    const windowLines = v2
      .split('\n')
      .filter((l) => /effective_from|effective_to/.test(l) && !l.trim().startsWith('--'))
    expect(windowLines.length, '没找到时间窗判据 —— 判据空跑了').toBeGreaterThan(0)
    expect(
      windowLines.filter((l) => l.includes('now()')),
      '政策时间窗还在用 now()（事务开始时间），锁等待期间过期的政策会被判成有效',
    ).toEqual([])
  })

  it('🔴 挂钟必须取在**拿到政策锁之后**（锁之前取等于没修）', () => {
    const v2 = bodyOf(fwd(), 'kernel_resolve_pending_approval_v2')
    const lockAt = v2.indexOf('FOR UPDATE;', v2.indexOf('client_automation_policies'))
    const recheckAt = v2.indexOf('policy_expired_before_signing')
    expect(lockAt).toBeGreaterThan(-1)
    expect(recheckAt, '复核必须排在政策锁之后').toBeGreaterThan(lockAt)
  })
})

/**
 * 🔴 **`kernel_begin_authorized_run` 的前向副本，只许跟历史原文差那四处。**
 *
 * 它是执行闸：132 行里抄漏一条判据，是不会有人发现的 —— 测试照样绿，
 * 而生产上少了一道「现在还准不准跑」。所以这里逐行比对，
 * 把「允许的差异」写死成一张清单。
 */
describe('🔴 begin_authorized_run 前向副本与历史原文逐行比对', () => {
  const HIST = 'supabase/migrations/20260808000003_me2_execution_kernel_v1.sql'
  const FWD = 'supabase/migrations/20260813000000_kernel_approval_identity_guards.sql'

  /** 去掉注释和空行 —— 只比真正会执行的那些行。 */
  function codeLines(src: string): string[] {
    const start = src.indexOf('CREATE OR REPLACE FUNCTION public.kernel_begin_authorized_run(')
    expect(start).toBeGreaterThan(-1)
    return src
      .slice(start, src.indexOf('$$;', start))
      .split('\n')
      .map((l) => l.replace(/--.*$/, '').trimEnd())
      .filter((l) => l.trim().length > 0)
  }

  //: 允许出现在前向副本里、历史原文里没有的行
  const ALLOWED_ADDED = [
    'v_now            timestamptz;',
    'v_now := clock_timestamp();',
    'AND p.effective_from <= v_now',
    'AND (p.effective_to IS NULL OR p.effective_to > v_now)',
    "IF v_decision.expires_at IS NOT NULL AND v_decision.expires_at <= v_now THEN",
  ]
  //: 允许消失的行（被上面那些替换掉的）
  const ALLOWED_REMOVED = [
    'AND p.effective_from <= now()',
    'AND (p.effective_to IS NULL OR p.effective_to > now())',
    "IF v_decision.expires_at IS NOT NULL AND v_decision.expires_at <= now() THEN",
  ]

  it('差异恰好就是那四处时间源，一行不多一行不少', () => {
    const hist = codeLines(readFileSync(join(ROOT, HIST), 'utf8')).map((l) => l.trim())
    const fwd = codeLines(readFileSync(join(ROOT, FWD), 'utf8')).map((l) => l.trim())

    const added = fwd.filter((l) => !hist.includes(l))
    const removed = hist.filter((l) => !fwd.includes(l))

    expect(added.sort(), '前向副本里多出了计划外的行 —— 抄的时候改了别的东西').toEqual(
      [...ALLOWED_ADDED].sort(),
    )
    expect(removed.sort(), '前向副本里丢了行 —— 抄漏一条判据 = 少一道执行闸').toEqual(
      [...ALLOWED_REMOVED].sort(),
    )
  })

  it('🔴 写入用的时间戳仍然是 now()（那些记「什么时候写的」，不是判据）', () => {
    const fwd = codeLines(readFileSync(join(ROOT, FWD), 'utf8')).join('\n')
    expect(fwd).toContain('consumed_at = now()')
    expect(fwd).toContain('started_at = COALESCE(started_at, now())')
  })

  it('🔴 挂钟取在两把行锁之后（锁之前取等于没修）', () => {
    const fwd = codeLines(readFileSync(join(ROOT, FWD), 'utf8')).join('\n')
    const decisionLock = fwd.indexOf("WHERE id = p_decision_id FOR UPDATE;")
    const clockAt = fwd.indexOf('v_now := clock_timestamp();')
    expect(decisionLock).toBeGreaterThan(-1)
    expect(clockAt, '取挂钟必须排在 decision 锁之后').toBeGreaterThan(decisionLock)
  })
})

/**
 * 🔴 **v2 返回的每一个原因码都必须被显式归类。**
 *
 * 这条是踩出来的：`policy_expired_before_signing` 是本批次新加的 RPC 返回码，
 * 加的时候**忘了**同步 `POLICY_RACE_REASONS`。后果不是报错 —— 是它掉进
 * 兜底的 `INVALID_STATE`，接口答终态的 `not_pending`，界面把一条
 * **还等着人点**的待办从列表里抹掉。整套测试当时是全绿的。
 *
 * 所以判据不能是「这几个码在清单里」（那还是手抄一份），
 * 而是**反过来**：从 SQL 里把码全捞出来，每一个都必须能在应用层找到归宿。
 * 新加一个码却不归类 → 当场红。
 */
describe('🔴 SQL 返回码必须在应用层有归宿（漏一个就会被当成终态）', () => {
  const FWD = 'supabase/migrations/20260813000000_kernel_approval_identity_guards.sql'
  const HUMAN = 'src/lib/kernel/human-approval.ts'

  /**
   * 刻意**不**归进那两张「非终态」清单的码，每一条都写清为什么。
   * 往这里加东西 = 明确声明「这个码就是终态 / 就是程序错误」。
   */
  const DELIBERATELY_UNCLASSIFIED: Readonly<Record<string, string>> = {
    approved: '成功',
    rejected: '成功',
    not_pending: '真·终态：run 已经有结论了，这正是要表达的意思',
    decision_not_current: 'resolveFailureToError 里单独一条分支处理（也是非终态）',
    run_not_found: '调用方传了不存在的 run —— 程序错误，不是竞态',
    bad_resolution: '调用方传了非法的 resolution —— 程序错误',
  }

  it('每个返回码要么在两张非终态清单里，要么在「刻意不归类」里写明了理由', () => {
    const sql = readFileSync(join(ROOT, FWD), 'utf8')
    const start = sql.indexOf('CREATE OR REPLACE FUNCTION public.kernel_resolve_pending_approval_v2(')
    expect(start).toBeGreaterThan(-1)
    const body = sql.slice(start, sql.indexOf('$$;', start))

    // `RETURN QUERY SELECT false, 'xxx'` / `'not_' || …` / `SELECT true, 'approved'`
    const codes = new Set<string>()
    // 🔴 用 Array.from 而不是 for…of 直接迭代 matchAll —— 仓库 tsconfig 没设
    //    target，直接迭代会报 TS2802（跟之前 `[...someSet]` 那次同一类）。
    for (const m of Array.from(body.matchAll(/RETURN QUERY SELECT (?:false|true), '([a-z_]+)'/g))) {
      codes.add(m[1])
    }
    for (const m of Array.from(body.matchAll(/RETURN QUERY SELECT false, '([a-z_]+)' \|\|/g))) {
      codes.add(m[1].replace(/_$/, ''))
    }
    expect(codes.size, '一个返回码都没捞到 —— 判据空跑了').toBeGreaterThan(8)

    const human = readFileSync(join(ROOT, HUMAN), 'utf8')
    const setBody = (name: string): string => {
      const at = human.indexOf(name)
      expect(at, `${name} 必须存在`).toBeGreaterThan(-1)
      return human.slice(at, human.indexOf('])', at))
    }
    const classified = setBody('POLICY_RACE_REASONS') + setBody('PENDING_INCONSISTENT_REASONS')

    const orphans = Array.from(codes).filter(
      (c) => !classified.includes(`'${c}'`) && !(c in DELIBERATELY_UNCLASSIFIED),
    )
    expect(
      orphans.sort(),
      '这些 SQL 返回码在应用层没有归宿 —— 它们会掉进兜底的 INVALID_STATE，\n' +
        '接口答终态的 not_pending，界面把一条还等着人点的待办从列表里抹掉。\n' +
        '要么加进非终态清单，要么在 DELIBERATELY_UNCLASSIFIED 里写明它为什么是终态。',
    ).toEqual([])
  })

  it('🔴 判据本身有效：把新加的那个码从清单里拿掉，必须被抓出来', () => {
    // 这就是本批次真实发生过的那一步。
    const human = readFileSync(join(ROOT, HUMAN), 'utf8')
    expect(human).toContain("'policy_expired_before_signing'")
    const without = human.replace("  'policy_expired_before_signing',\n", '')
    const at = without.indexOf('POLICY_RACE_REASONS')
    expect(without.slice(at, without.indexOf('])', at))).not.toContain(
      'policy_expired_before_signing',
    )
  })
})
