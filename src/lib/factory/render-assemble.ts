// 🔴 已退役(2026-09-02，render.yaml 同一条注释)：content-factory-render-worker 这条
// 旧 Render 云端拼片管线已停机、调用它的服务和入口已摘掉，`content_factory_render_jobs`
// 最后一条记录停在 2026-08-19。代码本次先留仓库不删(删除类 Bash 操作被 session 权限拦
// 下)，不是还活着、不要复活或当活代码维护——出片现在走 Creatomate 链(scene-assets.ts)。
//
// 拼接 — 把一条任务的画面+配音+字幕用 ffmpeg 拼成竖屏成片。只在 worker 容器里跑(需 ffmpeg+python-PIL)。
// 配方(本地 ffmpeg 8.1.2 实测)：字幕走 PIL 画透明 PNG + ffmpeg overlay(绕过精简版缺的 drawtext)。
// 每段：scale=1080:1920+crop 裁竖屏 → overlay 字幕 → 叠配音 → 时长=配音；再 concat。字幕在安全区 y≈980。

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { supabaseAdmin } from '@/lib/supabase'

const exec = promisify(execFile)
const BUCKET = 'content-factory'
// 容器里覆盖为 Linux 中文字体(如 Noto Sans CJK)。本机默认 mac 单文件中文字体。
const CJK_FONT = process.env.FACTORY_CJK_FONT || '/System/Library/Fonts/Supplemental/Arial Unicode.ttf'

interface JobRow {
  id: string
  client_id: string
  content_post_id: string
  scenes: { index: number; captionText: string }[] | null
  clip_urls: string[] | null
  vo_urls: string[] | null
}

async function patchJob(jobId: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await supabaseAdmin
    .from('content_factory_render_jobs')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', jobId)
  if (error) throw error
}

async function download(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) })
  if (!res.ok) throw new Error(`下载失败 ${res.status}: ${url}`)
  await writeFile(dest, Buffer.from(await res.arrayBuffer()))
}

async function ffprobeDuration(file: string): Promise<number> {
  const { stdout } = await exec('ffprobe', ['-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', file])
  const d = parseFloat(stdout.trim())
  if (!Number.isFinite(d) || d <= 0) throw new Error(`无法读取时长: ${file}`)
  return d
}

// PIL 画一张全屏透明字幕 PNG（大字白色黑描边，居中，安全区 y=980）。
const CAPTION_PY = `
import sys, json
from PIL import Image, ImageDraw, ImageFont
font_path, out_dir, caps_json = sys.argv[1], sys.argv[2], sys.argv[3]
caps = json.loads(caps_json)
font = ImageFont.truetype(font_path, 96)
for i, txt in enumerate(caps):
    img = Image.new("RGBA", (1080, 1920), (0, 0, 0, 0)); d = ImageDraw.Draw(img)
    if txt:
        bb = d.textbbox((0, 0), txt, font=font, stroke_width=9)
        x = (1080 - (bb[2] - bb[0])) // 2 - bb[0]
        d.text((x, 980), txt, font=font, fill=(255, 255, 255, 255), stroke_width=9, stroke_fill=(0, 0, 0, 240))
    img.save(f"{out_dir}/cap{i}.png")
`

/** 拼一条任务的成片：下载素材 → 画字幕 → ffmpeg 逐段+concat → 上传 → 标 ready_for_review。 */
export async function assembleRenderJob(jobId: string): Promise<{ outputUrl: string; durationSec: number }> {
  const { data: job, error } = await supabaseAdmin
    .from('content_factory_render_jobs')
    .select('id, client_id, content_post_id, scenes, clip_urls, vo_urls')
    .eq('id', jobId)
    .single<JobRow>()
  if (error || !job) throw new Error(`render job not found: ${jobId}`)

  const clips = job.clip_urls ?? []
  const vos = job.vo_urls ?? []
  const scenes = job.scenes ?? []
  const n = clips.length
  if (n === 0 || vos.length !== n) {
    throw new Error(`素材不齐：画面 ${n} 段 / 配音 ${vos.length} 段`)
  }

  const dir = await mkdtemp(join(tmpdir(), `render-${jobId}-`))
  try {
    // 1) 下载画面 + 配音
    await Promise.all([
      ...clips.map((u, i) => download(u, join(dir, `clip${i}.mp4`))),
      ...vos.map((u, i) => download(u, join(dir, `vo${i}.mp3`))),
    ])

    // 2) PIL 画字幕 PNG
    const caps = Array.from({ length: n }, (_, i) => scenes.find((s) => s.index === i)?.captionText ?? '')
    const pyFile = join(dir, 'caps.py')
    await writeFile(pyFile, CAPTION_PY)
    await exec('python3', [pyFile, CJK_FONT, dir, JSON.stringify(caps)])

    // 3) 逐段：裁竖屏 + 叠字幕 + 配音，时长=配音
    for (let i = 0; i < n; i++) {
      const dur = await ffprobeDuration(join(dir, `vo${i}.mp3`))
      await exec('ffmpeg', [
        '-y', '-loglevel', 'error',
        '-stream_loop', '-1', '-i', join(dir, `clip${i}.mp4`),
        '-i', join(dir, `cap${i}.png`),
        '-i', join(dir, `vo${i}.mp3`),
        '-filter_complex',
        '[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[bg];[bg][1:v]overlay=0:0[v]',
        '-map', '[v]', '-map', '2:a', '-t', String(dur),
        '-r', '30', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-ar', '44100',
        join(dir, `part${i}.mp4`),
      ])
    }

    // 4) concat
    const list = Array.from({ length: n }, (_, i) => `file 'part${i}.mp4'`).join('\n')
    await writeFile(join(dir, 'list.txt'), list)
    const outFile = join(dir, 'final.mp4')
    await exec('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(dir, 'list.txt'), '-c', 'copy', outFile])
    const durationSec = await ffprobeDuration(outFile)

    // 5) 上传成片
    const path = `${job.client_id}/render/${jobId}/final.mp4`
    const bytes = await readFile(outFile)
    const up = await supabaseAdmin.storage.from(BUCKET).upload(path, bytes, { contentType: 'video/mp4', upsert: true })
    if (up.error) throw up.error
    const { data: pub } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path)
    const outputUrl = pub.publicUrl

    // 6) 标成片：任务待审 + 选题挂上视频(看板据此移到「出片」列)
    await patchJob(jobId, { status: 'ready_for_review', output_url: outputUrl })
    await supabaseAdmin
      .from('content_posts')
      .update({ source_video_url: outputUrl })
      .eq('client_id', job.client_id)
      .eq('id', job.content_post_id)

    return { outputUrl, durationSec }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    await patchJob(jobId, { status: 'failed', error: `拼接失败：${message}` }).catch(() => {})
    throw e
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
