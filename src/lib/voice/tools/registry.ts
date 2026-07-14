/**
 * Tool Router (spec §10). Uniform interface: zod-validated args, server-injected
 * tenant context (never from model args, 魏征 #1/§17.2), timeout, audit, and
 * PII-minimised / length-capped output. Every invocation is recorded in
 * voice_agent_tool_calls.
 */
import type { ZodType } from 'zod'
import { VoiceError } from '../domain'
import type { AgentRow, TenantRow, VoiceStore } from '../store/types'
import type { BusinessBrain } from '../brain'

export interface ToolExecutionContext {
  store: VoiceStore
  tenant: TenantRow
  agent: AgentRow
  brain: BusinessBrain
  tenantId: string
  clientId: string | null
  agentId: string
  callId: string
  contactId?: string | null
  leadId?: string | null
  locale: string
  timezone: string
  requestId?: string
}

/** A control directive the realtime session must act on after the tool returns. */
export interface ToolControl {
  action: 'transfer' | 'hangup'
  targetUri?: string
  reason?: string
}

export interface ToolResult {
  output: Record<string, unknown>
  control?: ToolControl
}

export interface ToolDefinition<TArgs = unknown> {
  name: string
  description: string
  schema: ZodType<TArgs>
  jsonSchema: Record<string, unknown> // OpenAI realtime function tool definition
  requiresConfirmation: boolean | ((args: TArgs) => boolean)
  execute(ctx: ToolExecutionContext, args: TArgs): Promise<ToolResult>
}

const MUTATING_TOOLS = new Set(['create_or_update_lead', 'transfer_to_human', 'schedule_callback', 'end_call'])
const DEFAULT_TIMEOUT_MS = 15_000
const MAX_OUTPUT_CHARS = 2_000

function sanitizeOutput(output: Record<string, unknown>): Record<string, unknown> {
  const json = JSON.stringify(output)
  if (json.length <= MAX_OUTPUT_CHARS) return output
  return { ...output, _truncated: true, _note: 'result truncated for spoken response' }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new VoiceError('TOOL_TIMEOUT', `tool timed out after ${ms}ms`)), ms)
    p.then((v) => { clearTimeout(t); resolve(v) }, (e) => { clearTimeout(t); reject(e) })
  })
}

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition<any>>()

  register(def: ToolDefinition<any>): void {
    this.tools.set(def.name, def)
  }
  get(name: string): ToolDefinition<any> | undefined { return this.tools.get(name) }
  has(name: string): boolean { return this.tools.has(name) }

  /** OpenAI realtime tool schemas for the tools this agent has enabled. */
  schemasFor(enabledTools: string[]): Record<string, unknown>[] {
    return enabledTools.map((n) => this.tools.get(n)?.jsonSchema).filter(Boolean) as Record<string, unknown>[]
  }

  /**
   * Run a tool by name. Records a voice_agent_tool_calls row and always returns a
   * ToolResult — validation/exec errors become a safe structured output the agent
   * can speak around (never raw DB/API text; spec §18).
   */
  async run(
    ctx: ToolExecutionContext,
    toolName: string,
    rawArgs: unknown,
    openaiToolCallId?: string,
  ): Promise<ToolResult> {
    const def = this.tools.get(toolName)
    const start = Date.now()

    // gate: agent must have the tool enabled
    if (!def || !ctx.agent.enabled_tools.includes(toolName)) {
      await this.recordFailed(ctx, toolName, rawArgs, openaiToolCallId, 'tool not available')
      return { output: { error: true, message: 'That capability is not available on this call.' } }
    }

    const parsed = def.schema.safeParse(rawArgs)
    if (!parsed.success) {
      await this.recordFailed(ctx, toolName, rawArgs, openaiToolCallId, `invalid args: ${parsed.error.message}`)
      return { output: { error: true, message: 'I did not get the details I needed for that — could you repeat them?' } }
    }
    const args = parsed.data

    const requiresConfirmation =
      typeof def.requiresConfirmation === 'function' ? def.requiresConfirmation(args) : def.requiresConfirmation

    const rowIns = await ctx.store.createToolCall({
      tenant_id: ctx.tenantId,
      call_id: ctx.callId,
      agent_id: ctx.agentId,
      openai_tool_call_id: openaiToolCallId ?? null,
      tool_name: toolName,
      arguments: args as Record<string, unknown>,
      status: 'running',
      result: null,
      error: null,
      latency_ms: null,
      requires_confirmation: requiresConfirmation,
      confirmed_at: requiresConfirmation ? null : new Date().toISOString(),
    })

    try {
      const result = await withTimeout(def.execute(ctx, args), DEFAULT_TIMEOUT_MS)
      const safe = sanitizeOutput(result.output)
      await ctx.store.updateToolCall(rowIns.id, {
        status: 'completed', result: safe, latency_ms: Date.now() - start,
      })
      if (MUTATING_TOOLS.has(toolName)) {
        await ctx.store.audit({
          tenant_id: ctx.tenantId, actor_type: 'agent', actor_id: ctx.agentId,
          operation: toolName, resource_type: 'tool_call', resource_id: rowIns.id,
          changes: args as Record<string, unknown>, call_id: ctx.callId, request_id: ctx.requestId,
        })
      }
      return { output: safe, control: result.control }
    } catch (err) {
      const code = err instanceof VoiceError ? err.code : 'PROVIDER_UNAVAILABLE'
      await ctx.store.updateToolCall(rowIns.id, {
        status: 'failed', error: `${code}: ${(err as Error).message}`, latency_ms: Date.now() - start,
      })
      return { output: { error: true, message: 'I hit a problem doing that. I can have a colleague follow up with you.' } }
    }
  }

  private async recordFailed(
    ctx: ToolExecutionContext, toolName: string, rawArgs: unknown, openaiToolCallId: string | undefined, error: string,
  ): Promise<void> {
    try {
      await ctx.store.createToolCall({
        tenant_id: ctx.tenantId, call_id: ctx.callId, agent_id: ctx.agentId,
        openai_tool_call_id: openaiToolCallId ?? null, tool_name: toolName,
        arguments: (rawArgs ?? {}) as Record<string, unknown>, status: 'failed',
        result: null, error, latency_ms: 0, requires_confirmation: false, confirmed_at: null,
      })
    } catch { /* best effort */ }
  }
}
