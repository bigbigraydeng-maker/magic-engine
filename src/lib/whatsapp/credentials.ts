import { supabaseAdmin } from '@/lib/supabase'
import { decryptToken } from '@/lib/platform-oauth/vocabulary'

export type WhatsAppCredentials = {
  accessToken: string
  phoneNumberId: string
  source: 'connection' | 'env'
}

export type WhatsAppCredentialsResult =
  | { ok: true; credentials: WhatsAppCredentials }
  | { ok: false; error: string }

type ConnectionRow = {
  status: string | null
  access_token_enc: string | null
}

export async function resolveWhatsAppCredentials(
  clientId: string,
  ownedNumberId: string,
): Promise<WhatsAppCredentialsResult> {
  let row: ConnectionRow | null = null
  let queryFailed = false

  try {
    const { data, error } = await supabaseAdmin
      .from('platform_oauth_connections')
      .select('status, access_token_enc')
      .eq('client_id', clientId)
      .eq('provider', 'whatsapp')
      .eq('account_id', ownedNumberId)
      .maybeSingle()

    if (error) {
      queryFailed = true
    } else {
      row = (data as ConnectionRow | null) ?? null
    }
  } catch {
    queryFailed = true
  }

  if (!queryFailed && row) {
    if (row.status !== 'active') {
      return {
        ok: false,
        error: '这个号码的 WhatsApp 授权已停用，不能发送，请重新连接',
      }
    }

    let accessToken: string | null = null
    try {
      accessToken = decryptToken(row.access_token_enc ?? '')
    } catch {
      console.error('[whatsapp/credentials] token decrypt failed')
      return {
        ok: false,
        error: '这个号码的 WhatsApp 令牌读不出来，不能发送，请重新连接',
      }
    }

    if (!accessToken) {
      console.error('[whatsapp/credentials] token decrypt failed')
      return {
        ok: false,
        error: '这个号码的 WhatsApp 令牌读不出来，不能发送，请重新连接',
      }
    }

    return {
      ok: true,
      credentials: {
        accessToken,
        phoneNumberId: ownedNumberId,
        source: 'connection',
      },
    }
  }

  const token = process.env.WHATSAPP_ACCESS_TOKEN
  const envNumber = process.env.WHATSAPP_PHONE_NUMBER_ID

  if (!token || !envNumber) {
    return { ok: false, error: 'WhatsApp 授权未配置，无法发送' }
  }

  if (envNumber !== ownedNumberId) {
    return {
      ok: false,
      error:
        '这个客户的 WhatsApp 号码跟当前配置的发送号码不一致，已阻止发送（避免用别的客户号码发给客人）',
    }
  }

  return {
    ok: true,
    credentials: {
      accessToken: token,
      phoneNumberId: ownedNumberId,
      source: 'env',
    },
  }
}
