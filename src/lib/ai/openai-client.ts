/**
 * OpenAI client factory — routes through Cloudflare AI Gateway for observability.
 * Use getOpenAIClient() inside request handlers only (per CLAUDE.md convention).
 *
 * CF Gateway URL: https://gateway.ai.cloudflare.com/v1/{account}/{gateway}/openai
 * All requests are logged in the AI Gateway dashboard automatically.
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
  // CF AI Gateway Authenticated mode requires a cf-aig-authorization header.
  // When CF_AIG_TOKEN is unset, omit the header (gateway must then be unauthenticated).
  const aigToken = process.env.CF_AIG_TOKEN
  const defaultHeaders = aigToken ? { 'cf-aig-authorization': `Bearer ${aigToken}` } : undefined
  return new OpenAI({ apiKey, baseURL: CF_GATEWAY_BASE, defaultHeaders })
}
