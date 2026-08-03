/**
 * 不挑渠道的「发一条消息」出口。
 *
 * ## 为什么要有它（2026-08-02 定的产品方向）
 *
 * ME 的 CRM 要做成集邮件 / WhatsApp / Messenger / 电话于一体的 leads 营销中心，
 * 而且是给**所有**客户用的拳头产品。如果每接一条渠道就在页面和 CRM 里各写一套
 * 收发，最后会是五个互不相通的半成品 —— 今天那个「点了链接的 33 人整段从页面上
 * 消失」就是这类问题的小型预演：段位、文案、优先级全写好了，唯独漏配了一行。
 *
 * 所以先修总线：**上层只说「给这个人发这句话」，不关心走哪条线**；
 * 每条渠道写一个适配器注册进来。接 WhatsApp 时页面一行不用改。
 *
 * ## 三条不能破的规矩
 *
 * 1. **发不出去就说发不出去**，不许静默失败。每个适配器返回结构化结果，
 *    调用方据此对人说一句能行动的话（「Facebook 已经不让回这条了，改打电话」）。
 * 2. **窗口先问、再发**。Messenger 24 小时、WhatsApp 24 小时 + 模板 ——
 *    不先问就发，等于让销售打完一段字才被平台拒掉。
 * 3. **一条渠道没接进来，就明说没接**，不许退回一个「假装发出去了」的成功。
 *
 * 这一层**不碰数据库**：写不写触点、算不算「今天跟过」，由调用方决定 ——
 * 那些规则在 lib/crm 里，不该被渠道适配器各自复制一份。
 */

/** ME 支持（或计划支持）的对话渠道。跟 conversations.channel 的取值一致。 */
export const CHANNELS = ['messenger', 'whatsapp', 'email', 'sms'] as const
export type MessagingChannel = (typeof CHANNELS)[number]

/**
 * 现在能不能给这个人发消息。
 *
 * `open`     —— 随便发
 * `template` —— 只能发平台预先审核过的模板（WhatsApp 超过 24 小时后就是这样）
 * `closed`   —— 发不了，得换渠道
 */
export type SendWindow =
  | { kind: 'open'; msRemaining: number | null }
  | { kind: 'template'; msRemaining: number | null }
  | { kind: 'closed'; msRemaining: 0 }

export interface SendInput {
  clientId: string
  /** 发给谁（ME 里的联系人）。适配器自己去查他在这条渠道上的地址。 */
  contactId: string
  body: string
  /** 谁按的发送。审计要答得出「这句话是谁说的」。 */
  sentByEmail: string
}

export type SendResult =
  | { ok: true; externalMessageId: string | null }
  | {
      ok: false
      /** 给人看的一句话 —— 不是给开发看的堆栈。 */
      reason: string
      /** 机器可读，调用方据此决定是不是该建议换渠道。 */
      code: 'window_closed' | 'not_connected' | 'no_address' | 'rejected' | 'failed'
    }

export interface ChannelAdapter {
  channel: MessagingChannel
  /** 这个客户接没接这条渠道。没接就别在页面上给他一个点了没用的输入框。 */
  isConnected(clientId: string): Promise<boolean>
  /** 现在能不能发。**发之前必须先问**。 */
  window(clientId: string, contactId: string): Promise<SendWindow>
  send(input: SendInput): Promise<SendResult>
}

const registry = new Map<MessagingChannel, ChannelAdapter>()

/** 接一条新渠道 = 写一个适配器 + 在这里登记一行。 */
export function registerChannel(adapter: ChannelAdapter): void {
  registry.set(adapter.channel, adapter)
}

/** 只给测试用 —— 让每个用例从干净的注册表开始。 */
export function resetChannels(): void {
  registry.clear()
}

export function getChannel(channel: MessagingChannel): ChannelAdapter | null {
  return registry.get(channel) ?? null
}

/** 已经接进来的渠道。页面据此决定给哪些入口。 */
export function connectedChannels(): MessagingChannel[] {
  // 按 CHANNELS 的顺序，不按注册顺序 —— 否则页面上的渠道会随代码加载顺序跳动。
  return CHANNELS.filter((c) => registry.has(c))
}

/**
 * 给这个人发一条消息。
 *
 * 没接的渠道**明确失败**，绝不返回一个假装成功的结果 —— 上层会据此告诉销售
 * 「这条线还没接通」，而不是让他以为消息发出去了、干等一个永远不来的回复。
 */
export async function sendOnChannel(
  channel: MessagingChannel,
  input: SendInput,
): Promise<SendResult> {
  const adapter = registry.get(channel)
  if (!adapter) {
    return { ok: false, code: 'not_connected', reason: `${channel} 这条线还没接进来` }
  }

  if (!input.body.trim()) {
    return { ok: false, code: 'rejected', reason: '消息是空的' }
  }

  // 窗口先问、再发。不先问就发，等于让销售打完一段字才被平台拒掉。
  const win = await adapter.window(input.clientId, input.contactId)
  if (win.kind === 'closed') {
    return { ok: false, code: 'window_closed', reason: '现在不能给他发消息了，请改用别的方式联系' }
  }

  try {
    return await adapter.send(input)
  } catch (err) {
    // 适配器炸了也要给人一句能行动的话 —— 静默失败是这一层最不能犯的错。
    return {
      ok: false,
      code: 'failed',
      reason: err instanceof Error ? err.message : '没发出去，请再试一次',
    }
  }
}
