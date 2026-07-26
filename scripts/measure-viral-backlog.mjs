#!/usr/bin/env node
/**
 * 爆款库分镜头结构批量测量。
 *
 * 为什么是脚本而不是 cron:这是**存量回填**(一次性把 700+ 条历史样本量出来),
 * 增量测量走 measure-shot-structure.ts 挂在分析流程里。
 *
 * 用法:
 *   node scripts/measure-viral-backlog.mjs --limit 50 --platform tiktok
 *   node scripts/measure-viral-backlog.mjs --limit 200 --industry travel --dry
 *
 * 🔴 纪律:
 * - 只测没测过的(shot_recipe is null),重跑安全、可断点续传
 * - 并发压到 3:下载走 yt-dlp,并发高会被 YouTube/TikTok 限流甚至封 IP
 * - 单条失败只记该条,不中断整批(一条下架的视频不该毁掉一次回填)
 * - 超过 180 秒的样本跳过:我们要的是短视频配方,长片解码慢且没参考价值
 * - 测量失败写 { error } 而不是留 null —— 区分「没测过」和「测过但失败」,
 *   否则每次重跑都会重试同一批死链
 */

import { createClient } from '@supabase/supabase-js'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { unlink, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const execFileAsync = promisify(execFile)

// ── 参数 ──────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d }
const has = (k) => argv.includes(`--${k}`)

const LIMIT = Number(arg('limit', 40))
const PLATFORM = arg('platform', null)
const INDUSTRY = arg('industry', null)
// 🔴 默认 1:实测并发 3 跑 YouTube 有 70% 被限流,单条则 100% 成功。
// 慢一点无所谓(这是存量回填,可断点续传);把好样本误判成死链才是真损失。
const CONCURRENCY = Number(arg('concurrency', 1))
/** 每条之间的间隔,进一步降低触发限流的概率 */
const GAP_MS = Number(arg('gap', 1200))
const DRY = has('dry')

const SCENE_THRESHOLD = 0.3
const MAX_SECONDS = 180
const DL_TIMEOUT_MS = 150_000
const FF_TIMEOUT_MS = 240_000
const MAX_BUFFER = 64 * 1024 * 1024

// ── env(复用 .env.local,跟其他本地脚本同一套)─────────────────────────────────
async function loadEnv() {
  if (!existsSync('.env.local')) return
  for (const line of (await readFile('.env.local', 'utf8')).split('\n')) {
    const m = line.match(/^([A-Z_0-9]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

// ── yt-dlp:优先项目根(Render),再 /tmp 独立二进制(本地),最后 PATH ───────────
function ytDlpPath() {
  for (const p of [join(process.cwd(), 'yt-dlp'), '/tmp/yt-dlp_macos']) {
    if (existsSync(p)) return p
  }
  return 'yt-dlp'
}

// ── 测量 ──────────────────────────────────────────────────────────────────────
async function probeDuration(file) {
  const { stdout } = await execFileAsync('ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
    { timeout: 60_000 })
  const d = Number(String(stdout).trim())
  return Number.isFinite(d) ? d : 0
}

async function detectCuts(file) {
  let stderr = ''
  try {
    const r = await execFileAsync('ffmpeg',
      ['-hide_banner', '-i', file, '-vf', `select='gt(scene,${SCENE_THRESHOLD})',showinfo`, '-f', 'null', '-'],
      { timeout: FF_TIMEOUT_MS, maxBuffer: MAX_BUFFER })
    stderr = r.stderr ?? ''
  } catch (e) {
    stderr = e.stderr ?? '' // ffmpeg 正常结束也可能非零退出,stderr 才是产物
  }
  const out = new Set()
  for (const line of stderr.split('\n')) {
    if (!line.includes('Parsed_showinfo')) continue
    const m = line.match(/pts_time:\s*([0-9]+(?:\.[0-9]+)?)/)
    if (m) out.add(Number(m[1]))
  }
  return [...out].sort((a, b) => a - b)
}

const r2 = (n) => Math.round(n * 100) / 100
const median = (xs) => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** 跟 src/lib/reels/shot-structure.ts 的 buildShotRecipe 保持同一套口径 */
function buildRecipe(duration, cutTimes) {
  const cuts = [...new Set(cutTimes.filter((t) => t > 0 && t < duration))].sort((a, b) => a - b).map(r2)
  const bounds = [0, ...cuts, r2(duration)]
  const shots = []
  for (let i = 0; i < bounds.length - 1; i++) {
    const d = r2(bounds[i + 1] - bounds[i])
    if (d > 0) shots.push({ start: bounds[i], duration: d })
  }
  const lens = shots.map((s) => s.duration)
  return {
    duration_seconds: r2(duration),
    shot_count: shots.length,
    cut_times: cuts,
    shots,
    rhythm: {
      median_shot_seconds: r2(median(lens)),
      shortest_shot_seconds: lens.length ? r2(Math.min(...lens)) : 0,
      longest_shot_seconds: lens.length ? r2(Math.max(...lens)) : 0,
      cuts_per_second: r2(cuts.length / duration),
    },
    hook: {
      shots_in_first_3s: cuts.filter((t) => t < 3).length + 1,
      first_cut_at: cuts.length ? cuts[0] : null,
    },
    measured_with: { scene_threshold: SCENE_THRESHOLD, method: 'ffmpeg_scene_detect' },
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 🔴 下载带重试 —— 实测教训:并发 3 跑 YouTube,70% 报下载失败,
 * 而同样的 URL 单条手动下载 100% 成功。是限流,不是死链。
 * 而限流失败一旦被写成 { error },这条记录就再也不会被重测(查询只挑 shot_recipe is null),
 * 等于**把临时故障固化成永久跳过**。所以必须在写库之前就重试掉。
 */
async function downloadWithRetry(url, file, attempts = 3) {
  let last = ''
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await sleep(2000 * i) // 退避:2s、4s
    try {
      await execFileAsync(ytDlpPath(),
        ['-q', '--no-warnings', '-f', 'best[height<=720][ext=mp4]/best[height<=720]/best', '-o', file, url],
        { timeout: DL_TIMEOUT_MS, maxBuffer: MAX_BUFFER })
      if (existsSync(file)) return null
      last = '下载后文件不存在'
    } catch (e) {
      last = String(e.message ?? e).slice(0, 160)
    }
  }
  return last
}

async function measureOne(url, idx) {
  const file = join(tmpdir(), `vb_${process.pid}_${idx}.mp4`)
  try {
    const dlErr = await downloadWithRetry(url, file)
    if (dlErr) return { error: dlErr }
    if (!existsSync(file)) return { error: '下载后文件不存在' }
    const dur = await probeDuration(file)
    if (dur <= 0) return { error: 'ffprobe 取不到时长' }
    if (dur > MAX_SECONDS) return { error: `时长 ${Math.round(dur)}s 超过 ${MAX_SECONDS}s,跳过` }
    return buildRecipe(dur, await detectCuts(file))
  } catch (e) {
    return { error: String(e.message ?? e).slice(0, 180) }
  } finally {
    unlink(file).catch(() => {})
  }
}

// ── 主流程 ────────────────────────────────────────────────────────────────────
async function main() {
  await loadEnv()
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

  let q = sb.from('viral_reference_library')
    .select('id, source_url, platform, view_count')
    .is('shot_recipe', null)
    .not('source_url', 'is', null)
    .order('view_count', { ascending: false, nullsFirst: false })
    .limit(LIMIT)
  if (PLATFORM) q = q.eq('platform', PLATFORM)
  if (INDUSTRY) q = q.eq('industry', INDUSTRY)

  const { data: rows, error } = await q
  if (error) throw new Error(error.message)
  console.log(`待测 ${rows.length} 条 (platform=${PLATFORM ?? '全部'} industry=${INDUSTRY ?? '全部'} 并发=${CONCURRENCY})`)
  if (DRY) { console.log(rows.slice(0, 10).map((r) => `${r.view_count ?? '?'} ${r.source_url}`).join('\n')); return }

  let done = 0, ok = 0, failed = 0
  const queue = [...rows]
  async function worker(wid) {
    for (;;) {
      const row = queue.shift()
      if (!row) return
      const recipe = await measureOne(row.source_url, `${wid}_${done}`)
      const isErr = !!recipe.error
      await sb.from('viral_reference_library')
        .update({ shot_recipe: isErr ? { ...recipe, measured_at: new Date().toISOString() } : recipe })
        .eq('id', row.id)
      done++; isErr ? failed++ : ok++
      const tag = isErr ? `✗ ${recipe.error.slice(0, 60)}` : `✓ ${recipe.shot_count} 镜 / ${recipe.duration_seconds}s`
      console.log(`[${done}/${rows.length}] ${tag}  ${row.source_url.slice(0, 68)}`)
      if (GAP_MS > 0) await sleep(GAP_MS)
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i)))
  console.log(`\n完成:成功 ${ok} / 失败 ${failed} / 共 ${done}`)
}

main().catch((e) => { console.error('批量测量失败:', e); process.exit(1) })
