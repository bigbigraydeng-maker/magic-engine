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
function parseRenderYaml(): { service: string; schedule: string; routes: string[] }[] {
  const txt = readFileSync(path.join(ROOT, 'render.yaml'), 'utf8')
  const out: { service: string; schedule: string; routes: string[] }[] = []
  const re = /-\s+type:\s+cron\s*\n\s+name:\s*(\S+)([\s\S]*?)(?=\n\s*-\s+type:|$)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(txt)) !== null) {
    const schedule = /schedule:\s*"([^"]+)"/.exec(m[2])?.[1] ?? ''
    const routes = Array.from(m[2].matchAll(/\/api\/cron\/([a-z0-9-]+)/g)).map((x) => x[1])
    out.push({ service: m[1], schedule, routes })
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
