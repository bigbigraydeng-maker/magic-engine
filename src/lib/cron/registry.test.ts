import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { readFileSync, existsSync, statSync } from 'fs'
import path from 'path'
import { CRON_REGISTRY } from './registry'
import { expectedIntervalHours } from './schedule'

const ROOT = path.resolve(__dirname, '../../..')

/**
 * 清单必须跟 render.yaml 永远一致。
 *
 * 不对账的话，加了 cron 忘了登记 = 它从此不在监控范围内，
 * 而「不在监控范围」和「一切正常」在告警里长得一模一样 ——
 * 这正是工厂排产任务停摆 8 天没人发现的形态。
 */
type ParsedCron = { service: string; schedule: string; routes: string[]; startCommand: string }

/**
 * 从一个服务块里取出 startCommand。三种写法都认：
 *   - 单行 `startCommand: node x.js`
 *   - literal 块 `startCommand: |`（含 `|-` `|+`）：换行是真换行，另起一条命令
 *   - folded 块 `startCommand: >`（含 `>-` `>+`）：YAML 会把普通换行折成空格，仍是一条命令
 *
 * 两种块的换行语义必须分开 —— 都当 literal 的话，一个合法的 folded 块会被拆成
 * 「curl」+「URL」两段，URL 那段不以 curl 开头，测试就误报。
 *
 * 块的结束按缩进判：缩进不比 `startCommand:` 这一行深的第一行就是块外。
 * 早先用 `(?:[ \t]+.*\n)+` 一路吃下去，把后面的 `envVars:` / `- key: …` 也吞进了
 * 命令里 —— 反正后面判断时又把空白压平，整段还是以 curl 开头，就一直没露馅。
 *
 * 这是手写的够用版，不是完整 YAML 实现（不处理块内空行的折叠规则等）。本仓 46 条 cron
 * 全是 literal 块或单行，folded 只为「哪天有人这么写」兜底。真要完整语义得引 YAML
 * 解析器 —— 那是新依赖，不在这个 PR 的范围里。
 */
function extractStartCommand(block: string): string {
  const lines = block.split('\n')
  const i = lines.findIndex((l) => /^\s*startCommand:/.test(l))
  if (i < 0) return ''
  const keyIndent = /^([ \t]*)/.exec(lines[i])![1].length
  const inline = /startCommand:[ \t]+(\S.*)$/.exec(lines[i])?.[1]?.trim()
  const isBlock = inline !== undefined && /^[|>][-+]?\d*$/.test(inline)
  if (inline !== undefined && !isBlock) return inline
  const folded = isBlock && inline!.startsWith('>')
  const body: string[] = []
  for (const line of lines.slice(i + 1)) {
    if (line.trim() === '') break
    if (/^([ \t]*)/.exec(line)![1].length <= keyIndent) break
    body.push(line)
  }
  if (body.length === 0) return ''
  if (!folded) return `${body.join('\n')}\n`
  // folded 只折**同级缩进**的普通行；比基准更深的行保留换行（YAML 折叠标量的规则）。
  // 无脑全折会把一条更深缩进的本地命令拼进 curl 那一段，变成漏报。
  const base = /^([ \t]*)/.exec(body[0])![1].length
  const out: string[] = []
  for (const line of body) {
    const deeper = /^([ \t]*)/.exec(line)![1].length > base
    if (out.length === 0 || deeper) out.push(line.trim())
    else out[out.length - 1] = `${out[out.length - 1]} ${line.trim()}`
  }
  return `${out.join('\n')}\n`
}

function parseRenderYaml(): ParsedCron[] {
  const txt = readFileSync(path.join(ROOT, 'render.yaml'), 'utf8')
  const out: ParsedCron[] = []
  const re = /-\s+type:\s+cron\s*\n\s+name:\s*(\S+)([\s\S]*?)(?=\n\s*-\s+type:|$)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(txt)) !== null) {
    const schedule = /schedule:\s*"([^"]+)"/.exec(m[2])?.[1] ?? ''
    const routes = Array.from(m[2].matchAll(/\/api\/cron\/([a-z0-9-]+)/g)).map((x) => x[1])
    const startCommand = extractStartCommand(m[2])
    out.push({ service: m[1], schedule, routes, startCommand })
  }
  return out
}

