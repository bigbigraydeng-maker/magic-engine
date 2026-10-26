import { describe, expect, it } from 'vitest'
import { facebookPromotePort } from './facebook-port'
import { portFor } from './platform-port'

describe('portFor', () => {
  it('facebook 返回 Facebook 端口', () => {
    expect(portFor('facebook')).toBe(facebookPromotePort)
  })

  it.each(['instagram', 'tiktok', '', 'FACEBOOK', undefined])('没有登记的平台 %j 返回 null(调用方按目标不可用拒绝)', (platform) => {
    expect(portFor(platform)).toBeNull()
  })
})
