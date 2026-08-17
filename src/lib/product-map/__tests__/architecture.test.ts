/**
 * product-map 的架构守卫:
 * - 这是纯登记/推导层:不许碰 supabase、网络、SDK、环境变量;
 * - 对 kernel 的依赖只许 boundaries.ts 一个文件(唯一真值源),不许摸内核运行时;
 * - 防空跑:断言真的扫到了源文件。
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const LIB_DIR = join(__dirname, '..')

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue
      out.push(...sourceFiles(full))
    } else if (entry.name.endsWith('.ts')) {
      out.push(full)
    }
  }
  return out
}

const files = sourceFiles(LIB_DIR)

describe('防空跑', () => {
  it('扫到的源文件数量符合预期(目录被挪走时这里先红)', () => {
    expect(files.length).toBeGreaterThanOrEqual(10)
  })
})

describe('纯层边界', () => {
  const forbidden: readonly { pattern: RegExp; why: string }[] = [
    { pattern: /@supabase\/|@\/lib\/supabase/, why: '登记/推导层不碰数据库' },
    { pattern: /\bfetch\s*\(/, why: '不做网络调用(GitHub 事实由 PR2 同步器注入)' },
    { pattern: /process\.env/, why: '无环境依赖 —— 纯函数层' },
    { pattern: /from 'openai'|from '@anthropic/, why: '无 SDK' },
    // 只匹配真实 import 语句 —— 注释里解释「为什么不依赖」不算违规
    { pattern: /from '@\/lib\/product-map-sync/, why: '纯层不许反向依赖同步层(目录成环)' },
  ]

  for (const file of files) {
    const rel = file.slice(LIB_DIR.length + 1)
    it(rel, () => {
      const content = readFileSync(file, 'utf8')
      for (const { pattern, why } of forbidden) {
        expect(pattern.test(content), `${rel} 违反:${why}`).toBe(false)
      }
      // kernel 只许 import boundaries(单向只读依赖唯一真值源)
      const kernelImports = content.match(/@\/lib\/kernel[^'"]*/g) ?? []
      for (const imp of kernelImports) {
        expect(imp, `${rel} 只许 import '@/lib/kernel/boundaries',不许摸内核运行时`).toBe('@/lib/kernel/boundaries')
      }
    })
  }
})
