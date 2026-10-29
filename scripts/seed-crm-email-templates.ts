/**
 * 把「通话后跟进信」种子模板写进库——**默认只干跑**（不连数据库，只检查并打印）。
 * 设计稿：docs/specs/2026-10-28-crm-post-call-email-templates-design-v0.md §12
 *
 *   干跑：  npx tsx scripts/seed-crm-email-templates.ts --seed cts
 *   写库：  node --env-file=<.env.local> node_modules/tsx/dist/cli.mjs scripts/seed-crm-email-templates.ts \
 *             --seed cts --client <客户 UUID> --apply --pm-approved
 *
 * 🔴 写库 = 写生产数据，需要 PM 单独点头；没点头不要加 --pm-approved。
 * 写进去的模板都是**停用**状态；已存在的模板键会跳过，不会覆盖。
 */

import { SEED_SETS, checkSeeds, parseSeedArgs } from './crm-email-template-seeds/plan'

async function apply(seed: string, clientId: string): Promise<number> {
  // 只有真的写库时才加载数据库客户端，干跑不需要任何密钥
  const { supabaseAdmin } = await import('@/lib/supabase')
  const { appendTemplateVersion } = await import('@/lib/crm/email-templates/template-store')
  let failures = 0
  for (const t of SEED_SETS[seed]) {
    const result = await appendTemplateVersion(supabaseAdmin, {
      clientId,
      templateKey: t.templateKey,
      baseVersion: null,
      ...t.fields,
      createdBy: 'hello@magicengine.cloud',
    })
    if (result.ok) console.log(`  ✓ 已写入 ${t.templateKey}（版本 ${result.value.version}，停用）`)
    else if (result.reason === 'conflict') console.log(`  – ${t.templateKey} 已存在，跳过（不覆盖）`)
    else {
      failures += 1
      console.log(`  ✗ ${t.templateKey} 写入失败：${result.message}`)
    }
  }
  return failures
}

async function main(): Promise<void> {
  const args = parseSeedArgs(process.argv.slice(2))
  if (!args.ok) {
    console.error(args.error)
    process.exit(2)
  }
  const checks = checkSeeds(args.seed)
  console.log(`种子「${args.seed}」：${checks.length} 份模板（写入时都是停用状态）`)
  for (const c of checks) {
    console.log(`  ${c.ok ? '✓' : '✗'} ${c.templateKey}`)
    for (const e of c.errors) console.log(`      错误：${e}`)
    for (const n of c.notices) console.log(`      提醒：${n}`)
  }
  if (checks.some((c) => !c.ok)) process.exit(1)
  if (!args.apply || args.clientId === null) {
    console.log('干跑结束：没有连数据库，没有写任何东西。')
    return
  }
  console.log(`写库：客户 ${args.clientId}`)
  const failures = await apply(args.seed, args.clientId)
  process.exit(failures === 0 ? 0 : 1)
}

void main()
