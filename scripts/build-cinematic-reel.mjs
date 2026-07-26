#!/usr/bin/env node
/**
 * 端到端出片:真实地标 + AI 运镜 + 纸面事实卡交替剪。
 *
 * 【这条形态为什么这么设计】
 * PM 连说五轮「千篇一律」。查下来根因是素材:全是所有同行都在用的免费图库地标照,
 * 靠调转场/曲子/节奏永远撞脸。PM 又否掉了「AI 改地标本身」那条(过度承诺 + 对经典不敬)。
 * 所以剩下的路是:
 *   ① 地标**原样不动**,AI 只做光/天气/时辰(现实真会出现,只是游客拍不到)
 *   ② AI 做**运镜** —— 相机和摄影师的活,不是「拍的是什么」的活
 *   ③ 深色实景 ↔ 亮色纸面事实卡**交替硬切** —— 明暗反差本身就是最硬的「切」,
 *      而且纸卡是程序化生成的,别人拿同一批图库照抄不出这个节奏
 *
 * 时长按实测定:12 条百万级中国游 TikTok 中位 17.7 秒(我们旧片 25.8 秒,长了一半)。
 *
 * 🔴 不碰 make_promo:那个引擎不在 git、三条产线共用、改坏没有回滚。
 *    这条形态自带渲染器,风险与现有产线完全隔离。
 *
 * 用法:
 *   node scripts/build-cinematic-reel.mjs            # 全流程(会调 muapi,约 $0.90)
 *   node scripts/build-cinematic-reel.mjs --skip-i2v # 复用已下载的 clip,只重新合成($0)
 */

import { createClient } from '@supabase/supabase-js'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const execFileAsync = promisify(execFile)
const SKIP_I2V = process.argv.includes('--skip-i2v')

const CTS = 'c0000000-0000-0000-0000-000000000000'
const BUCKET = 'content-factory'
const SRC = join(process.env.HOME, 'Documents/Claude/cts_reels/cinematic')
const WORK = join(process.env.HOME, 'Documents/Claude/cts_reels/build_cine')
const OUT = join(process.env.HOME, 'Documents/Claude/cts_reels/cts_cinematic_v1.mp4')
const MUSIC = join(process.env.HOME,
  'Library/CloudStorage/Dropbox/MagicLab_Studio/_shared/music/Jade River Journey.mp3')

/**
 * 每一镜:图不动,AI 只负责镜头怎么动。
 * 措辞刻意具体到「镜头如何运动」,含糊的词(cinematic/dynamic)会让模型自由发挥,
 * 反而回到千篇一律 —— 这是今天在 strategist 那边已经验证过的教训。
 */
const SHOTS = [
  { key: 'wall_snow', motion: 'slow steady dolly push-in along the snow-covered walkway into the falling snow, locked horizon, no camera shake' },
  { key: 'forbidden_storm', motion: 'slow crane tilt upward from the wet courtyard to the storm clouds above the roof, steady and controlled' },
  { key: 'guilin_bluehour', motion: 'slow lateral tracking drift across the still water past the raft, glassy reflection stays intact' },
  { key: 'warriors_shaft', motion: 'slow dolly push forward through the shadow toward the lit row of warriors, dust drifting in the light beam' },
]

// 纸卡内容:全部官网可溯源(禁编行程)
const CARDS = [
  ['DAY 3', 'The Great Wall', 'Mutianyu section'],
  ['DAY 6', 'Beijing — Xi’an', 'train G89, seats booked'],
  ['DAY 5', 'Hutong by pedi-cab', 'a local family visit'],
]
const HOOK = ['Snow on the Wall.', 'Most tours never see it.']

