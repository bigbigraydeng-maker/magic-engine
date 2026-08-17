/** 依赖图工具测试:悬空 / 环 / 邻接 / blocker 传播。 */

import { describe, expect, it } from 'vitest'
import {
  findDanglingDependencies,
  findOrderingCycles,
  layerByDepth,
  neighboursOf,
  propagateBlocked,
} from '../graph'
import { makeComponent } from './_fixtures'

describe('layerByDepth', () => {
  it('无依赖的组件 depth 为 0', () => {
    const a = makeComponent({ id: 'platform.a' })
    expect(layerByDepth([a]).get('platform.a')).toBe(0)
  })

  it('被依赖者更浅:A requires B → B=0, A=1(最长路径)', () => {
    const a = makeComponent({ id: 'platform.a', dependencies: [{ type: 'requires', target: 'platform.b' }] })
    const b = makeComponent({ id: 'platform.b', dependencies: [{ type: 'requires', target: 'platform.c' }] })
    const c = makeComponent({ id: 'platform.c' })
    const d = layerByDepth([a, b, c])
    expect(d.get('platform.c')).toBe(0)
    expect(d.get('platform.b')).toBe(1)
    expect(d.get('platform.a')).toBe(2)
  })

  it('consumes / implements / adapts 都计入分层', () => {
    const a = makeComponent({ id: 'capability.a', componentType: 'capability', dependencies: [{ type: 'consumes', target: 'adapter.b' }] })
    const b = makeComponent({ id: 'adapter.b', dependencies: [{ type: 'implements', target: 'platform.c' }] })
    const c = makeComponent({ id: 'platform.c' })
    const d = layerByDepth([a, b, c])
    expect(d.get('platform.c')).toBe(0)
    expect(d.get('adapter.b')).toBe(1)
    expect(d.get('capability.a')).toBe(2)
  })

  it('blocks 边**不**计入分层(它是「卡住」不是数据流先后)', () => {
    const a = makeComponent({ id: 'platform.a', dependencies: [{ type: 'blocks', target: 'platform.b' }] })
    const b = makeComponent({ id: 'platform.b' })
    const d = layerByDepth([a, b])
    expect(d.get('platform.a')).toBe(0)
    expect(d.get('platform.b')).toBe(0)
  })

  it('consumes 环不爆栈(findOrderingCycles 不查、registry 不拦),depth 仍收敛', () => {
    const a = makeComponent({ id: 'capability.a', componentType: 'capability', dependencies: [{ type: 'consumes', target: 'capability.b' }] })
    const b = makeComponent({ id: 'capability.b', componentType: 'capability', dependencies: [{ type: 'consumes', target: 'capability.a' }] })
    const d = layerByDepth([a, b])
    expect(d.get('capability.a')).toBeTypeOf('number')
    expect(d.get('capability.b')).toBeTypeOf('number')
  })
})

describe('findDanglingDependencies', () => {
  it('指向存在组件的边不报', () => {
    const a = makeComponent({ id: 'platform.a', dependencies: [{ type: 'requires', target: 'platform.b' }] })
    const b = makeComponent({ id: 'platform.b' })
    expect(findDanglingDependencies([a, b])).toHaveLength(0)
  })

  it('悬空边报出组件与目标', () => {
    const a = makeComponent({ id: 'platform.a', dependencies: [{ type: 'consumes', target: 'capability.ghost' }] })
    const dangling = findDanglingDependencies([a])
    expect(dangling).toHaveLength(1)
    expect(dangling[0].componentId).toBe('platform.a')
    expect(dangling[0].dependency.target).toBe('capability.ghost')
  })
})

