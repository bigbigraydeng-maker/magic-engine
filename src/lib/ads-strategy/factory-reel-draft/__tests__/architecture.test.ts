/**
 * WP「Reel 自动起草 PAUSED 广告」的架构红线。
 *
 * 本文件冻结的命题是：
 *   「本功能里 ME 代码把广告打开（切到 ACTIVE）的唯一途径是：没有。
 *     激活入口始终是 /api/ad-approval。」
 *
 * 🔴 这句话的适用范围仅限本文件里的这些测试所冻结的东西：
 *    - 受保护文件的 import 白名单（加一条 import 就是一次要过 review 的 diff）；
 *    - 受保护文件里不许出现激活符号 / 激活模块 / 动态 import / require / 'ACTIVE' 字面量；
 *    - 仓库里既有的激活写入点、createDraftForApproval 调用点、publishDraftPaused 调用点
 *      被冻结成「只许缩小」的清单 —— 它们不会被本功能删除，只是不许再新增。
 *    本文件不声称、也无法证明仓库里不存在别的激活路径；它只保证本功能不新增。
 *
 * 🔴 判据一律先 stripComments() 再匹配：一条把自己的文档当罪证的规则，
 *    第一件事就是教人删注释。
 *
 * 🔴 所有路径都用 join(process.cwd(), …)：本文件会被移动到
 *    src/lib/ads-strategy/factory-reel-draft/__tests__/architecture.test.ts，
 *    但 vitest 的 cwd 始终是仓库根，所以绝不能用 __dirname。
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'
import ts from 'typescript'

const ROOT = process.cwd()

/** 受保护文件 → 允许的 import 清单（`${specifier}::${name}` 形式，排序后比较）。 */
const GUARDED_IMPORTS: Record<string, string[]> = {
  'src/lib/ads-strategy/factory-reel-draft/config.ts': [
    '../ad-draft::MAX_AUTO_DAILY_BUDGET',
    '../ad-draft::MAX_DURATION_DAYS',
    '@supabase/supabase-js::SupabaseClient',
  ],
  'src/lib/ads-strategy/factory-reel-draft/gates.ts': [
    '@/lib/ads-strategy/draft-redlines::findRedlineHits',
    '@/lib/social/content-review::REEL_AUTO_CHECK_KEYS',
    '@/lib/social/content-review::REEL_HUMAN_CHECK_KEYS',
    '@/lib/social/content-review::checklistPasses',
    '@/lib/social/content-review::validateContentChecklist',
    '@/lib/social/reel-publishing::buildReelPostCaption',
  ],
  'src/lib/ads-strategy/factory-reel-draft/graph-io.ts': [
    './post-resolver::GraphGetResult',
    './post-resolver::PostResolverDeps',
    '@/lib/meta/graph-base::GRAPH_BASE',
  ],
  'src/lib/ads-strategy/factory-reel-draft/intent-ledger.ts': [
    '@supabase/supabase-js::SupabaseClient',
  ],
  'src/lib/ads-strategy/factory-reel-draft/on-failure.ts': [
    './intent-ledger::FACTORY_REEL_DRAFT_ACTION',
    './intent-ledger::IntentMode',
    './intent-ledger::IntentPayload',
    './intent-ledger::buildIntentKey',
    './intent-ledger::finishIntent',
    '@/lib/factory/publish/reel-published-event::FactoryReelPublishedEventSchema',
    '@supabase/supabase-js::SupabaseClient',
  ],
  'src/lib/ads-strategy/factory-reel-draft/post-resolver.ts': [],
  'src/lib/ads-strategy/factory-reel-draft/real-deps.ts': [
    '../draft-and-gate::createDraftForApproval',
    '../draft-redlines::loadDraftRedlines',
    './config::loadFactoryReelDraftConfig',
    './gates::ReelWorkOrderRow',
    './graph-io::FetchLike',
    './graph-io::createGraphGet',
    './graph-io::probeMetaToken',
    './run::ClientMetaFacts',
    './run::RunDeps',
    '@/lib/meta/token-manager::getStoredPageToken',
    '@/lib/meta/token-manager::resolveMetaTokenForClient',
    '@supabase/supabase-js::SupabaseClient',
  ],
  'src/lib/ads-strategy/factory-reel-draft/run.ts': [
    '../ad-draft::AdDraft',
    '../ad-draft::validateDraft',
    '../draft-and-gate::CreateDraftDeps',
    '../draft-and-gate::CreateDraftOutcome',
    './config::LoadedFactoryReelDraftConfig',
    './gates::ReelWorkOrderRow',
    './gates::evaluateReelDraftGates',
    './intent-ledger::IntentPatch',
    './intent-ledger::IntentStatus',
    './intent-ledger::claimIntent',
    './intent-ledger::finishIntent',
    './post-resolver::PostResolverDeps',
    './post-resolver::resolvePromotablePostId',
    '@/lib/factory/publish/reel-published-event::FactoryReelPublishedEventSchema',
    '@supabase/supabase-js::SupabaseClient',
  ],
  'src/lib/inngest/functions/factory-reel-ad-draft.ts': [
    '../client::CLOUD_FN_PREFIX',
    '../client::inngest',
    '@/lib/ads-strategy/factory-reel-draft/on-failure::recordUnhandledFailure',
    '@/lib/ads-strategy/factory-reel-draft/real-deps::buildRunDeps',
    '@/lib/ads-strategy/factory-reel-draft/run::RunOutcome',
    '@/lib/ads-strategy/factory-reel-draft/run::runFactoryReelAdDraft',
    '@/lib/factory/publish/reel-published-event::FACTORY_REEL_PUBLISHED_EVENT',
    '@/lib/supabase::supabaseAdmin',
    '@supabase/supabase-js::SupabaseClient',
  ],
  'src/lib/pm-todo/factory-reel-ad-draft-items.ts': [
    './manual-item-types::ManualItem',
    '@/lib/ads-strategy/ad-draft::MAX_AUTO_DAILY_BUDGET',
    '@/lib/factory/publish/publish-display::toPublishedView',
    '@supabase/supabase-js::SupabaseClient',
  ],
  'src/app/api/clients/[id]/factory-reel-ad-draft-config/route.ts': [
    '@/lib/ads-strategy/factory-reel-draft/config::FACTORY_REEL_DRAFT_MODES',
    '@/lib/ads-strategy/factory-reel-draft/config::isMissingColumnError',
    '@/lib/ads-strategy/factory-reel-draft/config::loadFactoryReelDraftConfig',
    '@/lib/ads-strategy/factory-reel-draft/config::parseFactoryReelDraftConfig',
    '@/lib/auth/client-access::requirePaidClientAccess',
    '@/lib/auth/require-admin::guardGlobalAdmin',
    '@/lib/auth/require-session::requireSession',
    '@/lib/supabase::supabaseAdmin',
    'next/server::NextRequest',
    'next/server::NextResponse',
  ],
}

