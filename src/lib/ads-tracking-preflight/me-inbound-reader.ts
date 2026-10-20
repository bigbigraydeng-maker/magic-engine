/**
 * 按目标盯盘 · 读 ME 里实际收到的 WhatsApp 会话数（只读，只数不取内容）。
 *
 * 用来和 Meta 报的「开始聊天数」比一比：Meta 说有人聊了、ME 一条没收到 = 收信通道断了，客人的消息会漏回。
 * 起点是系列创建时刻——属于这个系列的聊天不可能早于它，所以 ME 收到的数应该不少于 Meta 报的数
 * （ME 的数里还包括没点广告的 WhatsApp 来信，只会偏多，不会让判断变严）。
 *
 * 数两个口径，取大的：
 *   · conversations 里 WhatsApp 渠道、起始时间之后新建的会话（客人第一次来信就会建）；
 *   · contact_touchpoints 里 WhatsApp、客人来信方向、起始时间之后的记录（老客人再来信也会算，每个会话一条）。
 * 只取大的是因为前者不依赖联系人归并成功，后者能数到老客人，两个各漏一种情况。
 *
 * 🔴 只读：只做 head 计数查询（不取任何姓名 / 电话 / 内容）；读不到就 read:false，绝不当成 0。
 * 🔴 平台通用：不点名任何客户。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { sanitizeError } from './sanitize'
import type { MeInboundFact } from './objective-watch'

const MAX_ERROR_CHARS = 120

const clip = (message: string): string => message.slice(0, MAX_ERROR_CHARS)

export async function countMeWhatsappInbound(supabase: SupabaseClient, clientId: string, sinceIso: string): Promise<MeInboundFact> {
  if (Number.isNaN(Date.parse(sinceIso))) return { read: false, error: '起始时间读不懂，没法数 ME 收到的会话' }
  try {
    const threads = await supabase
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .eq('channel', 'whatsapp')
      .gte('created_at', sinceIso)
    if (threads.error) return { read: false, error: clip(`读 ME 的 WhatsApp 会话失败：${threads.error.message}`) }

    const touches = await supabase
      .from('contact_touchpoints')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', clientId)
      .eq('channel', 'whatsapp')
      .eq('direction', 'inbound')
      .gte('occurred_at', sinceIso)
    if (touches.error) return { read: false, error: clip(`读 ME 的 WhatsApp 来信记录失败：${touches.error.message}`) }

    if (threads.count === null || touches.count === null) return { read: false, error: 'ME 没返回会话数，不当成 0' }
    return { read: true, count: Math.max(threads.count, touches.count), since: sinceIso }
  } catch (err) {
    return { read: false, error: clip(`读 ME 的 WhatsApp 会话出错：${sanitizeError(err)}`) }
  }
}
