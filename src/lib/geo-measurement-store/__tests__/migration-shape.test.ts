/**
 * WP03 migration 的静态守卫（Issue #875）。
 *
 * 🔴 **这些断言证明的是「迁移文件写了什么」，不是「数据库真的会那样做」。**
 *    它们扫的是 SQL 文本。真正的行为（触发器拦不拦得住 service_role、
 *    复合外键拦不拦得住跨客户引用、生成列算不算得出来）**只能在 apply 之后
 *    用真库验**，那一步是单独授权的运维动作，不在本 PR 里。
 *    apply 后要跑的自验清单写在迁移文件末尾 §7。
 *
 *    分清这两件事很重要：把文本扫描说成「已验证」，等于给自己发一张假绿灯。
 *
 * 扫描前先去掉 SQL 注释 —— 否则**解释规则的注释本身**会被当成罪证
 * （仓库的架构测试早就踩过这个坑，见 kernel/__tests__/architecture.test.ts）。
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const ROOT = process.cwd()
const MIGRATIONS_DIR = join(ROOT, 'supabase/migrations')
const MIGRATION_VERSION = '20260811000001'
const MIGRATION_FILE = `${MIGRATION_VERSION}_me2_geo_measurement_storage_v1.sql`

const RAW = readFileSync(join(MIGRATIONS_DIR, MIGRATION_FILE), 'utf8')

/**
 * 去掉 `--` 行注释与 `/* *​/` 块注释。
 * 本迁移的字符串字面量里没有 `--`，所以这个朴素实现是安全的。
 */
function stripSqlComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
}

const SQL = stripSqlComments(RAW)


/**
 * 取一段 SQL 区间。
 *
 * 🔴 定位标记找不到时**直接抛错**，不返回空串。
 *    `SQL.slice(-1, ...)` 会得到一段几乎空的文本，而在空文本上做
 *    `.not.toContain(...)` 断言是**恒真**的 —— 一条永远绿、什么都不保证的测试。
 *    仓库的架构测试把这个形状记成「已经发生过的静默失败」，这里不重蹈。
 */
function region(startMarker: string, endMarker?: string): string {
  const start = SQL.indexOf(startMarker)
  if (start === -1) {
    throw new Error(`区间起点不存在（切片会变成 fail-open）: ${startMarker}`)
  }
  if (endMarker === undefined) return SQL.slice(start)
  const end = SQL.indexOf(endMarker, start)
  if (end === -1) {
    throw new Error(`区间终点不存在（切片会变成 fail-open）: ${endMarker}`)
  }
  return SQL.slice(start, end)
}

const TABLES = [
  'geo_query_sets',
  'geo_queries',
  'geo_batches',
  'geo_observations',
  'geo_evidence',
] as const

/** 只保留不可变的三张（批次 / 观测 / 证据）—— 它们一句都不许改、一行都不许删。 */
const ALWAYS_IMMUTABLE_TABLES = ['geo_batches', 'geo_observations', 'geo_evidence'] as const

describe('WP03 migration · 版本号与文件边界', () => {
  it('版本号在整个 migrations 目录里唯一（并行开发最容易撞的就是它）', () => {
    const sameVersion = readdirSync(MIGRATIONS_DIR).filter(
      (f) => f.endsWith('.sql') && f.slice(0, 14) === MIGRATION_VERSION,
    )
    expect(
      sameVersion,
      '两个 migration 用同一个版本号时，各自分支上都看不出来，合并后 Supabase 的\n' +
        'migration 账本会出现重复 version。（全目录的撞车闸门在 kernel 的架构测试里，\n' +
        '这一条是本 WP 自己的近身检查。）',
    ).toEqual([MIGRATION_FILE])
  })

  it('文件名前 14 位是合法时间戳版本号', () => {
    expect(/^\d{14}$/.test(MIGRATION_VERSION)).toBe(true)
  })
})

describe('WP03 migration · 五张表都建了，且只建了该建的', () => {
  it.each(TABLES)('建了 public.%s', (table) => {
    expect(SQL).toContain(`CREATE TABLE IF NOT EXISTS public.${table}`)
  })

  it('没有顺手建页面台账 / 域名清单 / 指标汇总表', () => {
    // 🔴 这三样都是被 WP00 §15 与 GEO 契约 §10 明确留成未决的东西。
    //    在 WP03 里「顺手建一张」等于替 Build Control Room 拍了板。
    const forbidden = [
      'geo_pages',
      'geo_page_registry',
      'geo_owned_domains',
      'geo_verified_domains',
      'geo_metrics',
      'geo_metric_results',
      'geo_metrics_summary',
      'loop_run',
      'verification_id',
      'learning_record',
    ]
    const built = forbidden.filter((name) => new RegExp(`CREATE TABLE[^;]*\\b${name}\\b`).test(SQL))
    expect(
      built,
      '指标是从不可变的观测与证据**算出来**的，不落库；页面台账与自有域名清单是未决项。\n' +
        built.join('\n'),
    ).toEqual([])
  })

  it('聚合指标一个都没落库（qualified mention / conditional rank 等不出现为列）', () => {
    const metricColumns = [
      'qualified_mention',
      'conditional_rank',
      'recommendation_rate',
      'mention_rate',
      'engine_coverage_pct',
    ]
    const found = metricColumns.filter((c) => SQL.includes(c))
    expect(
      found,
      '七个指标是 compute-time 的结论，不是存储。落库就必然要更新，更新就违反不可变性。\n' +
        found.join('\n'),
    ).toEqual([])
  })
})

