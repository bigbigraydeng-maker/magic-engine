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

import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

// P21.J.M2 recipe(合同 5469105522):配了 creative_recipe 的工单走强约束 fail-closed 路径。
import { createHash } from 'node:crypto'
import {
  assertClientRecipeIntentMatchesBrief,
  assertPerCallBudget,
  assertRecipeBriefComplete,
  assertRecipeBudget,
  assertRecipeCtaFacts,
  assertRecipePlanShape,
  assertRecipeProfileConstraints,
  assertRecipeReceipt,
  assertRecipeReplanAcknowledged,
  assertRendererApproved,
  assertReopenedRecipeReplan,
  buildExecutedReceipt,
  buildExecutedSrt,
  buildRecipeAssembleConfig,
  makePromoPreflight,
  normalizeCreativeProfile,
  parseLufsFromEbur128,
  resolveRecipeBgm,
  validateRecipeCopy,
  validateMulticutCopy,
  verifyFinalMedia,
  winnerRecipeFromBrief,
} from './creative-recipe.mjs'

import {
  MUSIC_VOCAL_REGISTRY_PATH,
  checkRemotionHealth,
  processRemotionOrder,
  resolveEngine,
} from './remotion-branch.mjs'
import { MusicVocalGateError, assertBgmFileVocalClear, assertLegacyBgmVocalGate } from './music-vocal-gate.mjs'
import { pingRenderWorker, watchRenderWorker } from './render-worker-watch.mjs'

// ── 配置 ──────────────────────────────────────────────────────────────────────

function loadEnv() {
  const envPath = join(import.meta.dirname, '.env')
  const env = { ...process.env }
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/)
      if (m) {
        const value = m[2].replace(/^["']|["']$/g, '')
        // An empty worktree placeholder must not erase a secret injected by
        // launchd / --env-file from the canonical local secret source.
        if (value !== '' || env[m[1]] === undefined) env[m[1]] = value
      }
    }
  }
  return env
}

const ENV = loadEnv()
const API_BASE = ENV.FACTORY_API_BASE || 'https://app.magicengine.com.au'
const WORKER_TOKEN = ENV.FACTORY_WORKER_TOKEN || ''
const WORKER_ID = ENV.FACTORY_WORKER_ID || `mac-${hostname()}`
const TARGET_CLIENT_ID = ENV.FACTORY_WORKER_TARGET_CLIENT_ID?.trim() || ''
const MUAPI_KEY = ENV.MUAPI_API_KEY || ''
// OPENAI_KEY 已移除:A2 起文案由 ME 后端按 master_brief 生成(brief.copy),worker 不再写文案
// B3:引擎指向 MagicLab_Studio 权威版(治没音乐/素材糙),brandkit 按客户走(治装配层 CTS 尾巴)。
const STUDIO_ROOT = ENV.STUDIO_ROOT || join(process.env.HOME, 'Dropbox/MagicLab_Studio')
const MAKE_PROMO = ENV.MAKE_PROMO_PATH || join(STUDIO_ROOT, 'engine/make_promo.py')
// ⚠️ 这里**故意没有默认品牌包**。曾经的默认值是 CTS_BrandKit,任何没配映射的客户
// 都会拿到 CTS 的 logo —— 2026-08-03 Oztop 成片结尾放了 CTS logo 就是这么来的。
// 找不到自己的品牌包 = 工单失败,不是换一个凑合。
// client_id → studio 文件夹名(brandkit=$STUDIO_ROOT/<folder>/brandkit)。JSON env 覆盖。
const CLIENT_STUDIO = (() => { try { return JSON.parse(ENV.FACTORY_CLIENT_STUDIO || '{}') } catch { return {} } })()
// make_promo 引擎对这几个资产是无守卫 open(brand_red.txt)/引 logo/watermark —— 缺任一即炸装配。
// 健康检查到「资产在」而非只「文件夹在」(魏征 B3:半成品目录 existsSync 放行=第三客户定时炸弹)。
const BRANDKIT_REQUIRED = ['brand_red.txt', 'assets/logo_color.png', 'assets/watermark.png']
const brandkitHealthy = (kit) => BRANDKIT_REQUIRED.every((r) => existsSync(join(kit, r)))
/**
 * 找这个客户自己的品牌包。
 *
 * 🔴 **绝不退回别的客户的品牌包**(2026-08-03 真实事故)。
 *    旧逻辑找不到就退回 DEFAULT_BRAND_KIT(= CTS_BrandKit),结果 Oztop 的成片
 *    结尾放了 CTS 的 logo —— 客户 A 的品牌出现在客户 B 的对外内容里。
 *    而 Oztop 自己的品牌包一直是齐的,只是映射没配上,从没被选中。
 *
 *    「装不出片」是可以补救的,「发出去带错品牌」不能。所以这里直接抛错,
 *    让工单失败并留下能照做的修法,不做任何静默兜底。
 */
function brandkitFor(clientId) {
  const folder = CLIENT_STUDIO[clientId]
  if (!folder) {
    throw new Error(
      `客户 ${clientId} 没配 studio 目录 —— 无法确定用谁的品牌包。` +
      `修法:在 worker 的 FACTORY_CLIENT_STUDIO 里加一条 {"${clientId}":"<MagicLab_Studio 下的文件夹名>"}。` +
      `绝不拿别的客户的品牌包顶上。`,
    )
  }
  const kit = join(STUDIO_ROOT, folder, 'brandkit')
  if (!brandkitHealthy(kit)) {
    const missing = BRANDKIT_REQUIRED.filter((r) => !existsSync(join(kit, r)))
    throw new Error(
      `客户 ${clientId} 的品牌包缺文件: ${missing.join(', ')}(在 ${kit})。` +
      `补齐这几个文件再跑。绝不拿别的客户的品牌包顶上。`,
    )
  }
  return kit
}
const MUAPI_SLUG = ENV.MUAPI_KLING_SLUG || 'kling-v2.1-standard-i2v'
const CLIP_UNIT_COST = Number(ENV.FACTORY_CLIP_UNIT_COST_USD || '0.225')
// Homebrew lives at /usr/local on Intel Macs and /opt/homebrew on Apple Silicon;
// Render images normally expose ffmpeg through /usr/bin. Let execFile resolve PATH
// by default, while keeping an explicit override for restricted launchd environments.
const FFPROBE_BIN = ENV.FACTORY_FFPROBE_PATH || 'ffprobe'
const FFMPEG_BIN = ENV.FACTORY_FFMPEG_PATH || 'ffmpeg'
const TESSERACT_BIN = ENV.FACTORY_TESSERACT_PATH || 'tesseract'
const PYTHON_BIN = ENV.FACTORY_PYTHON_PATH || 'python3'
// Inngest one-candidate workflow can impose a stricter per-run ceiling than the
// work-order budget.  Missing means legacy/manual worker behaviour is unchanged.
const ORCHESTRATOR_MAX_PROVIDER_USD = ENV.FACTORY_ORCHESTRATOR_MAX_PROVIDER_USD === undefined
  ? null
  : Number(ENV.FACTORY_ORCHESTRATOR_MAX_PROVIDER_USD)
