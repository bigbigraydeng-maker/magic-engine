/**
 * 台账层的架构守卫（Issue #930 · #960）。
 *
 * 🔴 授权边界不能只靠 code review：一旦有人在这一层抓住 `supabaseAdmin`、
 *    把 crawler 那套「剥 www + 前缀比较」借回来、塞一个 route / cron 入口，
 *    或者**让生成入口接受调用方传进来的候选清单**，
 *    「精确主机边界」「注入而不是抓取」「本 PR 不开生产入口」「不存在签名 oracle」
 *    这几条就同时破了 —— 而这种改动在 diff 里长得很无辜。
 *
 * 仿 `src/lib/geo-baseline/__tests__/architecture.test.ts` 的写法。
 */

import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join, relative } from 'path'

const ROOT = process.cwd()
const DIR = join(ROOT, 'src/lib/site-audit/canonical-inventory')

/**
 * 仓库里**真正会被打包进运行时**的源码扩展名。
 *
 * 🔴 上一版只收 `.ts`，于是「全仓扫描」根本不成立 —— 仓库里有 350 个 `.tsx`
 *    （route / server action / component），一个都没被扫到。一个 `.tsx` 里的
 *    深 import 或 oracle 调用会完全隐形，而守卫照样全绿。
 */
export const RUNTIME_SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'] as const

function walk(dir: string, out: string[] = [], exts: readonly string[] = RUNTIME_SOURCE_EXTENSIONS): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out, exts)
    else if (exts.some((ext) => entry.endsWith(ext))) out.push(full)
  }
  return out
}

const rel = (f: string): string => relative(ROOT, f).split('\\').join('/')


function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => {
      const t = line.trim()
      return !t.startsWith('//') && !t.startsWith('*')
    })
    .join('\n')
}

const PRODUCTION_FILES = walk(DIR)
  .map((f) => relative(ROOT, f).split('\\').join('/'))
  .filter((f) => !f.includes('/__tests__/') && !f.endsWith('.test.ts'))

const sourceOf = (file: string): string => stripComments(readFileSync(join(ROOT, file), 'utf8'))

/**
 * canonical-inventory 目录下**全部**源码 —— 生产文件与测试文件都算。
 *
 * 🔴 必须定义在 `PRODUCTION_FILES` **之后**：变异探针会把它替换成 `PRODUCTION_FILES`，
 *    定义在前就会造成暂时性死区错误 → 整个测试文件加载失败 → `numFailedTests` 为 0，
 *    跟「这道闸零覆盖」输出一模一样。判据自己不能有这种假阴性。
 */
const ALL_INVENTORY_SOURCES = walk(DIR).map(rel)

/**
 * 全仓源码清单与「本目录之外」那部分的剥注释内容 —— **模块级只算一次**。
 *
 * 🔴 上一版三条用例各自独立地全仓 `walk` 一遍，其中深 import 那条还要对约 3000 个文件
 *    逐个读全文 + 跑两次正则。实测单次 2485–3546ms，而 vitest 默认单测超时是 5000ms ——
 *    满负载下会顶穿，于是这条判据时红时绿。
 *    **一条时红时绿的判据比没有判据更坏**：它训练人「再跑一次就绿了」，
 *    等真有人往某个 `.tsx` 里塞一条深 import，第一反应也会是重跑。
 *
 * 放模块级而不是懒加载：collection 阶段不受 5000ms 单测超时约束，
 * 成本落在那里就不会再变成偶发失败。
 */
const REPO_SOURCE_FILES: readonly string[] = walk(join(ROOT, 'src')).map(rel)

const OUTSIDE_INVENTORY_SOURCES: readonly { readonly file: string; readonly src: string }[] = REPO_SOURCE_FILES
  .filter((f) => !f.startsWith('src/lib/site-audit/canonical-inventory/'))
  .map((file) => ({ file, src: sourceOf(file) }))

/**
 * 客户专属字样。
 *
 * 🔴 只查**生产文件**。测试里故意留了 #930 授权点名的那个主机对（裸域 vs www），
 *    因为授权要求的证明就是那一条；但生产代码里出现任何客户字面量，
 *    就等于把这层做成了「某个客户的能力」，那是授权明确禁止的。
 */