/** 本功能里绝不许出现的符号名（无论从哪个模块 import）。 */
const FORBIDDEN_SYMBOLS = [
  'activatePublished',
  'approveDraft',
  'setCampaignStatus',
  'setAdSetStatus',
  'createAdFromPost',
]

/** 本功能里绝不许出现的模块（子串匹配）。 */
const FORBIDDEN_MODULE_SUBSTRINGS = ['ad-approval', 'spend-activation']

/** 仓库里既有的激活写入点 —— 只许缩小，不许新增。 */
const ACTIVATION_WRITERS_ALLOWED = [
  'src/app/api/ad-approval/[actionId]/route.ts',
  'src/app/api/clients/[id]/meta-ads/execute/route.ts',
  'src/lib/ads-strategy/draft-and-gate.ts',
  'src/lib/ads-strategy/stop-loss.ts',
  'src/lib/capabilities/ads-auto-pause/index.ts',
  'src/lib/capabilities/ads/pause-unit.ts',
  'src/lib/meta/ad-publisher.ts',
  'src/lib/meta/adsets.ts',
  'src/lib/meta/campaign-management.ts',
  'src/lib/meta/campaign-writes.ts',
]

/** 仓库里既有的 createDraftForApproval 调用点 —— 只许缩小，不许新增。 */
const CREATE_DRAFT_CALLERS_ALLOWED = [
  'src/app/api/clients/[id]/meta-ads/draft-listing/route.ts',
  'src/app/api/clients/[id]/meta-ads/draft/route.ts',
  'src/lib/ads-strategy/draft-and-gate.ts',
  'src/lib/ads-strategy/factory-reel-draft/real-deps.ts',
]

