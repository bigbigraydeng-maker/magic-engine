/**
 * WP3.1a 自治开关同步的架构红线（spec docs/specs/2026-09-25-ads-impact-wp3-design-v1.md §4.11 / §16.1）。
 *
 * 这些是 grep 级禁令：违反的代码即便逻辑通顺也不许进主干，因为它会绕开
 * 「同步 worker 是 Kernel 策略表 ads.* 键的唯一写入者」。
 *
 * 🔴 为什么不只靠 ESLint：`// eslint-disable-next-line` 一行就能关掉它。
 *    架构测试关不掉 —— 它跑在 `npm test` 里，白名单写在版本控制的代码里，
 *    加一条就是一次要过 review 的 diff。
 *
 * 🔴 判据一律先 `stripComments()` 再匹配：一条把自己的文档当罪证的规则，
 *    第一件事就是教人删注释。
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')

const SYNC_WORKER = 'src/lib/inngest/functions/ads-autonomy-sync.ts'
const SYNC_POLICY = 'src/lib/ads-strategy/autonomy/sync-policy.ts'
const CIRCUIT_BREAKER_WORKER = 'src/lib/inngest/functions/ads-circuit-breaker-check.ts'
const CIRCUIT_BREAKER_RELEASE_ROUTE =
  'src/app/api/clients/[id]/ad-strategy-config/release-circuit-breaker/route.ts'
const MIGRATIONS_DIR = 'supabase/migrations'

/**
 * 允许写 client_automation_policies 的 migration（白名单，不许悄悄扩）。
 *
 * 两类合法条目：①一次性数据种子（给特定客户 INSERT 一条策略行，不是常驻运行时
 * 写入者，不违反「同步 worker 是唯一写入者」——`brief_knowledge_migration...`
 * 和 `ads_d3_auto_pause_v1` 都是这类，本测试写好之后才发现漏收了后者）；
 * ②本文件顶部锁定的 SQL 函数定义本身（`ads_autonomy_sync` / `ads_circuit_breaker_policy`）。
 */
const MIGRATION_WRITE_ALLOWLIST = [
  '20260915120000_brief_knowledge_migration_and_cts_history.sql',
  '20260922100000_ads_d3_auto_pause_v1.sql',
  '20260926000001_ads_autonomy_sync.sql',
  '20260928000001_ads_circuit_breaker_policy.sql',
]

/** 递归列出目录下的 `.ts` / `.tsx` 文件（跳过 node_modules / .next）。 */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue
      walk(full, out)
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      out.push(full)
    }
  }
  return out
}

/** 测试文件判据：`.test.<ext>` 或落在 `/__tests__/` 里。 */
const isTest = (p: string) => /\.test\.tsx?$/.test(p) || p.includes('/__tests__/')

const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

/**
 * 挖空注释（保留换行，行号不动）。
 *
 * 🔴 行注释那条要避开 `://`（URL）与字符串里的 `//` —— 用 `(^|[^:'"\`])` 做前缀守卫，
 *    替换时把守卫字符原样还回去（`$1`）。
 */
function stripComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

/** 非测试的源码文件清单（仓库相对路径，`/` 分隔）。 */
function listSource(dir: string): string[] {
  return walk(join(ROOT, dir))
    .map((f) => relative(ROOT, f).split('\\').join('/'))
    .filter((f) => !isTest(f))
}

