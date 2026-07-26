#!/usr/bin/env node
/**
 * 「不可能的中国」—— 视觉冲击开场的素材生成。
 *
 * 为什么(2026-07-26,爆款库 383 条实测给出的最强反直觉信号):
 * 开场类型决定天花板。风景空镜开场中位播放 221 万,视觉冲击 1790 万 —— 差 8.1 倍。
 * 而**视觉冲击是唯一一种「AI 生成是优势而不是妥协」的开场**:库里一条 7180 万播放的
 * 旅游片,描述就是「超现实 / CGI 增强的风景」。
 *
 * 我们之前一直让 AI 去**模仿真实**(逼真的长城照),那是跟无人机和真相机比,必输 ——
 * 而且出来的图跟所有人用的免费图库长得一样。
 * 反过来:让 AI 做**相机根本拍不出来的画面**,它就成了别人抄不走的东西。
 *
 * 🔴 红线约束(不能因为追求视觉冲击就破):
 * - 只做**地标本身**的超现实处理,绝不编造客户的行程/价格/含项
 * - 画面里零文字(生成的中文必然是乱码,且会跟压上去的字幕打架)
 * - 主体必须仍然可辨认是中国(超现实到认不出来 = 跟客户业务脱钩,白做)
 *
 * 用法: node scripts/gen-impossible-china.mjs [输出目录]
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
 * 每一条都必须满足:①主体一眼认得出是中国 ②相机绝对拍不到 ③不涉及行程/价格断言
 */
export const SHOTS = [
  {
    key: 'wall_ribbon',
    label: '长城像绸带一样从山脊上升起',
    prompt:
      'The Great Wall of China lifting off the mountain ridge like an enormous stone ribbon, ' +
      'curling upward into low cloud, its watchtowers still intact along the rising curve. ' +
      'The mountains below stay ordinary and real. Overcast dawn light, muted greens and greys. ' + NO_TEXT,
  },
  {
    key: 'warriors_turn',
    label: '兵马俑坑里唯一一个转过头来的',
    prompt:
      'A vast terracotta warrior pit seen from above, hundreds of figures in perfect rows facing forward — ' +
      'except one single warrior in the middle who has turned his head to look straight up at the viewer. ' +
      'Dusty museum light from high windows, earth tones. Unsettling and quiet. ' + NO_TEXT,
  },
  {
    key: 'guilin_upside',
    label: '漓江的山倒长在水面之下',
    prompt:
      'The karst peaks of Guilin reflected in the Li River, but the reflection is the solid world: ' +
      'the mountains below the waterline are sharp and real while the ones above are made of mist and dissolving. ' +
      'A small bamboo raft floats exactly on the boundary. Soft morning haze, teal and grey. ' + NO_TEXT,
  },
  {
    key: 'forbidden_fold',
    label: '故宫像纸一样折起来',
    prompt:
      'A courtyard of the Forbidden City folding upward like a sheet of paper along a clean crease, ' +
      'the golden roof tiles and red walls bending without breaking, revealing more courtyards behind the fold. ' +
      'Flat overcast light, the crimson and gold kept restrained and true to life. ' + NO_TEXT,
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
