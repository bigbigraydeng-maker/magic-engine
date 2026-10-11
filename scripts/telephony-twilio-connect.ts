/**
 * 为一个客户生成 Twilio 连接的 SQL（不连库、不写库、不读任何令牌）。
 *
 *   npx tsx scripts/telephony-twilio-connect.ts <client_id> <AccountSid> <令牌所在的环境变量名> <来电转给的员工号码 E.164> [NZ|AU] '{"+6421...":"staff@example.com"}'
 *
 * 账号令牌只放服务器环境变量（Render），库里只存变量名。打印出的 INSERT 要在 PM 同意后由有权限的人执行。
 */

const [clientId, accountSid, secretRef, forwardTo, country = 'NZ', ext = '{}'] = process.argv.slice(2)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
if (!clientId || !UUID.test(clientId) || !/^AC[0-9a-f]{32}$/i.test(accountSid ?? '') || !/^TWILIO_AUTH_TOKEN_[A-Z0-9_]{1,40}$/.test(secretRef ?? '') || !/^\+\d{8,15}$/.test(forwardTo ?? '') || !['NZ', 'AU'].includes(country)) {
  console.error('用法: telephony-twilio-connect.ts <client_id uuid> <AccountSid ACxxxx(32位十六进制)> <ENV_VAR_NAME> <+E164 员工号码> [NZ|AU] [extension_map_json]')
  process.exit(1)
}
const map = JSON.parse(ext) as Record<string, string>
for (const k of Object.keys(map)) {
  if (!/^\+\d{8,15}$/.test(k)) {
    console.error(`员工号码对照的键必须是 E.164：${k}`)
    process.exit(1)
  }
}
const q = (s: string) => `'${s.replace(/'/g, "''")}'`
console.log(
  `insert into public.telephony_connections (client_id, provider, provider_account_id, secret_ref, forward_to, default_country, extension_map)\nvalues (${q(clientId)}, 'twilio', ${q(accountSid)}, ${q(secretRef)}, ${q(forwardTo)}, ${q(country)}, ${q(ext)}::jsonb)\nreturning id;  -- 这个 id 就是回调地址里的 <连接编号>`,
)
