/**
 * Client Knowledge Base — 「停止 AI 回复」(design doc §9.10: "客户也有'停止
 * AI 回复'按钮，不只 ME 能按").
 *
 * The customer's own emergency brake. It lives here, next to the confirmation
 * link, because the confirmation page is the one surface a customer contact
 * reliably reaches without a dashboard login — the moment they read a line
 * that says "AI 以后会这样回复顾客" and think *no*, the button to stop it has
 * to be right there, not behind a support email.
 *
 * 🔴 It flips the EXISTING Governed Reply Agent kill switches
 * (`clients.messenger_agent_enabled_messenger` / `_whatsapp`, added by
 * `20260913095601_conversation_reply_drafts.sql` and read by
 * `src/lib/messenger-agent/channel-dispatch.ts`) rather than inventing a
 * second, parallel "is the AI on" flag. Two switches for one question is how
 * you end up with an AI that is off according to one screen and on according
 * to the code that actually sends.
 *
 * 🔴 Order of operations: flip the switch FIRST, then write the audit event.
 * If the audit write fails afterwards, the AI is still off — the safe
 * direction. Doing it the other way round would risk a recorded "we stopped
 * it" next to an AI that never actually stopped.
 */

import { asRows, type KnowledgeWriteClient } from './write-client'

export class KnowledgeKillSwitchError extends Error {
  constructor(message: string) {
    super(`[knowledge] ${message}`)
    this.name = 'KnowledgeKillSwitchError'
  }
}

export interface StopAiRepliesResult {
  /** true = the switch is now off. Audit-write failures are reported separately, never by pretending the switch didn't move. */
  stopped: boolean
  /** Non-null when the switch flipped but the append-only audit event could not be written. */
  auditWarning: string | null
}

export interface ResumeAiRepliesResult {
  /** true = the switch is now on. Audit-write failures are reported separately, never by pretending the switch didn't move. */
  resumed: boolean
  /** Non-null when the switch flipped but the append-only audit event could not be written. */
  auditWarning: string | null
}

/**
 * Turn every channel of this client's automatic AI replying off, and record
 * who did it in the append-only `client_knowledge_events` stream.
 *
 * `actorEmail` must be a real identity (the confirmer's registered email, or
 * a logged-in dashboard user) — the event table's `actor_email` is NOT NULL
 * precisely so "someone turned the AI off and nobody knows who" cannot exist.
 */
export async function stopAiRepliesForClient(
  sb: KnowledgeWriteClient,
  params: { clientId: string; actorEmail: string; reason?: string; source?: string },
): Promise<StopAiRepliesResult> {
  const actorEmail = params.actorEmail.trim()
  if (!actorEmail) throw new KnowledgeKillSwitchError('缺少操作人身份，拒绝改动 AI 回复开关')

  const flip = await sb
    .from('clients')
    .update({
      messenger_agent_enabled_messenger: false,
      messenger_agent_enabled_whatsapp: false,
    })
    .eq('id', params.clientId)
    .select('id')
  if (flip.error) {
    throw new KnowledgeKillSwitchError(`关闭 AI 回复失败：${flip.error.message ?? '未知错误'}`)
  }
  // 🔴 PostgREST 的 update 匹配不到行时返回空数组而不是报错。把空数组当成
  // 成功，就会出现「页面显示已关闭、实际一个字段都没改」这种最危险的假象。
  if (asRows<{ id: string }>(flip.data).length === 0) {
    throw new KnowledgeKillSwitchError('没有找到这个客户，AI 回复开关没有被改动。')
  }

  const event = await sb
    .from('client_knowledge_events')
    .insert({
      client_id: params.clientId,
      dimension: 'kill_switch',
      value: 'off',
      reason: params.reason?.trim() || null,
      actor_email: actorEmail,
      payload: { source: params.source ?? 'unknown' },
    })
    .select('id')

  return {
    stopped: true,
    auditWarning: event.error
      ? `AI 回复已经停了，但这次操作没能记进日志：${event.error.message ?? '未知错误'}`
      : null,
  }
}

/**
 * `stopAiRepliesForClient` 的对称操作——把同一对开关重新打开。
 *
 * 🔴 为什么这个函数存在：门户「紧急全渠道停」面板（issue #1589）原来只有
 * 停用按钮，文案却写着「重新打开需要回到这里手动开」——但代码库里翻遍也
 * 没有任何地方把这两列写回 `true`（Codex 复审 2026-09-15 抓到）。一个只能
 * 往一个方向拨的「开关」不是真的开关：真出现误触发或者情况已经处理完，
 * 团队除了直接改数据库别无办法。这里照抄 `stopAiRepliesForClient` 的顺序
 * 和审计写法，只把值换成 `true`/`'on'`，不引入新的状态机。
 */
export async function resumeAiRepliesForClient(
  sb: KnowledgeWriteClient,
  params: { clientId: string; actorEmail: string; reason?: string; source?: string },
): Promise<ResumeAiRepliesResult> {
  const actorEmail = params.actorEmail.trim()
  if (!actorEmail) throw new KnowledgeKillSwitchError('缺少操作人身份，拒绝改动 AI 回复开关')

  const flip = await sb
    .from('clients')
    .update({
      messenger_agent_enabled_messenger: true,
      messenger_agent_enabled_whatsapp: true,
    })
    .eq('id', params.clientId)
    .select('id')
  if (flip.error) {
    throw new KnowledgeKillSwitchError(`重新打开 AI 回复失败：${flip.error.message ?? '未知错误'}`)
  }
  if (asRows<{ id: string }>(flip.data).length === 0) {
    throw new KnowledgeKillSwitchError('没有找到这个客户，AI 回复开关没有被改动。')
  }

  const event = await sb
    .from('client_knowledge_events')
    .insert({
      client_id: params.clientId,
      dimension: 'kill_switch',
      value: 'on',
      reason: params.reason?.trim() || null,
      actor_email: actorEmail,
      payload: { source: params.source ?? 'unknown' },
    })
    .select('id')

  return {
    resumed: true,
    auditWarning: event.error
      ? `AI 回复已经重新打开，但这次操作没能记进日志：${event.error.message ?? '未知错误'}`
      : null,
  }
}