describe('WP03 migration · RLS 与授权面', () => {
  it.each(TABLES)('public.%s 开了行级安全', (table) => {
    expect(SQL).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`)
  })

  it('每一条策略都写了 TO service_role（漏掉 = 对匿名访客敞开读写）', () => {
    const policies = Array.from(SQL.matchAll(/CREATE POLICY[\s\S]*?;/g)).map((m) => m[0])
    expect(policies.length, '五张表各一条策略').toBe(5)
    const missing = policies.filter((p) => !/FOR ALL TO service_role/.test(p))
    expect(
      missing,
      '2026-08-03 实测：CREATE POLICY ... USING (true) 漏写 TO service_role 会默认成 TO PUBLIC，\n' +
        '当时泄露了 118 条策略覆盖的数据。\n' +
        missing.join('\n'),
    ).toEqual([])
  })

  it('没有 anon / authenticated / PUBLIC 策略', () => {
    const leaks = ['TO anon', 'TO authenticated', 'TO PUBLIC', 'TO public'].filter((r) => SQL.includes(r))
    expect(leaks, '本 WP 没有任何 authenticated 调用方，不许凭空授予。\n' + leaks.join('\n')).toEqual([])
  })

  it('没有 auth.uid() / client_team / workspace_id 这三种被明令禁止的判据', () => {
    // 🔴 四个 token 一起扫：CLAUDE.md 的清单漏了 auth.jwt()，DECISIONS/PITFALLS 里有。
    const forbidden = ['auth.uid()', 'auth.jwt()', 'client_team', 'workspace_id'].filter((f) =>
      SQL.includes(f),
    )
    expect(forbidden, 'CLAUDE.md 铁律 7 明令禁止。\n' + forbidden.join('\n')).toEqual([])
  })

  it('没有 SECURITY DEFINER 函数 / RPC 捷径', () => {
    expect(
      SQL.includes('SECURITY DEFINER'),
      'v1 只有表与触发器。SECURITY DEFINER 函数默认把 EXECUTE 授予 anon/authenticated，\n' +
        '而 anon key 就在浏览器 bundle 里 —— 本 WP 没有任何需要它的调用方。',
    ).toBe(false)
  })

  it('触发器函数都钉死了 search_path', () => {
    const fns = Array.from(SQL.matchAll(/CREATE OR REPLACE FUNCTION[\s\S]*?AS \$\$/g)).map((m) => m[0])
    expect(fns.length).toBeGreaterThan(0)
    const unpinned = fns.filter((f) => !/SET search_path\s*=/.test(f))
    expect(
      unpinned,
      '调用者若改过 search_path，函数里无 schema 限定的名字解析目标就会变。\n' + unpinned.join('\n'),
    ).toEqual([])
  })
})

describe('WP03 migration · 租户一致性靠复合外键，不靠应用层自觉', () => {
  it.each([
    ['geo_queries → geo_query_sets', 'fk_geo_queries_set_same_client', '(client_id, query_set_id)', 'public.geo_query_sets (client_id, id)'],
    ['geo_batches → geo_query_sets', 'fk_geo_batches_set_same_client', '(client_id, query_set_id)', 'public.geo_query_sets (client_id, id)'],
    ['geo_observations → geo_batches', 'fk_geo_observations_batch_same_client', '(client_id, batch_id)', 'public.geo_batches (client_id, id)'],
    ['geo_observations → 自身(重新解析来源)', 'fk_geo_observations_source_same_client', '(client_id, source_observation_id)', 'public.geo_observations (client_id, id)'],
    ['geo_evidence → geo_observations', 'fk_geo_evidence_observation_same_client', '(client_id, observation_id)', 'public.geo_observations (client_id, id)'],
  ])('%s 是同租户复合外键', (_label, constraintName, childCols, parentRef) => {
    expect(SQL).toContain(constraintName)
    const block = region(constraintName)
    expect(
      block.includes(childCols) && block.includes(parentRef),
      `${constraintName} 必须是 FOREIGN KEY ${childCols} REFERENCES ${parentRef}。\n` +
        '单列外键只验证「父行存在」，拦不住「A 客户的行引用 B 客户的父行」。',
    ).toBe(true)
  })

  it('复合外键要落在真实存在的唯一索引上（父表的 (id, client_id)）', () => {
    for (const parent of ['geo_query_sets', 'geo_batches', 'geo_observations']) {
      expect(
        SQL.includes(`ON public.${parent} (client_id, id)`),
        `${parent} 缺 (id, client_id) 唯一索引，复合外键就没有落点，apply 时会直接报错。`,
      ).toBe(true)
    }
  })

  it('自引用外键是在唯一索引建好之后才补上的（写在建表语句里会 apply 失败）', () => {
    const idxAt = SQL.indexOf('ON public.geo_observations (client_id, id)')
    const fkAt = SQL.indexOf('fk_geo_observations_source_same_client')
    expect(idxAt).toBeGreaterThan(-1)
    expect(fkAt).toBeGreaterThan(-1)
    expect(
      fkAt > idxAt,
      '自引用外键指向 (id, client_id)，而承载它的唯一索引要等本表建完才建得出来。\n' +
        '写在 CREATE TABLE 里会报 there is no unique constraint matching given keys。',
    ).toBe(true)
  })

  it.each(TABLES)('public.%s 带非空 client_id', (table) => {
    const block = region(`CREATE TABLE IF NOT EXISTS public.${table}`, `ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`)
    expect(
      /client_id\s+uuid NOT NULL REFERENCES public\.clients\(id\)/.test(block),
      `${table} 必须自带 client_id（含 geo_queries —— 子表不许只靠父表间接说明自己属于谁）。`,
    ).toBe(true)
  })

  it('client_id 外键刻意不写 ON DELETE（NO ACTION）—— 不让级联去撞不可变触发器', () => {
    const cascadeOnClients = /REFERENCES public\.clients\(id\)\s+ON DELETE/.test(SQL)
    expect(
      cascadeOnClients,
      '实测过：外键级联动作是一条真实的 UPDATE / DELETE，会正常触发行级触发器\n' +
        '（20260805140000 删房源被自己触发器挡死）。这几张表挂着「不许删」的触发器，\n' +
        '写 CASCADE 只会让删客户报出一句跟删客户毫不相干的错。',
    ).toBe(false)
  })
})

describe('WP03 migration · 不可变性由触发器强制（RLS 拦不住 service_role）', () => {
  it.each(ALWAYS_IMMUTABLE_TABLES)('public.%s 上挂了 BEFORE UPDATE OR DELETE 触发器', (table) => {
    expect(SQL).toMatch(
      new RegExp(`CREATE TRIGGER ${table}_immutable_trigger\\s+BEFORE UPDATE OR DELETE ON public\\.${table}`),
    )
  })

  it('不可变触发器对 UPDATE 与 DELETE 都是无条件抛错（没有「哪些列可以改」的名单）', () => {
    const fn = region('FUNCTION public.geo_immutable_row()', 'DROP TRIGGER IF EXISTS geo_batches_immutable_trigger')
    expect(fn).toContain("TG_OP = 'DELETE'")
    // 两条 RAISE：一条给删，一条给改。函数体里不该有任何放行分支。
    expect((fn.match(/RAISE EXCEPTION/g) ?? []).length).toBe(2)
    expect(
      /RETURN (NEW|OLD)/.test(fn),
      'geo_immutable_row 不该有任何 RETURN 放行路径 —— 有就意味着存在一条能改历史的缝。',
    ).toBe(false)
  })

  it.each(TABLES)('public.%s 挡住了 TRUNCATE（行级触发器对 TRUNCATE 不触发）', (table) => {
    expect(SQL).toMatch(
      new RegExp(`CREATE TRIGGER ${table}_no_truncate\\s+BEFORE TRUNCATE ON public\\.${table}`),
    )
  })

  it('没有任何 upsert 通道（重跑必须是新行，不是覆盖旧行）', () => {
    expect(
      SQL.includes('ON CONFLICT'),
      '行业级归档那套 UNIQUE + upsert 会把上一次的行覆盖掉，正是本设计明令不走的路。',
    ).toBe(false)
  })
})

describe('WP03 migration · 查询集锁死之后不许增删改', () => {
  it('首个批次落地时由数据库自己上锁，不靠调用方自觉', () => {
    const fn = region('FUNCTION public.geo_batches_lock_query_set()')
    expect(fn).toContain('UPDATE public.geo_query_sets')
    expect(fn).toContain('SET locked_at = now()')
    expect(
      fn.includes('AND locked_at IS NULL'),
      '并发安全全靠这半句：两个批次同时插进来时，后到的那句重新求值 WHERE 会影响 0 行，\n' +
        '于是锁只会被打上一次、时间戳也只有一个。',
    ).toBe(true)
    // 🔴 BEFORE，不是 AFTER：外键检查会在父行上加 FOR KEY SHARE，
    //    放在 AFTER 就是「先拿 KEY SHARE 再要 NO KEY UPDATE」的锁升级，
    //    两个并发批次会互等成死锁。
    expect(SQL).toMatch(
      /CREATE TRIGGER geo_batches_lock_query_set_trigger\s+BEFORE INSERT ON public\.geo_batches/,
    )
  })

  it('geo_queries 的守卫同时挡住 INSERT / UPDATE / DELETE', () => {
    expect(
      SQL,
      '只挡 UPDATE/DELETE 拦不住集合长大 —— 往锁死的版本里再塞一道题，\n' +
        '等于偷偷换了一套题却沿用同一条时间线。',
    ).toMatch(
      /CREATE TRIGGER geo_queries_locked_set_guard_trigger\s+BEFORE INSERT OR UPDATE OR DELETE ON public\.geo_queries/,
    )
  })

  it('守卫读父集合时加了行锁，否则「正在上锁」与「正在加题」能并发穿过去', () => {
    const fn = region('FUNCTION public.geo_queries_locked_set_guard()', 'DROP TRIGGER IF EXISTS geo_queries_locked_set_guard_trigger')
    expect(fn).toContain('FROM public.geo_query_sets')
    expect(
      fn.includes('FOR NO KEY UPDATE'),
      '外键自带的 KEY SHARE 锁挡不住这件事 —— locked_at 不是键列。',
    ).toBe(true)
    // 🔴 强度必须刚好是 NO KEY UPDATE。FOR UPDATE 是唯一与 FOR KEY SHARE 冲突的强度，
    //    而 KEY SHARE 正是每次外键检查在父行上加的锁 —— 用 FOR UPDATE 会死锁。
    expect(
      /FOR UPDATE(?!\s*;?\s*--)/.test(fn.replace(/FOR NO KEY UPDATE/g, '')),
      '守卫里不许出现裸的 FOR UPDATE —— 那会跟外键的 KEY SHARE 冲突成死锁。',
    ).toBe(false)
  })

  it('锁死的集合不能靠「把问题搬到别的集合」来偷偷减员', () => {
    const fn = region('FUNCTION public.geo_queries_locked_set_guard()', 'DROP TRIGGER IF EXISTS geo_queries_locked_set_guard_trigger')
    // 身份冻结 + UPDATE/DELETE 看旧父集合，两条缺一不可
    expect(fn).toContain('NEW.query_set_id IS DISTINCT FROM OLD.query_set_id')
    expect(
      fn.includes("CASE WHEN TG_OP = 'INSERT' THEN NEW.query_set_id ELSE OLD.query_set_id END"),
      'UPDATE 只看 NEW 的父集合时，把一道题从锁死的集合搬到没锁的集合会被放行 ——\n' +
        '锁死集合的成员就这么少了一条。',
    ).toBe(true)
  })

  it('上锁时间由数据库写，不接受调用方倒填', () => {
    const fn = region('FUNCTION public.geo_query_sets_guard()', 'DROP TRIGGER IF EXISTS geo_query_sets_guard_trigger')
    expect(
      fn.includes('NEW.locked_at := now()'),
      '不强制的话，可以手写一个倒填的 locked_at，让集合看起来在某次采集之前就冻结了。',
    ).toBe(true)
  })

  it('锁死的查询集本身不可删、不可改（只放行一次上锁）', () => {
    const fn = region('FUNCTION public.geo_query_sets_guard()', 'DROP TRIGGER IF EXISTS geo_query_sets_guard_trigger')
    expect(fn).toContain("TG_OP = 'DELETE'")
    expect(fn).toContain('OLD.locked_at IS NOT NULL')
    expect(fn).toContain('NEW.locked_at IS NULL')
    // 上锁那一次也不许顺手改别的列
    expect(fn).toContain('IS DISTINCT FROM')
    expect(SQL).toMatch(
      /CREATE TRIGGER geo_query_sets_guard_trigger\s+BEFORE INSERT OR UPDATE OR DELETE ON public\.geo_query_sets/,
    )
  })
})

describe('WP03 migration · 批次状态与 WP02 冻结契约一致', () => {
  it('只接受 completed / partial / failed', () => {
    expect(SQL).toContain("status IN ('completed', 'partial', 'failed')")
  })

  it("没有存储层私自加的 'running'", () => {
    const statusCheck = region('status                      text NOT NULL')
    expect(
      /'running'/.test(statusCheck.slice(0, 200)),
      "WP03 存的是测量真相，不是调度状态。在途状态属于既有执行层。",
    ).toBe(false)
  })
})

describe('WP03 migration · WP02 的每一个维度都留住了', () => {
  const OBSERVATION_BLOCK = region('CREATE TABLE IF NOT EXISTS public.geo_observations', 'CREATE UNIQUE INDEX IF NOT EXISTS idx_geo_observations_client_id_id')

  it.each([
    ['采集身份 1/7 querySetVersion', 'query_set_version'],
    ['采集身份 2/7 queryKey', 'query_key'],
    ['采集身份 3/7 engineFamily', 'engine_family'],
    ['采集身份 4/7 modelVersion', 'model_version'],
    ['采集身份 5/7 locale', 'locale'],
    ['采集身份 6/7 market', 'market'],
    ['sample 1/3 样本计划', 'sample_planned_count'],
    ['sample 2/3 样本序号', 'sample_index'],
    ['sample 3/3 采样参数', 'sampling_parameters'],
    ['解释身份 parserVersion', 'parser_version'],
    ['解释身份 metricRulesVersion', 'metric_rules_version'],
    ['质量信号 confidence', 'confidence'],
  ])('%s 落成列，且带「已知/未知」二选一约束', (_label, column) => {
    expect(OBSERVATION_BLOCK).toContain(`${column} `)
    expect(OBSERVATION_BLOCK).toContain(`${column}_unknown_reason`)
    expect(
      OBSERVATION_BLOCK.includes(`num_nonnulls(${column}, ${column}_unknown_reason) = 1`),
      `${column} 必须「已知值」与「未知理由」恰好有一个非空。\n` +
        '省略会让下游把「不知道」误读成「一样」，补 0 会读成「一次都没有」。',
    ).toBe(true)
  })

  it('未知理由码用统一的域，三个值与 WP02 的 GeoUnknownReason 逐字一致', () => {
    expect(SQL).toContain('CREATE DOMAIN public.geo_unknown_reason')
    expect(SQL).toContain(
      "VALUE IN ('not_recorded_by_source', 'not_applicable', 'source_ambiguous')",
    )
  })

  it('失败观测能如实落行，且成功时不许带错误字段', () => {
    expect(OBSERVATION_BLOCK).toContain('outcome_ok                    boolean NOT NULL')
    expect(OBSERVATION_BLOCK).toContain('(outcome_ok = false) = (error_code IS NOT NULL)')
    expect(
      OBSERVATION_BLOCK.includes('geo_obs_error_message_absent_on_success'),
      '成功的观测不许挂着错误消息 —— 那会让「成功」和「失败」在库里长得一样。',
    ).toBe(true)
  })

  it('同一批次里的重复插入会撞唯一索引，而不是被 upsert 掉', () => {
    expect(SQL).toContain('idx_geo_observations_no_double_insert')
    // 🔴 locale / market 必须在键里：一个批次横跨多语言多市场，少了这两列，
    //    「同一问题换个语言再问一遍」会被当成重复插入拒掉 ——
    //    一条防重复的约束就变成了阻断合法采集的约束。
    expect(SQL).toContain(
      '(batch_id, query_key, engine_family, model_version, locale, market, sample_index)',
    )
    expect(
      SQL.includes('NULLS NOT DISTINCT'),
      '默认语义下 NULL 互不相等 —— 只要任何一个维度是「未知」，重复插入就悄悄溜过去了。',
    ).toBe(true)
  })

  it('重新解析的血缘列在，且不许拿自己当来源', () => {
    expect(OBSERVATION_BLOCK).toContain('source_observation_id')
    expect(OBSERVATION_BLOCK).toContain('source_observation_id IS DISTINCT FROM id')
  })

  it('批次留住了计划覆盖 / 实际覆盖 / 成本，且覆盖描述的八个键齐全', () => {
    const batchBlock = region('CREATE TABLE IF NOT EXISTS public.geo_batches', 'CREATE UNIQUE INDEX IF NOT EXISTS idx_geo_batches_client_id_id')
    expect(batchBlock).toContain('planned_coverage            jsonb NOT NULL')
    expect(batchBlock).toContain('actual_coverage             jsonb NOT NULL')
    expect(batchBlock).toContain('cost_usd')

    // 🔴 逐键逐列断言，不是「文件里有 COALESCE 就算数」。
    //    变异测试实测过：只写一句 includes('COALESCE(jsonb_typeof') 的话，
    //    把其中**一个**键的 COALESCE 拆掉，测试照样全绿 —— 那一条断言等于没写。
    //    jsonb_typeof(x -> '不存在的键') 返回 NULL，而 CHECK 在表达式为 NULL 时是**放行**的，
    //    所以漏掉任何一个 COALESCE，那个键就变成了「有没有都行」。
    const COVERAGE_KEYS = [
      'engines',
      'models',
      'locales',
      'markets',
      'queryKeys',
      'attempted',
      'succeeded',
      'failed',
    ]
    const unguarded: string[] = []
    for (const column of ['planned_coverage', 'actual_coverage']) {
      for (const key of COVERAGE_KEYS) {
        if (!batchBlock.includes(`COALESCE(jsonb_typeof(${column} -> '${key}')`)) {
          unguarded.push(`${column} -> ${key}`)
        }
      }
    }
    expect(
      unguarded,
      '这些覆盖率字段的存在性检查没套 COALESCE —— 键缺失时 CHECK 会静默放行。\n' +
        unguarded.join('\n'),
    ).toEqual([])
  })

  it('成本与置信度都拦住了 NaN（numeric 的 >= 0 拦不住它）', () => {
    expect(SQL).toContain("cost_usd <> 'NaN'::numeric")
    expect(SQL).toContain("confidence <> 'NaN'::numeric")
  })
})

describe('WP03 migration · Codex 复审三条（回归）', () => {
  const batchBlock = region(
    'CREATE TABLE IF NOT EXISTS public.geo_batches',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_geo_batches_client_id_id',
  )

  // ── P1：覆盖率计数 ────────────────────────────────────────────────────────
  it.each(['planned_coverage', 'actual_coverage'])(
    '%s 的三个计数必须是非负整数（jsonb_typeof=number 拦不住 -9 / 1.5）',
    (column) => {
      // 🔴 比对前先把空白压平：SQL 里为了对齐在 `~` 前面留了多余空格，
      //    照字面比会漏掉对齐过的那一行（'failed' 就是这么被漏掉的）。
      const flat = batchBlock.replace(/\s+/g, ' ')
      const missing = ['attempted', 'succeeded', 'failed'].filter(
        (key) => !flat.includes(`COALESCE((${column} ->> '${key}') ~ '^[0-9]+$', false)`),
      )
      expect(
        missing,
        `${column} 的这几个计数没有非负整数判据。批次落库即不可变，` +
          '这种行永远修不掉，还会一路污染失败率与引擎覆盖率（§6.1 第 3 条的硬闸）。\n' +
          missing.join('\n'),
      ).toEqual([])
    },
  )

  it('实际覆盖的三个数必须对得上：尝试 = 成功 + 失败', () => {
    // 🔴 断言的是**约束本身还挂着**，不只是这段文字还在文件里。
    //    只写 toContain('geo_batches_actual_counts_add_up') 的话，把它改名成
    //    ..._DISABLED 或者在前面加一句 `true OR` 都照样绿 —— 变异测试实测过。
    expect(batchBlock).toMatch(/CONSTRAINT geo_batches_actual_counts_add_up CHECK \(/)
    const flat = batchBlock.replace(/\s+/g, ' ')
    expect(
      /\btrue\s+OR\b/i.test(flat),
      '约束里出现 `true OR` 等于把它整条短路掉。',
    ).toBe(false)
    expect(flat).toContain(
      "(actual_coverage ->> 'attempted')::numeric " +
        "= (actual_coverage ->> 'succeeded')::numeric + (actual_coverage ->> 'failed')::numeric",
    )
  })

  it('这条等式**不许**套在 planned 上（计划里 succeeded/failed 本来就是 0）', () => {
    expect(
      /planned_coverage ->> 'attempted'\)::numeric\s*\n?\s*=/.test(batchBlock),
      '计划覆盖在下单那一刻 succeeded / failed 是 0、attempted 是整批的量 ——\n' +
        '对 planned 也套等式会把每一次合法的计划都拦下来。',
    ).toBe(false)
  })

  it('计数判据不做强制转换（转换在 CASE 里，AND 不保证短路）', () => {
    const addUp = region('CONSTRAINT geo_batches_actual_counts_add_up', 'CONSTRAINT geo_batches_cost_is_a_real_amount')
    expect(addUp).toContain('CASE')
    expect(
      addUp.includes('ELSE false'),
      '说不清楚就不许写 —— ELSE 必须是 false，不能落到 NULL（CHECK 遇 NULL 放行）。',
    ).toBe(true)
  })

  // ── P2：建集合时伪造锁时间 ────────────────────────────────────────────────
  it('查询集守卫覆盖 INSERT —— 不能建一个「生下来就锁着」的集合', () => {
    expect(
      SQL,
      '只挡 UPDATE 的话，直接 INSERT 一条 locked_at 是 2020 年的集合就绕过去了：\n' +
        '它当场被视为已锁定，再也加不进问题，时间还是假的且改不回来。',
    ).toMatch(
      /CREATE TRIGGER geo_query_sets_guard_trigger\s+BEFORE INSERT OR UPDATE OR DELETE ON public\.geo_query_sets/,
    )
    const fn = region('FUNCTION public.geo_query_sets_guard()', 'DROP TRIGGER IF EXISTS geo_query_sets_guard_trigger')
    expect(fn).toContain("IF TG_OP = 'INSERT' THEN")
    expect(fn).toContain('NEW.locked_at IS NOT NULL')
  })

  it('上锁这条路：调用方直接 UPDATE 被拒，首个批次触发的那次照样通过', () => {
    // 🔴 这条测试要同时钉住**两侧**。只钉「拒」的一侧是不够的：把阈值调严一点
    //    （比如 < 3）或者把上锁那句 UPDATE 挪出触发器，唯一那条合法的上锁路径
    //    就会被判据自己永久堵死，而查询集从此再也锁不上 —— 只测拒绝侧看不出来。
    //
    // 🔴 判据本身是**运行时行为**（触发深度），这里扫的只是 SQL 文本。
    //    真的「顶层 UPDATE 报错、批次插入成功上锁」必须在 apply 之后用真库验；
    //    仓库里没有可执行的本地 Postgres 测试设施，本 PR 也不引入。
    //    apply 后的自验语句见迁移文件 §8。
    const guard = region(
      'FUNCTION public.geo_query_sets_guard()',
      'DROP TRIGGER IF EXISTS geo_query_sets_guard_trigger',
    )

    // ── 拒的那一侧：顶层 UPDATE 时本守卫在深度 1 触发，阈值正好是 2 才拦得住 ──
    expect(
      guard.includes('pg_trigger_depth() < 2'),
      '调用方直接 UPDATE 时本守卫在深度 1 触发，批次触发的那次在深度 2。\n' +
        '阈值必须正好是 2：调大了会把唯一合法的上锁也拦掉，调小了等于没拦。',
    ).toBe(true)

    // 必须**先拦再写**，否则等于先放行再判
    const depthAt = guard.indexOf('pg_trigger_depth() < 2')
    const forceNowAt = guard.indexOf('NEW.locked_at := now()')
    expect(depthAt, '守卫里必须有深度判据').toBeGreaterThan(-1)
    expect(forceNowAt, '守卫里必须有「强制写数据库时间」').toBeGreaterThan(-1)
    expect(
      depthAt,
      '深度判据必须排在 NEW.locked_at := now() 之前 —— 排在后面就是先放行再判。',
    ).toBeLessThan(forceNowAt)

    // ── 放行的那一侧：合法的上锁必须是触发器**内部**发出的 UPDATE ──────────
    //    只有这样守卫才会在深度 2 触发。下面三件事任何一件变了，深度就不再是 2。
    const locker = region(
      'FUNCTION public.geo_batches_lock_query_set()',
      'DROP TRIGGER IF EXISTS geo_batches_lock_query_set_trigger',
    )
    expect(locker).toContain('UPDATE public.geo_query_sets')
    expect(locker).toContain('SET locked_at = now()')
    // 🔴 断言必须一路管到 EXECUTE FUNCTION 的**绑定**为止。
    //    只匹配到 FOR EACH ROW 是不够的：把 EXECUTE FUNCTION 改绑到别的函数
    //    （或整句删掉），上面那些断言照样全绿 —— 因为上锁函数本身还在、函数体里
    //    那句 UPDATE 也还在，只是**再没有人调用它**了。
    //    那种状态下首个批次落库后查询集根本不会被锁上，而「放行侧」看起来还被钉着。
    expect(
      SQL,
      '上锁那句 UPDATE 必须由 geo_batches 的**行级**触发器发出，深度才够得到 2；\n' +
        '而且这个触发器必须真的绑在 geo_batches_lock_query_set() 上 —— \n' +
        '函数还在、没人调用，跟没有这个函数是一回事。',
    ).toMatch(
      /CREATE TRIGGER geo_batches_lock_query_set_trigger\s+BEFORE INSERT ON public\.geo_batches\s+FOR EACH ROW EXECUTE FUNCTION public\.geo_batches_lock_query_set\(\);/,
    )

    // 全库只有这一处写 locked_at。多出来的那处多半在深度 1，会被守卫自己拦死 ——
    // 于是「上锁」这件事看起来有两条路，实际只有一条走得通。
    expect(
      SQL.split('SET locked_at').length - 1,
      'locked_at 只允许有一个写入方（批次触发器）。',
    ).toBe(1)

    // ── 合法的那次上锁**只准动 locked_at** ────────────────────────────────
    //    列清单从建表语句里现读，不写死：将来给 geo_query_sets 加一列却忘了
    //    加进冻结清单，这条会红。写死清单的话，新列会悄悄变成「上锁时可改」。
    const tableBlock = region(
      'CREATE TABLE IF NOT EXISTS public.geo_query_sets',
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_geo_query_sets_client_id_id',
    )
    const columns = Array.from(tableBlock.matchAll(/^ {2}([a-z_]+) +[a-z]/gm)).map((m) => m[1])
    expect(columns, '没解析到列名的话下面的判据就是空跑').toContain('locked_at')
    expect(columns.length).toBeGreaterThan(1)

    const notFrozen = columns
      .filter((c) => c !== 'locked_at')
      .filter((c) => !guard.includes(`NEW.${c}`) || !guard.includes(`OLD.${c}`))
    expect(
      notFrozen,
      '这些列没被上锁那一步的 ROW(...) 冻结住 —— 意味着「上锁」这一次写入\n' +
        '可以顺手把它们改掉，而查询集一旦锁定就再也改不回来了。\n' +
        notFrozen.join('\n'),
    ).toEqual([])
  })

  // ── P2：证据挂到失败观测 ──────────────────────────────────────────────────
  it('证据只能挂在成功的观测上（外键只管存在与同租户，管不了成败）', () => {
    expect(SQL).toContain('FUNCTION public.geo_evidence_requires_successful_observation()')
    expect(SQL).toMatch(
      /CREATE TRIGGER geo_evidence_successful_observation_trigger\s+BEFORE INSERT ON public\.geo_evidence/,
    )
    const fn = region(
      'FUNCTION public.geo_evidence_requires_successful_observation()',
      'DROP TRIGGER IF EXISTS geo_evidence_successful_observation_trigger',
    )
    expect(fn).toContain('SELECT outcome_ok INTO v_outcome_ok')
    expect(
      fn.includes('v_outcome_ok IS NOT TRUE'),
      'WP02 冻结的 GeoObservationOutcome 里，失败那一支结构上就没有 evidenceId ——\n' +
        '挂上去的行投影不出合法契约对象，而且证据不可删，再也清不掉。',
    ).toBe(true)
    // 🔴 光断言有 `IF NOT FOUND THEN` 不够 —— `IF NOT FOUND THEN RETURN NEW; END IF;`
    //    也含这句话，却是**放行**。必须断言这一支真的抛错（变异测试实测过这个盲区）。
    const notFoundAt = fn.indexOf('IF NOT FOUND THEN')
    const outcomeCheckAt = fn.indexOf('v_outcome_ok IS NOT TRUE')
    expect(notFoundAt, '守卫里必须有「观测不存在」这一支').toBeGreaterThan(-1)
    expect(outcomeCheckAt, '守卫里必须有成败判定').toBeGreaterThan(notFoundAt)
    expect(
      fn.slice(notFoundAt, outcomeCheckAt).includes('RAISE EXCEPTION'),
      '观测不存在时必须抛错，不能因为 SELECT INTO 留下 NULL 就放行。',
    ).toBe(true)
  })
})

describe('WP03 migration · 收尾与诚实声明', () => {
  it('发了 NOTIFY pgrst —— 否则新表在 PostgREST 眼里不存在', () => {
    expect(
      SQL.includes("NOTIFY pgrst, 'reload schema'"),
      '不发这一句，WP04 第一次写入会拿到「relation does not exist」，\n' +
        '而那个报错看起来像「migration 没 apply」，能把人带偏很久。',
    ).toBe(true)
  })

  it('locked_at 刻意没有 _unknown_reason 列（上锁与否是我们自己掌握的事实）', () => {
    expect(
      SQL.includes('locked_at_unknown_reason'),
      '「不知道锁没锁」这个状态在语义上不存在。将来做一致性清理的人\n' +
        '别顺手给它补一列 —— 那会凭空造出一个不存在的状态。',
    ).toBe(false)
  })

  it('查询集守卫显式处理了「父行已被删」，不靠 SELECT INTO 的巧合', () => {
    const fn = region('FUNCTION public.geo_queries_locked_set_guard()', 'DROP TRIGGER IF EXISTS geo_queries_locked_set_guard_trigger')
    expect(
      fn.includes('IF NOT FOUND THEN'),
      '不写这一段，代码靠「查不到时变量留 NULL」落到放行分支 —— 结论对，理由是巧合。\n' +
        '下一个人补一句 IF NOT FOUND THEN RAISE，所有未锁定集合就都删不掉了。',
    ).toBe(true)
  })
})

describe('WP03 migration · 证据：原始响应就地存、定位符不另立真相源', () => {
  // 🔴 必须给终点：不给的话切到文件末尾，会把后面那个提到 outcome_ok 的
  //    触发器函数一起吞进来，下面「证据表没有 outcome_ok 列」那条就失真了。
  const EVIDENCE_BLOCK = region(
    'CREATE TABLE IF NOT EXISTS public.geo_evidence',
    'ALTER TABLE public.geo_evidence ENABLE ROW LEVEL SECURITY',
  )

  it('原始响应是就地的 text，没有发明外部存储', () => {
    expect(EVIDENCE_BLOCK).toContain('raw_response                  text')
    for (const invented of ['s3://', 'storage.objects', 'supabase_storage', 'bucket']) {
      expect(EVIDENCE_BLOCK.includes(invented), `不许发明 ${invented} 这类新基础设施`).toBe(false)
    }
  })

  it('定位符由数据库从证据自己的 id 推导（GENERATED），不是另存一份可对不上的字符串', () => {
    expect(EVIDENCE_BLOCK).toContain('GENERATED ALWAYS AS')
    expect(EVIDENCE_BLOCK).toContain("'db://public.geo_evidence/' || id::text || '/raw_response'")
    expect(EVIDENCE_BLOCK).toContain('STORED')
  })

  it('原始响应记未知时定位符为 NULL —— 不给一个指向空气的地址', () => {
    expect(EVIDENCE_BLOCK).toContain('CASE WHEN raw_response IS NOT NULL')
    expect(EVIDENCE_BLOCK).toContain('ELSE NULL END')
    expect(EVIDENCE_BLOCK).toContain(
      'num_nonnulls(raw_response, raw_response_unknown_reason) = 1',
    )
  })

  it('引用来源必须是 JSON 数组', () => {
    expect(EVIDENCE_BLOCK).toContain("jsonb_typeof(citations) = 'array'")
  })

  it('一条成功观测对应一条证据；失败观测不会被补一条假证据', () => {
    expect(EVIDENCE_BLOCK).toContain('CONSTRAINT uq_geo_evidence_observation UNIQUE (observation_id)')
    // 证据表没有 outcome/error 之类的字段 —— 它只在成功时存在
    expect(EVIDENCE_BLOCK.includes('outcome_ok')).toBe(false)
  })
})