describe('findOrderingCycles', () => {
  it('无环图返回空', () => {
    const a = makeComponent({ id: 'platform.a', dependencies: [{ type: 'requires', target: 'platform.b' }] })
    const b = makeComponent({ id: 'platform.b' })
    expect(findOrderingCycles([a, b])).toHaveLength(0)
  })

  it('requires 互指成环', () => {
    const a = makeComponent({ id: 'platform.a', dependencies: [{ type: 'requires', target: 'platform.b' }] })
    const b = makeComponent({ id: 'platform.b', dependencies: [{ type: 'requires', target: 'platform.a' }] })
    expect(findOrderingCycles([a, b]).length).toBeGreaterThan(0)
  })

  it('requires + blocks 混合也能成环:A requires B 且 B blocks A 之外的顺序死结', () => {
    // A requires B(B 先于 A);A blocks B(A 先于 B)→ 死结
    const a = makeComponent({
      id: 'platform.a',
      dependencies: [
        { type: 'requires', target: 'platform.b' },
        { type: 'blocks', target: 'platform.b' },
      ],
    })
    const b = makeComponent({ id: 'platform.b' })
    expect(findOrderingCycles([a, b]).length).toBeGreaterThan(0)
  })

  it('consumes 边不参与环判定(不是顺序边)', () => {
    const a = makeComponent({ id: 'capability.a', componentType: 'capability', dependencies: [{ type: 'consumes', target: 'capability.b' }] })
    const b = makeComponent({ id: 'capability.b', componentType: 'capability', dependencies: [{ type: 'consumes', target: 'capability.a' }] })
    expect(findOrderingCycles([a, b])).toHaveLength(0)
  })
})

describe('neighboursOf', () => {
  it('上游 = 我声明的依赖;下游 = 声明依赖我的', () => {
    const a = makeComponent({ id: 'platform.a', dependencies: [{ type: 'requires', target: 'platform.b' }] })
    const b = makeComponent({ id: 'platform.b' })
    const nb = neighboursOf('platform.b', [a, b])
    expect(nb.upstream).toHaveLength(0)
    expect(nb.downstream).toEqual([{ id: 'platform.a', type: 'requires' }])
    const na = neighboursOf('platform.a', [a, b])
    expect(na.upstream).toEqual([{ id: 'platform.b', type: 'requires' }])
  })

  it('blocks 边方向单独反转:A blocks B → B 在 A 的下游、A 在 B 的上游(与环检测口径一致)', () => {
    const a = makeComponent({ id: 'platform.a', dependencies: [{ type: 'blocks', target: 'platform.b' }] })
    const b = makeComponent({ id: 'platform.b' })
    const na = neighboursOf('platform.a', [a, b])
    expect(na.downstream).toEqual([{ id: 'platform.b', type: 'blocks' }])
    expect(na.upstream).toHaveLength(0)
    const nb = neighboursOf('platform.b', [a, b])
    expect(nb.upstream).toEqual([{ id: 'platform.a', type: 'blocks' }])
    expect(nb.downstream).toHaveLength(0)
  })
})

describe('propagateBlocked', () => {
  it('上游有 blocker,下游沿 requires 边被传导卡住(含隔一层)', () => {
    const a = makeComponent({
      id: 'platform.a',
      currentBlockers: [{ id: 'x', kind: 'provisioning', summary: 'x' }],
    })
    const b = makeComponent({ id: 'platform.b', dependencies: [{ type: 'requires', target: 'platform.a' }] })
    const c = makeComponent({ id: 'platform.c', dependencies: [{ type: 'requires', target: 'platform.b' }] })
    const blocked = propagateBlocked([a, b, c])
    expect(blocked.get('platform.b')).toEqual(['platform.a'])
    expect(blocked.get('platform.c')).toEqual(['platform.a'])
    expect(blocked.has('platform.a')).toBe(false)
  })

  it('consumes 边不传导 blocker', () => {
    const a = makeComponent({
      id: 'capability.a',
      componentType: 'capability',
      currentBlockers: [{ id: 'x', kind: 'code', summary: 'x' }],
    })
    const b = makeComponent({ id: 'capability.b', componentType: 'capability', dependencies: [{ type: 'consumes', target: 'capability.a' }] })
    expect(propagateBlocked([a, b]).has('capability.b')).toBe(false)
  })

  it('requires 环不死循环', () => {
    const a = makeComponent({
      id: 'platform.a',
      dependencies: [{ type: 'requires', target: 'platform.b' }],
      currentBlockers: [{ id: 'x', kind: 'code', summary: 'x' }],
    })
    const b = makeComponent({ id: 'platform.b', dependencies: [{ type: 'requires', target: 'platform.a' }] })
    expect(propagateBlocked([a, b]).get('platform.b')).toEqual(['platform.a'])
  })
})
