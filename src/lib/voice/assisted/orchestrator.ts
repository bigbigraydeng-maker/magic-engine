/**
 * Assisted-outbound orchestrator (Phase 36.B). Turns one operator utterance (already
 * STT'd to text) into the target-language line the AI should speak, plus a guard flag.
 *
 * manual → faithful translation. mix → KB-assisted answer (price/availability facts
 * auto-flagged for operator confirmation, 魏征 #1). Either way, price/number/promise
 * content sets requiresConfirm so the operator approves before it is spoken.
 */
import { searchKnowledge } from '../knowledge'
import type { ToolExecutionContext } from '../tools/registry'
import { detectSensitive, getTranslator, type AssistedMode } from './translator'

export interface OperatorTurnInput {
  text: string // operator speech, transcribed to text (Chinese)
  mode: AssistedMode
  targetLang?: string // caller's language, default English
}

export interface OperatorTurnResult {
  mode: AssistedMode
  sourceText: string
  englishToSpeak: string
  requiresConfirm: boolean
  reasons: string[]
  kbSources: { document_id: string; title: string }[]
  kbConfidence?: 'high' | 'medium' | 'low'
}

export async function processOperatorTurn(
  ctx: ToolExecutionContext,
  input: OperatorTurnInput,
): Promise<OperatorTurnResult> {
  const targetLang = input.targetLang ?? 'English'
  const translator = getTranslator()
  const text = input.text.trim()

  if (input.mode === 'manual') {
    const englishToSpeak = await translator.translate(text, targetLang)
    const sens = detectSensitive(text, englishToSpeak)
    return {
      mode: 'manual', sourceText: text, englishToSpeak,
      requiresConfirm: sens.requiresConfirm, reasons: sens.reasons, kbSources: [],
    }
  }

  // mix: pull approved facts, compose, then guard
  const kb = await searchKnowledge(ctx, { query: text, category: null, language: 'zh' })
  const englishToSpeak = await translator.assist(text, kb.answer_context, targetLang)
  const sens = detectSensitive(text, englishToSpeak)
  const reasons = [...sens.reasons]
  if (kb.requires_human_verification) reasons.push('kb: needs human verification')
  return {
    mode: 'mix', sourceText: text, englishToSpeak,
    requiresConfirm: sens.requiresConfirm || kb.requires_human_verification,
    reasons,
    kbSources: kb.sources.map((s) => ({ document_id: s.document_id, title: s.title })),
    kbConfidence: kb.confidence,
  }
}
