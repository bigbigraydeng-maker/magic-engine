/**
 * Team Working Memory — 项目名归一化
 *
 * 这是修根因的那一步。实测（2026-08-02）：
 *   主目录 magic-engine 的 memory 目录                     95 条
 *   32 个 .claude/worktrees 下的自动 worktree              各 0 条
 *   还有 magic-engine-cts / -messenger / -seo-loop 等命名 worktree 也各自为政。
 *
 * Claude Code 按*目录*存记忆，所以每开一个工作目录就是一张白纸。
 * 这里把所有 worktree 一律折叠回父项目，让新窗口自动继承父项目的教训。
 */

import type { ProjectKey } from './types'

/**
 * 已知项目。顺序无关（前缀互不包含），但新增时请确认不会互相吞。
 * 命名 worktree（magic-engine-cts、magic-engine-seo-loop…）靠前缀匹配折叠。
 */
const KNOWN_PROJECTS: ProjectKey[] = [
  'magic-engine',
  'chinatravel',
  'midashand',
  'magic-lab-academy',
]

/** 路径里项目根目录的父目录名。两种布局都支持。 */
const PROJECT_ROOT_MARKERS = ['/Projects/', '/projects/']

/**
 * 从工作目录推出归一化项目名。
 *
 * 例：
 *   …/Projects/magic-engine                            → magic-engine
 *   …/Projects/magic-engine-cts                        → magic-engine
 *   …/Projects/magic-engine/.claude/worktrees/foo-123  → magic-engine
 *   …/Projects/chinatravel/.claude/worktrees/bar       → chinatravel
 *   …/Documents/random                                 → unknown
 */
export function projectKeyFromCwd(cwd: string | null | undefined): ProjectKey {
  if (!cwd) return 'unknown'
  const normalized = cwd.replace(/\\/g, '/')

  const segment = firstSegmentAfterProjectsRoot(normalized)
  if (!segment) return 'unknown'

  // 精确优先，避免 magic-lab-academy 之类被更短的名字前缀吞掉
  const exact = KNOWN_PROJECTS.find((p) => p === segment)
  if (exact) return exact

  // 命名 worktree：magic-engine-cts / magic-engine-seo-loop → magic-engine
  // 要求后面跟 '-'，否则 'magic-engineering' 这种会被误吞
  const prefixed = KNOWN_PROJECTS
    .filter((p) => segment.startsWith(`${p}-`))
    // 取最长匹配，防止将来加入互为前缀的项目名时选错
    .sort((a, b) => b.length - a.length)[0]

  return prefixed ?? 'unknown'
}

function firstSegmentAfterProjectsRoot(path: string): string | null {
  for (const marker of PROJECT_ROOT_MARKERS) {
    const idx = path.indexOf(marker)
    if (idx === -1) continue
    const rest = path.slice(idx + marker.length)
    const segment = rest.split('/')[0]
    if (segment) return segment
  }
  return null
}

/** 这个项目是否在受管范围内（PM 拍板：四个项目全管，其余窗口不上报） */
export function isManagedProject(key: ProjectKey): boolean {
  return key !== 'unknown'
}
