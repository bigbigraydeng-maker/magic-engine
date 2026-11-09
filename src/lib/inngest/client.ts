/**
 * Magic Engine 2.0 · 主应用（云端 web app）的 Inngest 客户端（Issue #1346）
 *
 * 🔴 **为什么要有这个文件**：主应用此前只有「发事件」的半边（`src/lib/workflows/inngest-event.ts`
 *    的 `sendInngestEvent`），没有「接收 + 执行」的半边 —— 事件发出去没有云端函数会跑。
 *    本客户端 + `/api/inngest` serve 端点补上接收半边。执行侧运行在 Render 的 web 服务里，
 *    7×24 在线，不依赖任何一台本机开机。
 *
 * 🔴 **Inngest 的路由不变量（子牙复审校正，务必让 #1347 的实现者读到）**：
 *    Inngest **按事件名（trigger）把事件 fan-out 到同一环境下所有 app 的所有匹配函数** ——
 *    **不按 app id、也不按函数 id 路由**。所以：
 *      · app id（本应用 `magic-engine-web` vs 本机 worker `magic-engine-cts-workflow`）
 *        只是**注册/同步的分组单位**，函数 id 由 Inngest 按 app 自动命名空间隔离（跨 app 不撞）。
 *      · `cloud-` 前缀是**可读性 + 双保险**，不是防重复执行的闸。
 *    **真正防「同一事件被两个 app 各跑一次」的唯一机制是「一个事件只被一个 app 消费」。**
 *    云端消费者只能监听云端专属、本机 worker 不消费的事件名；若某事件要由云端接管，
 *    本机 worker 必须先停止消费它（一事件一主）。这条不变量有契约测试锁死（见 route 测试）。
 */

import { Inngest } from 'inngest'

/** 云端应用标识 —— 与本机 worker（magic-engine-cts-workflow）刻意不同的注册分组。 */
export const INNGEST_APP_ID = 'magic-engine-web'

/** 云端注册函数的 id 命名空间前缀（可读性 + 双保险；隔离真正靠事件名归属）。 */
export const CLOUD_FN_PREFIX = 'cloud-'

/**
 * 本机 worker（`scripts/factory-worker`）已消费的事件名 —— 云端函数**禁止**监听，
 * 否则同一事件两处执行 = 平行系统。契约测试断言 cloudFunctions 不碰这些。
 */
export const WORKER_OWNED_EVENTS = [
  'daily_plan.publish_queue.ready',
  'me/factory.cts-candidate.requested',
  'me/factory.cts-candidate.reviewed',
  'me/factory.pilot.requested',
  'me/factory.pilot.reviewed',
] as const

/** 单例客户端。接收侧（serve）不需要 eventKey，只在校验入站签名时用 signing key。 */
export const inngest = new Inngest({ id: INNGEST_APP_ID })
