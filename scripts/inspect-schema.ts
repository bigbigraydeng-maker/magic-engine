import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'

const env: Record<string, string> = {}
const raw = readFileSync('.env.local', 'utf8')
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

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

;(async () => {
  const { data, error } = await sb
    .from('geo_observations')
    .select('*')
    .eq('client_id', 'e7465ac7-4f3d-4d6a-afbe-d036ab419708')
    .eq('batch_id', '688bd8ae-2db6-4300-b761-b850f30c32c5')
    .limit(1)

  if (error) {
    console.error('查询失败:', error)
    process.exit(1)
  }

  if (data && data[0]) {
    console.log('geo_observations 表字段：')
    for (const key of Object.keys(data[0]).sort()) {
      const val = data[0][key as keyof typeof data[0]]
      const typeStr = Array.isArray(val) ? 'array' : typeof val
      let preview = ''
      if (val !== null) {
        if (typeof val === 'object') {
          preview = JSON.stringify(val).slice(0, 100)
        } else if (typeof val === 'string') {
          preview = val.slice(0, 50)
        } else {
          preview = String(val)
        }
      }
      console.log(`  ${key}: ${typeStr}${preview ? ' = ' + preview : ''}`)
    }
  } else {
    console.log('没有数据')
  }

  process.exit(0)
})()
