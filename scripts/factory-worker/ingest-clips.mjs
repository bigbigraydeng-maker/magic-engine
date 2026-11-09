#!/usr/bin/env node
// P21.J B4 — 真实素材灌库(存储决策 spec 的单向同步:Dropbox/本地 → Supabase video_clips)。
// 上传到 content-factory/clips/{a-real|b-generated}/{client}/,路径遵 validateClipPath 正门约定
// (魏征红线:入库走正门不开旁路)。source_meta.origin 幂等,重跑不重插。
//
// 用法:  SB_KEY=<service_role> node ingest-clips.mjs <client_id> <dir> <track>
//   track = a_real | b_generated

import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
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

async function existingClips() {
  const res = await fetch(`${REST}?select=source_meta,sha256&client_id=eq.${clientId}`, { headers: H })
  if (!res.ok) throw new Error(`video_clips 幂等检查失败: ${res.status}`)
  const rows = await res.json()
  return {
    origins: new Set(rows.map((r) => r?.source_meta?.origin).filter(Boolean)),
    fingerprints: new Set(rows.map((r) => r?.sha256).filter(Boolean)),
  }
}

async function main() {
  const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.mp4'))
  if (files.length === 0) { console.error(`${dir} 无 mp4`); process.exit(1) }
  const seen = await existingClips()
  let uploaded = 0, skipped = 0
  const rows = []

  for (const f of files) {
    const origin = `${dir.replace(process.env.HOME || '', '~')}/${f}`
    if (seen.origins.has(origin)) { skipped++; continue }
    const buf = readFileSync(join(dir, f))
    const sha256 = createHash('sha256').update(buf).digest('hex')
    if (seen.fingerprints.has(sha256)) { skipped++; continue }
    // 文件名仅保留为显示标题；不再把它伪装成场景标签。
    // 先入待审核，ME 管理页补标签、许可证据并审核激活。
    const path = `clips/${folder}/${clientId}/${randomUUID()}.mp4`
    const up = await fetch(`${STORAGE}/${path}`, { method: 'POST', headers: { ...H, 'Content-Type': 'video/mp4', 'x-upsert': 'true' }, body: buf })
    if (!up.ok) { console.error(`上传失败 ${f}: ${up.status} ${await up.text()}`); process.exit(1) }
    rows.push({
      client_id: clientId, title: basename(f, extname(f)), scene_tag: 'unclassified',
      motion_type: null, duration_seconds: probeDuration(join(dir, f)), track,
      storage_url: path, generation_cost_usd: 0, status: 'pending_review', usage_count: 0,
      media_type: 'video', mime_type: 'video/mp4', tags: [], sha256,
      license_status: 'unknown',
      source_meta: { origin, seed: 'b4-ingest' },
    })
    uploaded++
    console.log(`↑ ${f} → ${path}`)
  }

  if (rows.length > 0) {
    const ins = await fetch(REST, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(rows) })
    if (!ins.ok) {
      await Promise.all(rows.map((row) => fetch(`${STORAGE}/${row.storage_url}`, { method: 'DELETE', headers: H }).catch(() => null)))
      console.error(`video_clips 入库失败: ${ins.status} ${await ins.text()}`); process.exit(1)
    }
  }
  console.log(`\n完成: 上传+入库 ${uploaded} 条, 跳过(已存在) ${skipped} 条 [client=${clientId} track=${track}]`)
}

main().catch((e) => { console.error(e); process.exit(1) })
