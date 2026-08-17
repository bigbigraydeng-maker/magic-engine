/**
 * 真实登记册的对账测试（cron registry 范式）：
 * 不测「代码逻辑对不对」,测「登记的话跟仓库现实对不对得上」。
 *
 * 🔴 这里红了的意思是:要么仓库里的东西被改名/删了(去改对应泳道文件
 *    src/lib/product-map/registry/<lane>.ts 里的那条登记),要么有人登了假证据。
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MANUAL_FACTS_SNAPSHOT } from '../external-facts'
import { PRODUCT_MAP_COMPONENTS } from '../registry'
import { ARCHITECTURAL_ROLE } from '../types'
import { validateRegistry } from '../validate'

const REPO_ROOT = join(__dirname, '..', '..', '..', '..')

/** 防空跑:总数 + 每泳道最小数(漏 import 一个泳道文件立刻红,总数断言盖不住这种)。 */
const LANE_MINIMUMS = { shared: 5, geo: 5, seo: 6, social: 2, ads: 2 } as const

describe('登记册规模(防清单被腰斩后静默全绿)', () => {
  it('总数 ≥ 20', () => {
    expect(PRODUCT_MAP_COMPONENTS.length).toBeGreaterThanOrEqual(20)
  })

  for (const [lane, min] of Object.entries(LANE_MINIMUMS)) {
    it(`${lane} 泳道 ≥ ${min} 个组件`, () => {
      const n = PRODUCT_MAP_COMPONENTS.filter((c) => c.businessLane === lane).length
      expect(n).toBeGreaterThanOrEqual(min)
    })
  }
})

describe('登记册通过全部校验', () => {
  const result = validateRegistry(PRODUCT_MAP_COMPONENTS, MANUAL_FACTS_SNAPSHOT)

  it('零 hard error', () => {
    expect(result.errors).toEqual([])
  })

  it('warnings 锁定为确切快照(变了必须有人改这里,不许静默滑入)', () => {
    // 只锁 code 不锁集合的话,夸大声明只会多一条同码 warning、CI 照绿没人看。
    const actual = result.warnings.map((w) => `${w.componentId}:${w.code}`).sort()
    expect(actual).toEqual([
      'adapter.geo-baseline-openai:unverified_critical_evidence',
      'capability.geo-measurement-runtime:unverified_critical_evidence',
      'platform.geo-measurement-store:unverified_critical_evidence',
    ])
  })
})

describe('WP00 七层边界（Build Control Room 2026-08-15 05:43 复审裁决）', () => {
  it('每个 me2_native 顶层组件都落在冻结七层之一（supporting artifact 除外）', () => {
    const offenders = PRODUCT_MAP_COMPONENTS.filter(
      // B2：supporting artifact（adapterOf 已设）不占角色，architecturalRole 结构上为空,
      // 不算违规 —— 只有 me2_native 的顶层组件必须落在七层。
      (c) => c.origin === 'me2_native' && c.adapterOf === undefined &&
        !(ARCHITECTURAL_ROLE as readonly string[]).includes(c.architecturalRole ?? ''),
    ).map((c) => c.id)
    expect(offenders).toEqual([])
  })

  it('B2：supporting artifact 不占顶层七角色（有 adapterOf 的一律无 architecturalRole）', () => {
    const offenders = PRODUCT_MAP_COMPONENTS.filter(
      (c) => c.origin === 'me2_native' && c.adapterOf !== undefined && c.architecturalRole !== undefined,
    ).map((c) => c.id)
    expect(offenders).toEqual([])
  })

  it('没有任何 legacy 组件伪装成已纳入 ME2 治理', () => {
    const offenders = PRODUCT_MAP_COMPONENTS.filter((c) => c.origin === 'legacy' && c.architecturalRole !== undefined).map(
      (c) => c.id,
    )
    expect(offenders).toEqual([])
  })

  it('adapterOf 全部指回登记册里真实存在的父组件', () => {
    const ids = new Set(PRODUCT_MAP_COMPONENTS.map((c) => c.id))
    const dangling = PRODUCT_MAP_COMPONENTS.filter((c) => c.adapterOf !== undefined && !ids.has(c.adapterOf)).map(
      (c) => c.id,
    )
    expect(dangling).toEqual([])
  })
})

