import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 平台化红线 2 的机器守卫：共享代码里不许出现任何客户的名字 / 编号 / 域名。
 * 客户差异只许住在 client-config.ts（以及专门测它的 client-config.test.ts）。
 * 这份测试自己不写字面量：禁用清单是拼出来的，免得守卫把自己扫红。
 */

const ROOT = path.resolve(__dirname, '../../../..')

const j = (...parts: string[]) => parts.join('')
const FORBIDDEN = [
  j('c0000000-0000-0000-0000', '-000000000000'),
  j('ctst', 'ours'),
  j('2202', '695063810470'),
  j('1441880', '990459874'),
  j('1824094', '338280968'),
  j('1272906', '127877005'),
  j('AW-', '17984232872'),
  j('G-SB9', 'EYP2X1L'),
  j('532503', '727'),
  j('5255813', '1445673'),
  j('5255835', '9035473'),
  j('5255836', '7358873'),
  j('12025045', '9565520307'),
  j('27757666', '42787274'),
]

/** 共享文件：整个模块目录（除了配置本身和专测配置的那份测试）+ 接线到别处的共享文件。 */
function sharedFiles(): string[] {
  const dir = path.join(ROOT, 'src/lib/ads-tracking-preflight')
  const out: string[] = []
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const full = path.join(d, name)
      if (statSync(full).isDirectory()) { walk(full); continue }
      if (!/\.(ts|tsx|json)$/.test(name)) continue
      if (name === 'client-config.ts' || name === 'client-config.test.ts' || name === 'client-config-guard.test.ts') continue
      out.push(full)
    }
  }
  walk(dir)
  for (const rel of [
    'src/lib/inngest/functions/ads-tracking-preflight.ts',
    'src/lib/inngest/functions/ads-tracking-launch-watch.ts',
    'src/lib/pm-todo/ads-tracking-preflight-items.ts',
  ]) {
    try {
      statSync(path.join(ROOT, rel))
      out.push(path.join(ROOT, rel))
    } catch {
      // 文件还没建就先不查
    }
  }
  return out
}

describe('共享代码不点名任何客户（客户差异只进 client-config.ts）', () => {
  const files = sharedFiles()

  it('确实扫到了东西（别因为路径写错而空转）', () => {
    expect(files.length).toBeGreaterThan(10)
  })

  // 客户简称是短词，直接做子串匹配会误伤 Facts / effects 这类词：按「整词、区分大小写」查
  const SHORT_NAMES = [j('C', 'TS')]
  for (const name of SHORT_NAMES) {
    it(`没有任何共享文件把客户简称「${name.slice(0, 1)}…」当成独立的词写出来`, () => {
      const word = new RegExp(`\\b${name}\\b`)
      const hits = files.filter(f => word.test(readFileSync(f, 'utf8')))
      expect(hits.map(f => path.relative(ROOT, f))).toEqual([])
    })
  }

  for (const needle of FORBIDDEN) {
    it(`没有任何共享文件含有「${needle.slice(0, 4)}…」`, () => {
      const hits = files.filter(f => readFileSync(f, 'utf8').toLowerCase().includes(needle.toLowerCase()))
      expect(hits.map(f => path.relative(ROOT, f))).toEqual([])
    })
  }
})