const ORCHESTRATOR_REQUIRED_RECIPE_ID = ENV.FACTORY_ORCHESTRATOR_REQUIRED_RECIPE_ID || null
const ORCHESTRATOR_REQUIRED_RECIPE_VERSION = ENV.FACTORY_ORCHESTRATOR_REQUIRED_RECIPE_VERSION === undefined
  ? null
  : Number(ENV.FACTORY_ORCHESTRATOR_REQUIRED_RECIPE_VERSION)
// R2a remotion engine: only clients listed here may use brief.engine='remotion' (empty = refuse all).
const REMOTION_CLIENT_IDS = (ENV.FACTORY_REMOTION_CLIENT_IDS || '')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)

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
  const r = await api('/api/factory/worker/claim', 'POST', buildClaimBody(WORKER_ID, TARGET_CLIENT_ID))
  if (!r.ok) throw new Error(`claim ${r.status}: ${JSON.stringify(r.json)}`)
  if (!r.json.claimed) return null
  if (TARGET_CLIENT_ID && !claimMatchesTarget(r.json, TARGET_CLIENT_ID)) {
    throw new Error('claim 返回了目标客户之外的工单,已停止且未开始生成')
  }
  return r.json
}

export function buildClaimBody(workerId, targetClientId) {
  return targetClientId
    ? { worker_id: workerId, client_id: targetClientId }
    : { worker_id: workerId }
}

export function claimMatchesTarget(claim, targetClientId) {
  return typeof claim?.client_id === 'string'
    && claim.client_id.toLowerCase() === targetClientId.toLowerCase()
}

/**
 * blocker 2:heartbeat 必须是 hard gate。任何非 2xx / 请求异常 / 返回体无法确认 abort 状态
 * → 直接抛，禁止 recipe 分支继续调用 provider。之前 return r.json 会把 { error: '...' } 或
 * undefined 当成"没 abort"放行，导致服务端已经喊停仍继续烧钱。
 * 服务端成功合同固定为 { ok:true, abort:boolean, ... }；任一字段缺失都不能证明安全。
 */
export async function heartbeat(woId, costSoFar, fetchFn = fetch) {
  let res
  try {
    res = await fetchFn(`${API_BASE}/api/factory/worker/${woId}/heartbeat`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${WORKER_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ worker_id: WORKER_ID, cost_so_far_usd: costSoFar }),
    })
  } catch (e) {
    throw new Error(`WINNER_RECIPE_HEARTBEAT_FAILED: heartbeat fetch failed: ${e?.message ?? e}`)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`WINNER_RECIPE_HEARTBEAT_FAILED: non-2xx status ${res.status}: ${text.slice(0, 200)}`)
  }
  const text = await res.text()
  let json
  try { json = text ? JSON.parse(text) : {} } catch {
    throw new Error(`WINNER_RECIPE_HEARTBEAT_FAILED: malformed JSON response: ${text.slice(0, 200)}`)
  }
  if (json == null || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error(`WINNER_RECIPE_HEARTBEAT_FAILED: unexpected response shape ${typeof json}`)
  }
  if (json.ok !== true || typeof json.abort !== 'boolean') {
    throw new Error(
      `WINNER_RECIPE_HEARTBEAT_FAILED: response must confirm {ok:true, abort:boolean}, got ok=${String(json.ok)} abort=${String(json.abort)}`,
    )
  }
  if (json.abort === true) log(`⚠️ heartbeat abort 信号(超预算),woId=${woId}`)
  // 干活期间别的客户看不到这台 worker 的工单心跳，顺手报一次存活（4 分钟节流，尽力而为）
  await pingAlive(fetchFn)
  return json
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

