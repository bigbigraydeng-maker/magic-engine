/**
 * ME2 Product Map v1 —— 依赖图与 unclassified 探测（Issue #974）。
 *
 * 🔴 纯函数，不碰 GitHub、不碰文件系统。输入是调用方已经拿到的路径/编号列表，
 *    输出是差集或图分析结果。真正去扫 `src/` 目录或调 GitHub API 属于
 *    调用方（未来的 reconciliation cron，PR2）的事，这里只负责算。
 */

import type { RegistryComponent } from './types'

export type GraphValidationResult = { readonly ok: true } | { readonly ok: false; readonly reason: string }

/**
 * 依赖 / 消费者是否都能在给定组件集合里解析到，且不构成环。
 *
 * Issue #974「Dependency Graph」视图要展示「谁依赖谁、关键路径和阻塞传播」——
 * 这两条不变量是它能立住的前提：指向不存在的组件，或者存在环，图就画不出关键路径。
 */
export function validateRegistryGraph(components: readonly RegistryComponent[]): GraphValidationResult {
  const knownIds = new Set(components.map((c) => c.componentId))

  for (const component of components) {
    for (const depId of component.dependencies) {
      if (!knownIds.has(depId)) {
        return {
          ok: false,
          reason: `${component.componentId} 声明依赖 ${depId}，但 registry 里没有这个组件`,
        }
      }
    }
    for (const consumerId of component.consumers) {
      if (!knownIds.has(consumerId)) {
        return {
          ok: false,
          reason: `${component.componentId} 声明消费者 ${consumerId}，但 registry 里没有这个组件`,
        }
      }
    }
  }

  const cycle = findDependencyCycle(components)
  if (cycle) {
    return { ok: false, reason: `依赖图里有环：${cycle.join(' → ')}` }
  }

  return { ok: true }
}

/** 有环就返回环上的 componentId 序列，没有就返回 null。DFS + 三色标记。 */
export function findDependencyCycle(components: readonly RegistryComponent[]): readonly string[] | null {
  const byId = new Map(components.map((c) => [c.componentId, c] as const))
  const state = new Map<string, 'visiting' | 'done'>()
  const path: string[] = []

  function visit(id: string): readonly string[] | null {
    const current = state.get(id)
    if (current === 'done') return null
    if (current === 'visiting') {
      const cycleStart = path.indexOf(id)
      return [...path.slice(cycleStart), id]
    }

    state.set(id, 'visiting')
    path.push(id)

    const component = byId.get(id)
    for (const depId of component?.dependencies ?? []) {
      const found = visit(depId)
      if (found) return found
    }

    path.pop()
    state.set(id, 'done')
    return null
  }

  for (const component of components) {
    const found = visit(component.componentId)
    if (found) return found
  }
  return null
}

/**
 * 找出「在候选路径列表里，但没被任何 registry 组件的 sourcePaths 覆盖」的路径。
 *
 * 一条候选路径只要落在某个已登记 `sourcePaths` 前缀之下就算被覆盖 ——
 * 组件通常登记的是目录（如 `src/lib/growth`），候选路径是目录下具体文件。
 */
export function findUnclassifiedSourcePaths(
  candidatePaths: readonly string[],
  components: readonly RegistryComponent[],
): readonly string[] {
  const registeredPrefixes = components.flatMap((c) => c.sourcePaths)
  const isCovered = (candidate: string): boolean =>
    registeredPrefixes.some((prefix) => candidate === prefix || candidate.startsWith(`${prefix}/`))
  return candidatePaths.filter((candidate) => !isCovered(candidate))
}

/** 找出「在候选 issue 编号列表里，但没被任何 registry 组件引用」的 issue 编号。 */
export function findUnclassifiedIssueNumbers(
  candidateIssueNumbers: readonly number[],
  components: readonly RegistryComponent[],
): readonly number[] {
  const registered = new Set(components.flatMap((c) => c.issueNumbers))
  return candidateIssueNumbers.filter((n) => !registered.has(n))
}

/** 找出「在候选 PR 编号列表里，但没被任何 registry 组件引用」的 PR 编号。 */
export function findUnclassifiedPullRequestNumbers(
  candidatePullRequestNumbers: readonly number[],
  components: readonly RegistryComponent[],
): readonly number[] {
  const registered = new Set(components.flatMap((c) => c.pullRequestNumbers))
  return candidatePullRequestNumbers.filter((n) => !registered.has(n))
}