const CLIENT_SPECIFIC = /romanhu|roman-hu|ray\s*white|mission\s*bay/i

describe('🔴 #960 承重墙：不存在签名 oracle', () => {
  const adapters = sourceOf('src/lib/site-audit/canonical-inventory/adapters.ts')

  /** 从源码里抠出一个 interface 的字段名清单。 */
  function fieldsOf(src: string, name: string): string[] {
    const match = new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`).exec(src)
    expect(match, `找不到 ${name} 的定义 —— 判据已失效，不是通过`).not.toBeNull()
    return Array.from((match as RegExpExecArray)[1].matchAll(/^\s*readonly\s+(\w+)/gm)).map((m) => m[1])
  }

  it('🔴 生成入口只接受业务边界：clientId / requestedDomain / approvedHosts，一个字段都不多', () => {
    // 多接受任何一样调用方构造的内容，它就变成一台「替任意内容签名」的机器：
    // 编辑者拿自己伪造的候选集合去调它，就能换回一枚合法的 L1 签名，
    // #960 的整个证明（「编辑者算不出锚点」）当场失效。
    expect(fieldsOf(adapters, 'GeneratePlanInput').sort()).toEqual([
      'approvedHosts',
      'clientId',
      'requestedDomain',
    ])
  })

  it('🔴 生成入口的入参里不许出现任何候选内容字样', () => {
    const match = /export interface GeneratePlanInput \{([\s\S]*?)\n\}/.exec(adapters)
    const body = (match as RegExpExecArray)[1]
    for (const banned of ['discoveredUrls', 'urls', 'candidates', 'discovery', 'perHost', 'counts', 'core', 'plan']) {
      expect(body, `GeneratePlanInput 里出现了 ${banned}`).not.toMatch(new RegExp(`\\b${banned}\\b`))
    }
  })

  it('🔴 生成入口自己在服务端跑发现，不从入参拿候选', () => {
    expect(adapters).toMatch(/const discovery = await discoverCandidateUrls\(input\.approvedHosts\)/)
  })

  it('🔴 公开门面不导出裸的核心构造器 / 封签器（否则等于把 oracle 摆上台面）', () => {
    const index = sourceOf('src/lib/site-audit/canonical-inventory/index.ts')
    for (const primitive of ['buildInventoryPlan', 'sealEnvelope', 'sealReview', 'computeGenerationDigest', 'computeReviewDigest']) {
      expect(index, `index.ts 导出了内部原语 ${primitive}`).not.toMatch(new RegExp(`\\b${primitive}\\b`))
    }
  })

  it('🔴 只有一个地方能产出 L1 签名（sealEnvelope 只被生成入口调用）', () => {
    const callers = PRODUCTION_FILES.filter((f) => /\bsealEnvelope\(/.test(sourceOf(f)))
    expect(callers).toEqual([
      'src/lib/site-audit/canonical-inventory/adapters.ts',
      'src/lib/site-audit/canonical-inventory/envelope.ts',
    ])
  })

  it('🔴 只有一个地方能产出 L2 凭证（sealReview 只被盖章入口调用）', () => {
    const callers = PRODUCTION_FILES.filter((f) => /\bsealReview\(/.test(sourceOf(f)))
    expect(callers).toEqual([
      'src/lib/site-audit/canonical-inventory/attestation.ts',
      'src/lib/site-audit/canonical-inventory/review.ts',
    ])
  })

  /**
   * 🔴 这一条补的是前一版守卫的**射程**：它只扫本目录，于是「仓库别处深 import 原语」
   *    这条路完全在视野之外 —— 加一个 route
   *    `import { sealEnvelope } from '@/lib/site-audit/canonical-inventory/envelope'`，
   *    拿请求体里的候选自己拼一份 core 去签，就能换回一枚**合法的 L1 签名**，
   *    而目录内的守卫全绿。承重墙必须按**全仓**来守。
   */
  it('🔴 全仓范围内：本目录之外没有任何文件深 import 签名原语模块', () => {
    // 判据按**路径尾部**匹配，所以 `@/lib/site-audit/canonical-inventory/envelope`
    // 与 `../canonical-inventory/envelope` 两种写法都盖得住，静态 import、
    // `require()`、动态 `import()` 也一样。
    const PRIMITIVES = ['envelope', 'attestation', 'plan', 'decisions', 'shapes', 'signing', 'canonical-json', 'crawl-stage']
    const offenders: string[] = []
    for (const { file, src } of OUTSIDE_INVENTORY_SOURCES) {
      for (const primitive of PRIMITIVES) {
        if (new RegExp(`canonical-inventory/${primitive}(['"/]|$)`, 'm').test(src)) {
          offenders.push(`${file} → canonical-inventory/${primitive}`)
        }
      }
    }
    expect(
      offenders,
      `这些文件绕过了 index.ts 的公开门面直接 import 原语（签名 oracle 风险）：\n${offenders.join('\n')}`,
    ).toEqual([])
  })

  it('🔴 判据本身没有空跑：全仓扫描扫到了东西，而且确实包含 .tsx', () => {
    const scanned = REPO_SOURCE_FILES
    expect(scanned.length, '扫描结果为空 = 上面那条守卫在空跑').toBeGreaterThan(500)
    // 🔴 这一条就是「把 .tsx 从扩展名清单里删掉必须变红」的判据本身。
    expect(scanned.filter((f) => f.endsWith('.tsx')).length, '一个 .tsx 都没扫到 —— 扩展名清单漏了它').toBeGreaterThan(0)
  })

  it('🔴 运行时源码扩展名清单覆盖真实会被打包的全部形态', () => {
    expect([...RUNTIME_SOURCE_EXTENSIONS].sort()).toEqual(['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx'])
  })

  it('🔴 扫描器确实按扩展名工作（只留 .tsx 时必须只返回 .tsx）', () => {
    // 独立盯住扫描器本身：清单是对的但扫描器不用它，是「声明了≠接上了」的经典形状。
    // 🔴 这一条**故意不复用**上面那份缓存 —— 复用就等于拿扫描器的输出去验证扫描器自己。
    //    它只做目录遍历、不读文件内容，成本是毫秒级，不构成超时风险。
    const onlyTsx = walk(join(ROOT, 'src'), [], ['.tsx']).map(rel)
    expect(onlyTsx.length).toBeGreaterThan(0)
    expect(onlyTsx.every((f) => f.endsWith('.tsx'))).toBe(true)
  })

  it('🔴 公共门面不导出通用 signer（不用 deep import 也能变成 oracle）', () => {
    const index = sourceOf('src/lib/site-audit/canonical-inventory/index.ts')
    expect(index, 'index.ts 导出了 createHmacSigner —— 外部 route 可以直接拿它给任意 payload 签名').not.toMatch(
      /\bcreateHmacSigner\b/,
    )
    // 验签能力不构成 oracle，保留是有意的 —— 顺带钉住「不许连它一起删掉」。
    expect(index).toMatch(/\bcreateHmacVerifier\b/)
  })

  it('🔴 签名覆盖面是穷举的 —— 给 UnsignedEnvelope 加字段却漏加进清单必须编译失败', () => {
    const envelope = sourceOf('src/lib/site-audit/canonical-inventory/envelope.ts')
    expect(envelope).toMatch(/Record<keyof UnsignedEnvelope, true>/)
    // 白名单最危险的失效方式是「加了字段没加进名单」——那会得到一个静默不被签名保护的字段。
    expect(envelope).toMatch(/Object\.keys\(SIGNED_ENVELOPE_FIELDS\)/)
  })
})

