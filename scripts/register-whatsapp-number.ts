/**
 * Register a WhatsApp Business number's credentials.
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/register-whatsapp-number.ts --dry-run
 *
 * Default is dry-run: validates inputs and prints what WOULD be written,
 * without connecting to the database. Pass --live to actually write.
 *
 * Inputs are read from the environment (never from argv):
 *   WA_CLIENT_ID          required
 *   WA_PHONE_NUMBER_ID    required
 *   WA_ACCESS_TOKEN       required
 *   WA_APP_SECRET         optional
 *
 * Exit code 1 on invalid input or error, 0 otherwise.
 */

const PHONE_NUMBER_ID_PATTERN = /^[0-9]{1,32}$/

interface ParsedInput {
  clientId: string
  phoneNumberId: string
  accessToken: string
  appSecret?: string
}

function parseInput(): { ok: true; input: ParsedInput } | { ok: false; error: string } {
  const clientId = process.env.WA_CLIENT_ID ?? ''
  const phoneNumberId = process.env.WA_PHONE_NUMBER_ID ?? ''
  const accessToken = process.env.WA_ACCESS_TOKEN ?? ''
  const appSecret = process.env.WA_APP_SECRET

  if (clientId.length === 0) return { ok: false, error: 'WA_CLIENT_ID is required' }
  if (!PHONE_NUMBER_ID_PATTERN.test(phoneNumberId)) {
    return { ok: false, error: 'WA_PHONE_NUMBER_ID must be 1-32 digits' }
  }
  if (accessToken.length === 0) return { ok: false, error: 'WA_ACCESS_TOKEN is required' }
  if (appSecret !== undefined && appSecret.length === 0) {
    return { ok: false, error: 'WA_APP_SECRET, if set, must be non-empty' }
  }

  return {
    ok: true,
    input: {
      clientId,
      phoneNumberId,
      accessToken,
      ...(appSecret !== undefined ? { appSecret } : {}),
    },
  }
}

function printDryRun(input: ParsedInput): void {
  console.log('dry-run: no database writes will occur')
  console.log('would write table: platform_oauth_connections')
  console.log('would write table: whatsapp_app_credentials')
  console.log(`client id: ${input.clientId}`)
  console.log(`phone_number_id: ${input.phoneNumberId}`)
  console.log(`app secret: ${input.appSecret !== undefined ? 'will write' : 'not provided'}`)
}

async function main(): Promise<void> {
  const live = process.argv.includes('--live')

  const parsed = parseInput()
  if (!parsed.ok) {
    console.error(`error: ${parsed.error}`)
    process.exitCode = 1
    return
  }

  if (!live) {
    printDryRun(parsed.input)
    return
  }

  const { registerWhatsAppNumber } = await import('../src/lib/whatsapp/register-number')
  const result = await registerWhatsAppNumber(parsed.input)

  if (result.ok) {
    console.log('ok')
    return
  }

  console.error(result.error)
  process.exitCode = 1
}

void main()
