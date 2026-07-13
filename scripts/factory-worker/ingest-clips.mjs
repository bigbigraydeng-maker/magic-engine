#!/usr/bin/env node
// P21.J B4 — 真实素材灌库(存储决策 spec 的单向同步:Dropbox/本地 → Supabase video_clips)。
// 上传到 content-factory/clips/{a-real|b-generated}/{client}/,路径遵 validateClipPath 正门约定
// (魏征红线:入库走正门不开旁路)。source_meta.origin 幂等,重跑不重插。
//
// 用法:  SB_KEY=<service_role> node ingest-clips.mjs <client_id> <dir> <track>
//   track = a_real | b_generated

import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { basename, extname, join } from 'node:path'

/** ffprobe 取真实时长(video_clips.duration_seconds NOT NULL);取不到退 5s */
function probeDuration(p) {
  try {
    const out = execFileSync('/usr/local/bin/ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p]).toString().trim()
    const d = Number(out)
    return Number.isFinite(d) && d > 0 ? Math.round(d * 100) / 100 : 5
  } catch { return 5 }
}

const [clientId, dir, track] = process.argv.slice(2)
const SB_KEY = process.env.SB_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
const REF = process.env.SB_REF || 'glbdnayojixmexgofbsd'

if (!clientId || !dir || !track) { console.error('用法: SB_KEY=.. node ingest-clips.mjs <client_id> <dir> <a_real|b_generated>'); process.exit(1) }
if (!SB_KEY) { console.error('缺 SB_KEY / SUPABASE_SERVICE_ROLE_KEY'); process.exit(1) }
const folder = track === 'a_real' ? 'a-real' : track === 'b_generated' ? 'b-generated' : null
if (!folder) { console.error('track 必须 a_real | b_generated'); process.exit(1) }

const STORAGE = `https://${REF}.supabase.co/storage/v1/object/content-factory`
const REST = `https://${REF}.supabase.co/rest/v1/video_clips`
const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }

// scene_tag:文件名去扩展名 → 小写 → 非字母数字转下划线(去客户前缀噪音保留语义)
const sceneTag = (f) => basename(f, extname(f)).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')

async function existingOrigins() {
  const res = await fetch(`${REST}?select=source_meta&client_id=eq.${clientId}`, { headers: H })
  const rows = res.ok ? await res.json() : []
  return new Set(rows.map((r) => r?.source_meta?.origin).filter(Boolean))
}

async function main() {
  const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.mp4'))
  if (files.length === 0) { console.error(`${dir} 无 mp4`); process.exit(1) }
  const seen = await existingOrigins()
  let uploaded = 0, skipped = 0
  const rows = []

  for (const f of files) {
    const origin = `${dir.replace(process.env.HOME || '', '~')}/${f}`
    if (seen.has(origin)) { skipped++; continue }
    const tag = sceneTag(f)
    const path = `clips/${folder}/${clientId}/${tag}.mp4`
    const buf = readFileSync(join(dir, f))
    const up = await fetch(`${STORAGE}/${path}`, { method: 'POST', headers: { ...H, 'Content-Type': 'video/mp4', 'x-upsert': 'true' }, body: buf })
    if (!up.ok) { console.error(`上传失败 ${f}: ${up.status} ${await up.text()}`); process.exit(1) }
    rows.push({
      client_id: clientId, title: basename(f, extname(f)), scene_tag: tag,
      motion_type: null, duration_seconds: probeDuration(join(dir, f)), track,
      storage_url: path, generation_cost_usd: 0, status: 'active', usage_count: 0,
      source_meta: { origin, seed: 'b4-ingest' },
    })
    uploaded++
    console.log(`↑ ${f} → ${path}`)
  }

  if (rows.length > 0) {
    const ins = await fetch(REST, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(rows) })
    if (!ins.ok) { console.error(`video_clips 入库失败: ${ins.status} ${await ins.text()}`); process.exit(1) }
  }
  console.log(`\n完成: 上传+入库 ${uploaded} 条, 跳过(已存在) ${skipped} 条 [client=${clientId} track=${track}]`)
}

main().catch((e) => { console.error(e); process.exit(1) })
