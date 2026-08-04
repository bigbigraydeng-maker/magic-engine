/**
 * 不挑渠道的发送出口。
 *
 * 这一层只有一个职责，但它决定了整个 leads 中心可不可信：
 * **要么真的发出去了，要么明确说没发出去**。中间那种「看起来成功了、其实
 * 客人什么都没收到」是最贵的失败 —— 销售会干等一个永远不来的回复。
 *
 * 所以钉的全是「不许静默」：
 *   · 没接进来的渠道 → 明确失败，不许假装成功
 *   · 窗口关了 → 发之前就拦，不让人打完一段字才被平台拒
 *   · 适配器炸了 → 变成一句人话，不许把异常抛给页面
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  connectedChannels,
  getChannel,
  registerChannel,
  resetChannels,
  sendOnChannel,
  type ChannelAdapter,
  type SendWindow,
} from '../channels'

const INPUT = { clientId: 'c1', contactId: 'p1', body: '你好', sentByEmail: 'sales@cts.co.nz' }

function fakeAdapter(over: Partial<ChannelAdapter> = {}): ChannelAdapter {
  return {
    channel: 'messenger',
    isConnected: async () => true,
    window: async (): Promise<SendWindow> => ({ kind: 'open', msRemaining: 3600_000 }),
    send: async () => ({ ok: true, externalMessageId: 'mid-1' }),
    ...over,
  }
}

beforeEach(() => resetChannels())

describe('没接进来的渠道', () => {
  /** 这条是这一层存在的理由：假装成功会让销售干等一个永远不来的回复。 */
  it('明确失败，绝不假装发出去了', async () => {
    const r = await sendOnChannel('whatsapp', INPUT)
    expect(r).toMatchObject({ ok: false, code: 'not_connected' })
    expect(r.ok === false && r.reason).toContain('还没接')
  })

  it('没接的渠道不出现在「已接通」名单里 —— 页面据此决定给不给入口', () => {
    registerChannel(fakeAdapter())
    expect(connectedChannels()).toEqual(['messenger'])
  })

  it('已接通的名单按固定顺序，不随代码加载顺序跳动', () => {
    registerChannel(fakeAdapter({ channel: 'sms' }))
    registerChannel(fakeAdapter({ channel: 'messenger' }))
    registerChannel(fakeAdapter({ channel: 'whatsapp' }))
    expect(connectedChannels()).toEqual(['messenger', 'whatsapp', 'sms'])
  })
})

describe('窗口先问、再发', () => {
  it('窗口关了 → 发之前就拦下来，不调用适配器', async () => {
    const send = vi.fn(async () => ({ ok: true as const, externalMessageId: null }))
    registerChannel(fakeAdapter({ window: async () => ({ kind: 'closed', msRemaining: 0 }), send }))

    const r = await sendOnChannel('messenger', INPUT)
    expect(r).toMatchObject({ ok: false, code: 'window_closed' })
    expect(send).not.toHaveBeenCalled()
  })

  /** WhatsApp 超过 24 小时只能发审核过的模板 —— 那仍然是「能发」，不该拦。 */
  it('只能发模板的窗口仍然放行 —— 拦下来等于白白少一次跟进', async () => {
    registerChannel(fakeAdapter({ window: async () => ({ kind: 'template', msRemaining: null }) }))
    expect((await sendOnChannel('messenger', INPUT)).ok).toBe(true)
  })
})

describe('发送本身', () => {
  it('发成功了带回平台的消息 id —— 对账要用', async () => {
    registerChannel(fakeAdapter())
    expect(await sendOnChannel('messenger', INPUT)).toMatchObject({
      ok: true,
      externalMessageId: 'mid-1',
    })
  })

  it('空消息不发 —— 不浪费一次平台配额，也不在客人那边冒一条空气泡', async () => {
    const send = vi.fn(async () => ({ ok: true as const, externalMessageId: null }))
    registerChannel(fakeAdapter({ send }))

    const r = await sendOnChannel('messenger', { ...INPUT, body: '   ' })
    expect(r).toMatchObject({ ok: false, code: 'rejected' })
    expect(send).not.toHaveBeenCalled()
  })

  /** 页面拿到异常只会白屏。这一层必须把它变成一句人能行动的话。 */
  it('适配器炸了 → 变成一句人话，不把异常抛给页面', async () => {
    registerChannel(
      fakeAdapter({
        send: async () => {
          throw new Error('Graph 502')
        },
      }),
    )
    const r = await sendOnChannel('messenger', INPUT)
    expect(r).toMatchObject({ ok: false, code: 'failed' })
    expect(r.ok === false && r.reason).toBe('Graph 502')
  })

  it('适配器自己判定失败 → 原样带回它的理由，不吞掉', async () => {
    registerChannel(
      fakeAdapter({
        send: async () => ({ ok: false, code: 'no_address', reason: '他没留 WhatsApp 号码' }),
      }),
    )
    expect(await sendOnChannel('messenger', INPUT)).toMatchObject({
      ok: false,
      code: 'no_address',
      reason: '他没留 WhatsApp 号码',
    })
  })
})

describe('注册表', () => {
  it('取得出已登记的适配器', () => {
    registerChannel(fakeAdapter())
    expect(getChannel('messenger')?.channel).toBe('messenger')
    expect(getChannel('whatsapp')).toBeNull()
  })

  it('同一条渠道重复登记以后一次为准 —— 不留两个各说各话的适配器', () => {
    registerChannel(fakeAdapter({ send: async () => ({ ok: true, externalMessageId: '旧' }) }))
    registerChannel(fakeAdapter({ send: async () => ({ ok: true, externalMessageId: '新' }) }))
    expect(connectedChannels()).toEqual(['messenger'])
  })
})
