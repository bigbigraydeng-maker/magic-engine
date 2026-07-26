#!/usr/bin/env node
/**
 * 「电影级的中国」—— 视觉冲击开场的素材生成。
 *
 * 🔴 PM 拍板改向(2026-07-26,原方向已废):
 * 上一版让 AI 去改长城/兵马俑/故宫本身(城墙腾空、俑转头、故宫像纸折起来)。
 * PM 否决,原话:「AI 应该做的是视频的视觉效果,而不是去改长城、兵马俑、故宫
 * 这种严肃又出名的经典。」
 *
 * 除了文化上的不得体,还有一层更实际的:把长城拍成腾空的,客户到现场看到的是
 * 一段普通城墙 —— 那是**变相过度承诺**,跟「绝不编造客户业务事实」是同一条红线。
 * 当时只盯着爆款库的播放数据,没往这儿想。
 *
 * 【新方向】主体必须是**真实的、没有被改动的**中国;AI 干的是摄影师和调色师的活:
 * 光线、天气、时刻、大气、镜头语言 —— 全都是现实中**真的会出现、只是很难拍到**的条件。
 * 这样既有视觉冲击(爆款库:视觉冲击开场中位 1790 万 vs 风景空镜 221 万),
 * 又不撒谎:客户真去了,遇上那个天气就是那个样子。
 *
 * 判定标准(每条提示词都要过):
 * ① 地标的形状/结构/比例**一点不改** —— 只改光、天气、时刻、视角
 * ② 描述的条件在现实中真实存在(晨雾、暴雪、雷雨、逆光、蓝调时刻)
 * ③ 画面零文字(生成的中文必然乱码,且会跟压上去的字幕打架)
 * ④ 不涉及任何行程/价格/含项断言
 *
 * 用法: node scripts/gen-cinematic-china.mjs [输出目录]
 */

import OpenAI from 'openai'
import { writeFile, mkdir, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const NO_TEXT =
  'Absolutely no text, no letters, no Chinese characters, no signage, no watermark, no logo. ' +
  'Vertical 9:16 composition, clean negative space in the upper third for caption overlay. ' +
  'Photographic realism in lighting and texture — it should look photographed, not illustrated, ' +
  'even though the event depicted is impossible.'

/**
 * 每一条:地标本身**原样不动**,冲击力全部来自光/天气/时刻/机位。
 * 这些条件现实中都真的会出现 —— 只是绝大多数游客拍不到。
 */
export const SHOTS = [
  {
    key: 'wall_snow',
    label: '长城暴雪 —— 结构不动,只是天气极端',
    prompt:
      'The Great Wall of China during heavy snowfall, the stone structure completely unaltered and ' +
      'architecturally accurate, watchtowers and battlements exactly as they really are. ' +
      'Thick snow falling, the ridge disappearing into white, footprints on the walkway. ' +
      'Cold blue-grey light, low contrast, the quiet of a real blizzard. ' + NO_TEXT,
  },
  {
    key: 'warriors_shaft',
    label: '兵马俑一束天光 —— 俑不动,只是打光',
    prompt:
      'The terracotta warrior pit, the figures completely unaltered and historically accurate, ' +
      'standing in their real formation. A single shaft of daylight falls from a high window across ' +
      'one row, dust suspended in the beam, the rest of the pit in deep shadow. ' +
      'Warm earth tones against darkness, museum stillness. ' + NO_TEXT,
  },
  {
    key: 'guilin_bluehour',
    label: '漓江蓝调时刻 —— 山川如实,只是时辰',
    prompt:
      'The karst peaks of Guilin at blue hour just before sunrise, the mountains and river ' +
      'entirely real and unaltered in shape. Mist sitting low on the water, a single fisherman ' +
      'on a bamboo raft, the sky deep indigo shading to pale gold at the horizon. ' +
      'Long-exposure smoothness on the water, restrained cool palette. ' + NO_TEXT,
  },
  {
    key: 'forbidden_storm',
    label: '故宫雷雨将至 —— 建筑如实,只是天空',
    prompt:
      'A courtyard of the Forbidden City minutes before a summer thunderstorm, the architecture ' +
      'completely accurate and unaltered — real proportions, real golden roof tiles, real crimson walls. ' +
      'Heavy bruised storm clouds above, the last shaft of sun raking across the tiles, ' +
      'the courtyard empty and wet. Dramatic natural light, no colour grading tricks. ' + NO_TEXT,
  },
]

async function main() {
  const outDir = process.argv[2] ?? 'impossible'
  if (existsSync('.env.local')) {
    for (const line of (await readFile('.env.local', 'utf8')).split('\n')) {
      const m = line.match(/^([A-Z_0-9]+)=(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  }
  await mkdir(outDir, { recursive: true })
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

  for (const s of SHOTS) {
    process.stdout.write(`生成 ${s.key} (${s.label}) … `)
    try {
      const r = await client.images.generate({
        model: 'gpt-image-1',
        prompt: s.prompt,
        size: '1024x1536',   // 竖版,接近 9:16
        quality: 'high',
        n: 1,
      })
      const b64 = r.data?.[0]?.b64_json
      if (!b64) throw new Error('无 b64 返回')
      await writeFile(join(outDir, `${s.key}.png`), Buffer.from(b64, 'base64'))
      console.log('OK')
    } catch (e) {
      console.log(`失败: ${e.message?.slice(0, 120) ?? e}`)
    }
  }
  console.log(`\n输出目录: ${outDir}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
