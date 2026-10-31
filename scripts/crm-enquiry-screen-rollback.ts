/**
 * 一键回退「机器筛选判成非咨询」的人。默认只演练（只说「将还原 M 人」，不写库）。
 * 设计稿：docs/specs/2026-10-29-crm-enquiry-screen-runner-v0.md §7 P2
 *
 *   node --env-file=/path/.env.local node_modules/tsx/dist/cli.mjs scripts/crm-enquiry-screen-rollback.ts \
 *     --client <clientId> [--apply]
 *
 * 只还原「当前仍是非咨询、且最近一条阶段变更是 ai:enquiry-screen 写的」的人；
 * 事后被人改过的不动。--apply 才真的写。
 */

import { supabaseAdmin as sb } from '@/lib/supabase'
import { rollbackScreenedContacts } from '@/lib/crm/enquiry-screen/rollback'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

async function main(): Promise<void> {
  const clientId = arg('client')
  if (!clientId) {
    console.error('必须传 --client <clientId>')
    process.exit(1)
  }
  const apply = process.argv.includes('--apply')
  const r = await rollbackScreenedContacts(sb, clientId, { apply })
  console.log(`${apply ? '已还原' : '演练：将还原'} ${apply ? r.restored : r.planned} 人（符合条件 ${r.planned}，写库时被别人改过跳过 ${r.skipped}）`)
  for (const it of r.items) console.log(`  ${it.contactId} → ${it.restoreTo ?? '（空）'}`)
}

void main()
