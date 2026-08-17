/**
 * 依赖图工具：悬空检测、requires/blocks 环检测、上下游查询。
 *
 * v1 刻意只有邻接表 + DFS —— 依赖列表比「大蜘蛛网」可读（WP 明文），
 * 不引图形库、不做布局。
 */

import type { ComponentDependency, ProductMapComponent } from './types'

/** 会形成「必须先于」关系、因此不允许成环的边类型。 */
const ORDERING_EDGE_TYPES: ReadonlySet<ComponentDependency['type']> = new Set<
  ComponentDependency['type']
>(['requires', 'blocks'])

/**
 * 数据流「先后」边：`A requires/consumes/implements/adapts B` → B 排在 A 之前（更浅）。
 *
 * 🔴 这跟 ORDERING_EDGE_TYPES **不是**一回事，两者故意各自具名：
 * - ORDERING_EDGE_TYPES = {requires, blocks}，管的是「必须先于」的**环检测**；
 * - DEPTH_EDGE_TYPES = {requires, consumes, implements, adapts}，管的是分层**先后**，
 *   **故意排除 blocks**（blocks 是「卡住」语义，不是数据流先后）。
 * 别把 blocks 加进来，否则横轴先后就和环检测口径打架。
 */
export const DEPTH_EDGE_TYPES: ReadonlySet<ComponentDependency['type']> = new Set<
  ComponentDependency['type']
>(['requires', 'consumes', 'implements', 'adapts'])

/**
 * 分层深度：被依赖者深度更小（排在左边 / 先做）。返回 id → depth。
 *
 * 深度 = 沿 DEPTH_EDGE_TYPES 的最长路径。**自带 onStack 环守卫**：
 * consumes 环 findOrderingCycles 不查、registry 校验器也不拦，最长路径撞上环会爆栈；
 * 守卫在回边处就地断为 0，保证有环也收敛（登记册当前无环，此为防御）。
 */
export function layerByDepth(components: readonly ProductMapComponent[]): Map<string, number> {
  const byId = new Map(components.map((c) => [c.id, c]))
  const depth = new Map<string, number>()
  const onStack = new Set<string>()

  function visit(id: string): number {
    const cached = depth.get(id)
    if (cached !== undefined) return cached
    if (onStack.has(id)) return 0 // 环：回边就地断，不再加深
    const c = byId.get(id)
    if (!c) return 0
    onStack.add(id)
    let d = 0
    for (const dep of c.dependencies) {
      if (!DEPTH_EDGE_TYPES.has(dep.type) || !byId.has(dep.target)) continue
      d = Math.max(d, visit(dep.target) + 1)
    }
    onStack.delete(id)
    depth.set(id, d)
    return d
  }

  for (const c of components) visit(c.id)
  return depth
}

export interface DanglingDependency {
  readonly componentId: string
  readonly dependency: ComponentDependency
}

export function findDanglingDependencies(
  components: readonly ProductMapComponent[],
): DanglingDependency[] {
  const ids = new Set(components.map((c) => c.id))
  const dangling: DanglingDependency[] = []
  for (const c of components) {
    for (const dep of c.dependencies) {
      if (!ids.has(dep.target)) dangling.push({ componentId: c.id, dependency: dep })
    }
  }
  return dangling
}

/**
 * requires/blocks 环检测。返回找到的环（组件 id 序列，首尾同一个）；空数组 = 无环。
 *
 * 边方向统一成「先做谁」：`A requires B` → B 先于 A；`A blocks B` → A 先于 B。
 * 两种边混在一张图上找环 —— 「A requires B 且 B requires A」和
 * 「A requires B 且 A blocks B 的前置」一样是排不出顺序的死结。
 */
export function findOrderingCycles(components: readonly ProductMapComponent[]): string[][] {
  const edges = new Map<string, string[]>()
  const ids = new Set(components.map((c) => c.id))
  for (const c of components) {
    for (const dep of c.dependencies) {
      if (!ORDERING_EDGE_TYPES.has(dep.type) || !ids.has(dep.target)) continue
      const [from, to] = dep.type === 'requires' ? [dep.target, c.id] : [c.id, dep.target]
      const list = edges.get(from) ?? []
      list.push(to)
      edges.set(from, list)
    }
  }

  const cycles: string[][] = []
  const visited = new Set<string>()
  const onStack = new Set<string>()
  const stack: string[] = []

  function dfs(node: string): void {
    visited.add(node)
    onStack.add(node)
    stack.push(node)
    for (const next of edges.get(node) ?? []) {
      if (onStack.has(next)) {
        const start = stack.indexOf(next)
        cycles.push([...stack.slice(start), next])
      } else if (!visited.has(next)) {
        dfs(next)
      }
    }
    stack.pop()
    onStack.delete(node)
  }

  for (const id of Array.from(ids)) {
    if (!visited.has(id)) dfs(id)
  }
  return cycles
}

export interface ComponentNeighbours {
  /** 排在本组件之前的邻居（我 requires/consumes 的对象;以及 blocks 我的人）。 */
  readonly upstream: readonly { id: string; type: ComponentDependency['type'] }[]
  /** 排在本组件之后的邻居（依赖我的人;以及我 blocks 的对象）。 */
  readonly downstream: readonly { id: string; type: ComponentDependency['type'] }[]
}

/**
 * 🔴 blocks 边方向要单独反转:`A blocks B` 的排序语义是 A 在 B 上游 ——
 *    跟 findOrderingCycles 的方向保持一致,否则 PR3 会把阻塞关系上下游画反。
 */
export function neighboursOf(
  componentId: string,
  components: readonly ProductMapComponent[],
): ComponentNeighbours {
  const upstream: { id: string; type: ComponentDependency['type'] }[] = []
  const downstream: { id: string; type: ComponentDependency['type'] }[] = []
  const self = components.find((c) => c.id === componentId)
  for (const dep of self?.dependencies ?? []) {
    if (dep.type === 'blocks') downstream.push({ id: dep.target, type: dep.type })
    else upstream.push({ id: dep.target, type: dep.type })
  }
  for (const c of components) {
    if (c.id === componentId) continue
    for (const dep of c.dependencies) {
      if (dep.target !== componentId) continue
      if (dep.type === 'blocks') upstream.push({ id: c.id, type: dep.type })
      else downstream.push({ id: c.id, type: dep.type })
    }
  }
  return { upstream, downstream }
}

/**
 * 被 blocker 卡住的组件，会沿 requires 边把「卡住」传导给下游
 * （X 有 blocker 且 Y requires X → Y 实际也动不了）。
 * 返回每个组件的传导来源列表（空 = 没被传导卡住）。
 */
export function propagateBlocked(
  components: readonly ProductMapComponent[],
): Map<string, string[]> {
  const directlyBlocked = new Set(
    components.filter((c) => c.currentBlockers.length > 0).map((c) => c.id),
  )
  const result = new Map<string, string[]>()
  const byId = new Map(components.map((c) => [c.id, c]))

  function blockedSources(id: string, seen: Set<string>): string[] {
    if (seen.has(id)) return []
    seen.add(id)
    const c = byId.get(id)
    if (!c) return []
    const sources: string[] = []
    for (const dep of c.dependencies) {
      if (dep.type !== 'requires') continue
      if (directlyBlocked.has(dep.target)) sources.push(dep.target)
      sources.push(...blockedSources(dep.target, seen))
    }
    return sources
  }

  for (const c of components) {
    const sources = Array.from(new Set(blockedSources(c.id, new Set())))
    if (sources.length > 0) result.set(c.id, sources)
  }
  return result
}