describe('🔴 #960 密钥与验签边界', () => {
  it('🔴 本层不读环境变量 —— 密钥由组合根注入（密钥永不进入工件的前提）', () => {
    const offenders = PRODUCTION_FILES.filter((f) => /process\.env/.test(sourceOf(f)))
    expect(offenders, `这些文件自己读了 env：\n${offenders.join('\n')}`).toEqual([])
  })

  it('🔴 生产代码里不存在恒真验签器（注入一个恒真的，这道闸就等于没有）', () => {
    const offenders: string[] = []
    for (const file of PRODUCTION_FILES) {
      const src = sourceOf(file)
      if (/\(\s*\)\s*=>\s*'valid'/.test(src)) offenders.push(`${file} → 恒判 valid 的验签器`)
      if (/=>\s*true\b/.test(src)) offenders.push(`${file} → 恒返回 true 的谓词`)
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('🔴 不复用 Kernel 的 canonicalJson（依赖方向 + 本层序列化规则必须自己版本化）', () => {
    const offenders = PRODUCTION_FILES.filter((f) => /kernel\/idempotency|from\s+['"]@\/lib\/kernel/.test(sourceOf(f)))
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('🔴 签名比较必须是常量时间（否则那道探针拆掉也没人会红）', () => {
    // 这条判据的存在理由很具体：变异探针「把 timingSafeEqual 换成 ===」在行为上
    // 与原实现完全等价（utf8 编码单射），任何行为测试都抓不到它 —— 只有这里抓得到。
    const signing = sourceOf('src/lib/site-audit/canonical-inventory/signing.ts')
    expect(signing).toMatch(/timingSafeEqual\(a, b\)/)
    expect(signing, '签名比较退回成 === 了').not.toMatch(/return expected === provided/)
  })

  it('🔴 两层签名必须是两把不同的密钥（keyId 相同就当场拒）', () => {
    expect(sourceOf('src/lib/site-audit/canonical-inventory/review.ts')).toMatch(/shared_signing_key/)
    expect(sourceOf('src/lib/site-audit/canonical-inventory/activation.ts')).toMatch(/shared_signing_key/)
  })

  it('🔴 缺密钥不许 fallback 到别的密钥（借来的密钥 = 两套系统共用一个信任根）', () => {
    const offenders = PRODUCTION_FILES.filter((f) => /CRON_SECRET|UPLOAD_LINK_SECRET/.test(sourceOf(f)))
    expect(offenders, offenders.join('\n')).toEqual([])
  })
})

describe('🔴 #960 有效期与身份来源是常量，不是选项', () => {
  const envelope = sourceOf('src/lib/site-audit/canonical-inventory/envelope.ts')

  it('🔴 PLAN_MAX_AGE_DAYS 固定 7 天', () => {
    expect(envelope).toMatch(/export const PLAN_MAX_AGE_DAYS = 7\b/)
  })

  it('🔴 有效期不是任何函数的入参，也没有 skip / disable 开关', () => {
    for (const file of PRODUCTION_FILES) {
      const src = sourceOf(file)
      expect(src, `${file} 出现了可调的有效期`).not.toMatch(/maxAgeDays|maxAgeMs|skipExpiry|ignoreExpiry|disableExpiry/)
    }
    // 新鲜度函数只收「签发时间 + 当前时间」两个参数，没有第三个可以塞上限的口子。
    expect(envelope).toMatch(/export function checkEnvelopeFreshness\(issuedAt: string, nowIso: string\)/)
  })

  it('🔴 信封 / 凭证的结构版本必须逐字比对当前常量（只算不比 = 升版本是空承诺）', () => {
    expect(sourceOf('src/lib/site-audit/canonical-inventory/envelope.ts')).toMatch(
      /envelope\.envelopeVersion !== INVENTORY_ENVELOPE_VERSION/,
    )
    expect(sourceOf('src/lib/site-audit/canonical-inventory/attestation.ts')).toMatch(
      /review\.envelopeVersion !== INVENTORY_ENVELOPE_VERSION/,
    )
  })

  it('🔴 激活侧也要跑 core 的机器一致性纵深校验（不能只在盖章时跑）', () => {
    expect(sourceOf('src/lib/site-audit/canonical-inventory/activation.ts')).toMatch(/assertCoreIntact\(core\)/)
  })

  it('🔴 兜底闸必须排在被接受集合闸**之后**（放前面会整片遮住更具体的闸）', () => {
    const src = sourceOf('src/lib/site-audit/canonical-inventory/activation.ts')
    const accepted = src.indexOf('checkAcceptedSet(resolved')
    const fallback = src.indexOf('checkCoreMachineDerived(core)')
    expect(accepted, '判据失效：找不到被接受集合闸').toBeGreaterThan(0)
    expect(fallback, '判据失效：找不到兜底闸').toBeGreaterThan(0)
    expect(fallback).toBeGreaterThan(accepted)
  })

  it('🔴 reviewerIdentitySource 是单一字面量类型，不是联合类型', () => {
    const types = sourceOf('src/lib/site-audit/canonical-inventory/types.ts')
    expect(types).toMatch(/readonly reviewerIdentitySource: 'self_reported'\n/)
    expect(types, '出现了 authenticated_session —— 现在没有任何东西能产生它').not.toMatch(
      /reviewerIdentitySource[^\n]*authenticated_session/,
    )
  })

  it('🔴 增量激活必须 fail closed（防重放当前只靠首次激活的空库闸）', () => {
    const shapes = sourceOf('src/lib/site-audit/canonical-inventory/shapes.ts')
    expect(shapes).toMatch(/input\.mode !== 'first_activation'/)
    expect(shapes).toMatch(/unsupported_activation_mode/)
  })
})

describe('台账层的边界', () => {
  it('目录里确实有生产文件（防止判据因路径写错而空跑）', () => {
    expect(PRODUCTION_FILES.length).toBeGreaterThan(0)
    expect(PRODUCTION_FILES).toContain('src/lib/site-audit/canonical-inventory/activation.ts')
    expect(PRODUCTION_FILES).toContain('src/lib/site-audit/canonical-inventory/envelope.ts')
  })

  it('绝不自己抓 service-role 客户端 —— 落库口一律注入', () => {
    const offenders = PRODUCTION_FILES.filter((f) => /from\s+['"]@\/lib\/supabase['"]/.test(sourceOf(f)))
    expect(offenders, `这些文件自己抓了 supabaseAdmin：\n${offenders.join('\n')}`).toEqual([])
  })

  it('🔴 不直接碰 client_site_pages —— 写入只能经过注入的 store', () => {
    const offenders = PRODUCTION_FILES.filter((f) => /client_site_pages/.test(sourceOf(f)))
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('不 import 执行内核 / 能力层 / 飞轮 / 执行队列（依赖方向）', () => {
    const forbidden = ['@/lib/kernel', '@/lib/execution', '@/lib/capabilities', '@/lib/flywheel', '@/lib/zhuge']
    const violations: string[] = []
    for (const file of PRODUCTION_FILES) {
      const src = sourceOf(file)
      for (const spec of forbidden) {
        if (new RegExp(`from\\s+['"]${spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(src)) {
          violations.push(`${file} → ${spec}`)
        }
      }
    }
    expect(violations, violations.join('\n')).toEqual([])
  })

  it('🔴 不复用 seo-patrol 的 canonicalUrl —— 那个故意合并 bare/www，目标相反', () => {
    const offenders = PRODUCTION_FILES.filter((f) => /seo-patrol/.test(sourceOf(f)))
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('🔴 不把 crawler 的「剥 www」宽松同源判定借进来', () => {
    const offenders: string[] = []
    for (const file of PRODUCTION_FILES) {
      const src = sourceOf(file)
      // 生产代码里不该出现 www 字面量（批准清单由调用方给），也不该有剥 www 的正则。
      if (/www\\?\./.test(src)) offenders.push(`${file} → 出现了 www 字面量`)
      if (/replace\([^)]*www/.test(src)) offenders.push(`${file} → 剥 www 的 replace`)
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('🔴 主机判定不许用 startsWith / includes —— 只能是精确相等', () => {
    const rules = sourceOf('src/lib/site-audit/canonical-inventory/url-rules.ts')
    expect(rules).not.toMatch(/hostname[^\n]*\.startsWith\(/)
    expect(rules).toMatch(/approved === host/)
  })

  it('不暴露生产入口（没有 route.ts / cron 文件）', () => {
    const files = walk(DIR).map((f) => relative(ROOT, f))
    const entrypoints = files.filter((f) => /route\.ts$|cron/i.test(f))
    expect(entrypoints, `本 PR 不开生产入口：\n${entrypoints.join('\n')}`).toEqual([])
  })

  it('🔴 本 PR 不提供落库实现 —— 代码里没有任何路径能写到生产台账', () => {
    // store 只有接口与假件；出现一个真实实现（import supabase 类型并实现该接口）就要停下来重新授权。
    const offenders = PRODUCTION_FILES.filter((f) => /implements\s+CanonicalInventoryStore/.test(sourceOf(f)))
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('生产文件里没有任何客户专属字样（不是「某个客户的能力」）', () => {
    const offenders = PRODUCTION_FILES.filter((f) => CLIENT_SPECIFIC.test(readFileSync(join(ROOT, f), 'utf8')))
    expect(offenders, `这些文件里有客户专属字样：\n${offenders.join('\n')}`).toEqual([])
  })

  it('生产文件里没有 UUID 字面量（租户只能从调用方进来）', () => {
    const offenders = PRODUCTION_FILES.filter((f) =>
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(sourceOf(f)),
    )
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('每个函数都 < 50 行（CLAUDE.md 的硬规则，别等复审来提）', () => {
    const offenders: string[] = []
    // 🔴 本 PR 新增/改动的文件全都要盯，不只是本目录 ——
    //    判据的覆盖面本身也是判据的一部分。
    for (const file of [...PRODUCTION_FILES, 'src/lib/site-audit/page-enrichment.ts']) {
      const lines = readFileSync(join(ROOT, file), 'utf8').split('\n')
      let start = -1
      for (let i = 0; i < lines.length; i++) {
        if (start < 0 && /^(export )?(async )?function /.test(lines[i])) start = i
        else if (start >= 0 && lines[i] === '}') {
          const length = i - start + 1
          if (length >= 50) offenders.push(`${file}:${start + 1} → ${length} 行`)
          start = -1
        }
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('🔴 每个文件都 < 800 行 —— **生产文件与测试文件一律**（冻结契约的硬规则）', () => {
    // 🔴 上一版只扫 PRODUCTION_FILES，于是 activation.test.ts 长到 862 行也全绿，
    //    而 PR 报告还写着「最大文件 696 行」—— 结论不实。上限对测试文件同样成立。
    const offenders = ALL_INVENTORY_SOURCES.map((f) => ({
      f,
      n: readFileSync(join(ROOT, f), 'utf8').split('\n').length,
    }))
      .filter((x) => x.n >= 800)
      .map((x) => `${x.f} → ${x.n} 行`)
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('文件上限守卫没有空跑：扫描面确实同时包含生产文件与测试文件', () => {
    expect(ALL_INVENTORY_SOURCES.length).toBeGreaterThan(PRODUCTION_FILES.length)
    expect(ALL_INVENTORY_SOURCES.some((f) => f.includes('/__tests__/'))).toBe(true)
    expect(ALL_INVENTORY_SOURCES).toContain('src/lib/site-audit/canonical-inventory/activation.ts')
  })

  it('没有 any', () => {
    const offenders = PRODUCTION_FILES.filter((f) => /:\s*any\b|<any>|as\s+any\b/.test(sourceOf(f)))
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('本 PR 没有新增 migration（台账用现有表，不加列不加表）', () => {
    const migrations = readdirSync(join(ROOT, 'supabase/migrations'))
    const offenders = migrations.filter((f) => /canonical.?inventory|inventory.?envelope/i.test(f))
    expect(offenders, offenders.join('\n')).toEqual([])
  })
})

describe('复用而不是重造', () => {
  const adapters = sourceOf('src/lib/site-audit/canonical-inventory/adapters.ts')

  it('发现 / 抓取用现有 crawler，不另起一套', () => {
    expect(adapters).toMatch(/from '\.\.\/crawler'/)
    expect(adapters).toMatch(/discoverSitemapUrls/)
    expect(adapters).toMatch(/crawlPages/)
  })

  it('分类 / GEO 检测走抽出来的 page-enrichment（背后仍是现有 classifier + geo-detector）', () => {
    expect(adapters).toMatch(/from '\.\.\/page-enrichment'/)
    const enrichment = sourceOf('src/lib/site-audit/page-enrichment.ts')
    expect(enrichment).toMatch(/from '\.\/classifier'/)
    expect(enrichment).toMatch(/from '\.\/geo-detector'/)
  })

  it('台账层自己不实现抓取 —— 没有 fetch / jina 调用', () => {
    const offenders = PRODUCTION_FILES.filter((f) => /\bfetch\(|jina/i.test(sourceOf(f)))
    expect(offenders, offenders.join('\n')).toEqual([])
  })
})