async function muapiGenerate(planItem, sourceImageUrl, durationSeconds = 5) {
  if (!MUAPI_KEY) throw new Error('MUAPI_API_KEY 未配置,无法生成缺失 clip')
  const submit = await fetch(`https://api.muapi.ai/api/v1/${MUAPI_SLUG}`, {
    method: 'POST',
    headers: { 'x-api-key': MUAPI_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      image_url: sourceImageUrl,
      prompt: planItem.prompt_hint,
      // 硬编 5 是 legacy 兼容;recipe 路径按 recipe.segments[i].duration_hint_s 传真值
      // (合同 5469105522 §5:defect#2 — muapi 只拿 prompt_hint + 固定 5s 会让 recipe 时长失控)。
      duration: durationSeconds,
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

// #1218:旧版给每个非-hook 段都塞 { caption: wo.angle } —— hook 的 title_sub 也是同一个
// wo.angle,于是 8 段字幕里 7 段在闪同一句话(CTS work order 7c2809e1 实测)。
// 按 #1218 fail-closed 合同:宁可留白让画面说话,也不把 hook 品牌线塞进 middle——
// 仅 hook(i===0)保留 angle,所有非-hook 段留空(buildSrt 对空 caption 直接跳过)。
export function resolveCopy(wo) {
  if (wo.brief?.copy?.segments?.length) return wo.brief.copy
  log('⚠️ brief.copy 缺失(后端文案生成可能失败),走 angle 兜底')
  return {
    segments: wo.brief.segments.map((s, i) => ({
      role: s.role,
      ...(i === 0 ? { title_sub: wo.angle } : {}),
    })),
    endcard: { cta: wo.angle, offer: [], url: '' },
  }
}

// ── SRT / segments.json ────────────────────────────────────────────────────────

export function buildSrt(segments, copy) {
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
    // source image:优先用建单时挑好的源图(plan.source_image_url),没有才退回占位帧。
    //
    // 🔴 这是「所有片子长得一样」的根因之一:此前**无条件**用同一张 seed/cts_source.jpg,
    // 所有 i2v 画面都从同一张图长出来 —— 换多少种提示词都改不掉底子。
    // 建单侧现在会把抓来的素材填进 source_image_url(见 lib/factory/stock-ingest.ts),
    // 每条片子的源图不同,画面才可能不同。
    const srcImg =
      (typeof plan.source_image_url === 'string' && plan.source_image_url.trim())
        ? plan.source_image_url.trim()
        : (ENV.MUAPI_SOURCE_IMAGE_URL || `${ENV.NEXT_PUBLIC_SUPABASE_URL || ''}/storage/v1/object/public/content-factory/seed/cts_source.jpg`)
    if (plan.source_image_url) log(`  源图来自素材库: ${String(plan.source_image_url).slice(-40)}`)
    log(`  生成 clip ${seg.role}:${i} via muapi…`)
    // recipe 路径:duration 严格按 recipe.segments[i].duration_hint_s(通过 seg 透传);legacy 保持旧行为(5s)。
    const gen = await muapiGenerate(plan, srcImg, seg.duration_hint_s || 5)
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
      source_meta: { muapi_url: gen.muapi_url, request_id: gen.request_id, source_image_url: plan.source_image_url ?? null },
    })
  }
  return { localPaths, newClips, cost }
}

// ── 装配(make_promo.py)────────────────────────────────────────────────────────

// B3 皮按客户走:brandkit 根可放 factory_profile.json 定义创意配置,worker 下发引擎。
// { music?: 曲名(相对 _shared/music)或绝对路径, music_mood?, look?, caption_mode?, xfade? }。
// 缺文件 = 全部保持引擎默认(不给无 profile 的客户偷偷改风格/换曲)。
const SHARED_MUSIC = join(STUDIO_ROOT, '_shared/music')

// 2026-07-24:风格改由 ME 配置页维护(clients.factory_config.creative_profile),建单时
// 注入 wo.brief.creative_profile 下发。ME 有值就用 ME 的,没有才读本地 factory_profile.json。
//
// 为什么要迁:风格此前只能手改 Dropbox 里的 JSON,ME 完全不知道它存在 —— 违反「配置类
// 数据必须有 UI」。而且本地文件的键名容易写错却不报错:CTS 那份写的是 caption_style / vo,
// 而这里读的是 caption_mode、根本不读 vo —— 那两条设置从来没生效过,没人发现。
function readLocalProfile(brandKit) {
  const p = join(brandKit, 'factory_profile.json')
  if (!existsSync(p)) return {}
  try {
    return JSON.parse(readFileSync(p, 'utf8'))
  } catch {
    log(`⚠️ factory_profile.json 解析失败: ${p},用引擎默认`)
    return {}
  }
}

function creativeProfile(brandKit, wo) {
  const local = readLocalProfile(brandKit)
  const fromMe = wo?.brief?.creative_profile
  if (fromMe && typeof fromMe === 'object' && Object.keys(fromMe).length > 0) {
    // 🔴 必须是**字段级**覆盖,不能整套替换。整套替换的话:PM 在 ME 里只改了个调色,
    // 本地的 endcard_panel:false 就一起没了 —— Oztop 白字 logo 的结尾卡当场消失。
    log(`🎨 风格:ME 覆盖 [${Object.keys(fromMe).join(', ')}],其余用本地配置`)
    return { ...local, ...fromMe }
  }
  return local
}

// BGM 解析:profile.music(绝对路径或 _shared/music 下曲名)优先,回退 env / brandkit 自带曲。
// make_promo 只在 cfg.music 存在时才铺床(ducked -14dB),无 music 且无 music_mood = 无背景乐。
function resolveBgm(profile, brandKit) {
  if (profile.music) {
    const abs = profile.music.startsWith('/') ? profile.music : join(SHARED_MUSIC, profile.music)
    if (existsSync(abs)) return abs
    // 魏征 P1:打错曲名且声明了 music_mood 时,别静默砸 brandkit 默认曲(可能串 CTS),
    // 返回 null 让 assemble 落到 music_mood(客户声明的次优意图)。仅无 mood 才兜底默认曲。
    log(`⚠️ factory_profile.music 找不到: ${abs}${profile.music_mood ? ',回退 music_mood' : ',回退默认曲'}`)
    if (profile.music_mood) return null
  }
  const fallback = ENV.FACTORY_BGM_PATH || join(brandKit, 'assets/music_bright.wav')
  return existsSync(fallback) ? fallback : null
}

// 定格兜底:取 clip 真实时长,装配时 dur 不超过它(短 clip 撑长时段会定格,PM 反馈 6-10s 定格)。
// ffprobe 取不到 → 返回 null,退回 duration_hint_s(保持旧行为,不炸)。
function probeClipDuration(p) {
  try {
    const out = execFileSync(
      FFPROBE_BIN,
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p],
    ).toString().trim()
    const d = parseFloat(out)
    return Number.isFinite(d) && d > 0 ? d : null
  } catch {
    return null
  }
}

function assemble(wo, localPaths, copy, tmp) {
  const brief = wo.brief
  const out = join(tmp, 'final.mp4')
  const brandKit = brandkitFor(wo.client_id) // B3:brandkit 按客户,不再硬编 CTS
  const profile = creativeProfile(brandKit, wo)
  const bgm = resolveBgm(profile, brandKit)
  assertLegacyBgmVocalGate({ bgm, musicMood: profile.music_mood, registryPath: MUSIC_VOCAL_REGISTRY_PATH })
  const cfg = {
    output: out,
    brand_kit: brandKit,
    // 音乐:显式曲优先;无显式曲但 profile 给了 mood → 交引擎按库自动选。
    ...(bgm ? { music: bgm } : profile.music_mood ? { music_mood: profile.music_mood } : {}),
    // 质量参数(reel 感):仅 profile 显式声明才下发,不给无 profile 客户偷改。
    ...(profile.look ? { look: profile.look } : {}),
    ...(profile.caption_mode != null ? { caption_mode: profile.caption_mode } : {}),
    ...(profile.xfade != null ? { xfade: profile.xfade } : {}),
    // endcard_panel:false = logo 直接放深色渐变(白字 logo 用,如 Oztop),不套白卡片(否则白字消失)。
    ...(profile.endcard_panel != null ? { endcard_panel: profile.endcard_panel } : {}),
    segments: brief.segments.map((seg, i) => {
      const clipDur = probeClipDuration(localPaths[i])
      // 定格根治:dur 不超过 clip 实长(留 0.1s 余量避免边界撑帧);探测失败退回 hint
      const dur = clipDur ? Math.min(seg.duration_hint_s, clipDur - 0.1) : seg.duration_hint_s
      // 地板 1.0s > make_promo XFADE(0.5):防"dur==xfade → 该段偏移不前进被过渡吞帧"(魏征 P2)
      return { src: localPaths[i], ss: 0, dur: Math.max(dur, 1.0), ...(copy.segments[i] || {}) }
    }),
    endcard: copy.endcard,
  }
  const cfgPath = join(tmp, 'promo.json')
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2))
  execFileSync(PYTHON_BIN, [MAKE_PROMO, cfgPath], { stdio: 'inherit' })
  if (!existsSync(out)) throw new Error('make_promo 未产出 final.mp4')
  return out
}

// ── 单工单处理 ──────────────────────────────────────────────────────────────────

