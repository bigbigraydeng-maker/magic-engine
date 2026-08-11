/**
 * 死信 / 等审批 / 被拒绝 → 下发成人工任务。
 *
 * 铁律的下半句：确实做不了，也不许烂尾。**必须下发成人工任务，且进同一个管道**
 * （今日待办），不能只写进 cron summary / console.log / 只有开发看得到的表。
 *
 * 三件套缺一条就是没下发好：
 *   what —— 问题**和影响**，说人话
 *   how  —— 具体点哪里，让 FDE 不用问人
 *   href —— 直达链接，连粘贴都不用
 *
 * 🔴 **但「三件套齐全」不等于「这条待办真能做完」。**
 *
 *    早先 `pending_approval` 那条写的是「打开执行看板点『同意执行』」，链接指向
 *    `/dashboard/clients/<id>/execution`。实际上那个页面**根本不读 `action_runs`**，
 *    全仓也没有任何 UI / API 会调 `approveAndRun` / `rejectPendingRun` ——
 *    也就是说：点进去既找不到这条 run，也没有那两个按钮。
 *
 *    一条**指向不存在的操作**的待办比没有待办更糟：它看起来已经下发好了，
 *    于是没有人再去建那个入口，而审批和死信会永久停住。
 *
 *    v1 是**未启用的空转内核**，所以正确做法不是编一个假入口，而是如实说
 *    「审批入口还没上线，这条已经安全停住、不会自动执行」，并把入口本身
 *    列成 Enable 前的硬前提（见 KERNEL-E7-APPROVAL-SURFACE）。
 *    有一条守卫测试盯着这里不许再出现假的可操作文案和假链接。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ActionRun } from './types'
import { listDeadLetterRuns } from './store'

export interface KernelHandoffTodo {
  client_id: string
  run_id: string
  what: string
  how: string
  href: string
}

/** 多久以内的需要人处理的执行才捞。太老的说明已经不重要了，天天刷屏反而没人看。 */
export const HANDOFF_WINDOW_DAYS = 14

/**
 * 🔴 Enable 前的硬前提。**在任何可能产生 `pending_approval` 的动作接真实调用方
 *    / apply 迁移 / 启用之前**，下面七件事必须先存在：
 *
 *      1. 认证过的操作者身份（不能信请求体里的 `approvedByUser`）；
 *      2. 真能读到 `action_runs` + 当前那条 pending 决策的 UI 或 API；
 *      3. 同意 → `approveAndRun`；
 *      4. 不做 → `rejectPendingRun`；
 *      5. 已结束 / 已被别人处理（settled / stale）要如实反馈，不能假装还在等；
 *      6. 客户归属与授权校验（谁能批哪个客户的东西）；
 *      7. 审批操作本身要留审计。
 *
 *    **本 PR 不实现它，也不假装它存在。**
 */
export const APPROVAL_SURFACE_BLOCKER = 'KERNEL-E7-APPROVAL-SURFACE'

export async function fetchKernelHandoffTodos(
  sb: SupabaseClient,
  now: Date = new Date(),
): Promise<KernelHandoffTodo[]> {
  const since = new Date(now.getTime() - HANDOFF_WINDOW_DAYS * 86_400_000).toISOString()
  const runs = await listDeadLetterRuns(sb, since)
  return runs.map((run) => toTodo(run))
}

function toTodo(run: ActionRun): KernelHandoffTodo {
  // 🔴 **这三种待办都不给 action URL。**
  //    执行看板（`/dashboard/clients/<id>/execution`）**不读 `action_runs`** ——
  //    点进去既找不到这条 run，也没有任何能处理它的按钮。
  //    给一个打得开但看不到这件事的链接，跟给一个 404 一样是假的三件套：
  //    人点过去以为自己漏看了，然后回来问「在哪」。
  //    没有链接时渲染器不会画「去做这件事」按钮，而 dropBrokenLinks 也不会
  //    把「没链接」当成「链接坏了」丢掉（两处都有守卫测试）。

  if (run.status === 'pending_approval') {
    return {
      client_id: run.client_id,
      run_id: run.id,
      what:
        `有一件「${run.action_key}」按这个客户的规则要人点头才做。` +
        `它已经安全停住了 —— 不会自动执行，也不会重复扣费。`,
      // 🔴 不给假的操作步骤，也不给假的链接。审批入口还没上线，
      //    这条待办现在**做不完**，如实说出来，并说清缺的是什么。
      how:
        '现在还没有可以点的审批入口：执行内核 v1 是未启用的空转版本，' +
        `审批界面 / 操作者 API 尚未上线（${APPROVAL_SURFACE_BLOCKER}）。` +
        '这条不用你做任何事 —— 回我一句，我来把审批入口排进计划。' +
        '在它上线之前，不会有任何需要人点头的动作被启用。',
      href: '',
    }
  }

  if (run.status === 'denied') {
    return {
      client_id: run.client_id,
      run_id: run.id,
      what: `有一件「${run.action_key}」被系统挡下来了：${run.last_error ?? '未说明原因'}`,
      how:
        '大多数是两种情况：① 这个客户还没给这类动作设自动化规则；' +
        '② 这个动作系统还没实现。两种都不用你自己动手做那件事 —— 回我一句，我来处理',
      href: '',
    }
  }

  return {
    client_id: run.client_id,
    run_id: run.id,
    what: `有一件「${run.action_key}」重试到上限还是没做成，已经停手：${run.last_error ?? '未说明原因'}`,
    how: '这条不用你做那件事本身 —— 回我一句「查一下这条」，我去看是哪一步卡住的。在修好之前它不会自己重试，也不会重复扣费',
    href: '',
  }
}
