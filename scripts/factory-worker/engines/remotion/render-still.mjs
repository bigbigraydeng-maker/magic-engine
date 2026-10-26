import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundle } from '@remotion/bundler'
import { renderStill, selectComposition } from '@remotion/renderer'

const FPS_FRAME = 34
const BRAND = '#0B6E99'
const CHROME = process.env.REMOTION_BROWSER_EXECUTABLE || '/usr/bin/google-chrome'

const SHOTS = [
  { file: 'hook-kinetic-9x16.png', kind: 'hook-kinetic', aspect: '9:16' },
  { file: 'hook-kinetic-1x1.png', kind: 'hook-kinetic', aspect: '1:1' },
  { file: 'hook-stat-9x16.png', kind: 'hook-stat', aspect: '9:16' },
  { file: 'hook-question-9x16.png', kind: 'hook-question', aspect: '9:16' },
  { file: 'end-card-9x16.png', kind: 'end', aspect: '9:16' },
  { file: 'end-card-1x1.png', kind: 'end', aspect: '1:1' },
  { file: 'end-card-fallback-9x16.png', kind: 'end-fallback', aspect: '9:16' },
]

function shotProps(shot) {
  return {
    kind: shot.kind,
    aspect: shot.aspect,
    brandColor: BRAND,
    backgroundFile: 'busy.jpg',
  }
}

async function renderShot(serveUrl, publicDir, outDir, shot) {
  const inputProps = shotProps(shot)
  const composition = await selectComposition({
    serveUrl,
    id: 'FramePreview',
    inputProps,
    browserExecutable: CHROME,
  })
  const output = path.join(outDir, shot.file)
  await renderStill({
    composition,
    serveUrl,
    output,
    frame: FPS_FRAME,
    imageFormat: 'png',
    inputProps,
    browserExecutable: CHROME,
  })
  const size = fs.statSync(output).size
  process.stdout.write(`${shot.file} ${composition.width}x${composition.height} ${size} bytes\n`)
}

async function main() {
  const outDir = process.argv[2] || '/opt/cursor/artifacts/remotion-frames'
  fs.mkdirSync(outDir, { recursive: true })
  const publicDir = fs.mkdtempSync(path.join(os.tmpdir(), 'frame-preview-'))
  const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'busy-street.jpg')
  fs.copyFileSync(fixture, path.join(publicDir, 'busy.jpg'))
  const entry = path.join(path.dirname(fileURLToPath(import.meta.url)), 'src', 'index.ts')
  const serveUrl = await bundle({ entryPoint: entry, publicDir })
  try {
    for (const shot of SHOTS) {
      await renderShot(serveUrl, publicDir, outDir, shot)
    }
  } finally {
    fs.rmSync(serveUrl, { recursive: true, force: true })
    fs.rmSync(publicDir, { recursive: true, force: true })
  }
}

main().catch((err) => {
  process.stderr.write(`${err.stack || err.message}\n`)
  process.exit(1)
})
