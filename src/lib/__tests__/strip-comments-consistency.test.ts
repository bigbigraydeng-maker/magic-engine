/**
 * 七套架构守卫的 `stripComments()` 必须保持一份口径（Issue #929）。
 *
 * 🔴 **为什么需要机器盯着：这个函数已经被「修一处、漏别处」咬过两次。**
 *    - PR #898 把 kernel / action-bridge 从正则版换成解析器版，另外五套没跟上；
 *    - Issue #923 修 JsxText 时要同时动两处，差一点就只改一边。
 *    七个文件是**有意各自独立**的（删掉任何一个，其余六个仍拦得住自己那半边），
 *    所以这里不抽共享 helper —— 抽了就等于给七道闸装同一个总开关。
 *    代价是七份副本会漂，那就用这条测试把「漂了」变成一次红。
 *
 * 判据刻意写成**扫描式**而不是写死七个路径：以后新加一套架构守卫，
 * 只要它自带 `stripComments()`，这条就自动把它一起管上，不需要有人记得来登记。
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, relative } from 'path'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')

/** 本文件自己只是在讲这个函数，不定义它 —— 扫描时要排除掉，否则会把说明文字当实现。 */
const SELF = 'src/lib/__tests__/strip-comments-consistency.test.ts'

/**
 * 🔴 **这条测试自己的扫描面也得盖住构建会编译的每一种后缀。**（Issue #938）
 *
 * 本文件的作用是「谁定义了 `stripComments()`，就把它一起管上」。
 * 原来这里只收 `.ts` / `.tsx` —— 以后有人把某套架构守卫写成 `.mts` / `.cjs`
 * （仓库 tsconfig 是 `allowJs: true`，这是合法的），**这条盯梢就看不见它**，
 * 而症状是「一切正常」：盯梢绿着，被漏掉的那份副本随便漂。
 *
 * 与七套架构守卫用同一份 8 种后缀清单（依据见
 * `src/lib/kernel/__tests__/architecture.test.ts` 里 `SOURCE_EXTENSIONS` 的注释）。
 */
const SOURCE_EXTENSIONS = ['.tsx', '.jsx', '.mts', '.cts', '.mjs', '.cjs', '.ts', '.js'] as const

const isScannedSource = (p: string): boolean => SOURCE_EXTENSIONS.some((ext) => p.endsWith(ext))

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '.next') continue
      walk(full, out)
    } else if (isScannedSource(entry)) {
      out.push(full)
    }
  }
  return out
}

const DECL = 'function stripComments('

/** 抠出函数正文：从声明行到第一条顶格 `}`（这七份都写在文件顶层，不带缩进）。 */
function extractStripComments(source: string): string | null {
  const start = source.indexOf(DECL)
  if (start === -1) return null
  const end = source.indexOf('\n}\n', start)
  if (end === -1) return null
  return source.slice(start, end + 3)
}

interface Impl {
  file: string
  body: string
}

const IMPLEMENTATIONS: Impl[] = walk(SRC)
  .map((f) => relative(ROOT, f).split('\\').join('/'))
  .filter((f) => f !== SELF)
  .map((file) => ({ file, body: extractStripComments(readFileSync(join(ROOT, file), 'utf8')) }))
  .filter((x): x is Impl => x.body !== null)

describe('stripComments() 七处一份口径（Issue #929）', () => {
  it('🔴 扫描确实找到了实现（防止判据因为抠取写错而空跑）', () => {
    // 空跑的判据是绿的，而绿的判据看起来跟「没问题」一模一样 —— 这条专门防它。
    expect(
      IMPLEMENTATIONS.length,
      '一个都没扫到 = 抠取逻辑坏了，不是「大家都合规」。',
    ).toBeGreaterThanOrEqual(7)
  })

  it('🔴 所有实现逐字一致（谁再改这个函数，必须七处一起改）', () => {
    const groups = new Map<string, string[]>()
    for (const { file, body } of IMPLEMENTATIONS) {
      const same = groups.get(body) ?? []
      same.push(file)
      groups.set(body, same)
    }
    const variants = Array.from(groups.values()).map((files) => files.sort().join('\n    '))
    expect(
      variants.length,
      '出现了不止一种写法 —— 说明有人只改了一部分。各组分别是：\n  ' + variants.join('\n  --- vs ---\n  '),
    ).toBe(1)
  })

  it('🔴 没有人退回正则版（正则分不清注释与字面量，会放行真实违规）', () => {
    const regexVersion = IMPLEMENTATIONS.filter(
      ({ body }) => body.includes('.replace(/\\/\\*[\\s\\S]*?\\*\\//g') || !body.includes('ts.getLeadingCommentRanges'),
    ).map(({ file }) => file)
    expect(
      regexVersion,
      'Issue #929：注释范围必须来自解析器。正则版会把 `const START = \'/*\'` … `const END = \'*/\'`\n' +
        '之间的真实源码整段删掉，夹在中间的违规随之蒸发。\n' +
        regexVersion.join('\n'),
    ).toEqual([])
  })

  it('🔴 Issue #923 的 JsxText 保护还在（JSX 文本不是注释）', () => {
    const missing = IMPLEMENTATIONS.filter(({ body }) => !body.includes('startsInsideJsxText')).map(
      ({ file }) => file,
    )
    expect(
      missing,
      'Issue #923：JSX 文本里形似注释的内容是要渲染出去的字面文本；\n' +
        '未闭合的 `/*` 会一路吃到 EOF，把该文件后续全部源码挖空。\n' +
        missing.join('\n'),
    ).toEqual([])
  })
})

/**
 * 🔴 **这条盯梢自己的扫描面也要有测试盯着。**（Issue #938）
 *
 * 上面四条全都建立在「walker 真的把每一份 `stripComments()` 都找出来了」之上。
 * 扫描面缩小时它们不会红 —— 找不到的那份副本直接从判据里消失，**盯梢照样全绿**。
 * 这正是 #938 的形状，所以这里对 walker 的行为直接下断言。
 */
describe('这条盯梢自己的扫描面（Issue #938）', () => {
  it('🔴 8 种后缀全部算源码；非源码后缀一律不算', () => {
    for (const ext of SOURCE_EXTENSIONS) {
      expect(isScannedSource(`anything${ext}`), ext).toBe(true)
    }
    for (const other of ['.json', '.md', '.css', '.sql', '.snap', '.py']) {
      expect(isScannedSource(`anything${other}`), other).toBe(false)
    }
  })

  it('🔴 walker 与后缀清单同源（真磁盘 fixture）', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'strip-comments-scan-surface-'))
    try {
      const expected: string[] = []
      for (const ext of SOURCE_EXTENSIONS) {
        const name = `f${ext.replace('.', '_')}${ext}`
        writeFileSync(join(tmp, name), 'export const x = 1\n')
        expected.push(name)
      }
      writeFileSync(join(tmp, 'notes.md'), 'not source')
      const collected = walk(tmp).map((f) => f.split(/[\\/]/).pop() as string)
      expect(collected.sort()).toEqual(expected.sort())
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
})
