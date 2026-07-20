/**
 * Magic Engine Voice Agent — environment config + provider mode resolution.
 *
 * 魏征 #5: mock/real 切换按 provider 独立解析，不用单一全局开关。避免「为测知识库把
 * 开关关成 false，连带把 telephony 切真、拨了真号」的半真半假危险态。
 *
 * 懒加载（不在模块顶层读 env / 建 SDK），符合 CLAUDE.md「SDK 客户端必须在 handler 内部
 * 初始化」。
 */
import { z } from 'zod'

export type ProviderMode = 'real' | 'mock'

export interface ProviderModes {
  openai: ProviderMode
  telephony: ProviderMode
  whatsapp: ProviderMode
}

const EnvSchema = z.object({
  NODE_ENV: z.string().default('development'),
  MOCK_EXTERNAL_SERVICES: z.string().optional(),

  DEFAULT_TIMEZONE: z.string().default('Pacific/Auckland'),
  DEFAULT_COUNTRY: z.string().default('NZ'),

  OPENAI_API_KEY: z.string().optional(),
  OPENAI_PROJECT_ID: z.string().optional(),
  OPENAI_WEBHOOK_SECRET: z.string().optional(),
  OPENAI_REALTIME_MODEL: z.string().default('gpt-realtime-2.1-mini'),
  OPENAI_SUMMARY_MODEL: z.string().default('gpt-4o-mini'),
  OPENAI_KB_MODEL: z.string().default('gpt-4o-mini'),
  OPENAI_DEFAULT_VOICE: z.string().optional(),

  TELEPHONY_PROVIDER: z.string().default('twilio'),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  DEFAULT_HUMAN_TRANSFER_URI: z.string().optional(),

  META_APP_SECRET: z.string().optional(),
  META_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),

  INTERNAL_WORKER_TOKEN: z.string().optional(),
  WEBHOOK_REPLAY_WINDOW_SECONDS: z.coerce.number().default(300),

  // 外呼安全（魏征 #4 / 板桥 #7）
  OUTBOUND_CALLING_ENABLED: z.string().optional(),
  VOICE_TEST_NUMBERS: z.string().optional(), // 逗号分隔的沙盒白名单 E.164

  // 单号首呼兜底：DID 未透传时用此 agent（spec §8.2 step 8）
  VOICE_DEFAULT_AGENT_ID: z.string().optional(),

  VOICE_STORE: z.enum(['auto', 'memory', 'supabase']).default('auto'),
})

export type VoiceEnv = z.infer<typeof EnvSchema>

let cached: VoiceConfig | null = null

export interface VoiceConfig {
  env: VoiceEnv
  isProd: boolean
  providers: ProviderModes
  outboundEnabled: boolean
  testNumbers: string[]
  storeKind: 'memory' | 'supabase'
}

function truthy(v: string | undefined): boolean {
  return v === 'true' || v === '1' || v === 'yes'
}

/** 单个 provider 的真实/mock 判定：全局 mock 开关优先，否则看该 provider 的 key 是否齐。 */
function resolveMode(globalMock: boolean, keysPresent: boolean): ProviderMode {
  if (globalMock) return 'mock'
  return keysPresent ? 'real' : 'mock'
}

export function getVoiceConfig(env: NodeJS.ProcessEnv = process.env): VoiceConfig {
  if (cached) return cached
  const parsed = EnvSchema.parse(env)
  const isProd = parsed.NODE_ENV === 'production'
  const globalMock = truthy(parsed.MOCK_EXTERNAL_SERVICES)

  const providers: ProviderModes = {
    openai: resolveMode(globalMock, Boolean(parsed.OPENAI_API_KEY && parsed.OPENAI_WEBHOOK_SECRET)),
    telephony: resolveMode(globalMock, Boolean(parsed.TWILIO_ACCOUNT_SID && parsed.TWILIO_AUTH_TOKEN)),
    whatsapp: resolveMode(globalMock, Boolean(parsed.WHATSAPP_ACCESS_TOKEN && parsed.META_APP_SECRET)),
  }

  // 生产环境：任一「应为 real」provider 落到 mock → fail fast。
  if (isProd && !globalMock) {
    const missing = Object.entries(providers)
      .filter(([, m]) => m === 'mock')
      .map(([k]) => k)
    if (missing.length > 0) {
      throw new Error(
        `[voice/config] production requires real providers but these fell back to mock: ${missing.join(', ')}. ` +
          `Set the corresponding keys or MOCK_EXTERNAL_SERVICES=true explicitly.`,
      )
    }
  }

  const storeKind: 'memory' | 'supabase' =
    parsed.VOICE_STORE === 'memory'
      ? 'memory'
      : parsed.VOICE_STORE === 'supabase'
        ? 'supabase'
        : env.SUPABASE_SERVICE_ROLE_KEY && env.NEXT_PUBLIC_SUPABASE_URL
          ? 'supabase'
          : 'memory'

  cached = {
    env: parsed,
    isProd,
    providers,
    outboundEnabled: truthy(parsed.OUTBOUND_CALLING_ENABLED),
    testNumbers: (parsed.VOICE_TEST_NUMBERS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    storeKind,
  }
  return cached
}

/** 测试用：清缓存，允许不同 env 重新解析。 */
export function resetVoiceConfigCache(): void {
  cached = null
}
