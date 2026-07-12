#!/usr/bin/env node
// P21.J M2 — Content Factory 本地 worker(spec §6.1)
// 单机 Mac 产线:claim → [muapi 生成缺失 clip] → make_promo.py 装配 9:16+brandkit →
// 签名上传成片三件套 → complete。心跳纪律 + 预扣硬数本地强制 check。
//
// 只用 Node 内置(fetch/fs/child_process)。装配复用 ~/Documents/CTS_BrandKit/make_promo.py。
// 配置读 scripts/factory-worker/.env(worker-local,gitignored)。
//
// 运行:  node scripts/factory-worker/worker.mjs           # 单次领一单跑完退出
//        node scripts/factory-worker/worker.mjs --loop    # 持续轮询(默认 30s)

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// ── 配置 ──────────────────────────────────────────────────────────────────────

function loadEnv() {
  const envPath = join(import.meta.dirname, '.env')
  const env = { ...process.env }
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/)
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  }
  return env
}

const ENV = loadEnv()
const API_BASE = ENV.FACTORY_API_BASE || 'https://app.magicengine.com.au'
const WORKER_TOKEN = ENV.FACTORY_WORKER_TOKEN || ''
const WORKER_ID = ENV.FACTORY_WORKER_ID || `mac-${hostname()}`
const MUAPI_KEY = ENV.MUAPI_API_KEY || ''
// OPENAI_KEY 已移除:A2 起文案由 ME 后端按 master_brief 生成(brief.copy),worker 不再写文案
const MAKE_PROMO = ENV.MAKE_PROMO_PATH || join(process.env.HOME, 'Documents/CTS_BrandKit/make_promo.py')
const BRAND_KIT = ENV.BRAND_KIT_PATH || join(process.env.HOME, 'Documents/CTS_BrandKit')
const MUAPI_SLUG = ENV.MUAPI_KLING_SLUG || 'kling-v2.1-standard-i2v'
const CLIP_UNIT_COST = Number(ENV.FACTORY_CLIP_UNIT_COST_USD || '0.225')

if (!WORKER_TOKEN) {
  console.error('FATAL: FACTORY_WORKER_TOKEN 未配置(scripts/factory-worker/.env)')
  process.exit(1)
}

const log = (...a) => console.log(new Date().toISOString(), ...a)

// ── ME API 客户端 ──────────────────────────────────────────────────────────────

async function api(path, method = 'POST', body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${WORKER_TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  let json
  try { json = text ? JSON.parse(text) : {} } catch { json = { raw: text } }
  return { ok: res.ok, status: res.status, json }
}

async function claimOne() {
  const r = await api('/api/factory/worker/claim', 'POST', { worker_id: WORKER_ID })
  if (!r.ok) throw new Error(`claim ${r.status}: ${JSON.stringify(r.json)}`)
  return r.json.claimed ? r.json : null
}

async function heartbeat(woId, costSoFar) {
  const r = await api(`/api/factory/worker/${woId}/heartbeat`, 'POST', {
    worker_id: WORKER_ID,
    cost_so_far_usd: costSoFar,
  })
  if (r.json?.abort) log(`⚠️ heartbeat abort 信号(超预算),woId=${woId}`)
  return r.json
}

async function failOrder(woId, error, retryable) {
  await api(`/api/factory/worker/${woId}/fail`, 'POST', { worker_id: WORKER_ID, error, retryable })
}

// ── 上传(签名 URL,PUT bytes)────────────────────────────────────────────────

async function uploadSigned(signedUrl, buf, contentType) {
  const res = await fetch(signedUrl, {
    method: 'PUT',
    headers: { 'content-type': contentType, 'x-upsert': 'true' },
    body: buf,
  })
  if (!res.ok) throw new Error(`upload ${res.status}: ${await res.text()}`)
}

// ── muapi Kling I2V 生成(spike §4)────────────────────────────────────────────

async function muapiGenerate(planItem, sourceImageUrl) {
  if (!MUAPI_KEY) throw new Error('MUAPI_API_KEY 未配置,无法生成缺失 clip')
  const submit = await fetch(`https://api.muapi.ai/api/v1/${MUAPI_SLUG}`, {
    method: 'POST',
    headers: { 'x-api-key': MUAPI_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_url: sourceImageUrl,
      prompt: planItem.prompt_hint,
      duration: 5,
      aspect_ratio: '9:16',
    }),
  })
  const sj = await submit.json()
  if (!submit.ok || !sj.request_id) throw new Error(`muapi submit: ${JSON.stringify(sj)}`)
  const cost = Number(sj.cost?.amount ?? CLIP_UNIT_COST)

  // 轮询终态(completed/failed)
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 5000))
    const pr = await fetch(`https://api.muapi.ai/api/v1/predictions/${sj.request_id}/result`, {
      headers: { 'x-api-key': MUAPI_KEY },
    })
    const pj = await pr.json()
    if (pj.status === 'completed') {
      const url = pj.outputs?.[0]
      if (!url) throw new Error('muapi completed 无 outputs')
      const vid = Buffer.from(await (await fetch(url)).arrayBuffer())
      return { buf: vid, cost, muapi_url: url, request_id: sj.request_id }
    }
    if (pj.status === 'failed' || pj.status === 'cancelled') {
      throw new Error(`muapi ${pj.status}: ${JSON.stringify(pj.error ?? {})}`)
    }
  }
  throw new Error('muapi 轮询超时(10min)')
}