async function loadEnv() {
  for (const line of (await readFile('.env.local', 'utf8')).split('\n')) {
    const m = line.match(/^([A-Z_0-9]+)=(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}

async function uploadAndGetUrl(sb, key) {
  const path = `stock/${CTS}/cine_${key}.png`
  const buf = await readFile(join(SRC, `${key}.png`))
  const { error } = await sb.storage.from(BUCKET).upload(path, buf, { contentType: 'image/png', upsert: true })
  if (error) throw new Error(`上传失败 ${key}: ${error.message}`)
  return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`
}

async function i2v(imageUrl, motion, outFile) {
  const key = process.env.MUAPI_API_KEY
  if (!key) throw new Error('MUAPI_API_KEY 未配置')
  const submit = await fetch('https://api.muapi.ai/api/v1/kling-v2.1-standard-i2v', {
    method: 'POST',
    headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_url: imageUrl, prompt: motion, duration: 5, aspect_ratio: '9:16' }),
  })
  const sj = await submit.json()
  if (!submit.ok || !sj.request_id) throw new Error(`muapi submit: ${JSON.stringify(sj).slice(0, 200)}`)
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 5000))
    const pr = await fetch(`https://api.muapi.ai/api/v1/predictions/${sj.request_id}/result`,
      { headers: { 'x-api-key': key } })
    const pj = await pr.json()
    if (pj.status === 'completed') {
      const url = pj.outputs?.[0]
      if (!url) throw new Error('completed 但无 outputs')
      await writeFile(outFile, Buffer.from(await (await fetch(url)).arrayBuffer()))
      return Number(sj.cost?.amount ?? 0.225)
    }
    if (pj.status === 'failed' || pj.status === 'cancelled') throw new Error(`muapi ${pj.status}`)
  }
  throw new Error('muapi 轮询超时')
}

async function main() {
  await loadEnv()
  await mkdir(WORK, { recursive: true })
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

  let cost = 0
  for (const s of SHOTS) {
    const dst = join(WORK, `${s.key}.mp4`)
    if (SKIP_I2V && existsSync(dst)) { console.log(`跳过(已有) ${s.key}`); continue }
    process.stdout.write(`AI 运镜 ${s.key} … `)
    const url = await uploadAndGetUrl(sb, s.key)
    cost += await i2v(url, s.motion, dst)
    console.log('OK')
  }
  console.log(`i2v 成本 $${cost.toFixed(3)}`)

  // 纸卡逐帧渲染交给 Python(PIL 在那边,复用同一套版式)
  await execFileAsync('python3', [join(process.cwd(), 'scripts/render-cards.py'), WORK,
    JSON.stringify({ hook: HOOK, cards: CARDS })], { maxBuffer: 32 * 1024 * 1024 })

  // 合成:实景与纸卡交替硬切
  const seq = [
    { f: join(WORK, 'wall_snow.mp4'), d: 3.0, ss: 0.3 },
    { f: join(WORK, 'card_0.mp4'), d: 1.3 },
    { f: join(WORK, 'forbidden_storm.mp4'), d: 2.6, ss: 0.4 },
    { f: join(WORK, 'card_1.mp4'), d: 1.3 },
    { f: join(WORK, 'guilin_bluehour.mp4'), d: 2.6, ss: 0.5 },
    { f: join(WORK, 'card_2.mp4'), d: 1.3 },
    { f: join(WORK, 'warriors_shaft.mp4'), d: 2.4, ss: 0.4 },
    { f: join(WORK, 'card_end.mp4'), d: 3.4 },
  ]
  const total = seq.reduce((s, x) => s + x.d, 0)

  const inputs = []
  const parts = []
  seq.forEach((s, i) => {
    inputs.push('-ss', String(s.ss ?? 0), '-t', String(s.d), '-i', s.f)
    parts.push(`[${i}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1,trim=duration=${s.d},setpts=PTS-STARTPTS[v${i}]`)
  })
  // 🔴 钩子文字叠在第一段实景上 —— 开场 3 秒不能空着没字(第一版就是空的)。
  // 用 overlay 的 alpha 淡入而不是等它出现:第一帧就要有字。
  const hookIdx = seq.length
  inputs.push('-loop', '1', '-t', String(seq[0].d), '-i', join(WORK, 'hook.png'))
  parts.push(`[${hookIdx}:v]format=rgba,fade=t=out:st=${(seq[0].d - 0.5).toFixed(2)}:d=0.5:alpha=1[hk]`)
  parts.push(`[v0][hk]overlay=0:0:format=auto[v0h]`)
  const concat = seq.map((_, i) => (i === 0 ? '[v0h]' : `[v${i}]`)).join('') + `concat=n=${seq.length}:v=1:a=0[vout]`
  inputs.push('-i', MUSIC)
  const afilter = `[${seq.length + 1}:a]atrim=0:${total.toFixed(2)},afade=t=in:st=0:d=0.4,afade=t=out:st=${(total - 1).toFixed(2)}:d=1,volume=0.9[aout]`

  await execFileAsync('ffmpeg', ['-y', '-v', 'error', ...inputs,
    '-filter_complex', `${parts.join(';')};${concat};${afilter}`,
    '-map', '[vout]', '-map', '[aout]', '-c:v', 'libx264', '-preset', 'medium',
    '-crf', '19', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', OUT],
    { maxBuffer: 64 * 1024 * 1024 })

  console.log(`DONE -> ${OUT}  ${total.toFixed(1)}s  ${seq.length} 段(全硬切)`)
}

main().catch((e) => { console.error('出片失败:', e.message ?? e); process.exit(1) })