/** 仓库里既有的 publishDraftPaused 调用点 —— 只许缩小，不许新增。 */
const PUBLISH_PAUSED_CALLERS_ALLOWED = [
  'src/lib/ads-strategy/draft-and-gate.ts',
  'src/lib/meta/ad-publisher.ts',
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

/**
 * 用 TypeScript 编译器 API 解析 import，返回排序去重后的 `${specifier}::${name}` 列表。
 *
 * 命名 import 用「导入名」（`propertyName ?? name`），所以
 * `import { setAdSetStatus as s }` 仍然记作 `setAdSetStatus`。
 */
function extractImports(source: string): string[] {
  const sf = ts.createSourceFile('probe.ts', source, ts.ScriptTarget.Latest, true)
  const out: string[] = []

  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt)) continue
    if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue
    const spec = stmt.moduleSpecifier.text
    const clause = stmt.importClause

    if (!clause) {
      out.push(`${spec}::<side-effect>`)
      continue
    }

    if (clause.name) {
      out.push(`${spec}::default`)
    }

    const bindings = clause.namedBindings
    if (bindings) {
      if (ts.isNamespaceImport(bindings)) {
        out.push(`${spec}::*`)
      } else if (ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) {
          const name = el.propertyName ? el.propertyName.text : el.name.text
          out.push(`${spec}::${name}`)
        }
      }
    }
  }

  return Array.from(new Set(out)).sort()
}