export async function processOrder(wo) {
  const woId = wo.work_order_id
  log(`领到工单 ${woId} · ${wo.brief.segments?.length ?? 0} 段 · 预算上限 $${wo.budget_cap_usd}`)
  const tmp = mkdtempSync(join(tmpdir(), 'factory_'))
  try {
    await heartbeat(woId, 0)
    // 客户 factory_config.creative_recipe 无法被服务端安全解析 → 一律在任何 provider 之前
    // fail-closed(recipe 与 legacy 分支都不能走)。claim route 会把解析原因放进
    // recipe_intent_invalid_reason;非空即拒。
    assertNoRecipeIntentInvalidReason(wo.recipe_intent_invalid_reason)
    // R2a: engine dispatch runs BEFORE the recipe-intent gates on purpose — those gates only stop
    // recipe clients from running a legacy shell, and a remotion order is an explicit other engine.
    if (resolveEngine(wo.brief) === 'remotion') {
      return await processRemotionOrder({ wo, tmp, deps: remotionDeps(woId) })
    }
    // R3/R4:reopened 单只有**显式** recipe_replan_required marker 才 fail-closed;legacy 无
    // recipe review 重试不受影响。marker+缺 recipe → 抛 WINNER_RECIPE_REPLAN_REQUIRED,
    // 全走 outer catch 落到 fail(retryable=false)。
    assertReopenedRecipeReplan(wo.brief)
    // R3 硬绑定:即便 marker 已清、recipe 已写回,若 brief.review_feedback_digest 与
    // creative_recipe.acknowledged_review_feedback_digest 不匹配,视为「静默换 recipe 但没吃
    // 反馈」路径 → fail-closed。legacy(无 digest)完全绕开该 gate。
    assertRecipeReplanAcknowledged(wo.brief)
    // R3 补:客户当前 factory_config.creative_recipe 意图必须与 queued brief 匹配。
    // claim response 携带 recipe_intent(claim route 拿 clients.factory_config 计算),不匹配
    // 视作 stale queued 单 → fail-closed。
    assertClientRecipeIntentMatchesBrief(wo.brief, wo.recipe_intent ?? null)

    const recipe = winnerRecipeFromBrief(wo.brief)
    if (recipe) {
      return await processRecipeOrder(wo, tmp, recipe)
    }
    // ── legacy 分支(未配 recipe 的客户走原路径,合同 §4:legacy 行为不变)──
    const copy = resolveCopy(wo)
    const { localPaths, newClips, cost } = await resolveClips(wo, tmp, (c) => heartbeat(woId, c))
    log(`  素材就绪(${newClips.length} 条生成,成本 $${cost.toFixed(3)}),装配中…`)
    await heartbeat(woId, cost)
    const finalPath = assemble(wo, localPaths, copy, tmp)

    // 上传三件套
    const videoBuf = readFileSync(finalPath)
    const segmentsJson = Buffer.from(JSON.stringify({ segments: wo.brief.segments, copy }, null, 2))
    const srtText = buildSrt(wo.brief.segments, copy)
    const srt = Buffer.from(srtText)
    const mediaEvidence = probeMediaEvidence(finalPath, srtText)
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
      media_evidence: mediaEvidence,
    })
    if (!r.ok) throw new Error(`complete ${r.status}: ${JSON.stringify(r.json)}`)
    log(`✅ 工单 ${woId} 完成 → ${r.json.status ?? 'in_review'}`, r.json.redline_hits?.length ? `(红线标记: ${r.json.redline_hits})` : '')
    return true
  } catch (e) {
    log(`❌ 工单 ${woId} 失败: ${e.message}`)
    const retryable = e?.retryable ?? !/预扣硬顶|max_new_clips|无上传通道|既无库存|WINNER_RECIPE_/.test(e.message)
    await failOrder(woId, e.message.slice(0, 500), retryable)
    return false
  }
}

