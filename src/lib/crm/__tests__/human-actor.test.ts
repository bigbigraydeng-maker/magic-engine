/**
 * `isHumanActor` 是全仓唯一的「谁是人」判据。哪个前缀被漏掉，哪种客人会被误锁。
 * 生产 CTS 974 条阶段事件里 944 条 `ai:conversation-read`——它必须落到「机器」这一边。
 */
import { describe, expect, it } from 'vitest'
import { isHumanActor } from '../human-actor'

describe('isHumanActor', () => {
  it('登录邮箱算人', () => {
    expect(isHumanActor('sales@ctstours.co.nz')).toBe(true)
    expect(isHumanActor('BAKER@CTSTours.co.nz')).toBe(true) // 大小写不影响，只看有没有 @
    expect(isHumanActor('a@b')).toBe(true) // 判据只到「含 @」，格式合不合法不由这里管
  })

  it('AI 自动写阶段的 `ai:conversation-read` 不算人（生产 944 条这里）', () => {
    expect(isHumanActor('ai:conversation-read')).toBe(false)
  })

  it('自动化系统写入者不算人', () => {
    expect(isHumanActor('system')).toBe(false)
    expect(isHumanActor('system:qualified-buyer')).toBe(false)
    expect(isHumanActor('system:stage-infer')).toBe(false)
  })

  it('governed-reply-agent 那种长得像邮箱但没 @ 的 slug 不算人', () => {
    expect(isHumanActor('governed-reply-agent')).toBe(false)
  })

  it('空值、null、undefined 都不算人', () => {
    // typeof 守卫同时防非字符串（如运行时错传 number），不为它单独造 fixture——
    // 那种测试要绕过类型系统，反过来把「谁是人」这条判据写成含糊的。
    expect(isHumanActor('')).toBe(false)
    expect(isHumanActor(null)).toBe(false)
    expect(isHumanActor(undefined)).toBe(false)
  })
})
