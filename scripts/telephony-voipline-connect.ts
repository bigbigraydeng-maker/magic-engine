/**
 * 为一个客户生成 VoIPLine 连接所需的令牌和 SQL（不连库、不写库）。
 *
 *   npx tsx scripts/telephony-voipline-connect.ts <client_id> <provider_account_id> [NZ|AU] '{"101":"staff@example.com"}'
 *
 * 令牌只在屏幕上显示这一次，填进 VoIPLine 门户的 Secret Token；库里只存它的 SHA-256。
 * 打印出的 INSERT 要在 PM 同意后由有权限的人执行。不要把令牌贴进聊天、文档或提交。
 */

import { generateWebhookToken, hashWebhookToken } from '../src/lib/telephony/voipline/auth'

const [clientId, account, country = 'NZ', ext = '{}'] = process.argv.slice(2)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
if (!clientId || !UUID.test(clientId) || !account || !['NZ', 'AU'].includes(country)) {
  console.error('用法: telephony-voipline-connect.ts <client_id uuid> <provider_account_id> [NZ|AU] [extension_map_json]')
  process.exit(1)
}
JSON.parse(ext)
const q = (s: string) => `'${s.replace(/'/g, "''")}'`
const token = generateWebhookToken()
console.log('--- 令牌（只显示一次，填进 VoIPLine 门户的 Secret Token）---')
console.log(token)
console.log('\n--- SQL（令牌不在里面；PM 同意后执行）---')
console.log(
  `insert into public.telephony_connections (client_id, provider, provider_account_id, webhook_token_hash, default_country, extension_map)\nvalues (${q(clientId)}, 'voipline', ${q(account)}, ${q(hashWebhookToken(token))}, ${q(country)}, ${q(ext)}::jsonb)\nreturning id;  -- 这个 id 就是接收地址里的 <连接编号>`,
)