// ── recipe 分支(合同 5469105522):强约束 fail-closed,不回退 legacy ──────────────
//
// runRecipeSequence 把顺序 + 所有 IO 拧成一个可注入依赖的函数,worker.test.mjs 用它
// 逐步验证 gate 顺序而不需真 IO。processRecipeOrder 只是 wire prod-deps 的薄壳。
//
// 顺序(任何一步失败都在 provider 调用 / 上传 / complete 之前炸):
//   0. recipe intent match(claim 传的客户当前 recipe 与 brief 对齐,R3)
//   1. plan shape(R8)
//   2. profile 归一 + 强约束(vo/caption/kenburns · R9 相关 hint)
//   3. renderer SHA 白名单 gate(R11 · 主批准闸)
//   4. make_promo capability preflight(次要 · semantic tokens)
//   5. BGM 解析(profile.music_pool / library)+ 输入 loudness > threshold(R10)
//   6. 结构化 hook + CTA(brief.copy · 若缺 → COPY_INVALID)
//   7. 建单前 budget gate(R7:max_new_clips ≥ recipe.segments.length,projected ≤ cap)
//   8. 每段 provider 调用之前 heartbeat abort 检查 + 累计 budget 检查
//   9. assemble + final duration/loudness probe(R12)
//  10. TS 侧 assertRecipeReceipt(生产 receipt validator,R12)
//  11. upload + complete
export async function runRecipeSequence({ wo, recipe, tmp, deps }) {
  const {
    log: logFn,
    heartbeatFn,
    uploadSignedFn,
    providerFn,
    readFileFn,
    writeFileFn,
    existsFn,
    joinFn,
    tmpJoin,
    probeDurationFn,
    probeLoudnessFn,
    probeMediaEvidenceFn = () => ({}),
    hashFileFn,
    musicVocalGateFn,
    execAssembleFn,
    completeFn,
    receiptValidator,
    brandKit,
    approvedRendererShas,
    rendererPath,
    sharedMusicDir,
    musicLibrary,
    workerId,
    clipUnitCostUsd,
    // blocker 7:BGM 输入门槛(严格 `>`)与 final silence 门槛分开
    minBgmInputLoudnessLufs,
    minLoudnessLufs,
  } = deps

  const woId = wo.work_order_id
  const budgetCapUsd = Number(wo.budget_cap_usd)
  logFn?.(`🎬 recipe 分支: ${recipe.id} v${recipe.version}`)

  // 0. R5 defense-in-depth:即便 evaluate 侧的 pre-insert check 被绕过,worker 侧再验一遍
  // brief claim-critical 完备性(recipe/copy/profile/plan/idempotency 非占位符)。plan shape 由
  // 内部 assertRecipePlanShape 承担,这里主要防「壳单被抢跑」竞态。
  assertRecipeBriefComplete(wo.brief, recipe)

  // 1. plan shape(冗余 · 只为让顺序显式;assertRecipeBriefComplete 已包含)
  assertRecipePlanShape(wo.brief, recipe)

  // 2. profile 归一 + 强约束
  const rawProfile = { ...(wo.brief.creative_profile || {}) }
  const profile = normalizeCreativeProfile(rawProfile)
  assertRecipeProfileConstraints(profile, recipe)

  // 3. renderer SHA 白名单(主批准闸;env 未配 = fail-closed)
  assertRendererApproved({ path: rendererPath, approvedShas: approvedRendererShas, hashFn: hashFileFn })

  // 4. semantic tokens preflight(次要)
  makePromoPreflight({ path: rendererPath, readFn: readFileFn })

  // 5. BGM(音乐库 + music_pool + 响度)—— blocker 7:BGM 输入门槛用 minBgmInputLoudnessLufs
  const music = resolveRecipeBgm({
    profile,
    sharedMusicDir,
    musicLibrary,
    existsFn,
    probeLoudnessLufsFn: probeLoudnessFn,
    joinFn,
    minLoudnessLufs: minBgmInputLoudnessLufs,
  })
  logFn?.(`  BGM: ${music.portableId} (${music.source}, ${music.loudnessLufs.toFixed(1)} LUFS)`)
  // Vocal gate on the exact file handed to the renderer (fail-closed: no gate fn = refuse).
  if (typeof musicVocalGateFn !== 'function') {
    throw new MusicVocalGateError('MUSIC_VOCAL_REGISTRY_INVALID', 'recipe 分支缺少音乐人声检查函数，拒绝出片')
  }
  const gateResult = musicVocalGateFn(music.absPath, { label: music.portableId })
  if (gateResult && typeof gateResult.then === 'function') {
    gateResult.then(() => {}, () => {}) // swallow: we refuse below, don't leak an unhandled rejection
    throw new MusicVocalGateError('MUSIC_VOCAL_REGISTRY_INVALID', 'recipe 音乐人声检查必须是同步函数（异步结果会被忽略=绕过闸），拒绝出片')
  }

  // 6. 结构化文案(禁 angle 兜底 · R9)。multicut(text_overlay_roles 含 'middle')走
  // hook+middle 校验并构建 captionsByRole;legacy 保持 hookText/ctaText 原路径不变。
  const usesMulticutCopy = Array.isArray(recipe.text_overlay_roles) && recipe.text_overlay_roles.includes('middle')
  let hookText
  let ctaText
  let captionsByRole
  if (usesMulticutCopy) {
    const { hook, middle } = validateMulticutCopy(wo.brief.copy, recipe)
    hookText = hook
    captionsByRole = { hook, middle }
  } else {
    const { hook, cta } = validateRecipeCopy(wo.brief.copy, recipe)
    hookText = hook
    ctaText = cta
  }

  // 6b. CTA 事实(client-scoped verified facts)—— 必须在任何 provider 调用之前 fail-closed。
  // assertRecipeBriefComplete(步骤 0)已对 recipe.cta_facts_required 非空的 recipe 校验过一遍
  // brief.cta_facts;这里复用同一断言函数(单一真源,不重复写第二套逻辑)取回已验证的 facts
  // 供 assemble/receipt 使用。
  const ctaFacts = Array.isArray(recipe.cta_facts_required) && recipe.cta_facts_required.length > 0
    ? assertRecipeCtaFacts(wo.brief.cta_facts, recipe)
    : null

  // 7. budget gate(R7 pre-provider)
  assertRecipeBudget({
    budgetCapUsd,
    maxNewClips: Number(wo.brief.max_new_clips),
    clipUnitCostUsd,
    recipe,
  })

  // 8. 每段 provider(先 heartbeat / abort 检查 → per-call budget → 调用)
  const uploadByKey = new Map((wo.clip_uploads || []).map((u) => [u.idempotency_key, u]))
  const localPaths = []
  const newClips = []
  const executed = []
  let cost = 0
  for (let i = 0; i < recipe.segments.length; i++) {
    // 每次 provider 之前先心跳,收到 abort 直接停(hard stop · R7)
    const hb = await heartbeatFn(woId, cost)
    if (hb?.abort) {
      throw new Error(`WINNER_RECIPE_HEARTBEAT_ABORT: heartbeat requested abort before seg[${i}] provider call`)
    }
    // 累计 budget 检查(下一次调用会不会跨顶)
    assertPerCallBudget({
      nextCallCostUsd: clipUnitCostUsd,
      alreadySpentUsd: cost,
      budgetCapUsd,
    })

    const plan = wo.brief.clip_generation_plan[i]
    const spec = recipe.segments[i]
    const up = uploadByKey.get(plan.idempotency_key)
    if (!up) {
      throw new Error(
        `WINNER_RECIPE_UPLOAD_MISSING: 生成 clip 无上传通道(key=${plan.idempotency_key})`,
      )
    }
    // gen_duration_s = provider 应生成的真实时长;legacy recipe 没这字段则退回展示时长(v1 两者相等)。
    const genDurationS = spec.gen_duration_s ?? spec.duration_hint_s
    logFn?.(`  生成 seg[${i}] ${plan.motion_type} via provider (${genDurationS}s)…`)
    const gen = await providerFn({
      plan,
      sourceImageUrl: plan.source_image_url,
      durationSeconds: genDurationS,
      recipe,
    })
    const dst = tmpJoin(tmp, `seg_${i}.mp4`)
    writeFileFn(dst, gen.buf)
    const clipDur = probeDurationFn(dst)
    if (!Number.isFinite(clipDur) || clipDur < genDurationS - 0.5) {
      throw new Error(
        `WINNER_RECIPE_I2V_UNDERRUN: seg[${i}] 时长不足 (${clipDur ?? '未探测'}s < ${genDurationS}s)`,
      )
    }
    localPaths.push(dst)
    await uploadSignedFn(up.signed_url, gen.buf, 'video/mp4')
    // blocker 5:provider-reported cost 必须 finite + 非负,否则拒（防 NaN/Infinity/负数进台账）
    if (typeof gen.cost !== 'number' || !Number.isFinite(gen.cost) || gen.cost < 0) {
      throw new Error(
        `WINNER_RECIPE_BUDGET_INSUFFICIENT: provider returned non-finite/negative cost for seg[${i}]: ${String(gen.cost)}`,
      )
    }
    cost += gen.cost
    executed.push({
      actual_duration_s: clipDur,
      provider: gen.provider ?? 'muapi',
      request_id: gen.request_id ?? '',
    })
    newClips.push({
      storage_url: up.path,
      track: 'b_generated',
      scene_tag: plan.scene_tag,
      duration_seconds: spec.duration_hint_s,
      idempotency_key: plan.idempotency_key,
      motion_type: plan.motion_type,
      generation_cost_usd: gen.cost,
      source_meta: { provider: gen.provider ?? 'muapi', request_id: gen.request_id, recipe: recipe.id, source_image_url: plan.source_image_url ?? null },
    })
  }
  // 生成完再 heartbeat 一次;abort → 不组装、不 complete
  const postGenHb = await heartbeatFn(woId, cost)
  if (postGenHb?.abort) {
    throw new Error('WINNER_RECIPE_HEARTBEAT_ABORT: heartbeat abort after provider calls, refusing to assemble')
  }

  // 9. assemble + final probe
  const outputPath = tmpJoin(tmp, 'final.mp4')
  const cfg = buildRecipeAssembleConfig({
    recipe,
    localPaths,
    hookText,
    ctaText,
    captionsByRole,
    ctaFacts,
    bgmAbsPath: music.absPath,
    brandKit,
    outputPath,
    profile,
  })
  const cfgPath = tmpJoin(tmp, 'promo.json')
  writeFileFn(cfgPath, JSON.stringify(cfg, null, 2))
  await execAssembleFn({ cfgPath, outputPath })
  if (!existsFn(outputPath)) throw new Error('WINNER_RECIPE_ASSEMBLE_FAILED: renderer 未产出 final.mp4')
  const finalProbed = verifyFinalMedia({
    path: outputPath,
    recipe,
    ffprobeFn: (p) => ({ duration: probeDurationFn(p), loudnessLufs: probeLoudnessFn(p) }),
  })

  // 10. 生产 receipt validator(R12)
  const sourceImageUrls = wo.brief.clip_generation_plan.map((p) => p.source_image_url)
  const sourceImageUrl = sourceImageUrls[0]
  const receipt = buildExecutedReceipt({
    recipe,
    hookText,
    ctaText,
    captionsByRole,
    ctaFacts,
    sourceImageUrl,
    sourceImageUrls,
    executed,
    music,
    final: finalProbed,
  })
  receiptValidator(receipt, recipe)

  // 11. upload + complete
  const videoBuf = readFileFn(outputPath, true /* binary */)
  await uploadSignedFn(wo.uploads.video.signed_url, videoBuf, 'video/mp4')
  await uploadSignedFn(
    wo.uploads.segments_json.signed_url,
    Buffer.from(JSON.stringify(receipt, null, 2)),
    'application/json',
  )
  const executedSrt = buildExecutedSrt({ recipe, hookText, captionsByRole })
  const mediaEvidence = probeMediaEvidenceFn(outputPath, executedSrt)
  await uploadSignedFn(
    wo.uploads.srt.signed_url,
    Buffer.from(executedSrt),
    'text/plain',
  )

  // caption 送品控扫描,必须从已校验的 receipt.segments[].caption 收集(而非 hookText 单独拼),
  // 否则 multicut 的 middle 字幕(hook 之外的段)会被漏扫 —— 见 recipe.ts 的 caption 校验口径。
  const caption = receipt.segments
    .map((s) => s.caption)
    .concat(ctaText ? [ctaText] : [])
    .filter(Boolean)
    .join(' · ')
  // blocker 1:recipe 单必须把 executed receipt 明文附在 complete body,server 会用共享
  // assertRecipeReceipt 再校一遍并强制 new_clips 计数 / recipe id-version / source metadata 一致。
  // 老 worker 不带 recipe_receipt → server 一律拒(recipe brief 单不许进 in_review)。
  const r = await completeFn({
    worker_id: workerId,
    video_url: wo.uploads.video.path,
    segments_json_url: wo.uploads.segments_json.path,
    srt_url: wo.uploads.srt.path,
    caption,
    actual_cost_usd: cost,
    new_clips: newClips,
    recipe_receipt: receipt,
    media_evidence: mediaEvidence,
  })
  if (!r.ok) throw new Error(`complete ${r.status}: ${JSON.stringify(r.json)}`)
  logFn?.(`✅ 工单 ${woId} recipe 完成 → ${r.json?.status ?? 'in_review'}`)
  return { ok: true, cost, receipt }
}

