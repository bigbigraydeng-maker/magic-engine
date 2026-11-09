import { execFileSync } from 'node:child_process'
// Run in the deployment build before enabling TikTok publishing. No credentials required.
try {
  const output = execFileSync('ffprobe', ['-version'], { encoding: 'utf8', timeout: 10_000, maxBuffer: 64 * 1024 })
  if (!output.startsWith('ffprobe version')) throw new Error('Unexpected executable')
  console.log(output.split('\n')[0])
  console.log('TikTok video inspection runtime: ready')
} catch {
  console.error('TikTok publishing requires ffprobe on PATH. Install ffmpeg/ffprobe before deployment.')
  process.exitCode = 1
}