describe('CRON_REGISTRY 与 render.yaml 对账', () => {
  const parsed = parseRenderYaml()

  it('解析器真的解析到了东西（防止正则写歪导致后面全部空转成绿）', () => {
    expect(parsed.length).toBeGreaterThan(30)
  })

  it('🔴 render.yaml 里的每个 cron 都在清单里 —— 漏登记 = 脱离监控', () => {
    const known = new Set(CRON_REGISTRY.map((e) => e.service))
    const missing = parsed.filter((p) => !known.has(p.service)).map((p) => p.service)
    expect(missing, `这些 cron 没登记进 CRON_REGISTRY：${missing.join(', ')}`).toEqual([])
  })

  it('清单里不该有 render.yaml 已经删掉的任务（否则天天误报「没跑」）', () => {
    const live = new Set(parsed.map((p) => p.service))
    const stale = CRON_REGISTRY.filter((e) => !live.has(e.service)).map((e) => e.service)
    expect(stale, `这些已从 render.yaml 移除，清单该同步删：${stale.join(', ')}`).toEqual([])
  })

  it('调度表达式跟 render.yaml 一致', () => {
    const bySvc = new Map(parsed.map((p) => [p.service, p]))
    const drift = CRON_REGISTRY
      .filter((e) => bySvc.get(e.service)?.schedule !== e.schedule)
      .map((e) => `${e.service}: 清单 ${e.schedule} vs yaml ${bySvc.get(e.service)?.schedule}`)
    expect(drift).toEqual([])
  })

  it('每个调度表达式都能被算出间隔 —— 算不出的会静默失去监控', () => {
    const bad = CRON_REGISTRY
      .filter((e) => expectedIntervalHours(e.schedule) === null)
      .map((e) => `${e.service}(${e.schedule})`)
    expect(bad, `这些表达式解析不了，需要在 schedule.ts 里支持：${bad.join(', ')}`).toEqual([])
  })

  /** 从接口代码里读 startCronRun 的真实入参 —— 那才是日志里的名字。 */
  function jobNameInCode(routes: string[]): string | null {
    for (const r of routes) {
      const f = path.join(ROOT, 'src/app/api/cron', r, 'route.ts')
      if (!existsSync(f)) continue
      const m = /startCronRun\(\s*['"]([^'"]+)['"]/.exec(readFileSync(f, 'utf8'))
      if (m) return m[1]
    }
    return null
  }

  it('logsRuns 标记跟接口代码里实际有没有 startCronRun 一致', () => {
    const bySvc = new Map(parsed.map((p) => [p.service, p]))
    const drift = CRON_REGISTRY
      .filter((e) => (jobNameInCode(bySvc.get(e.service)?.routes ?? []) !== null) !== e.logsRuns)
      .map((e) => `${e.service}: 清单 ${e.logsRuns}`)
    expect(drift).toEqual([])
  })

  it('🔴 jobName 必须等于代码里 startCronRun 的入参 —— 猜错就会把在跑的判成没跑过', () => {
    const bySvc = new Map(parsed.map((p) => [p.service, p]))
    const drift: string[] = []
    for (const e of CRON_REGISTRY) {
      if (!e.logsRuns) continue
      const actual = jobNameInCode(bySvc.get(e.service)?.routes ?? [])
      if (actual && actual !== e.jobName) drift.push(`${e.service}: 清单 ${e.jobName} vs 代码 ${actual}`)
    }
    expect(drift).toEqual([])
  })
})

/**
 * cron 触发的开关，配在哪要跟「谁的进程真读它」对得上。
 *
 * 这两个 cron 的 startCommand 只是一条 curl，打 web 上的 /api/cron/*；开关是在那条
 * 路由里 process.env 读的，也就是 web 进程。按 docs/ENV.md 原来的「Render-cron」
 * 把变量配到 cron service 上，开关不会生效 —— 而且不报错。两个都是「默认关、要显式
 * 打开」的闸，失效方向是「以为开了其实没开」，跟「一切正常」在日志里长得一样。
 *
 * 下面只钉死 (变量, cron 服务) 两个坐标，其余全部从真实来源推：路由路径从 render.yaml
 * 里那条 curl 的 URL 解出来，读取位置从路由源码里查，位置标注从 docs/ENV.md 的表格里
 * 按表头定位「配在哪」那一列取。所以它不是第二份变量清单 —— 没有一项事实是抄来的。
 */
const CRON_TRIGGERED_WEB_FLAGS: { env: string; service: string }[] = [
  { env: 'PROSPECTING_SWEEP_ENABLED', service: 'prospecting-sweep' },
  { env: 'JOB_SIGNAL_INGEST_ENABLED', service: 'job-boards-weekly' },
]

/**
 * startCommand 是不是**只**由 curl 调用组成。
 *
 * 用允许列表，不用「禁止 node/npm/…」那种黑名单 —— 黑名单永远枚举不全：
 * `./scripts/foo.mjs`、`/usr/bin/node foo.js`、`bun foo.ts` 都能绕过去，而只要
 * 其中任何一条在 cron 进程里跑并读了这个开关，本文件的结论（配 Render-web）就错了，
 * 测试却还是绿的。所以这里反过来问：拆开的每一段是不是都是 curl？
 *
 * 光看段首还不够：`curl "$(./scripts/foo.mjs)"` 整段以 curl 开头，但 shell 会先把
 * 里面那个本地命令跑掉。所以嵌套执行语法（命令替换 `$(…)` / 反引号、进程替换
 * `<(…)` `>(…)`）一律判不通过。`$CRON_SECRET`、`${VAR}` 这类纯变量展开不受影响。
 */
function isCurlOnly(startCommand: string): boolean {
  // 只把「反斜杠 + 换行」的行接续接起来。**不能**把所有空白压平 —— 那会把裸换行
  // 也变成空格，于是「第二行另起一条命令」被并进 curl 那一段，整段还是以 curl 开头。
  const joined = startCommand.replace(/\\[ \t]*\n/g, ' ')
  if (/\$\(|`|<\(|>\(/.test(joined)) return false
  const segments = joined
    .split(/&&|\|\||;|\||&|\n/) // 换行和单个 & 都是命令分隔符，跟 && / ; 一样要拆
    .map((s) => s.replace(/[ \t]+/g, ' ').trim())
    .filter((s) => s !== '')
  return segments.length > 0 && segments.every((s) => /^curl(\s|$)/.test(s))
}

/** docs/ENV.md 里某个变量所在行的「配在哪」那一格（列位置按所属表格的表头定，不写死）。 */
function envDocLocation(name: string): string | null {
  const lines = readFileSync(path.join(ROOT, 'docs/ENV.md'), 'utf8').split('\n')
  const cellsOf = (line: string) => line.split('|').slice(1, -1).map((c) => c.trim())
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trimStart().startsWith('|')) continue
    const cells = cellsOf(lines[i])
    if (!new RegExp(`\`${name}\``).test(cells[0] ?? '')) continue
    for (let j = i - 1; j >= 0 && lines[j].trimStart().startsWith('|'); j--) {
      const col = cellsOf(lines[j]).findIndex((c) => c.includes('配在哪'))
      if (col >= 0) return cells[col] ?? null
    }
    return null
  }
  return null
}

