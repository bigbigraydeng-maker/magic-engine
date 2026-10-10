/**
 * F3 · `conversation.approval.emit`（Issue #1586，design doc"纯中继，不变"）。
 *
 * 🔴（子牙复审 2026-09-15 指出并采纳）这个文件最初放在 `src/lib/inngest/functions/`
 * 目录下——那个目录里**每一个**文件都是被 Inngest 触发、注册进 `index.ts` 的
 * `cloudFunctions` 数组、并受一条运行期自检（函数 id 必须以 `cloud-` 开头）约束的
 * 正式函数。这个文件不是那种东西：它没有自己的事件订阅，是门户"批准"/"改后发送"
 * 按钮点击那一刻，由 HTTP 路由（
 * `src/app/api/clients/[id]/messenger/conversations/[conversationId]/reply/route.ts`）
 * 同步调用的一个薄封装，把"人工批准了这条草稿"这件事翻译成 F2
 * （`conversation.inbound.draft`，issue #1585）的
 * `step.waitForEvent('conversation/reply.approved', { if: 'async.data.draft_id == "${draftId}"' })`
 * 认识的事件形状。放进那个目录会破坏"这个目录=注册过的 Inngest 函数"这条隐含
 * 契约，误导以后可能加的"每个导出函数必须在 cloudFunctions 里注册"这类检查。
 * 仓库里已经有同一种角色的先例——`src/lib/factory/publish/reel-published-event.ts`
 * （"只管事件契约，自己不碰 Inngest，真正的 `sendInngestEvent` 调用在别处"），
 * 放在它服务的业务域目录下，不在 `inngest/` 里——这个文件现在跟随同一个约定，
 * 放进 `src/lib/messenger-agent/`（design doc 里同一批 CTS 私信客服文件
 * `channel-dispatch.ts`/`classify.ts`/`optout.ts` 所在的目录）。
 *
 * 发送用的是 `sendInngestEvent`（`src/lib/workflows/inngest-event.ts`）而不是
 * `src/lib/inngest/client.ts` 的云端客户端——跟已经合并的 Messenger webhook
 * （issue #1640）emit `conversation/message.received` 用的是同一条发送路径，保持
 * 这整条 `conversation/*` 事件族的发送方式一致。Inngest 按事件名 fan-out，不按
 * 发送方用的是哪个 SDK 实例，所以这个选择不影响 F2 将来注册在云端还是本机 worker。
 * （仓库里 `inngest.send()` 云端客户端也被 `web-intelligence/route.ts`、
 * `webhooks/whatsapp/route.ts` 两处生产路由直接调用——两条发送路径长期并存，没有
 * 文档规定新代码该选哪条，这是系统性遗留问题，这个文件的选择只是跟离它最近的
 * 同族事件保持一致，不代表"两条路径" 的整体问题在这里被解决了。）
 *
 * "拒绝并接管"不经过这里——那条路径只更新 `conversation_reply_drafts.verifier_status`
 * 为 `'rejected'`，不需要唤醒 F2（见 reply route 的拒绝分支注释）。
 */

import { sendInngestEvent } from '@/lib/workflows/inngest-event'

export const CONVERSATION_REPLY_APPROVED_EVENT = 'conversation/reply.approved'

export interface EmitConversationApprovalEventInput {
  draftId: string
  clientId: string
  conversationId: string
  /** 谁点的批准/改后发送——落进事件 data，供 F2 或审计回看时核对操作者。 */
  decidedByEmail: string
}

export interface EmitConversationApprovalEventDeps {
  send?: typeof sendInngestEvent
}

/**
 * 事件 `id` 用 `draftId` 派生（而不是随机 UUID）：Inngest 按事件 `id` 去重
 * （同一个 `id` 重复发送只会被消费一次）。同一条草稿只应该真正触发一次
 * "已批准"事件——如果 FDE 因为网络卡顿重复点击批准按钮、或者调用方对失败做了
 * 重试，这里天然幂等，不会让 F2 收到两次唤醒信号。
 */
function eventIdFor(draftId: string): string {
  return `conversation-approval-emit:${draftId}`
}

export async function emitConversationApprovalEvent(
  input: EmitConversationApprovalEventInput,
  deps: EmitConversationApprovalEventDeps = {},
): Promise<void> {
  const send = deps.send ?? sendInngestEvent
  await send({
    id: eventIdFor(input.draftId),
    name: CONVERSATION_REPLY_APPROVED_EVENT,
    data: {
      draft_id: input.draftId,
      client_id: input.clientId,
      conversation_id: input.conversationId,
      decided_by_email: input.decidedByEmail,
    },
  })
}
