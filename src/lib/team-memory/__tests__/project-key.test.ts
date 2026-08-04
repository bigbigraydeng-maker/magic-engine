import { describe, it, expect } from 'vitest'
import { projectKeyFromCwd, isManagedProject } from '../project-key'

describe('projectKeyFromCwd', () => {
  it('主目录直接命中', () => {
    expect(projectKeyFromCwd('/Users/x/Documents/Claude/Projects/magic-engine')).toBe('magic-engine')
  })

  it('命名 worktree 折叠回父项目 —— 这是修根因的那一步', () => {
    // 实测这些目录各自有 0 条记忆，折叠后才能继承主目录的 95 条
    expect(projectKeyFromCwd('/Users/x/Documents/Claude/Projects/magic-engine-cts')).toBe('magic-engine')
    expect(projectKeyFromCwd('/Users/x/Documents/Claude/Projects/magic-engine-seo-loop')).toBe('magic-engine')
  })

  it('.claude/worktrees 下的自动 worktree 也折叠', () => {
    expect(
      projectKeyFromCwd('/Users/x/Documents/Claude/Projects/magic-engine/.claude/worktrees/brave-bell-06bef3'),
    ).toBe('magic-engine')
    expect(
      projectKeyFromCwd('/Users/x/Documents/Claude/Projects/chinatravel/.claude/worktrees/epic-johnson-934157'),
    ).toBe('chinatravel')
  })

  it('magic-lab-academy 不会被 magic-engine 吞掉', () => {
    expect(projectKeyFromCwd('/Users/x/Documents/Claude/Projects/magic-lab-academy')).toBe(
      'magic-lab-academy',
    )
  })

  it('相似但不同的名字不许误吞（前缀后必须是短横线）', () => {
    expect(projectKeyFromCwd('/Users/x/Documents/Claude/Projects/magic-engineering')).toBe('unknown')
  })

  it('受管范围外的目录返回 unknown —— 私人项目一个字都不上报', () => {
    expect(projectKeyFromCwd('/Users/x/Documents/personal-taxes')).toBe('unknown')
    expect(projectKeyFromCwd('')).toBe('unknown')
    expect(projectKeyFromCwd(null)).toBe('unknown')
  })

  it('isManagedProject 只放行已知四个项目', () => {
    expect(isManagedProject('magic-engine')).toBe(true)
    expect(isManagedProject('unknown')).toBe(false)
  })
})