describe('cron 触发、web 进程读取的开关：docs/ENV.md 的「配在哪」', () => {
  const parsed = parseRenderYaml()

  it('前提成立：解析器读到了 cron，也读到了 ENV.md 的表（正则写歪不许静默变绿）', () => {
    expect(parsed.length).toBeGreaterThan(30)
    // 这里对 startCommand 只管本文件受检的那两条任务。**不**对全部 cron 设任何约束 ——
    // 无论是「必须 curl」还是「必须写成块格式」，都会让一条正当的新 cron 弄红一个跟它
    // 毫无关系的断言。受检任务自己的「只能 curl」在下面各自验。
    const checked = CRON_TRIGGERED_WEB_FLAGS.map((f) => parsed.find((p) => p.service === f.service))
    expect(checked.filter((p) => (p?.startCommand ?? '').trim() === '')).toEqual([])
    // 块只能取到命令本身：吃到 envVars / - key 就是解析越界了（曾经真的越界过，
    // 只是当时把空白压平，整段还是以 curl 开头，所以一直没露馅）
    expect(checked.some((p) => /envVars:|- key:/.test(p!.startCommand))).toBe(false)
    expect(envDocLocation('CRON_SECRET')).toContain('cron')
    // 🔴 这是「解析器真读到了『配在哪』那一格」的探针，所以**必须**是精确值比对，
    //    不能松成 toContain —— 松了就分不出「读对了整格」和「读到了半格」。
    //    ENV.md 里这一行改了，这里就要跟着改（本次由反向核对补标 worker 而改）。
    expect(envDocLocation('NEXT_PUBLIC_SUPABASE_ANON_KEY')).toBe(
      'Render-web + worker `content-factory-render-worker`',
    )
    expect(envDocLocation('THIS_ENV_DOES_NOT_EXIST')).toBeNull()
  })

  it('前提成立：literal / folded 块的换行语义分得开，folded 只折同级缩进', () => {
    // 同级缩进：YAML 折成空格，仍是一条 curl
    const flat = (ind: string) =>
      `    name: x\n    startCommand: ${ind}\n      curl -fsS\n      https://example.test/api\n    envVars:\n      - key: CRON_SECRET\n`
    expect(isCurlOnly(extractStartCommand(flat('>')))).toBe(true)
    expect(isCurlOnly(extractStartCommand(flat('>-')))).toBe(true)
    // literal 块里同样两行 = 两条命令，第二条不是 curl，判不通过
    expect(isCurlOnly(extractStartCommand(flat('|')))).toBe(false)

    // folded 里更深缩进的行保留换行 —— 无脑全折会把本地命令拼进 curl 那段变成漏报
    const deeper =
      `    name: x\n    startCommand: >\n      curl -fsS https://example.test/api\n        ./scripts/foo.mjs\n    envVars:\n      - key: CRON_SECRET\n`
    expect(extractStartCommand(deeper)).toContain('\n')
    expect(isCurlOnly(extractStartCommand(deeper))).toBe(false)

    // 两种块都不许把 envVars / - key 吃进来
    expect(extractStartCommand(flat('|'))).not.toMatch(/envVars:|- key:/)
    expect(extractStartCommand(flat('>'))).not.toMatch(/envVars:|- key:/)
    // 单行写法原样取出
    expect(extractStartCommand('    startCommand: node scripts/x.mjs\n')).toBe('node scripts/x.mjs')
  })

  it('前提成立：isCurlOnly 是允许列表 —— 黑名单枚举不到的那几种写法必须也判成「不只是 curl」', () => {
    expect(isCurlOnly('curl -fsS https://x/y \\\n  && curl -fsS https://hc-ping.com/z\n')).toBe(true)
    expect(isCurlOnly('curl -fsS https://x/y\n')).toBe(true)
    // 下面这些黑名单版全都漏判成「只是 curl」，允许列表版必须拦住
    expect(isCurlOnly('curl -fsS https://x/y && ./scripts/foo.mjs\n')).toBe(false)
    expect(isCurlOnly('/usr/bin/node foo.js\n')).toBe(false)
    expect(isCurlOnly('bun foo.ts\n')).toBe(false)
    expect(isCurlOnly('curl -fsS https://x/y | sh\n')).toBe(false)
    expect(isCurlOnly('node scripts/x.mjs\n')).toBe(false)
    expect(isCurlOnly('')).toBe(false)
    // 嵌套执行：整段以 curl 开头，但 shell 会先把里面那个本地命令跑掉
    expect(isCurlOnly('curl "$(./scripts/foo.mjs)"\n')).toBe(false)
    expect(isCurlOnly('curl "$(/usr/bin/node foo.js)"\n')).toBe(false)
    expect(isCurlOnly('curl "`./scripts/foo.mjs`"\n')).toBe(false)
    expect(isCurlOnly('curl --data @<(./scripts/foo.mjs) https://x/y\n')).toBe(false)
    // 换行和单个 & 都另起一条命令，不能被并进 curl 那一段
    expect(isCurlOnly('curl -fsS https://x/y\n./scripts/foo.mjs\n')).toBe(false)
    expect(isCurlOnly('curl -fsS https://x/y & ./scripts/foo.mjs\n')).toBe(false)
    // 纯变量展开不是执行，别误杀 —— 真实命令就长这样
    expect(isCurlOnly('curl -H "Authorization: Bearer $CRON_SECRET" https://x/y\n')).toBe(true)
    expect(isCurlOnly('curl -H "Authorization: Bearer ${CRON_SECRET}" https://x/y\n')).toBe(true)
  })

  describe.each(CRON_TRIGGERED_WEB_FLAGS)('$env', ({ env, service }) => {
    const svc = parsed.find((p) => p.service === service)

    it(`${service} 这条 cron 还在，而且只是 curl —— 一旦它改成在自己进程里跑脚本，这个变量要挪回 Render-cron`, () => {
      expect(svc, `render.yaml 里没有名为 ${service} 的 cron 了`).toBeDefined()
      expect(
        isCurlOnly(svc!.startCommand),
        `${service} 的 startCommand 不再是纯 curl（拆开后有非 curl 的段）：${svc!.startCommand.trim()}`,
      ).toBe(true)
    })

    it('确实是在它 curl 打的那条路由里 process.env 读的（路由路径从 render.yaml 推，不写死）', () => {
      const hits = (svc?.routes ?? [])
        .map((r) => path.join(ROOT, 'src/app/api/cron', r, 'route.ts'))
        .filter((f) => existsSync(f))
        .filter((f) => readFileSync(f, 'utf8').includes(`process.env.${env}`))
      expect(
        hits.length,
        `${service} 打的路由里没有一条读 process.env.${env} —— 读取位置变了，配在哪要重新判定`,
      ).toBeGreaterThan(0)
    })

    it('docs/ENV.md 标的是 Render-web', () => {
      const where = envDocLocation(env)
      expect(where, `docs/ENV.md 里找不到 ${env} 这一行`).not.toBeNull()
      expect(where).toContain('Render-web')
      expect(where).not.toContain('Render-cron')
    })
  })
})

