/**
 * 「停止 AI 回复」（issue #1646 / design doc §9.10）。
 */

import { describe, it, expect } from 'vitest'
import { stopAiRepliesForClient, resumeAiRepliesForClient, KnowledgeKillSwitchError } from '../kill-switch'
import { createFakeWriteSupabase, type Row } from './fake-write-supabase'

const CLIENT_A = 'aaaaaaaa-0000-0000-0000-000000000001'
const CONFIRMER = 'owner@ctstours.co.nz'
const STAFF = 'ray@magicengine.com.au'

function tables(clientRows?: Row[]) {
  return {
    clients: clientRows ?? [
      { id: CLIENT_A, name: 'CTS', messenger_agent_enabled_messenger: true, messenger_agent_enabled_whatsapp: true },
    ],
    client_knowledge_events: [] as Row[],
  }
}

function stoppedTables(clientRows?: Row[]) {
  return {
    clients: clientRows ?? [
      { id: CLIENT_A, name: 'CTS', messenger_agent_enabled_messenger: false, messenger_agent_enabled_whatsapp: false },
    ],
    client_knowledge_events: [] as Row[],
  }
}

describe('stopAiRepliesForClient', () => {
  it('🔴 把 Governed Reply Agent 已有的两个开关都关掉（不另造一个平行开关）', async () => {
    const db = tables()
    const sb = createFakeWriteSupabase(db)
    const result = await stopAiRepliesForClient(sb, {
      clientId: CLIENT_A,
      actorEmail: CONFIRMER,
      source: 'knowledge_confirmation_page',
    })
    expect(result.stopped).toBe(true)
    expect(db.clients[0].messenger_agent_enabled_messenger).toBe(false)
    expect(db.clients[0].messenger_agent_enabled_whatsapp).toBe(false)
  })

  it('留下一条只增不改的审计事件，记得清楚是谁按的', async () => {
    const db = tables()
    const sb = createFakeWriteSupabase(db)
    await stopAiRepliesForClient(sb, {
      clientId: CLIENT_A,
      actorEmail: CONFIRMER,
      reason: '客户在确认页上点了停',
      source: 'knowledge_confirmation_page',
    })
    expect(db.client_knowledge_events).toHaveLength(1)
    expect(db.client_knowledge_events[0]).toMatchObject({
      client_id: CLIENT_A,
      dimension: 'kill_switch',
      value: 'off',
      actor_email: CONFIRMER,
      reason: '客户在确认页上点了停',
    })
  })

  it('🔴 一行都没改到时必须报错 —— PostgREST 的空数组不是"已经关好了"', async () => {
    const db = tables([])
    const sb = createFakeWriteSupabase(db)
    await expect(
      stopAiRepliesForClient(sb, { clientId: CLIENT_A, actorEmail: CONFIRMER }),
    ).rejects.toBeInstanceOf(KnowledgeKillSwitchError)
  })

  it('没有操作人身份就拒绝 —— 不许出现"AI 被谁停的没人知道"', async () => {
    const sb = createFakeWriteSupabase(tables())
    await expect(stopAiRepliesForClient(sb, { clientId: CLIENT_A, actorEmail: '  ' })).rejects.toThrow('缺少操作人身份')
  })

  it('审计写失败不改变"已经停了"这个事实，但要如实报出来', async () => {
    const db = tables()
    const sb = createFakeWriteSupabase(db, { errorTables: new Set(['client_knowledge_events']) })
    const result = await stopAiRepliesForClient(sb, { clientId: CLIENT_A, actorEmail: CONFIRMER })
    expect(result.stopped).toBe(true)
    expect(db.clients[0].messenger_agent_enabled_messenger).toBe(false)
    expect(result.auditWarning).toContain('没能记进日志')
  })

  it('开关写失败时抛错，不假装停下来了', async () => {
    const sb = createFakeWriteSupabase(tables(), { errorTables: new Set(['clients']) })
    await expect(
      stopAiRepliesForClient(sb, { clientId: CLIENT_A, actorEmail: CONFIRMER }),
    ).rejects.toBeInstanceOf(KnowledgeKillSwitchError)
  })
})

describe('resumeAiRepliesForClient', () => {
  it('🔴 把两个开关都重新打开——停用的对称操作，不是另一套机制', async () => {
    const db = stoppedTables()
    const sb = createFakeWriteSupabase(db)
    const result = await resumeAiRepliesForClient(sb, {
      clientId: CLIENT_A,
      actorEmail: STAFF,
      source: 'portal_emergency_stop',
    })
    expect(result.resumed).toBe(true)
    expect(db.clients[0].messenger_agent_enabled_messenger).toBe(true)
    expect(db.clients[0].messenger_agent_enabled_whatsapp).toBe(true)
  })

  it('留下一条 value=on 的审计事件', async () => {
    const db = stoppedTables()
    const sb = createFakeWriteSupabase(db)
    await resumeAiRepliesForClient(sb, { clientId: CLIENT_A, actorEmail: STAFF, reason: '误触发，确认没有影响客户' })
    expect(db.client_knowledge_events).toHaveLength(1)
    expect(db.client_knowledge_events[0]).toMatchObject({
      client_id: CLIENT_A,
      dimension: 'kill_switch',
      value: 'on',
      actor_email: STAFF,
      reason: '误触发，确认没有影响客户',
    })
  })

  it('🔴 一行都没改到时必须报错', async () => {
    const db = stoppedTables([])
    const sb = createFakeWriteSupabase(db)
    await expect(
      resumeAiRepliesForClient(sb, { clientId: CLIENT_A, actorEmail: STAFF }),
    ).rejects.toBeInstanceOf(KnowledgeKillSwitchError)
  })

  it('没有操作人身份就拒绝', async () => {
    const sb = createFakeWriteSupabase(stoppedTables())
    await expect(resumeAiRepliesForClient(sb, { clientId: CLIENT_A, actorEmail: '  ' })).rejects.toThrow('缺少操作人身份')
  })

  it('审计写失败不改变"已经重新打开"这个事实，但要如实报出来', async () => {
    const db = stoppedTables()
    const sb = createFakeWriteSupabase(db, { errorTables: new Set(['client_knowledge_events']) })
    const result = await resumeAiRepliesForClient(sb, { clientId: CLIENT_A, actorEmail: STAFF })
    expect(result.resumed).toBe(true)
    expect(db.clients[0].messenger_agent_enabled_messenger).toBe(true)
    expect(result.auditWarning).toContain('没能记进日志')
  })

  it('开关写失败时抛错，不假装打开了', async () => {
    const sb = createFakeWriteSupabase(stoppedTables(), { errorTables: new Set(['clients']) })
    await expect(
      resumeAiRepliesForClient(sb, { clientId: CLIENT_A, actorEmail: STAFF }),
    ).rejects.toBeInstanceOf(KnowledgeKillSwitchError)
  })
})