// prod wrapper — 用真实 IO wire 依赖
async function processRecipeOrder(wo, tmp, recipe) {
  return runRecipeSequence({
    wo,
    recipe,
    tmp,
    deps: {
      log,
      heartbeatFn: (id, c) => heartbeat(id, c),
      uploadSignedFn: uploadSigned,
      providerFn: async ({ plan, sourceImageUrl, durationSeconds }) =>
        await muapiGenerate(plan, sourceImageUrl, durationSeconds),
      readFileFn: (p, binary = false) => (binary ? readFileSync(p) : readFileSync(p, 'utf8')),
      writeFileFn: (p, buf) => writeFileSync(p, buf),
      existsFn: existsSync,
      joinFn: join,
      tmpJoin: (t, name) => join(t, name),
      probeDurationFn: probeClipDuration,
      probeLoudnessFn: probeLoudnessLufs,
      probeMediaEvidenceFn: probeMediaEvidence,
      hashFileFn: sha256File,
      musicVocalGateFn: (absPath, opts) => assertBgmFileVocalClear(absPath, MUSIC_VOCAL_REGISTRY_PATH, opts),
      execAssembleFn: ({ cfgPath, outputPath }) => {
        execFileSync(PYTHON_BIN, [MAKE_PROMO, cfgPath], { stdio: 'inherit' })
        // 30fps muxing can leave one trailing frame (12.033s for a 12.000s
        // recipe). Normalize only that tiny quantization overflow; larger
        // overruns still reach verifyFinalMedia and fail closed.
        const assembledDuration = probeClipDuration(outputPath)
        if (assembledDuration > recipe.max_final_dur
            && assembledDuration <= recipe.max_final_dur + 0.05) {
          const normalized = `${outputPath}.duration-normalized.mp4`
          execFileSync(FFMPEG_BIN, [
            '-y', '-v', 'error', '-i', outputPath,
            '-t', String(recipe.max_final_dur - (1 / 30)),
            '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18',
            '-c:a', 'aac', '-b:a', '192k', normalized,
          ])
          renameSync(normalized, outputPath)
        }
      },
      completeFn: async (payload) => await api(`/api/factory/worker/${wo.work_order_id}/complete`, 'POST', payload),
      // TS 侧 assertRecipeReceipt 的字段等价实现从 creative-recipe.mjs 直出;
      // 不再动态 import 未打包 TS 源码 → 也不再有静默弱回退掩盖 receipt 违规。
      receiptValidator: assertRecipeReceipt,
      brandKit: brandkitFor(wo.client_id),
      approvedRendererShas: (ENV.FACTORY_RECIPE_APPROVED_MAKE_PROMO_SHA256 || '')
        .split(',').map((s) => s.trim()).filter(Boolean),
      rendererPath: MAKE_PROMO,
      sharedMusicDir: SHARED_MUSIC,
      musicLibrary: loadMusicLibrary(),
      workerId: WORKER_ID,
      clipUnitCostUsd: CLIP_UNIT_COST,
      // blocker 7:BGM 输入门槛 vs final silence 门槛分开
      minBgmInputLoudnessLufs: recipe.min_bgm_input_loudness_lufs,
      minLoudnessLufs: recipe.min_loudness_lufs,
    },
  })
}

