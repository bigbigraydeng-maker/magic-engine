import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { bundle } from '@remotion/bundler'
import { renderStill, selectComposition } from '@remotion/renderer'

const FPS_FRAME = 34
const BRAND = '#0B6E99'
const CHROME = process.env.REMOTION_BROWSER_EXECUTABLE || '/usr/bin/google-chrome'

const SHOTS = [
  { file: 'hook-kinetic-9x16.png', kind: 'hook-kinetic', aspect: '9:16', logo: false },
  { file: 'hook-kinetic-1x1.png', kind: 'hook-kinetic', aspect: '1:1', logo: false },
  { file: 'hook-stat-9x16.png', kind: 'hook-stat', aspect: '9:16', logo: false },
  { file: 'hook-question-9x16.png', kind: 'hook-question', aspect: '9:16', logo: false },
  { file: 'end-card-9x16.png', kind: 'end', aspect: '9:16', logo: true },
  { file: 'end-card-1x1.png', kind: 'end', aspect: '1:1', logo: true },
  { file: 'end-card-fallback-9x16.png', kind: 'end-fallback', aspect: '9:16', logo: false },
]

function crc32(buf) {
  let c = ~0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ~c >>> 0
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([length, typeBuf, data, crc])
}

function writeRgbaPng(file, width, height, pixelAt) {
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1)
    raw[row] = 0
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixelAt(x, y)
      const at = row + 1 + x * 4
      raw[at] = r
      raw[at + 1] = g
      raw[at + 2] = b
      raw[at + 3] = a
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const png = Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
  fs.writeFileSync(file, png)
}

function logoPixel(x, y) {
  const cream = [244, 241, 234, 255]
  const blue = [11, 110, 153, 255]
  if (x < 28) return blue
  const dx = x - 400
  const dy = y - 90
  if (dx * dx + dy * dy < 46 * 46) return blue
  return cream
}

function shotProps(shot) {
  return {
    kind: shot.kind,
    aspect: shot.aspect,
    brandColor: BRAND,
    logoFile: shot.logo ? 'logo.png' : undefined,
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
  writeRgbaPng(path.join(publicDir, 'logo.png'), 480, 180, logoPixel)
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