// ── 广告文案(A2:后端已按 master_brief 品牌接地生成,存 brief.copy;worker 只读不生成)──
// worker 不再写文案(以前硬编 CTS,只能服务一个客户)。brief.copy 缺失才走品牌无关兜底
// (仅用 angle,不硬编任何客户名/网址)——正常路径永远有 brief.copy。

function resolveCopy(wo) {
  if (wo.brief?.copy?.segments?.length) return wo.brief.copy
  log('⚠️ brief.copy 缺失(后端文案生成可能失败),走 angle 兜底')
  return {
    segments: wo.brief.segments.map((s, i) => ({
      role: s.role,
      ...(i === 0 ? { title_sub: wo.angle } : { caption: wo.angle }),
    })),
    endcard: { cta: wo.angle, offer: [], url: '' },
  }
}

// ── SRT / segments.json ────────────────────────────────────────────────────────

function buildSrt(segments, copy) {
  let t = 0, out = '', n = 1
  const fmt = (s) => {
    const h = String(Math.floor(s / 3600)).padStart(2, '0')
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
    const ss = String(Math.floor(s % 60)).padStart(2, '0')
    const ms = String(Math.round((s % 1) * 1000)).padStart(3, '0')
    return `${h}:${m}:${ss},${ms}`
  }
  segments.forEach((seg, i) => {
    const dur = seg.duration_hint_s
    const c = copy.segments[i] ?? {}
    const text = c.title_sub || c.caption || c.title_main || ''
    if (text) { out += `${n++}\n${fmt(t)} --> ${fmt(t + dur)}\n${text}\n\n` }
    t += dur
  })
  return out
}

// ── clip 就绪:库存下载 / 生成 ──────────────────────────────────────────────────

async function resolveClips(wo, tmp, onCost) {
  const brief = wo.brief
  // 库存签名 URL map
  const clipById = new Map((wo.clips || []).map((c) => [c.clip_id, c]))
  const uploadByKey = new Map((wo.clip_uploads || []).map((u) => [u.idempotency_key, u]))
  const localPaths = [] // 每段一个本地文件路径(按 segment 顺序)
  const newClips = []
  let cost = 0

  for (let i = 0; i < brief.segments.length; i++) {
    const seg = brief.segments[i]
    const dst = join(tmp, `seg_${i}.mp4`)
    const libId = (seg.clip_ids || [])[0]
    if (libId && clipById.has(libId) && clipById.get(libId).signed_url) {
      // 库存实拍:下载签名 URL
      const buf = Buffer.from(await (await fetch(clipById.get(libId).signed_url)).arrayBuffer())
      writeFileSync(dst, buf)
      localPaths.push(dst)
      continue
    }
    // 缺库存 → 找 generation_plan 里同 role/position 的项生成
    const plan = (brief.clip_generation_plan || []).find(
      (p) => p.segment_role === seg.role && p.position === i,
    )
    if (!plan) throw new Error(`segment ${i}(${seg.role}) 既无库存 clip 又无生成计划`)
    // 预扣硬数本地强制 check(护栏 8):已生成数 < max_new_clips
    if (newClips.length >= brief.max_new_clips) {
      throw new Error(`预扣硬顶:已生成 ${newClips.length} 达 max_new_clips=${brief.max_new_clips}`)
    }
    const wo_key = plan.idempotency_key.replace('{work_order_id}', wo.work_order_id)
    const up = uploadByKey.get(wo_key) || uploadByKey.get(plan.idempotency_key)
    if (!up) throw new Error(`生成 clip 无上传通道(key=${wo_key})`)
    // source image:v1 用 brandkit 占位帧(真实接入时来自 clip 库首帧/客户图)
    const srcImg = ENV.MUAPI_SOURCE_IMAGE_URL || `${ENV.NEXT_PUBLIC_SUPABASE_URL || ''}/storage/v1/object/public/content-factory/seed/cts_source.jpg`
    log(`  生成 clip ${seg.role}:${i} via muapi…`)
    const gen = await muapiGenerate(plan, srcImg)
    writeFileSync(dst, gen.buf)
    localPaths.push(dst)
    await uploadSigned(up.signed_url, gen.buf, 'video/mp4')
    cost += gen.cost
    if (onCost) await onCost(cost)
    newClips.push({
      storage_url: up.path,
      track: 'b_generated',
      scene_tag: plan.scene_tag === 'pending_resolution' ? `gen_${seg.role}` : plan.scene_tag,
      duration_seconds: seg.duration_hint_s,
      idempotency_key: wo_key,
      motion_type: plan.motion_type,
      generation_cost_usd: gen.cost,
      source_meta: { muapi_url: gen.muapi_url, request_id: gen.request_id },
    })
  }
  return { localPaths, newClips, cost }
}

