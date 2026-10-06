/**
 * Roman 两批观测对比（放在 scripts/ 里能找到项目依赖）
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { createClient } from '@supabase/supabase-js'

const ROMAN_CLIENT_ID = 'e7465ac7-4f3d-4d6a-afbe-d036ab419708'
const OLD_BATCH = '688bd8ae-2db6-4300-b761-b850f30c32c5'
const NEW_BATCH = '41952296-9d26-458a-92f0-250200985f3a'

function loadEnv(): Record<string, string> {
  const raw = readFileSync(join(process.cwd(), '.env.local'), 'utf8')
  const env: Record<string, string> = {}
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    env[key] = val
  }
  return env
}

async function fetchBatchDetails(sb: any, batchId: string) {
  const { data: obs, error: obsErr } = await sb
    .from('geo_observations')
    .select('*')
    .eq('client_id', ROMAN_CLIENT_ID)
    .eq('batch_id', batchId)
    .order('observed_at', { ascending: true })

  if (obsErr) throw obsErr

  const obsIds = (obs || []).map((o: any) => o.id)
  const { data: evid, error: evidErr } = await sb.from('geo_evidence').select('*').in('observation_id', obsIds)

  if (evidErr) throw evidErr

  const evidMap = new Map()
  for (const e of evid || []) {
    evidMap.set(e.observation_id, e)
  }

  return { observations: obs || [], evidenceMap: evidMap }
}

function line(s = ''): void {
  process.stdout.write(s + '\n')
}

async function main() {
  const env = loadEnv()
  const url = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) throw new Error('缺 Supabase 凭据')

  const sb = createClient(url, key, { auth: { persistSession: false } })

  line('╭─ Roman 两批观测对比 ─────────────────────────────────')
  line('│')

  const old = await fetchBatchDetails(sb, OLD_BATCH)
  const newData = await fetchBatchDetails(sb, NEW_BATCH)

  old.observations.sort((a: any, b: any) => (a.query_key || '').localeCompare(b.query_key || ''))
  newData.observations.sort((a: any, b: any) => (a.query_key || '').localeCompare(b.query_key || ''))

  line(`│ 旧批次 ${OLD_BATCH.slice(0, 8)}... (2026-08-12 基线)`)
  line(`│ ─────────────────────────────────────────────────────`)
  for (const obs of old.observations) {
    const evid = old.evidenceMap.get(obs.id)
    const cited = evid?.cited_domains || []
    const entityKind = obs.entity_match?.kind || 'unknown'
    const qualified = obs.qualified_mention?.qualified ? '✓' : '✗'
    const citatText = cited.length > 0 ? cited.slice(0, 2).join(', ') : '-'
    line(
      `│   ${(obs.query_key || 'unknown').slice(0, 12)}... ${qualified} entity=${entityKind} cited=[${citatText}${cited.length > 2 ? '...' : ''}]`,
    )
  }

  line(`│`)
  line(`│ 新批次 ${NEW_BATCH.slice(0, 8)}... (2026-09-28)`)
  line(`│ ─────────────────────────────────────────────────────`)
  for (const obs of newData.observations) {
    const evid = newData.evidenceMap.get(obs.id)
    const cited = evid?.cited_domains || []
    const entityKind = obs.entity_match?.kind || 'unknown'
    const qualified = obs.qualified_mention?.qualified ? '✓' : '✗'
    const citatText = cited.length > 0 ? cited.slice(0, 2).join(', ') : '-'
    line(
      `│   ${(obs.query_key || 'unknown').slice(0, 12)}... ${qualified} entity=${entityKind} cited=[${citatText}${cited.length > 2 ? '...' : ''}]`,
    )
  }

  line(`│`)
  line(`│ 变化汇总`)
  line(`│ ─────────────────────────────────────────────────────`)

  const oldQualified = old.observations.filter((o: any) => o.qualified_mention?.qualified).length
  const newQualified = newData.observations.filter((o: any) => o.qualified_mention?.qualified).length

  line(`│   合格提及观测：${oldQualified} → ${newQualified} (+${newQualified - oldQualified})`)

  const oldQualKeys = new Set(
    old.observations.filter((o: any) => o.qualified_mention?.qualified).map((o: any) => o.query_key),
  )
  const newQualKeys = newData.observations
    .filter((o: any) => o.qualified_mention?.qualified)
    .map((o: any) => o.query_key)
  const deltaKeys = newQualKeys.filter((k: any) => !oldQualKeys.has(k))

  if (deltaKeys.length > 0) {
    line(`│`)
    line(`│   新增合格提及的引用源：`)
    for (const key of deltaKeys) {
      const obs = newData.observations.find((o: any) => o.query_key === key)
      const evid = newData.evidenceMap.get(obs.id)
      const cited = evid?.cited_domains || []
      line(`│     · query_key=${(key || 'unknown').slice(0, 12)}...`)
      line(`│       sources: ${cited.length > 0 ? cited.join(', ') : '(direct answer)'}`)
    }
  }

  line(`│`)
  line('╰─────────────────────────────────────────────────────')
}

main().catch((err) => {
  console.error('❌', err.message)
  process.exit(1)
})
