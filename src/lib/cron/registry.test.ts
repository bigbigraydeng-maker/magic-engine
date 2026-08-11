import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
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
    expect(envDocLocation('NEXT_PUBLIC_SUPABASE_ANON_KEY')).toBe('Render-web')
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
