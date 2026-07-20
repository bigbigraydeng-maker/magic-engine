/** Realtime provider factory — picks openai vs mock by per-provider config (魏征 #5). */
import { getVoiceConfig } from '../config'
import { MockRealtimeProvider } from './mock'
import { OpenAIRealtimeProvider } from './openai'
import type { RealtimeProvider } from './types'

export * from './types'
export { MockRealtimeProvider } from './mock'
export { OpenAIRealtimeProvider } from './openai'
export { signWebhook, computeSignature } from './webhook-sign'

let injected: RealtimeProvider | null = null
let mockSingleton: MockRealtimeProvider | null = null
let realSingleton: OpenAIRealtimeProvider | null = null

/** Tests inject a specific provider (usually a fresh MockRealtimeProvider). */
export function setRealtimeProvider(p: RealtimeProvider | null): void { injected = p }

export function getMockProvider(): MockRealtimeProvider {
  if (!mockSingleton) mockSingleton = new MockRealtimeProvider()
  return mockSingleton
}

export function getRealtimeProvider(): RealtimeProvider {
  if (injected) return injected
  const cfg = getVoiceConfig()
  if (cfg.providers.openai === 'real') {
    if (!realSingleton) realSingleton = new OpenAIRealtimeProvider()
    return realSingleton
  }
  return getMockProvider()
}