/** 对（已挖空注释的）源码做红线检查，返回原因字符串列表。 */
function findViolations(source: string): string[] {
  const code = stripComments(source)
  const reasons: string[] = []

  const imports = extractImports(code)
  for (const entry of imports) {
    const sep = entry.indexOf('::')
    const spec = entry.slice(0, sep)
    const name = entry.slice(sep + 2)

    if (FORBIDDEN_SYMBOLS.includes(name)) {
      reasons.push(`forbidden_symbol:${name}`)
    }
    if (FORBIDDEN_MODULE_SUBSTRINGS.some((s) => spec.includes(s))) {
      reasons.push(`forbidden_module:${spec}`)
    }
    if (name === '*' || name === 'default') {
      reasons.push('namespace_or_default_import')
    }
  }

  if (/\bimport\s*\(/.test(code)) reasons.push('dynamic_import')
  if (/\brequire\s*\(/.test(code)) reasons.push('require_call')
  if (/['"`]ACTIVE['"`]/.test(code)) reasons.push('active_literal')

  return Array.from(new Set(reasons)).sort()
}

/** 比较两份 import 清单，返回新增 / 删除。 */
function diffImports(
  actual: string[],
  expected: string[],
): { added: string[]; removed: string[] } {
  const a = new Set(actual)
  const e = new Set(expected)
  const added = actual.filter((x) => !e.has(x)).sort()
  const removed = expected.filter((x) => !a.has(x)).sort()
  return { added, removed }
}

/** 是否出现「把广告打开」的写入（激活符号调用 / 状态置 ACTIVE）。 */
function writesActivation(s: string): boolean {
  return (
    /\b(activatePublished|approveDraft)\s*\(/.test(s) ||
    /\bset(Campaign|AdSet)Status\s*\([^)]*['"]ACTIVE['"]/.test(s) ||
    /\bstatus\??\s*:\s*['"]ACTIVE['"](?!\s*\|)/.test(s)
  )
}

/** 是否提到 createDraftForApproval。 */
function mentionsCreateDraft(s: string): boolean {
  return /\bcreateDraftForApproval\b/.test(s)
}

/** 是否提到 publishDraftPaused。 */
function mentionsPublishPaused(s: string): boolean {
  return /\bpublishDraftPaused\b/.test(s)
}

/** 仓库里所有非测试源码文件（仓库相对路径，`/` 分隔）。 */
function allSourceFiles(): string[] {
  return listSource('src')
}

/** 对全仓非测试源码跑一个判据，返回命中的文件清单（排序）。 */
function scanRepo(predicate: (stripped: string) => boolean): string[] {
  return allSourceFiles()
    .filter((f) => predicate(stripComments(read(f))))
    .sort()
}

describe('A. 受保护文件的 import 白名单', () => {
  it('guarded files import exactly the allowed symbols', () => {
    for (const [file, expected] of Object.entries(GUARDED_IMPORTS)) {
      const actual = extractImports(read(file))
      const diff = diffImports(actual, expected)
      expect(
        diff,
        `${file} 的 import 与白名单不一致。\n` +
          `新增（要过 review 才能加）：${diff.added.join(', ') || '（无）'}\n` +
          `缺失（白名单里的幽灵条目）：${diff.removed.join(', ') || '（无）'}`,
      ).toEqual({ added: [], removed: [] })
    }
  })
})

describe('B. factory-reel-draft 目录里的每个非测试 .ts 都在白名单里', () => {
  it('every non-test .ts file in the factory-reel-draft directory is in the map', () => {
    const dir = join(ROOT, 'src/lib/ads-strategy/factory-reel-draft')
    const found = readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => !/\.test\.ts$/.test(f))
      .map((f) => `src/lib/ads-strategy/factory-reel-draft/${f}`)
      .sort()

    const expected = Object.keys(GUARDED_IMPORTS)
      .filter((f) => f.startsWith('src/lib/ads-strategy/factory-reel-draft/'))
      .sort()

    expect(
      found,
      'factory-reel-draft 目录里出现了没有白名单条目的新文件 —— 新文件必须显式登记。',
    ).toEqual(expected)
  })
})

describe('C. 受保护文件里没有红线违规', () => {
  it('guarded files have no violations', () => {
    for (const file of Object.keys(GUARDED_IMPORTS)) {
      const violations = findViolations(read(file))
      expect(
        violations,
        `${file} 命中红线：${violations.join(', ')}\n` +
          '本功能不许出现激活符号 / 激活模块 / 动态 import / require / \'ACTIVE\' 字面量。',
      ).toEqual([])
    }
  })
})

describe('D. 白名单自身的自洽性', () => {
  it('the allowlist itself contains no forbidden symbol or module', () => {
    for (const [file, entries] of Object.entries(GUARDED_IMPORTS)) {
      for (const entry of entries) {
        const sep = entry.indexOf('::')
        const spec = entry.slice(0, sep)
        const name = entry.slice(sep + 2)

        expect(
          FORBIDDEN_SYMBOLS.includes(name),
          `${file} 的白名单里出现了禁用符号 ${name}`,
        ).toBe(false)

        expect(
          FORBIDDEN_MODULE_SUBSTRINGS.some((s) => spec.includes(s)),
          `${file} 的白名单里出现了禁用模块 ${spec}`,
        ).toBe(false)
      }
    }
  })
})

describe('E. 全仓冻结清单（只许缩小）', () => {
  it('activation writers are a subset of the frozen allowlist', () => {
    const found = scanRepo(writesActivation)
    const allowed = new Set(ACTIVATION_WRITERS_ALLOWED)
    const offenders = found.filter((f) => !allowed.has(f))
    expect(
      offenders,
      '出现了新的「把广告打开」的写入点。\n' +
        '本功能不许新增激活路径 —— 请把新调用点拿去过 review，' +
        '确认它确实走 /api/ad-approval，再决定是否扩白名单。\n' +
        offenders.join('\n'),
    ).toEqual([])
  })

  it('createDraftForApproval callers are a subset of the frozen allowlist', () => {
    const found = scanRepo(mentionsCreateDraft)
    const allowed = new Set(CREATE_DRAFT_CALLERS_ALLOWED)
    const offenders = found.filter((f) => !allowed.has(f))
    expect(
      offenders,
      '出现了新的 createDraftForApproval 调用点。\n' +
        '请把新调用点拿去过 review，确认它只起草 PAUSED 广告，再决定是否扩白名单。\n' +
        offenders.join('\n'),
    ).toEqual([])
  })

  it('publishDraftPaused callers are a subset of the frozen allowlist', () => {
    const found = scanRepo(mentionsPublishPaused)
    const allowed = new Set(PUBLISH_PAUSED_CALLERS_ALLOWED)
    const offenders = found.filter((f) => !allowed.has(f))
    expect(
      offenders,
      '出现了新的 publishDraftPaused 调用点。\n' +
        '请把新调用点拿去过 review，确认它不会把广告打开，再决定是否扩白名单。\n' +
        offenders.join('\n'),
    ).toEqual([])
  })
})

describe('F. 探针：判据必须真的会响', () => {
  it('findViolations 命中禁用符号（含别名）', () => {
    expect(
      findViolations(`import { activatePublished } from '@/lib/meta/ad-publisher'`),
    ).toContain('forbidden_symbol:activatePublished')

    expect(
      findViolations(`import { approveDraft } from '@/lib/meta/ad-publisher'`),
    ).toContain('forbidden_symbol:approveDraft')

    // 别名：用导入名（propertyName），所以 `setAdSetStatus as s` 仍然要响
    expect(
      findViolations(`import { setAdSetStatus as s } from '@/lib/meta/adsets'`),
    ).toContain('forbidden_symbol:setAdSetStatus')
  })

  it('findViolations 命中禁用模块', () => {
    const v = findViolations(`import { a } from '@/lib/ads/spend-activation'`)
    expect(v.some((r) => r.startsWith('forbidden_module:'))).toBe(true)
  })

  it('findViolations 命中 namespace / default import', () => {
    expect(findViolations(`import * as m from './x'`)).toContain(
      'namespace_or_default_import',
    )
    expect(findViolations(`import d from './x'`)).toContain(
      'namespace_or_default_import',
    )
  })

  it('findViolations 命中 dynamic import / require', () => {
    expect(findViolations(`const m = await import('./x')`)).toContain('dynamic_import')
    expect(findViolations(`const m = require('./x')`)).toContain('require_call')
  })

  it("findViolations 命中 'ACTIVE' 字面量（各种引号）", () => {
    expect(findViolations(`const s = 'ACTIVE'`)).toContain('active_literal')
    expect(findViolations(`const o = { status: "ACTIVE" }`)).toContain('active_literal')
    expect(findViolations('const s = `ACTIVE`')).toContain('active_literal')
  })

  it('findViolations 对干净源码不响', () => {
    expect(findViolations(`import { a } from './a'\nexport const b = a`)).toEqual([])
  })

  it('findViolations 先挖空注释，注释里的违规不算', () => {
    expect(
      findViolations(`// activatePublished('ACTIVE') import('x')\nexport const ok = 1`),
    ).toEqual([])
  })

  it('diffImports 能看出新增与删除', () => {
    const base = ['a::x', 'b::y']
    expect(diffImports([...base, 'c::z'], base)).toEqual({ added: ['c::z'], removed: [] })
    expect(diffImports(['a::x'], base)).toEqual({ added: [], removed: ['b::y'] })
  })

  it('writesActivation 会响 / 不响', () => {
    expect(writesActivation(`await activatePublished(x)`)).toBe(true)
    expect(writesActivation(`setAdSetStatus(id, token, 'ACTIVE')`)).toBe(true)
    expect(writesActivation(`const o = { status: 'ACTIVE' }`)).toBe(true)

    // 类型位置（联合类型）不算写入
    expect(writesActivation(`type S = { status: 'ACTIVE' | 'PAUSED' }`)).toBe(false)
    expect(writesActivation(`const o = { status: 'PAUSED' }`)).toBe(false)
  })

  it('mentionsCreateDraft / mentionsPublishPaused 会响 / 不响', () => {
    expect(mentionsCreateDraft(`await createDraftForApproval(deps, input)`)).toBe(true)
    expect(mentionsCreateDraft(`const x = 1`)).toBe(false)

    expect(mentionsPublishPaused(`await publishDraftPaused(deps, id)`)).toBe(true)
    expect(mentionsPublishPaused(`const x = 1`)).toBe(false)
  })
})
