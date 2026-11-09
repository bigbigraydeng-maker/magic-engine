import { callClaudeChat, MODEL_HAIKU } from '@/lib/anthropic/client'

const SMART_ACK_TIMEOUT_MS = 8000

/** One Haiku call, single attempt, hard 8s timeout. Throws on any failure (composeAck degrades). */
export async function callSmartAckModel(input: { system: string; user: string }): Promise<string> {
  const res = await callClaudeChat({
    systemPrompt: input.system,
    messages: [{ role: 'user', content: input.user }],
    model: MODEL_HAIKU,
    singleAttempt: true,
    maxOutputTokens: 200,
    timeoutMs: SMART_ACK_TIMEOUT_MS,
  })
  return res.text
}
