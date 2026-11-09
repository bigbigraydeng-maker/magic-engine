// 事件契约（只声明事件名 + payload 形状，不碰 Inngest/数据库——遵循
// reel-published-event.ts 同款"契约模块"惯例，保持可脱网单测）。
// Spec §4.4/§4.5。
import { z } from 'zod'

export const CREATOMATE_RENDER_REQUESTED_EVENT = 'me/factory.creatomate_render.requested' as const
export const CREATOMATE_RENDER_WEBHOOK_RECEIVED_EVENT = 'me/factory.creatomate_render.webhook_received' as const

const uuidLike = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'invalid id')

export const CreatomateRenderRequestedSchema = z.object({
  job_id: uuidLike,
  client_id: uuidLike,
  post_id: uuidLike,
})
export type CreatomateRenderRequestedData = z.infer<typeof CreatomateRenderRequestedSchema>

// 🔴 刻意只带 job_id/render_id，不带 status/url——webhook 来源无法验证签名（spec §3.3/§6.1），
// 事件类型上就不给"可以直接采信"的字段，逼下游永远回头查一次 GET /v2/renders/{id}。
export const CreatomateRenderWebhookReceivedSchema = z.object({
  job_id: uuidLike,
  render_id: z.string().min(1),
})
export type CreatomateRenderWebhookReceivedData = z.infer<typeof CreatomateRenderWebhookReceivedSchema>