// R2a remotion branch: wire the real IO (the branch itself lives in remotion-branch.mjs).
function remotionDeps(woId) {
  return {
    log,
    heartbeatFn: (id, c) => heartbeat(id, c),
    uploadSignedFn: uploadSigned,
    completeFn: (payload) => api(`/api/factory/worker/${woId}/complete`, 'POST', payload),
    probeMediaEvidenceFn: probeMediaEvidence,
    brandkitFor,
    studioRoot: STUDIO_ROOT,
    clientStudio: CLIENT_STUDIO,
    allowedClientIds: REMOTION_CLIENT_IDS,
    workerId: WORKER_ID,
  }
}

/**
 * claim response 带 recipe_intent_invalid_reason(clients.factory_config.creative_recipe
 * 解析失败,例如未知 id / 缺 version / 版本对不上)→ worker 一律拒,不进 recipe 也不进 legacy。
 * 与 legacy 分支保持互斥:合法解析出 null intent 时不设 reason,legacy 继续按老路径走。
 */
export function assertNoRecipeIntentInvalidReason(reason) {
  if (typeof reason === 'string' && reason.trim().length > 0) {
    throw new Error(
      `WINNER_RECIPE_CONFIG_INVALID: client factory_config.creative_recipe is not parseable: ${reason.trim()}`,
    )
  }
}

// ── ffprobe / crypto helpers ──────────────────────────────────────────────────

/** ffprobe 探测:文件是否含 audio 流(sanity;真实 loudness 由 probeLoudnessLufs 承担)。 */
export function probeHasAudio(path) {
  try {
    const out = execFileSync(
      FFPROBE_BIN,
      ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', path],
    ).toString().trim()
    return out.split('\n').some((line) => line.trim() === 'audio')
  } catch {
    return false
  }
}

function parseSubtitleCues(srt) {
  return String(srt).split(/\r?\n\s*\r?\n/).flatMap((block) => {
    const lines = block.split(/\r?\n/)
    const timing = lines.find((line) => line.includes('-->'))
    if (!timing) return []
    const match = timing.match(/(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/)
    if (!match) return [{ start_seconds: NaN, end_seconds: NaN, text: '' }]
    const toSeconds = (h, m, s, ms) => Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms) / 1000
    return [{
      start_seconds: toSeconds(match[1], match[2], match[3], match[4]),
      end_seconds: toSeconds(match[5], match[6], match[7], match[8]),
      text: lines.slice(lines.indexOf(timing) + 1).join(' ').replace(/<[^>]*>/g, '').trim(),
    }]
  })
}

/** Probe the final encoded file before it leaves the authenticated render worker. */
export function probeMediaEvidence(path, srt) {
  const evidence = { subtitle_cues: parseSubtitleCues(srt) }
  try {
    const raw = execFileSync(FFPROBE_BIN, [
      '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', path,
    ], { encoding: 'utf8' })
    const stream = JSON.parse(raw).streams?.[0]
    if (Number.isInteger(stream?.width)) evidence.width = stream.width
    if (Number.isInteger(stream?.height)) evidence.height = stream.height
    const duration = probeClipDuration(path)
    if (Number.isFinite(duration)) evidence.duration_seconds = duration
  } catch {
    // Leave only the video metadata unmeasured; other independent checks remain usable.
  }
  evidence.audio_stream_present = probeHasAudio(path)
  evidence.audio_loudness_lufs = probeLoudnessLufs(path)

  try {
    const pixels = execFileSync(FFMPEG_BIN, [
      '-hide_banner', '-loglevel', 'error', '-ss', '0.5', '-i', path, '-frames:v', '1',
      '-vf', 'scale=32:32:flags=area,format=gray', '-f', 'rawvideo', '-pix_fmt', 'gray', 'pipe:1',
    ])
    if (pixels.length === 32 * 32) {
      const values = [...pixels]
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length
      evidence.cover_mean_luma = Number(mean.toFixed(2))
      evidence.cover_luma_range = Math.max(...values) - Math.min(...values)
    }
    const frame = execFileSync(FFMPEG_BIN, [
      '-hide_banner', '-loglevel', 'error', '-ss', '0.5', '-i', path, '-frames:v', '1',
      '-vf', 'scale=640:640:flags=neighbor', '-f', 'image2pipe', '-vcodec', 'png', 'pipe:1',
    ])
    const ocr = execFileSync(TESSERACT_BIN, ['stdin', 'stdout', '--psm', '11'], {
      input: frame,
      encoding: 'utf8',
      timeout: 15000,
    })
    evidence.cover_placeholder_detected = /\b(?:placeholder|sample video|lorem ipsum|insert (?:logo|text|image)|your (?:logo|text))\b/i.test(ocr)
  } catch {
    // Missing OCR or an unprobeable frame is not a PASS. The server records it as NOT_MEASURED.
  }
  return evidence
}

/**
 * ffmpeg ebur128 integrated loudness (LUFS) —— recipe BGM/final 强约束。
 *
 * ffmpeg `-af ebur128 -f null -` 是 nominal success(exit 0),但 Integrated loudness 摘要
 * 只写在 stderr。之前用 execFileSync 只捕 stdout,summary 全部丢失,任何真实音频都被
 * 解析成 null → 走 -70 兜底 → BGM/final loudness gate 一律 reject(合法音频当静音)。
 *
 * 改用 spawnSync 显式抓 stderr;真解析失败(空输出 / ffmpeg 未装)才落 -70 兜底(供
 * gate 视作静音拒收,不再让静默降级放行任何一条真静音)。runner 可注入便于测试。
 */
export function probeLoudnessLufs(path, runner = defaultFfmpegLoudnessRunner) {
  let res
  try {
    res = runner(path)
  } catch (e) {
    res = { stderr: e?.stderr, stdout: e?.stdout }
  }
  const parsed = parseLufsFromEbur128(res?.stderr) ?? parseLufsFromEbur128(res?.stdout)
  return parsed != null ? parsed : -70
}

function defaultFfmpegLoudnessRunner(path) {
  const r = spawnSync(
    FFMPEG_BIN,
    ['-hide_banner', '-nostats', '-i', path, '-af', 'ebur128=peak=true', '-f', 'null', '-'],
    { encoding: 'utf8' },
  )
  return { stderr: r.stderr, stdout: r.stdout, status: r.status, error: r.error }
}