describe('ownedPaths 对着磁盘核验', () => {
  for (const c of PRODUCT_MAP_COMPONENTS) {
    for (const p of c.ownedPaths) {
      it(`${c.id} → ${p}`, () => {
        const abs = join(REPO_ROOT, p)
        expect(existsSync(abs), `路径不存在:${p}(改 registry/${c.businessLane}.ts 里 ${c.id} 的登记)`).toBe(true)
        if (p.endsWith('/')) {
          expect(statSync(abs).isDirectory(), `${p} 登成目录但不是目录`).toBe(true)
          expect(readdirSync(abs).length, `${p} 是空目录 —— 认领了空气`).toBeGreaterThan(0)
        } else {
          expect(statSync(abs).isFile(), `${p} 登成文件但不是文件`).toBe(true)
        }
      })
    }
  }
})

describe('integration 证据对着源码核验(声明了≠接上了)', () => {
  // 🔴 四种 kind 一视同仁:ref 文件必须存在,且内容必须真的引用到组件认领的
  //    路径之一。「这个 cron 隔两层间接用到它」不算证据 —— 那种关系登 importer
  //    到直接调用方文件上。只核验 existsSync 曾经漏进过一条假 caller_cron。
  for (const c of PRODUCT_MAP_COMPONENTS) {
    for (const ev of c.integrationEvidence) {
      it(`${c.id} → ${ev.kind}:${ev.ref}`, () => {
        const abs = join(REPO_ROOT, ev.ref)
        expect(existsSync(abs), `证据文件不存在:${ev.ref}`).toBe(true)
        if (c.ownedPaths.length === 0) return
        // 认 '@/lib/...' 别名,也认相对 import(如同目录的 './brand-standardiser')。
        // 🔴 必须带终结符(后随 ' 或 /)再算命中 —— 裸 includes 会让
        //    '@/lib/geo-measurement' 被兄弟模块 '@/lib/geo-measurement-runtime'
        //    的 import 误命中,同前缀兄弟正是假证据最容易长的形状。
        const content = readFileSync(abs, 'utf8')
        const stems = c.ownedPaths.flatMap((p) => {
          const noSlash = p.replace(/\/$/, '').replace(/\.ts$/, '')
          const base = noSlash.split('/').pop() as string
          return [noSlash.replace(/^src\//, '@/'), `./${base}`]
        })
        const hit = stems.some((s) => content.includes(`${s}'`) || content.includes(`${s}/`))
        expect(hit, `${ev.ref} 没有引用 ${stems.join(' / ')} —— ${ev.kind} 证据是假的`).toBe(true)
      })
    }
  }
})

describe('contract 证据的路径型 ref 对着磁盘核验', () => {
  for (const c of PRODUCT_MAP_COMPONENTS) {
    for (const ev of c.contractEvidence) {
      if (!ev.ref.startsWith('docs/') && !ev.ref.startsWith('src/')) continue
      it(`${c.id} → ${ev.ref}`, () => {
        expect(existsSync(join(REPO_ROOT, ev.ref)), `契约文档不存在:${ev.ref}`).toBe(true)
      })
    }
  }
})

describe('PR 事实快照覆盖登记册引用的每个 PR', () => {
  it('登记的 PR 号都有事实(否则 M2 判定在拿「查无此事」当数据)', () => {
    const missing: number[] = []
    for (const c of PRODUCT_MAP_COMPONENTS) {
      for (const pr of c.linkedPullRequests) {
        if (!MANUAL_FACTS_SNAPSHOT.pullRequests[pr.number]) missing.push(pr.number)
      }
    }
    expect(missing, `这些 PR 在 MANUAL_FACTS_SNAPSHOT 里没登事实:${missing.join(', ')}`).toEqual([])
  })
})

describe('登记册不可变', () => {
  it('顶层与深层都被冻结', () => {
    expect(Object.isFrozen(PRODUCT_MAP_COMPONENTS)).toBe(true)
    const first = PRODUCT_MAP_COMPONENTS[0]
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first.contractEvidence)).toBe(true)
    expect(Object.isFrozen(first.currentBlockers)).toBe(true)
    if (first.currentBlockers.length > 0) {
      expect(Object.isFrozen(first.currentBlockers[0])).toBe(true)
    }
  })
})
