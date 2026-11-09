import { describe, it, expect } from 'vitest'
import {
  MAX_FULL_TEXT_FETCHES,
  hasAnythingToSummarise,
  resolveEmailBodies,
  type EmailMessageRef,
} from '../email-brief-bodies'

function refs(n: number): EmailMessageRef[] {
  return Array.from({ length: n }, (_, i) => ({ messageId: `m${i}`, storedBody: `stored ${i}` }))
}

describe('resolveEmailBodies', () => {
  it('每条输入都有一条输出，顺序原样不变', async () => {
    const r = await resolveEmailBodies(refs(5), async (id) => `full ${id}`)
    expect(r.bodies.map((b) => b.messageId)).toEqual(['m0', 'm1', 'm2', 'm3', 'm4'])
  })

  it('只给最后 12 条拉全文；更早的用摘要，而且**不算**失败', async () => {
    const asked: string[] = []
    const r = await resolveEmailBodies(refs(20), async (id) => { asked.push(id); return `full ${id}` })
    expect(asked).toHaveLength(MAX_FULL_TEXT_FETCHES)
    expect(asked[0]).toBe('m8')
    expect(r.fellBack).toBe(0) // 早条目不是失败，只是按预算没去拉
    expect(r.bodies.filter((b) => b.source === 'stored_fallback')).toHaveLength(8)
  })

  it('拉不到（返回 null）就退回摘要，并计入失败数', async () => {
    const r = await resolveEmailBodies(refs(3), async () => null)
    expect(r.fellBack).toBe(3)
    expect(r.bodies.every((b) => b.source === 'stored_fallback')).toBe(true)
    expect(r.bodies[0].text).toBe('stored 0')
  })

  it('🔴 一封抛错不许连累整条线程：其余照样有正文', async () => {
    const r = await resolveEmailBodies(refs(3), async (id) => {
      if (id === 'm1') throw new Error('Graph 挂了')
      return `full ${id}`
    })
    expect(r.bodies.map((b) => b.source)).toEqual(['full', 'stored_fallback', 'full'])
    expect(r.fellBack).toBe(1)
    expect(r.bodies[2].text).toBe('full m2')
  })

  it('必须一个一个拉，不许并发（服务商按邮箱限流，时间预算也是这么估的）', async () => {
    let inFlight = 0
    let maxInFlight = 0
    await resolveEmailBodies(refs(4), async (id) => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, 1))
      inFlight -= 1
      return `full ${id}`
    })
    expect(maxInFlight).toBe(1)
  })

  it('转发内容必须带标签，模型才不会把它当成客人自己说的话', async () => {
    const body = ['see below', '', '---------- Forwarded message ---------', 'From: a@example.com', '', 'Day 1 Beijing.'].join('\n')
    const r = await resolveEmailBodies([{ messageId: 'm0', storedBody: '' }], async () => body)
    expect(r.bodies[0].text).toContain('see below')
    expect(r.bodies[0].text).toContain('[客人转发过来的内容，不是客人自己写的]')
    expect(r.bodies[0].text).toContain('Day 1 Beijing')
    // 客人自己写的那句必须排在标签**前面**，否则标签就把它一起圈进去了
    expect(r.bodies[0].text.indexOf('see below')).toBeLessThan(
      r.bodies[0].text.indexOf('[客人转发过来的内容'),
    )
  })

  it('客人只把我们自己的邮件转回来、一个字没写 → 这条算空', async () => {
    // 真实形状：iPad 转发长得像普通回复，引用的是我们自己发的推广邮件。
    const body = 'Sent from my iPad\n\nOn 8 Oct 2026, at 3:52 PM, CTS Tours <info@x.co.nz> wrote:\n\nOur tour departs 25 March.'
    const r = await resolveEmailBodies([{ messageId: 'm0', storedBody: 'Sent from my iPad' }], async () => body)
    expect(r.bodies[0].text).toBe('')
    expect(r.empty).toBe(1)
    expect(hasAnythingToSummarise(r)).toBe(false)
  })

  it('空输入不炸', async () => {
    expect(await resolveEmailBodies([], async () => 'x')).toEqual({ bodies: [], fellBack: 0, empty: 0 })
  })

  it('只要有一条有字就该写卡', async () => {
    const r = await resolveEmailBodies(refs(2), async (id) => (id === 'm0' ? '' : 'Please quote 3 adults.'))
    expect(hasAnythingToSummarise(r)).toBe(true)
  })
})