/** sha256 hex —— renderer SHA gate 主批准闸(R11)。 */
export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/**
 * music_library.json:studio 侧维护的 mood → allowlist 映射。
 * 找不到 = null,resolveRecipeBgm 会走 pool 或抛 BGM_MISSING(不再兜底 canonical 文件名)。
 */
function loadMusicLibrary() {
  const p = ENV.FACTORY_MUSIC_LIBRARY_PATH || join(SHARED_MUSIC, 'music_library.json')
  if (!existsSync(p)) return null
  try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null }
}

// ── 主循环 ──────────────────────────────────────────────────────────────────────

// 存活信号：让服务端知道「出片机还活着、只是没领到单 / 正在给别的客户干活」，离线才能在 30 分钟内判出来。
// 尽力而为——失败只记一行日志、有 10 秒超时，不会卡住领单。
const PING_EVERY_MS = 4 * 60_000
let lastPingAt = 0
function defaultRenderWatch() {
  try {
    return watchRenderWorker(checkRemotionHealth())
  } catch {
    return watchRenderWorker(undefined)
  }
}

export async function pingAlive(fetchFn = fetch, now = Date.now(), watch = undefined) {
  if (now - lastPingAt < PING_EVERY_MS) return false
  lastPingAt = now
  try {
    const res = await fetchFn(`${API_BASE}/api/factory/worker/ping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${WORKER_TOKEN}` },
      body: JSON.stringify({
        ...buildClaimBody(WORKER_ID, TARGET_CLIENT_ID),
        render_worker: pingRenderWorker(watch ?? defaultRenderWatch()),
      }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) log(`存活信号发送失败 status=${res.status}`)
    return res.ok
  } catch (e) {
    log('存活信号发送失败:', e?.message ?? e)
    return false
  }
}

async function main() {
  if (!WORKER_TOKEN) {
    console.error('FATAL: FACTORY_WORKER_TOKEN 未配置(scripts/factory-worker/.env)')
    process.exit(1)
  }
  const loop = process.argv.includes('--loop')
  const jsonResult = process.argv.includes('--json-result')
  const intervalMs = Number(ENV.FACTORY_POLL_INTERVAL_MS || '30000')
  log(`worker 启动 id=${WORKER_ID} api=${API_BASE} loop=${loop}`)
  if (REMOTION_CLIENT_IDS.length > 0) {
    const remotionProblems = checkRemotionHealth()
    if (remotionProblems.length > 0) {
      log(`⚠️ Remotion 引擎未就绪，remotion 工单会被拒绝：${remotionProblems.join('；')}`)
    }
  }
  do {
    try {
      const result = await runOneOrder()
      // 领单请求没抛错才算「活着且能领单」；领单一直失败时不报存活，离线提醒才会响
      if (loop) await pingAlive()
      if (jsonResult) console.log(`FACTORY_WORKER_RESULT ${JSON.stringify(result)}`)
      if (!result.claimed && loop) log('无 queued 工单,等待…')
      else if (!result.claimed) { log('无 queued 工单,退出'); break }
    } catch (e) {
      log('循环异常:', e.message)
      if (jsonResult) {
        console.log(`FACTORY_WORKER_RESULT ${JSON.stringify({ claimed: false, ok: false, error: e.message })}`)
      }
    }
    if (loop) await new Promise((r) => setTimeout(r, intervalMs))
  } while (loop)
}

/**
 * One deterministic claim/process unit for the Inngest Connect wrapper.
 * It deliberately does not retry: content_work_orders already owns retry and
 * dead-letter semantics, while Inngest owns the outer durable run.
 */
export async function runOneOrder({
  claimFn = claimOne,
  processFn = processOrder,
  failFn = failOrder,
  orchestratorMaxProviderUsd = ORCHESTRATOR_MAX_PROVIDER_USD,
  requiredRecipeId = ORCHESTRATOR_REQUIRED_RECIPE_ID,
  requiredRecipeVersion = ORCHESTRATOR_REQUIRED_RECIPE_VERSION,
} = {}) {
  const wo = await claimFn()
  if (!wo) return { claimed: false, ok: true }
  const workOrderBudget = Number(wo.budget_cap_usd)
  if (requiredRecipeId !== null) {
    const actualRecipe = wo.brief?.creative_recipe
    const versionMatches = requiredRecipeVersion === null
      || (Number.isFinite(requiredRecipeVersion) && Number(actualRecipe?.version) === requiredRecipeVersion)
    if (actualRecipe?.id !== requiredRecipeId || !versionMatches) {
      await failFn(
        wo.work_order_id,
        `INNGEST_RECIPE_SCOPE_GATE: expected ${requiredRecipeId} v${String(requiredRecipeVersion)}, got ${String(actualRecipe?.id)} v${String(actualRecipe?.version)}`,
        false,
      )
      return {
        claimed: true,
        ok: false,
        work_order_id: wo.work_order_id,
        client_id: wo.client_id,
        error: 'recipe_scope_gate',
      }
    }
  }
  if (orchestratorMaxProviderUsd !== null) {
    if (!Number.isFinite(orchestratorMaxProviderUsd) || orchestratorMaxProviderUsd <= 0) {
      throw new Error('FACTORY_ORCHESTRATOR_MAX_PROVIDER_USD must be a finite positive number')
    }
    if (!Number.isFinite(workOrderBudget) || workOrderBudget > orchestratorMaxProviderUsd) {
      await failFn(
        wo.work_order_id,
        `INNGEST_PROVIDER_BUDGET_GATE: work order $${String(wo.budget_cap_usd)} exceeds run cap $${orchestratorMaxProviderUsd}`,
        false,
      )
      return {
        claimed: true,
        ok: false,
        work_order_id: wo.work_order_id,
        client_id: wo.client_id,
        error: 'provider_budget_gate',
      }
    }
  }
  const processed = await processFn(wo)
  return {
    claimed: true,
    ok: processed === true || processed?.ok === true,
    work_order_id: wo.work_order_id,
    client_id: wo.client_id,
    actual_cost_usd: Number(processed?.cost ?? 0),
    status: processed === true || processed?.ok === true ? 'in_review' : 'failed',
  }
}

// #1218:守住入口 —— 只在直接执行本文件时跑主循环。测试要 import resolveCopy/buildSrt
// 这两个纯函数做回归验证,没有这道 guard,import 本身就会去敲真实 API、起 claim 循环。
// process.argv[1] 是原始文件系统路径,含空格/#/% 等字符时不会被编码;
// import.meta.url 是编码过的 file:// URL。直接拼字符串比较在这类路径下恒为假,
// 需用 pathToFileURL() 把两边都规范成编码后的 URL 再比较。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1) })
}
