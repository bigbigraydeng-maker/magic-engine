/**
 * CLIENT_DOC_MANUAL_TASKS 是纯数据：每条都会原样进今日待办「需要你动手」。
 * 一条坏数据（相对链接、写错的到期时间、空的 how）会让这条待办被链接闸丢掉、
 * 永不过期或者没法照做 —— 等于管道断头。这里把每条的基本形状钉住。
 */
import { describe, it, expect } from 'vitest'
import { CLIENT_DOC_MANUAL_TASKS } from '../client-doc-manual-tasks'

describe('CLIENT_DOC_MANUAL_TASKS', () => {
  it.each(CLIENT_DOC_MANUAL_TASKS.map((t) => [t.what.slice(0, 24), t] as const))(
    '%s… 三件套齐全、链接是绝对网址、到期时间能解析',
    (_label, t) => {
      expect(t.clientId.length).toBeGreaterThan(0)
      expect(t.clientName.length).toBeGreaterThan(0)
      expect(t.what.length).toBeGreaterThan(10)
      expect(t.how.length).toBeGreaterThan(10)
      expect(t.href).toMatch(/^https:\/\//)
      expect(Number.isFinite(Date.parse(t.expiresAt))).toBe(true)
    },
  )

  it('Meta 企业认证那条下发给平台（infra），链接指向商务管理平台的企业信息页', () => {
    const task = CLIENT_DOC_MANUAL_TASKS.find((t) => t.clientId === 'infra' && t.what.includes('企业认证'))
    expect(task).toBeDefined()
    expect(task?.href).toBe('https://business.facebook.com/settings/info')
    expect(task?.how).toContain('Magic Engine AI Technology Limited')
  })
})
