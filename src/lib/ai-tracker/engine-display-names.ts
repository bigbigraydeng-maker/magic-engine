/**
 * AI Tracker engine internal codes → client-facing display names.
 *
 * Per CLAUDE.md §三, real third-party vendor names (OpenAI / ChatGPT / Anthropic /
 * Claude / Perplexity / Google) must never appear in UI, client reports, or
 * customer-visible error messages. Keep the internal codes in the database and
 * code paths; route every UI render through the helpers below.
 */

export const ENGINE_DISPLAY_NAMES: Record<string, string> = {
  openai: 'Content Engine',
  anthropic: 'Strategy Engine',
  perplexity: 'Discovery Engine',
  google: 'Search AI Engine',
};

export function getEngineDisplayName(engine: string): string {
  return ENGINE_DISPLAY_NAMES[engine.toLowerCase()] ?? engine;
}
