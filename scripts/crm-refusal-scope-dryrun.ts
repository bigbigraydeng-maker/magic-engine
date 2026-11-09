/**
 * 只读试跑：把「别再联系」的存量备注按新规则（refusal-scope）重判一遍，打印表格。
 * 不连库、不写任何数据。用法：npx tsx scripts/crm-refusal-scope-dryrun.ts <notes.json>
 * notes.json = [{ id, name, stage, raw }]
 */
import { readFileSync } from 'node:fs'
import { classifyRefusalScope } from '../src/lib/crm/refusal-scope'

interface Row { id: string; name: string; stage: string | null; raw: string }

const path = process.argv[2]
if (!path) {
  console.error('usage: tsx scripts/crm-refusal-scope-dryrun.ts <notes.json>')
  process.exit(1)
}
const rows = JSON.parse(readFileSync(path, 'utf8')) as Row[]
const label = { phone_only: '只别打电话', all: '别再联系（不变）', needs_review: '请人看一眼', none: '不是拒绝' } as const
const counts: Record<string, number> = {}
for (const r of rows) {
  const s = classifyRefusalScope(r.raw)
  counts[s] = (counts[s] ?? 0) + 1
  console.log(`${s.padEnd(13)} ${label[s].padEnd(14)} ${r.id} ${r.name.padEnd(22)} ${(r.stage ?? '-').padEnd(13)} ${r.raw}`)
}
console.log('\n合计', rows.length, JSON.stringify(counts))
