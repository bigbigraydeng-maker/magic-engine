/**
 * Register a WhatsApp Business number's credentials.
 *
 * Writes two things:
 *  1. A platform_oauth_connections row (via upsertConnection) holding the
 *     number's access token — encrypted at rest by the connection store.
 *  2. Optionally, a whatsapp_app_credentials row holding the app secret —
 *     encrypted here before it hits the DB.
 *
 * Fails closed: any validation or DB failure returns { ok:false, error }.
 * Error strings are short, English, and NEVER contain the token, the app
 * secret, or any ciphertext.
 */

import { supabaseAdmin } from '@/lib/supabase'
import { upsertConnection } from '@/lib/platform-oauth/connection-store'
import { encryptToken, PLATFORM_PROVIDERS } from '@/lib/platform-oauth/vocabulary'

export type RegisterWhatsAppNumberInput = {
  clientId: string
  phoneNumberId: string
  accessToken: string
  appSecret?: string
}

export type RegisterWhatsAppNumberResult =
  | { ok: true; wroteAppSecret: boolean }
  | { ok: false; error: string }

const PHONE_NUMBER_ID_PATTERN = /^[0-9]{1,32}$/

/** Far-future expiry: WhatsApp number tokens do not carry a usable expiry. */
const WHATSAPP_TOKEN_EXPIRY = new Date('2099-12-31T00:00:00.000Z')

function isValidInput(input: RegisterWhatsAppNumberInput): boolean {
  if (!PHONE_NUMBER_ID_PATTERN.test(input.phoneNumberId)) return false
  if (input.accessToken.length === 0) return false
  if (input.appSecret !== undefined && input.appSecret.length === 0) return false
  return true
}

/**
 * Confirm the client row exists and is bound to this exact phone number.
 * Returns true only when the binding matches.
 */
async function isClientBoundToNumber(clientId: string, phoneNumberId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('whatsapp_phone_number_id')
    .eq('id', clientId)
    .maybeSingle()

  if (error || !data) return false
  return data.whatsapp_phone_number_id === phoneNumberId
}

/** Store the app secret, encrypted, keyed by phone_number_id. */
async function storeAppSecret(phoneNumberId: string, appSecret: string): Promise<boolean> {
  try {
    const { error } = await supabaseAdmin
      .from('whatsapp_app_credentials')
      .upsert(
        {
          phone_number_id: phoneNumberId,
          app_secret_enc: encryptToken(appSecret),
          status: 'active',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'phone_number_id' },
      )
    return !error
  } catch {
    return false
  }
}

export async function registerWhatsAppNumber(
  input: RegisterWhatsAppNumberInput,
): Promise<RegisterWhatsAppNumberResult> {
  if (!isValidInput(input)) {
    return { ok: false, error: 'invalid input' }
  }

  const bound = await isClientBoundToNumber(input.clientId, input.phoneNumberId)
  if (!bound) {
    return { ok: false, error: 'client is not bound to this phone number' }
  }

  try {
    await upsertConnection({
      clientId: input.clientId,
      provider: PLATFORM_PROVIDERS.WHATSAPP,
      accessToken: input.accessToken,
      refreshToken: 'not-applicable',
      tokenExpiry: WHATSAPP_TOKEN_EXPIRY,
      accountId: input.phoneNumberId,
      displayName: `WhatsApp ${input.phoneNumberId}`,
      scopes: ['whatsapp_business_messaging'],
      lastSyncedAt: new Date(),
    })
  } catch {
    return { ok: false, error: 'failed to store token' }
  }

  if (input.appSecret !== undefined) {
    const stored = await storeAppSecret(input.phoneNumberId, input.appSecret)
    if (!stored) {
      return { ok: false, error: 'token stored but failed to store app secret; rerun to retry (writes are idempotent)' }
    }
  }

  return { ok: true, wroteAppSecret: Boolean(input.appSecret) }
}