describe('① API 层不许直接写 client_automation_policies', () => {
  it('src/app/api 里没有一处对 client_automation_policies 的 update / insert / upsert / delete', () => {
    const pattern =
      /from\(\s*['"]client_automation_policies['"]\s*\)[\s\S]{0,400}?\.(update|insert|upsert|delete)\(/
    const offenders = listSource('src/app/api').filter((f) => pattern.test(stripComments(read(f))))

    expect(
      offenders,
      'API 路由只能改 ad_strategy_configs 意向，策略表由同步 worker 经 SQL 函数写。\n' +
        'Kernel 的授权决策是 append-only 的审计记录，不能被面板写入覆盖。\n' +
        offenders.join('\n'),
    ).toEqual([])
  })
})

describe('② rpc(ads_sync_autonomy_policy) 只许出现在同步 worker 里', () => {
  it('全仓唯一调用点就是同步 worker，且 worker 自己确实在调', () => {
    const pattern = /rpc\(\s*['"]ads_sync_autonomy_policy['"]/
    const callers = listSource('src').filter((f) => pattern.test(stripComments(read(f))))

    expect(
      callers,
      '同步 worker 是唯一写策略表的入口。别处直接 rpc 这个函数 = 绕开幂等键与回执。\n' +
        callers.join('\n'),
    ).toEqual([SYNC_WORKER])

    // 反向断言：worker 改名 / 改实现之后这条测试不许静默变绿
    expect(
      pattern.test(stripComments(read(SYNC_WORKER))),
      `${SYNC_WORKER} 应该调用 rpc('ads_sync_autonomy_policy') —— 否则上面那条断言是空转的`,
    ).toBe(true)
  })
})

describe('②b rpc(ads_trip_circuit_breaker_policy) 只许出现在熔断检查 worker 里', () => {
  it('全仓唯一调用点就是熔断检查 worker，且 worker 自己确实在调', () => {
    const pattern = /rpc\(\s*['"]ads_trip_circuit_breaker_policy['"]/
    const callers = listSource('src').filter((f) => pattern.test(stripComments(read(f))))

    expect(
      callers,
      '熔断检查 worker 是唯一写 deny 的入口。别处直接 rpc 这个函数 = 绕开幂等判据。\n' +
        callers.join('\n'),
    ).toEqual([CIRCUIT_BREAKER_WORKER])

    expect(
      pattern.test(stripComments(read(CIRCUIT_BREAKER_WORKER))),
      `${CIRCUIT_BREAKER_WORKER} 应该调用 rpc('ads_trip_circuit_breaker_policy') —— 否则上面那条断言是空转的`,
    ).toBe(true)
  })
})

describe('②c rpc(ads_release_circuit_breaker_policy) 只许出现在解除路由里', () => {
  it('全仓唯一调用点就是解除路由，且路由自己确实在调', () => {
    const pattern = /rpc\(\s*['"]ads_release_circuit_breaker_policy['"]/
    const callers = listSource('src').filter((f) => pattern.test(stripComments(read(f))))

    expect(
      callers,
      '解除熔断只能走这一条内部管理员路由。别处直接 rpc 这个函数 = 绕开全局管理员闸。\n' +
        callers.join('\n'),
    ).toEqual([CIRCUIT_BREAKER_RELEASE_ROUTE])

    expect(
      pattern.test(stripComments(read(CIRCUIT_BREAKER_RELEASE_ROUTE))),
      `${CIRCUIT_BREAKER_RELEASE_ROUTE} 应该调用 rpc('ads_release_circuit_breaker_policy') —— 否则上面那条断言是空转的`,
    ).toBe(true)
  })
})

describe('③ 写 autonomy_mode 的路由必须过全局管理员闸', () => {
  it('每一处 autonomy_mode 赋值所在的路由文件都命中 guardGlobalAdmin / requireGlobalAdmin', () => {
    const assignment = /\.autonomy_mode\s*=[^=]/
    const guard = /\b(guardGlobalAdmin|requireGlobalAdmin)\(/
    const writers = listSource('src/app/api').filter((f) => assignment.test(stripComments(read(f))))

    expect(
      writers.length,
      '至少应该有一条路由写 ad_strategy_configs.autonomy_mode（Settings 面板的 PATCH）',
    ).toBeGreaterThanOrEqual(1)

    const offenders = writers.filter((f) => !guard.test(stripComments(read(f))))
    expect(
      offenders,
      '写 autonomy_mode 等于改客户自治程度，必须过全局管理员闸。\n' +
        offenders.join('\n'),
    ).toEqual([])
  })
})

describe('④ migration 里写 client_automation_policies 只许白名单', () => {
  const stripSqlComments = (sql: string) =>
    sql.replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')

  const writePattern =
    /\b(UPDATE|INSERT\s+INTO|DELETE\s+FROM)\s+(public\.)?client_automation_policies\b/i

  const migrationFiles = readdirSync(join(ROOT, MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql'))

  it('写策略表的 migration 全在白名单里', () => {
    const writers = migrationFiles.filter((f) =>
      writePattern.test(stripSqlComments(read(`${MIGRATIONS_DIR}/${f}`))),
    )
    const offenders = writers.filter((f) => !MIGRATION_WRITE_ALLOWLIST.includes(f))

    expect(
      offenders,
      '策略表的写入只许来自白名单 migration（同步 SQL 函数 + 已知的历史迁移）。\n' +
        '新增一条要过 review 的 diff，不许悄悄扩。\n' +
        offenders.join('\n'),
    ).toEqual([])
  })

  it('白名单里的每一条都真实存在且确实在写（清单不许留幽灵条目）', () => {
    for (const f of MIGRATION_WRITE_ALLOWLIST) {
      expect(migrationFiles, `${f} 不在 supabase/migrations 里`).toContain(f)
      expect(
        writePattern.test(stripSqlComments(read(`${MIGRATIONS_DIR}/${f}`))),
        `${f} 已经不再写 client_automation_policies 了，把它从白名单里删掉`,
      ).toBe(true)
    }
  })
})

describe('⑤ 纯判据 sync-policy.ts 不碰 supabase / Kernel 运行时', () => {
  it('没有 supabase 客户端、没有 .from() / .rpc()，Kernel 只取注册表常量', () => {
    const code = stripComments(read(SYNC_POLICY))

    expect(
      /@\/lib\/supabase|@supabase\/supabase-js|\.from\(|\.rpc\(/.test(code),
      `${SYNC_POLICY} 是纯模块：不 import supabase、无副作用，所有 I/O 归 worker。`,
    ).toBe(false)

    const specifiers = Array.from(code.matchAll(/from\s+['"]([^'"]+)['"]/g)).map((m) => m[1])
    const kernelImports = specifiers.filter((s) => s.startsWith('@/lib/kernel/'))
    expect(
      kernelImports,
      '纯判据只许从 Kernel 注册表取 ACTION_KEYS 常量，不许 import Kernel 运行时。',
    ).toEqual(['@/lib/kernel/registry'])

    // worker 侧：Kernel 一行不动 —— 连注册表都不 import
    const workerCode = stripComments(read(SYNC_WORKER))
    const workerKernelImports = Array.from(
      workerCode.matchAll(/from\s+['"]([^'"]+)['"]/g),
    ).map((m) => m[1]).filter((s) => s.startsWith('@/lib/kernel/'))
    expect(
      workerKernelImports,
      '同步 worker 不 import @/lib/kernel/** 的任何东西 —— Kernel 不认识 autonomy_mode。',
    ).toEqual([])
  })
})
