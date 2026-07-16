/**
 * Assisted Bilingual Outbound — translation / sensitive-content detection.
 * (docs/voice-agent/assisted-bilingual-outbound.md · Phase 36.B)
 *
 * Paradigm-independent: the operator's speech (already STT'd to text) is turned into
 * the target-language line the AI will speak. Two modes:
 *   - manual: faithful translation of exactly what the operator said
 *   - mix:    KB-assisted answer composed from operator intent + retrieved facts
 *
 * Provider is mock (deterministic, for tests/local) or OpenAI (real). The final
 * "speak it on the call" hop is separate and pending the verbatim spike.
 */
import { getVoiceConfig } from '../config'

export type AssistedMode = 'manual' | 'mix'

/** Sensitive content that must be operator-confirmed before it's spoken (魏征 #1/#5). */
const PRICE_RE = /\b(price|prices|pricing|cost|costs|quote|how much|fee|fees|discount|availab|in stock|stock|slot|book(ing)?)\b/i
const PROMISE_RE = /\b(guarantee|guaranteed|promise|free|refund|deposit|deadline|deliver(y)?|warranty)\b/i
// Err toward over-detection: a false positive just asks the operator to confirm (safe);
// a miss lets an un-approved price/promise reach the customer (魏征 #1, unsafe).
const ZH_SENSITIVE = /(价格|价钱|价位|报价|团价|报.{0,3}价|多少\s*[钱价费块万千]|几[千万百]|块钱|折扣|优惠|保证|承诺|免费|退款|定金|押金|交期|包邮|库存|成团)/
const NUMBERISH = /(\$|¥|€|£|NZ\$|AU\$|US\$|\d[\d,\.]*\s*(pp|per person|每人|元|块|万|千|%|percent))|(\d{2,})/i

export interface SensitiveCheck {
  requiresConfirm: boolean
  reasons: string[]
}

/** Detect price / promise / number content in either the source (zh) or target (en). */
export function detectSensitive(sourceZh: string, targetEn: string): SensitiveCheck {
  const reasons: string[] = []
  if (PRICE_RE.test(targetEn) || ZH_SENSITIVE.test(sourceZh)) reasons.push('price/availability')
  if (PROMISE_RE.test(targetEn)) reasons.push('promise/commitment')
  if (NUMBERISH.test(targetEn) || NUMBERISH.test(sourceZh)) reasons.push('number/amount')
  return { requiresConfirm: reasons.length > 0, reasons }
}

export interface Translator {
  readonly simulated: boolean
  /** manual mode — faithful translation, no added content. */
  translate(zh: string, targetLang: string): Promise<string>
  /** mix mode — compose a target-language reply from operator intent + KB facts. */
  assist(intentZh: string, kbContext: string, targetLang: string): Promise<string>
}

/** Deterministic mock — proves the pipeline without a key. Uses a small demo phrasebook. */
export class MockTranslator implements Translator {
  readonly simulated = true
  private book: Record<string, string> = {
    '谢谢您还记得！我们十月有一个北京西安的家庭团': 'Thank you for remembering! We have a Beijing–Xi’an family tour running in October.',
    '我让顾问给您准确报价，不同日期价格不一样': 'Pricing varies by date, so I’ll have our consultant send you an exact quote.',
    '好的，我明天让顾问联系您': 'Great — our consultant will be in touch tomorrow.',
  }
  async translate(zh: string, _targetLang = 'English'): Promise<string> {
    return this.book[zh.trim()] ?? `[EN] ${zh}` // clearly-marked placeholder for un-scripted lines
  }
  async assist(intentZh: string, kbContext: string, _targetLang = 'English'): Promise<string> {
    const facts = kbContext ? ` (based on: ${kbContext.slice(0, 80)})` : ''
    return `[EN·assist] ${intentZh}${facts}`
  }
}

/** Real translator over the OpenAI text model. */
export class OpenAITranslator implements Translator {
  readonly simulated = false
  private async chat(system: string, user: string): Promise<string> {
    const cfg = getVoiceConfig()
    const { default: OpenAI } = await import('openai')
    const client = new OpenAI({ apiKey: cfg.env.OPENAI_API_KEY })
    const res = await client.responses.create({
      model: cfg.env.OPENAI_SUMMARY_MODEL,
      input: [{ role: 'system', content: system }, { role: 'user', content: user }],
    } as Parameters<typeof client.responses.create>[0])
    return ((res as { output_text?: string }).output_text ?? '').trim()
  }
  translate(zh: string, targetLang: string): Promise<string> {
    return this.chat(
      `You are a faithful interpreter for a live sales call. Translate the operator's message into ${targetLang}. ` +
        `Translate ONLY — add nothing, invent nothing, keep every number and negation exact. Output only the translation.`,
      zh,
    )
  }
  assist(intentZh: string, kbContext: string, targetLang: string): Promise<string> {
    return this.chat(
      `You draft one short ${targetLang} sales-call line for a human operator to approve. Use ONLY the operator's intent ` +
        `and the approved facts below — never invent prices, availability, or promises. If facts are missing, say you will confirm.\n\nApproved facts:\n${kbContext || '(none)'}`,
      intentZh,
    )
  }
}

export function getTranslator(): Translator {
  return getVoiceConfig().providers.openai === 'real' ? new OpenAITranslator() : new MockTranslator()
}