// ── 装配(make_promo.py)────────────────────────────────────────────────────────

function assemble(wo, localPaths, copy, tmp) {
  const brief = wo.brief
  const out = join(tmp, 'final.mp4')
  // BGM:默认 brandkit 自带 music_bright.wav,可 env 覆盖(FACTORY_BGM_PATH)。
  // make_promo 只在 cfg.music 存在时才铺床(ducked -14dB),无此字段 = 无背景乐。
  const bgm = ENV.FACTORY_BGM_PATH || join(BRAND_KIT, 'assets/music_bright.wav')
  const cfg = {
    output: out,
    brand_kit: BRAND_KIT,
    ...(existsSync(bgm) ? { music: bgm } : {}),
    segments: brief.segments.map((seg, i) => ({
      src: localPaths[i],
      ss: 0,
      dur: seg.duration_hint_s,
      ...(copy.segments[i] || {}),
    })),
    endcard: copy.endcard,
  }
  const cfgPath = join(tmp, 'promo.json')
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2))
  execFileSync('python3', [MAKE_PROMO, cfgPath], { stdio: 'inherit' })
  if (!existsSync(out)) throw new Error('make_promo 未产出 final.mp4')
  return out
}

// ── 单工单处理 ──────────────────────────────────────────────────────────────────

async function processOrder(wo) {
  const woId = wo.work_order_id
  log(`领到工单 ${woId} · ${wo.brief.segments.length} 段 · 预算上限 $${wo.budget_cap_usd}`)
  const tmp = mkdtempSync(join(tmpdir(), 'factory_'))
  try {
    await heartbeat(woId, 0)
    const copy = resolveCopy(wo)
    const { localPaths, newClips, cost } = await resolveClips(wo, tmp, (c) => heartbeat(woId, c))
    log(`  素材就绪(${newClips.length} 条生成,成本 $${cost.toFixed(3)}),装配中…`)
    await heartbeat(woId, cost)
    const finalPath = assemble(wo, localPaths, copy, tmp)

    // 上传三件套
    const videoBuf = readFileSync(finalPath)
    const segmentsJson = Buffer.from(JSON.stringify({ segments: wo.brief.segments, copy }, null, 2))
    const srt = Buffer.from(buildSrt(wo.brief.segments, copy))
    await uploadSigned(wo.uploads.video.signed_url, videoBuf, 'video/mp4')
    await uploadSigned(wo.uploads.segments_json.signed_url, segmentsJson, 'application/json')
    await uploadSigned(wo.uploads.srt.signed_url, srt, 'text/plain')

    const caption = copy.segments.map((s) => s.title_sub || s.caption || s.title_main).filter(Boolean).join(' · ')
    const r = await api(`/api/factory/worker/${woId}/complete`, 'POST', {
      worker_id: WORKER_ID,
      video_url: wo.uploads.video.path,
      segments_json_url: wo.uploads.segments_json.path,
      srt_url: wo.uploads.srt.path,
      caption,
      actual_cost_usd: cost,
      new_clips: newClips,
    })
    if (!r.ok) throw new Error(`complete ${r.status}: ${JSON.stringify(r.json)}`)
    log(`✅ 工单 ${woId} 完成 → rendered`, r.json.redline_hits?.length ? `(红线标记: ${r.json.redline_hits})` : '')
    return true
  } catch (e) {
    log(`❌ 工单 ${woId} 失败: ${e.message}`)
    const retryable = !/预扣硬顶|max_new_clips|无上传通道|既无库存/.test(e.message)
    await failOrder(woId, e.message.slice(0, 500), retryable)
    return false
  }
}

// ── 主循环 ──────────────────────────────────────────────────────────────────────

async function main() {
  const loop = process.argv.includes('--loop')
  const intervalMs = Number(ENV.FACTORY_POLL_INTERVAL_MS || '30000')
  log(`worker 启动 id=${WORKER_ID} api=${API_BASE} loop=${loop}`)
  do {
    try {
      const wo = await claimOne()
      if (wo) await processOrder(wo)
      else if (loop) log('无 queued 工单,等待…')
      else { log('无 queued 工单,退出'); break }
    } catch (e) {
      log('循环异常:', e.message)
    }
    if (loop) await new Promise((r) => setTimeout(r, intervalMs))
  } while (loop)
}

main().catch((e) => { console.error(e); process.exit(1) })
