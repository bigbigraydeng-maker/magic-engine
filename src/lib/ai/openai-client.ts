/**
 * OpenAI client factory — routes through Cloudflare AI Gateway for observability.
 * Use getOpenAIClient() inside request handlers only (per CLAUDE.md convention).
 *
 * CF Gateway URL: https://gateway.ai.cloudflare.com/v1/{account}/{gateway}/openai
 * All requests are logged in the AI Gateway dashboard automatically.
 *
 * If CF_AIG_TOKEN is set, sends cf-aig-authorization header (required when the
 * Gateway is configured as "Authenticated" in the Cloudflare dashboard).
 * Without the token an Authenticated Gateway returns 401 on every call.
 */

import OpenAI from 'openai'

const CF_ACCOUNT_ID = 'bbd84393da8e5707ba617749dc17117c'
const CF_GATEWAY_ID = 'magic-engine'
const CF_GATEWAY_BASE = `https://gateway.ai.cloudflare.com/v1/${CF_ACCOUNT_ID}/${CF_GATEWAY_ID}/openai`

export function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is not set')
  }
  const aigToken = process.env.CF_AIG_TOKEN
  return new OpenAI({
    apiKey,
    baseURL: CF_GATEWAY_BASE,
    defaultHeaders: aigToken ? { 'cf-aig-authorization': `Bearer ${aigToken}` } : undefined,
  })
}
