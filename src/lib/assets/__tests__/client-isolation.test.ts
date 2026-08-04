import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import path from 'path'

/**
 * 客户素材隔离的机械守卫（2026-08-03）。
 *
 * PM 2026-08-02 原话：「不可以，如果是客户自己的实拍素材，坚决不可以共用」。
 *
 * 隔离**不能靠查询纪律**。上一版设计打算用「唯一查询帮手」强制，被审出行不通：
 * `supabaseAdmin` 全仓可导入、无 eslint 限制、脚本与 Studio 完全绕过。
 * 而实际扫描证实了这个担心 —— 当时有两处按 id 直取素材、不带 client_id
 * （storyboard 的 generate-video 与 send-to-kanban），一个上游 bug 就能变成
 * 跨客户素材外流。
 *
 * 所以改成这条测试：全仓扫 `client_assets` 的每一次读取，逼它带客户条件。
 * 写漏了当场红，不用指望谁记得。
 */

const SRC = path.resolve(__dirname, '../../..')

/** 读取后多少行内必须出现客户条件 —— 链式调用通常紧挨着，给足余量。 */
const LOOKAHEAD_LINES = 12

/**
 * 允许不带 client_id 的地方，每条都要写清为什么。
 * 加白名单前先想清楚：真的不能带，还是只是懒得带？
 */
const ALLOWLIST: { file: string; why: string }[] = [
  {
    file: 'app/api/cron/vision-analyzer/route.ts',
    why: '全局后台工人：跨所有客户捞待分析的图，再按 id 写回自己刚读的那一行。不是跨客户读取。',
  },
]

function walk(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') continue
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

interface Violation {
  file: string
  line: number
  snippet: string
}

/** 扫到的调用点总数 —— 用来证明扫描器真的在工作，不是空转成绿。 */
let scannedCallSites = 0

function findViolations(): Violation[] {
  const violations: Violation[] = []
  scannedCallSites = 0

  for (const file of walk(SRC)) {
    const rel = path.relative(SRC, file).replace(/\\/g, '/')
    if (ALLOWLIST.some(a => rel === a.file)) continue

    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, i) => {
      if (!line.includes("from('client_assets')")) return
      scannedCallSites++

      const window = lines.slice(i, i + LOOKAHEAD_LINES).join('\n')
      // insert 的 client_id 写在负载对象里，不是链式条件 —— 两种写法都认。
      const guarded =
        window.includes("eq('client_id'") ||
        /client_id\s*:/.test(window)

      if (!guarded) {
        violations.push({ file: rel, line: i + 1, snippet: line.trim() })
      }
    })
  }

  return violations
}

describe('客户素材隔离 —— 机械守卫', () => {
  it('每一处读写 client_assets 都带客户条件', () => {
    const violations = findViolations()
    const readable = violations
      .map(v => `  ${v.file}:${v.line}  ${v.snippet}`)
      .join('\n')

    expect(
      violations,
      violations.length === 0
        ? ''
        : `以下位置读写 client_assets 没有带 client_id 条件，客户实拍可能跨客户外流：\n${readable}\n` +
            `修法：链式加 .eq('client_id', clientId)；确实不能带的，写进本测试的 ALLOWLIST 并说明理由。`,
    ).toEqual([])
  })

  it('扫描器真的扫到了调用点 —— 防止路径写错导致空转成绿', () => {
    findViolations()
    // 2026-08-03 实测 11 处（不含 vision-analyzer 白名单）。只卡下限，
    // 新增调用点不该让这条测试红。
    expect(scannedCallSites).toBeGreaterThanOrEqual(8)
  })

  it('守卫本身有效 —— 认得出缺客户条件的写法', () => {
    // 防止正则写歪导致这条测试永远通过（一个永远绿的守卫比没有守卫更糟）
    const bad = ["supabaseAdmin.from('client_assets')", ".select('storage_url')", ".eq('id', assetId)"].join('\n')
    expect(bad.includes("eq('client_id'") || /client_id\s*:/.test(bad)).toBe(false)

    const good = [...bad.split('\n'), ".eq('client_id', clientId)"].join('\n')
    expect(good.includes("eq('client_id'")).toBe(true)
  })

  it('白名单每条都写了理由', () => {
    for (const entry of ALLOWLIST) {
      expect(entry.why.length, `${entry.file} 缺理由`).toBeGreaterThan(20)
    }
  })
})