/**
 * 标着「要配到 cron service 上」的变量，必须真的在 cron 进程里读得到。
 *
 * 本仓每条 cron 的 startCommand 都只是一条 curl 打 web 上的 /api/cron/*，
 * cron 进程里唯一读得到的就是那条 curl 自己要用的 CRON_SECRET。业务变量标成
 * Render-cron，运维照着配就是配到一个永远读不到的地方 —— 而且不报错。
 *
 * 下面不写死任何变量名单：cron 的资格是从 render.yaml 里**各 cron 的 startCommand 真的
 * 引用了哪些 $VAR** 推出来的 —— 不是「envVars 里声明过」。声明 ≠ 被读：一个遗留或
 * 误加进 envVars、但命令里从来没展开过的变量，进程里根本没有读取方，拿「声明过」当
 * 依据会把这种情况判成绿。
 *
 * 两个方向都要管，缺一个都能 false-green：
 *   正向 —— 文档标着上 cron 的，命令里必须真的引用了它；
 *   反向 —— 命令里真的引用了的（且 ENV.md 里有登记的），文档必须保留 cron 标注。
 * 只有正向的话，以后新加一条 curl 用了 $FOO 而 ENV.md 把 FOO 写成 Render-web，
 * 没有任何断言会红。
 */
/** docs/ENV.md 全表：变量名 → 「配在哪」那一格。 */
function allEnvDocLocations(): Map<string, string> {
  const lines = readFileSync(path.join(ROOT, 'docs/ENV.md'), 'utf8').split('\n')
  const cellsOf = (l: string) => l.split('|').slice(1, -1).map((c) => c.trim())
  const out = new Map<string, string>()
  let col = -1
  for (const line of lines) {
    if (!line.trimStart().startsWith('|')) { col = -1; continue }
    const cells = cellsOf(line)
    const h = cells.findIndex((c) => c.includes('配在哪'))
    if (h >= 0) { col = h; continue }
    if (col < 0 || col >= cells.length) continue
    if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue
    Array.from(cells[0].matchAll(/`([A-Z][A-Z0-9_]*)`/g)).forEach((m) => out.set(m[1], cells[col]))
  }
  return out
}

