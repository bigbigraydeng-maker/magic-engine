import { createHash } from 'crypto'
import { mkdtemp, open, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
const exec = promisify(execFile)
const MAX_BYTES = 256 * 1024 * 1024
/** Inspect the actual stored file with bounded disk streaming; never trust browser duration. */
export async function inspectTikTokVideo(url: string): Promise<{ sha256: string; durationSeconds: number }> {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:') throw new Error('成片地址必须使用 HTTPS')
  const dir = await mkdtemp(join(tmpdir(), 'me-tiktok-proof-'))
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000) })
    if (!response.ok || !response.body) throw new Error('无法读取成片进行核验')
    if (Number(response.headers.get('content-length')) > MAX_BYTES) {
      await response.body.cancel()
      throw new Error('成片超过当前发布核验上限 256 MiB')
    }
    const file = join(dir, 'video.mp4')
    const handle = await open(file, 'wx')
    const reader = response.body.getReader()
    const hash = createHash('sha256')
    let size = 0
    try {
      for (;;) {
        const part = await reader.read()
        if (part.done) break
        size += part.value.byteLength
        if (size > MAX_BYTES) throw new Error('成片超过当前发布核验上限 256 MiB')
        hash.update(part.value)
        let offset = 0
        while (offset < part.value.byteLength) {
          const result = await handle.write(part.value, offset, part.value.byteLength - offset)
          if (!result.bytesWritten) throw new Error('成片核验文件写入失败')
          offset += result.bytesWritten
        }
      }
    } finally { await reader.cancel().catch(() => {}); await handle.close() }
    let stdout: string
    try {
      const result = await exec('ffprobe', ['-v','error','-protocol_whitelist','file,pipe','-show_entries','format=duration:stream=codec_type','-of','json',file], { timeout:30_000,maxBuffer:64*1024 })
      stdout = result.stdout
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new Error('发布服务缺少 ffprobe，请管理员配置视频核验依赖')
      throw error
    }
    const info = JSON.parse(stdout) as {format?: {duration?: string};streams?: {codec_type?:string}[]}
    const durationSeconds = Number(info.format?.duration)
    if (!info.streams?.some(s => s.codec_type === 'video') || !Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error('成片文件无法识别为有效视频')
    return { sha256:hash.digest('hex'),durationSeconds }
  } finally { await rm(dir, { recursive:true,force:true }) }
}
