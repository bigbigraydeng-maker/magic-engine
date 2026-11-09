import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { parseArgs } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'

const USAGE = `用法：node tools/make-placeholder-assets.mjs --out <dir>

选项：
  --out <dir>   必填，素材输出目录
  -h, --help    显示本帮助`

/** Fixed palette of colour pairs used to make each clip look different. */
const PALETTE = [
  ['0x1f4e79', '0x0b6e99'],
  ['0x2e7d32', '0x81c784'],
  ['0x6a1b9a', '0xba68c8'],
  ['0xb71c1c', '0xef9a9a'],
  ['0xef6c00', '0xffcc80'],
  ['0x00695c', '0x4db6ac'],
  ['0x283593', '0x7986cb'],
  ['0x4e342e', '0xa1887f'],
  ['0x37474f', '0x90a4ae'],
]

/** Clip file names in creation order. */
const CLIP_NAMES = [
  'hook.mp4',
  'item1.mp4',
  'item2.mp4',
  'item3.mp4',
  'item4.mp4',
  'item5.mp4',
  'item6.mp4',
  'item7.mp4',
  'price.mp4',
]

/** Run ffmpeg with an args array (never a shell string). */
function runFfmpeg(args) {
  const result = spawnSync('ffmpeg', args, { encoding: 'utf8' })
  if (result.error) {
    if (result.error.code === 'ENOENT') {
      process.stderr.write('找不到 ffmpeg，请先安装（brew install ffmpeg）\n')
      process.exit(1)
    }
    process.stderr.write(`ffmpeg 启动失败：${result.error.message}\n`)
    process.exit(1)
  }
  if (result.status !== 0) {
    const tail = (result.stderr || '').slice(-400)
    process.stderr.write(`ffmpeg 执行失败：\n${tail}\n`)
    process.exit(1)
  }
}

/** Build the ffmpeg args for one gradient clip. */
function clipArgs(file, colors) {
  const [c0, c1] = colors
  return [
    '-y',
    '-f',
    'lavfi',
    '-i',
    `gradients=s=1080x1920:r=30:d=14:c0=${c0}:c1=${c1}:speed=0.03`,
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-an',
    '-t',
    '14',
    file,
  ]
}

/** Create the placeholder clips and logo inside outDir, skipping existing files. */
export function makePlaceholderAssets(outDir) {
  const clipsDir = path.join(outDir, 'clips')
  fs.mkdirSync(clipsDir, { recursive: true })

  const created = []

  CLIP_NAMES.forEach((name, index) => {
    const file = path.join(clipsDir, name)
    if (fs.existsSync(file)) return
    runFfmpeg(clipArgs(file, PALETTE[index % PALETTE.length]))
    created.push(file)
  })

  const logoFile = path.join(outDir, 'logo.png')
  if (!fs.existsSync(logoFile)) {
    runFfmpeg([
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=0x0B6E99:s=470x171',
      '-frames:v',
      '1',
      logoFile,
    ])
    created.push(logoFile)
  }

  return created
}

/** Parse the command line and return the resolved output directory. */
function parseCliArgs(argv) {
  let parsed
  try {
    parsed = parseArgs({
      args: argv,
      strict: true,
      allowPositionals: false,
      options: {
        out: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
    })
  } catch (err) {
    process.stderr.write(`命令行参数错误：${err.message}\n\n${USAGE}\n`)
    process.exit(2)
  }

  if (parsed.values.help) {
    process.stdout.write(`${USAGE}\n`)
    process.exit(0)
  }

  const out = parsed.values.out
  if (!out) {
    process.stderr.write(`缺少必填选项 --out\n\n${USAGE}\n`)
    process.exit(2)
  }

  return path.resolve(out)
}

/** CLI entry point. */
function main() {
  const outDir = parseCliArgs(process.argv.slice(2))
  const created = makePlaceholderAssets(outDir)
  process.stdout.write(`已创建 ${created.length} 个占位素材文件，输出目录：${outDir}\n`)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