describe('docs/ENV.md 里带 cron 标注的变量，必须真的配得到 cron 上', () => {
  const parsed = parseRenderYaml()

  /**
   * 一条命令里**真的会被 shell 展开**的变量。
   *
   * 单引号里的 `$VAR` 和转义的 `\$VAR` 都是字面量，不展开 —— 那种写法下 cron 会带着
   * 一串字面量去请求（真发生过就是 401），把它算成「读取方」等于把坏掉的配置判成对的。
   * 所以先把转义和单引号段去掉再匹配。这是够用的近似，不是 shell 解析器。
   */
  /**
   * 把不会展开的位置盖掉，**长度保持不变** —— 这样原文和盖过的版本可以按下标对齐，
   * 于是能逐次出现地判断，而不是按变量名去重。同一条命令里同一个名字既正常展开、
   * 又在单引号里出现一次时，按名字去重会把后者放过去。
   *
   * 必须按引号**状态**逐字符扫，不能拿正则全局配对任意两个 `'`：
   *   - 双引号里的 `'` 是普通字符，`"…'\$X'…"` 里的 $X 照样展开；
   *   - 拿正则配对会把双引号里的撇号跟后面真正的单引号配成一段，两个方向都判错。
   * 这是引号/转义状态机，不是 shell 解析器 —— 不处理 here-doc、$'…' 这类扩展语法。
   */
  function maskNonExpanding(startCommand: string): string {
    const out = startCommand.split('')
    let inSingle = false
    let inDouble = false
    for (let i = 0; i < startCommand.length; i++) {
      const ch = startCommand[i]
      // 单引号里没有转义；其余位置反斜杠吃掉下一个字符（`\$` 就是这样不展开的）
      if (!inSingle && ch === '\\') {
        out[i] = ' '
        if (i + 1 < startCommand.length) out[i + 1] = ' '
        i++
        continue
      }
      // 双引号里的 `'` 是普通字符，不开单引号段；单引号里的 `"` 同理
      if (!inDouble && ch === "'") { inSingle = !inSingle; continue }
      if (!inSingle && ch === '"') { inDouble = !inDouble; continue }
      if (inSingle) out[i] = ' '
    }
    // 🔴 扫完还停在引号里 = 这条命令 bash 根本跑不起来（实测 `bash -n` 返回 2，语法错）。
    //    这时候「哪个 $VAR 会展开」无从谈起：右引号缺失的那段之后，所有 $VAR 都会被
    //    当成「正常展开」——于是字面量、注入、文档三条断言**同时**放行一条压根执行不了的命令。
    //    必须 fail closed：宁可让这条测试炸出来，也不能给一条坏命令发通行证。
    if (inSingle || inDouble) {
      throw new Error(
        `startCommand 有未闭合的${inSingle ? '单' : '双'}引号，bash 会直接语法错，无法判定变量展开：${startCommand}`,
      )
    }
    return out.join('')
  }

  /**
   * 按 shell 的标识符规则整个抓，不是只抓大写前缀。
   * 名字长度不设下限（`$TZ` / `$X` 都合法），也不能在小写处截断 ——
   * `$CRON_SECRETx` 里 shell 读的是 `CRON_SECRETx` 这一整个名字（通常展开成空，
   * 于是鉴权失败）；只捕获前缀 `CRON_SECRET` 会让注入、字面量、文档三项全都误判成通过。
   */
  /**
   * 🔴 **花括号里变量名后面允许跟 shell 操作符，不是只有紧邻的 `}`。**（Issue #948）
   *
   * 原来的写法只认 `${NAME}`。而下面这些都是合法且常见的参数展开：
   *     ${CRON_SECRET:-}          缺了用空默认值
   *     ${CRON_SECRET:?missing}   缺了直接退出
   *     ${CRON_SECRET:+x}         有才用替代值
   *     ${CRON_SECRET#pre}  ${CRON_SECRET%suf}  ${CRON_SECRET/a/b}   截取 / 替换
   * 一条 cron 只要这么写，它引用的变量对整套判据就**完全隐形** —— 该服务把注入删掉也不会红，
   * 而其他任务仍会把同名变量加进全局 `referenced`，连「没人用了」都不会触发。
   * 实际后果是发**空鉴权**或在 curl 前**直接退出**，两种都是静默失败。
   *
   * 捕获组：1 = `${…}` 形式的名字 · 2 = 花括号里名字之后的剩余部分（可能为空）· 3 = `$NAME` 裸形式。
   */
  const VAR_RE = /\$(?:\{([A-Za-z_][A-Za-z0-9_]*)([^}]*)\}|([A-Za-z_][A-Za-z0-9_]*))/g

  /**
   * 这一次引用**自带兜底**吗 —— 决定「该服务没注入它」算不算问题。
   *
   * 自带兜底（缺了也能跑）：`:-` `-` `:=` `=` `:+` `+`
   * 不算兜底（缺了会出事）：`:?` `?`（缺了直接退出）、`#` `%` `/` `^` `,` 等纯字符串操作，
   *                        以及没有任何操作符的裸引用。
   * 认不出的操作符一律按**没兜底**处理（fail closed，宁可多问一句）。
   */
  function referenceHasDefault(suffix: string | undefined): boolean {
    if (!suffix) return false
    return /^:?[-=+]/.test(suffix)
  }

  /**
   * 命令里每一次 `$VAR` 出现：名字 + 下标 + 这一次会不会真的展开 + 自带不自带兜底。
   *
   * `expands` 讲的是**引号**（单引号里、被转义的不展开）；
   * `hasDefault` 讲的是**操作符**（`${X:-d}` 缺了也能跑）。两件事互相独立，别混。
   */
  function varOccurrences(
    startCommand: string,
  ): { name: string; index: number; expands: boolean; hasDefault: boolean }[] {
    const masked = maskNonExpanding(startCommand)
    const expandedAt = new Set(
      Array.from(masked.matchAll(VAR_RE)).map((m) => m.index as number),
    )
    return Array.from(startCommand.matchAll(VAR_RE)).map((m) => ({
      name: m[1] ?? m[3],
      index: m.index as number,
      expands: expandedAt.has(m.index as number),
      hasDefault: referenceHasDefault(m[2]),
    }))
  }

  function expandedVars(startCommand: string): string[] {
    return varOccurrences(startCommand).filter((o) => o.expands).map((o) => o.name)
  }

  type CronEnv = { service: string; startCommand: string; keys: string[]; fromGroup: boolean }

  /** 每条 cron：命令 + 它自己 envVars 注进来的 key（fromGroup 的内容仓库里看不到）。 */
  function cronEnvBlocks(): CronEnv[] {
    const txt = readFileSync(path.join(ROOT, 'render.yaml'), 'utf8')
    return Array.from(
      txt.matchAll(/-\s+type:\s+cron\s*\n\s+name:\s*(\S+)([\s\S]*?)(?=\n\s*-\s+type:|$)/g),
    ).map((m) => ({
      service: m[1],
      startCommand: extractStartCommand(m[2]),
      keys: Array.from(m[2].matchAll(/-\s+key:\s*(\S+)/g)).map((k) => k[1]),
      fromGroup: /fromGroup:/.test(m[2]),
    }))
  }

  /**
   * 「cron 进程真读得到」的证据：**同一条 cron** 既在命令里展开了它，又确实被注进了环境。
   * 只看「哪条命令引用过」不够 —— 引用了但那条服务没注入，跑起来就是空值。
   * 走 fromGroup 的服务无法从仓库判断组里有什么，按「可能注入」放行。
   */
  function cronVarEvidence(): Set<string> {
    const out = new Set<string>()
    for (const c of cronEnvBlocks()) {
      for (const v of expandedVars(c.startCommand)) {
        if (c.fromGroup || c.keys.includes(v)) out.add(v)
      }
    }
    return out
  }

  const referenced = cronVarEvidence()
  const locations = allEnvDocLocations()
  /** 「配在哪」里声称要上 cron 的写法：Render-cron / 全部 cron / + cron。 */
  const claimsCron = (where: string) => /Render-cron|全部 cron|\+\s*cron/.test(where)

  it('前提成立：两个解析器都读到了东西（走空不许静默变绿）', () => {
    expect(parsed.length).toBeGreaterThan(30)
    expect(locations.size).toBeGreaterThan(50)
    expect(referenced.size).toBeGreaterThan(0)
    expect(claimsCron('Render-web + 全部 cron')).toBe(true)
    expect(claimsCron('Render-cron')).toBe(true)
    expect(claimsCron('Render-web')).toBe(false)
    expect(claimsCron('Render-web + worker `content-factory-render-worker`')).toBe(false)
  })

  it('🔴 每条 cron 都只是 curl —— 所以业务变量配到 cron 上读不到（哪天有 cron 自己跑脚本，这条会红，提醒重判）', () => {
    const inProcess = parsed.filter((p) => !isCurlOnly(p.startCommand)).map((p) => p.service)
    expect(
      inProcess,
      `这些 cron 不再是纯 curl，跟它们相关的变量要重新判定配在哪：${inProcess.join(', ')}`,
    ).toEqual([])
  })

  it('前提成立：展开判定认得单引号 / 转义，而且是逐次出现地判，不是按名字去重', () => {
    expect(expandedVars('curl -H "Authorization: Bearer $CRON_SECRET" https://x')).toEqual(['CRON_SECRET'])
    expect(expandedVars('curl -H "Bearer ${CRON_SECRET}" https://x')).toEqual(['CRON_SECRET'])
    // 单引号里不展开，shell 会把字面量发出去（真发生过就是 401）
    expect(expandedVars("curl -H 'Authorization: Bearer $CRON_SECRET' https://x")).toEqual([])
    // 转义同理
    expect(expandedVars('curl -H "Bearer \\$CRON_SECRET" https://x')).toEqual([])
    // 🔴 同一条命令里同一个名字，一次展开一次不展开 —— 按名字去重会把后者放过去
    const mixed = 'curl -H "Bearer $CRON_SECRET" \'$CRON_SECRET\''
    expect(varOccurrences(mixed).map((o) => o.expands)).toEqual([true, false])
    // 掩码必须保长，否则下标对不齐，逐次判定就退化了
    expect(maskNonExpanding(mixed)).toHaveLength(mixed.length)

    // 🔴 不许在小写处截断：shell 读的是 CRON_SECRETx 这一整个名字
    expect(expandedVars('curl -H "Bearer $CRON_SECRETx" https://x')).toEqual(['CRON_SECRETx'])
    expect(expandedVars('curl -H "Bearer ${CRON_SECRET}x" https://x')).toEqual(['CRON_SECRET'])
    // 🔴 短名字也是合法环境变量，不许因为长度被整个忽略
    expect(expandedVars('curl -H "X: $TZ" https://x')).toEqual(['TZ'])
    expect(expandedVars('curl -H "X: ${X}" https://x')).toEqual(['X'])
    // 🔴 双引号里的 `'` 是普通字符，里面的 $VAR 照样展开（正则配对会判成不展开）
    expect(expandedVars('curl "https://x?t=\'$CRON_SECRET\'"')).toEqual(['CRON_SECRET'])
    // 🔴 反过来：双引号里出现一个撇号，不该跟后面真正的单引号段配成一对
    expect(expandedVars('curl -H "\'" \'$CRON_SECRET\'')).toEqual([])

    // 🔴 未闭合的引号必须 fail closed，不许当成正常命令继续判（Codex thread：registry.test.ts L369）
    //    漏一个右双引号，bash 直接语法错（实测 `bash -n` 返回 2）；而扫描器如果不管，
    //    后面那个 $CRON_SECRET 会被判成「会展开」，字面量 / 注入 / 文档三条断言一起放行。
    expect(() => expandedVars('curl -H "Bearer $CRON_SECRET https://x')).toThrow(/未闭合的双引号/)
    expect(() => expandedVars("curl -H 'Bearer $CRON_SECRET https://x")).toThrow(/未闭合的单引号/)
    // 转义掉的引号不算开引号段，不许误报
    expect(expandedVars('curl -H "Bearer $CRON_SECRET\\"" https://x')).toEqual(['CRON_SECRET'])
  })

  /** Issue #948 缺口一：花括号里名字后面带操作符时，原来整个变量都扫不到。 */
  it('🔴 带 shell 操作符的参数展开必须能扫到变量名（原来三种写法全部隐形）', () => {
    // 这几种原实现全部返回 []，于是该服务删掉注入也不会红
    expect(expandedVars('curl -H "Bearer ${CRON_SECRET:-}" https://x')).toEqual(['CRON_SECRET'])
    expect(expandedVars('curl -H "Bearer ${CRON_SECRET:?missing}" https://x')).toEqual(['CRON_SECRET'])
    expect(expandedVars('curl -H "Bearer ${CRON_SECRET:+set}" https://x')).toEqual(['CRON_SECRET'])
    // 字符串截取 / 替换同样是引用
    expect(expandedVars('curl "https://x/${BASE_URL#https://}"')).toEqual(['BASE_URL'])
    expect(expandedVars('curl "https://x/${BASE_URL%/}"')).toEqual(['BASE_URL'])
    expect(expandedVars('curl "https://x/${BASE_URL/a/b}"')).toEqual(['BASE_URL'])

    // 引号规则跟操作符互相独立：单引号里照样不展开
    expect(expandedVars("curl -H 'Bearer ${CRON_SECRET:-}' https://x")).toEqual([])
  })

  it('🔴 「自带兜底」和「缺了会出事」必须分开 —— 否则要么误报要么放行', () => {
    const only = (cmd: string) => varOccurrences(cmd)[0]

    // 自带兜底：缺了也能跑，不该要求该服务注入它
    for (const cmd of [
      'curl "${X:-d}"',
      'curl "${X-d}"',
      'curl "${X:=d}"',
      'curl "${X=d}"',
      'curl "${X:+alt}"',
      'curl "${X+alt}"',
    ]) {
      expect(only(cmd).hasDefault, cmd).toBe(true)
    }

    // 没兜底：缺了发空值或直接退出，必须要求注入
    for (const cmd of [
      'curl "$X"',
      'curl "${X}"',
      'curl "${X:?missing}"', // 缺了 bash 直接退出 —— 这不是兜底，是更早的失败
      'curl "${X?missing}"',
      'curl "${X#pre}"',
      'curl "${X%suf}"',
      'curl "${X/a/b}"',
      'curl "${X^^}"',
    ]) {
      expect(only(cmd).hasDefault, cmd).toBe(false)
    }
  })

  it('🔴 命令里不许出现「写了但不会展开」的 $VAR —— 那会把字面量发出去', () => {
    const literals: string[] = []
    for (const c of cronEnvBlocks()) {
      for (const o of varOccurrences(c.startCommand)) {
        if (!o.expands) {
          literals.push(`${c.service}: 第 ${o.index} 个字符处的 $${o.name} 在单引号或转义里，不会展开`)
        }
      }
    }
    expect(
      literals,
      `这些 cron 会把字面量当值发出去（空 Bearer → 401，日志里跟「没跑」长得一样）：\n${literals.join('\n')}`,
    ).toEqual([])
  })

  it('🔴 每条 cron 命令里展开的变量，那条服务自己必须注入了它（引用 ≠ 拿得到）', () => {
    const broken: string[] = []
    for (const c of cronEnvBlocks()) {
      if (c.fromGroup) continue // 组里有什么，仓库里看不到
      for (const o of varOccurrences(c.startCommand)) {
        // 只看真会展开的那几次；自带兜底的（`${X:-d}`）缺了也能跑，不算漏注入。
        if (!o.expands || o.hasDefault) continue
        if (!c.keys.includes(o.name)) {
          broken.push(`${c.service}: 命令用了 $${o.name}（无兜底），但 envVars 里没有它`)
        }
      }
    }
    expect(
      broken,
      `这些 cron 会带着空值去请求（最典型就是空 Bearer 换来 401，而日志里跟「没跑」长得一样）：\n${broken.join('\n')}`,
    ).toEqual([])
  })

  it('🔴 正向：标着上 cron 的变量，cron 的命令里必须真的展开过它', () => {
    const offenders = Array.from(locations.entries())
      .filter(([, where]) => claimsCron(where))
      .filter(([env]) => !referenced.has(env))
      .map(([env, where]) => `${env} → 「${where}」`)
    expect(
      offenders,
      `没有任何 cron 的命令引用过这些变量，cron 进程里就没有读取方；文档这么写会让人配到不生效的地方：\n${offenders.join('\n')}`,
    ).toEqual([])
  })

  it('🔴 反向：cron 命令里真的用到的变量，文档必须保留 cron 标注', () => {
    const missing = Array.from(referenced)
      .filter((env) => !locations.has(env) || !claimsCron(locations.get(env)!))
      .map((env) =>
        locations.has(env) ? `${env} → 「${locations.get(env)}」` : `${env} → ENV.md 里压根没登记`,
      )
    expect(
      missing,
      `这些变量 cron 的命令里真的要用，但文档没标 cron —— 照文档配会漏掉 cron 那份：\n${missing.join('\n')}`,
    ).toEqual([])
  })

  it('前提成立：反向那条不是空转（确实有变量既被命令引用、又在 ENV.md 里登记）', () => {
    const both = Array.from(referenced).filter((env) => locations.has(env))
    expect(both.length, '一个都没有的话，上面那条反向断言等于没跑').toBeGreaterThan(0)
  })
})
