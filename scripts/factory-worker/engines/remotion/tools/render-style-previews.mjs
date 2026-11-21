import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { bundle } from '@remotion/bundler'
import { openBrowser, renderMedia, renderStill, selectComposition } from '@remotion/renderer'
import { FAMILY_NAME, studyPlan } from '../src/styles/craft.ts'
import { resolveStyle } from '../src/styles/select.ts'
import { PRESET_IDS } from '../src/styles/types.ts'
import { loadTemplate } from '../src/templates.ts'
import { makePlaceholderAssets } from './make-placeholder-assets.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const entry = path.join(here, '..', 'src', 'index.ts')
const outRoot = '/opt/cursor/artifacts/styles'
const chrome = '/usr/bin/google-chrome'
const labelFont = '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc'
const logFile = '/tmp/style-previews.log'

const BRANDS = [
  { id: 'a', name: '示例客户 A', primary: '#e10600', secondary: '#1b1b1b', font: 'sans' },
  { id: 'b', name: '示例客户 B', primary: '#0b3d2e', secondary: '#f3e2b3', font: 'serif' },
]
const BRAND_PACKS = ['vivid', 'travel', 'retail']

function log(line) {
  fs.appendFileSync(logFile, `${line}\n`)
}

function beat(clip, line) {
  return {
    clip,
    line,
    sourceUrl: 'https://example.com/bowl',
    sourceQuote: line,
  }
}

function compareProps() {
  return {
    brandColor: '#1f7a4d',
    logoFile: 'logo.png',
    musicFile: null,
    hook: '看这一下',
    point: '台面擦干净',
    before: beat('clips/hook.mp4', '油污还在'),
    process: beat('clips/item1.mp4', '正在擦洗'),
    after: beat('clips/item2.mp4', '台面干净了'),
  }
}

function writeMark(file, color, letter) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const result = spawnSync('ffmpeg', [
    '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=470x171`,
    '-frames:v', '1',
    '-vf', `drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='${letter}':fontsize=90:fontcolor=white:x=36:y=36`,
    file,
  ], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr?.slice(-400) || 'logo failed')
}

function shots(total) {
  return {
    open: Math.min(8, total - 1),
    mid: Math.max(0, Math.floor(total / 2)),
    end: Math.max(0, total - 8),
  }
}

function collage(files, captions, dest, columns) {
  const py = `
import sys
from PIL import Image, ImageDraw, ImageFont
files = sys.argv[1].split('|')
caps = sys.argv[2].split('|')
dest, cols, font_path = sys.argv[3], int(sys.argv[4]), sys.argv[5]
thumb_w, thumb_h, label_h, pad = 180, 320, 48, 8
rows = (len(files) + cols - 1) // cols
sheet = Image.new('RGB', (cols * (thumb_w + pad) + pad, rows * (thumb_h + label_h + pad) + pad), (24, 24, 24))
draw = ImageDraw.Draw(sheet)
font = ImageFont.truetype(font_path, 16)
for i, (src, cap) in enumerate(zip(files, caps)):
    im = Image.open(src).convert('RGB').resize((thumb_w, thumb_h))
    x = pad + (i % cols) * (thumb_w + pad)
    y = pad + (i // cols) * (thumb_h + label_h + pad)
    sheet.paste(im, (x, y))
    draw.text((x, y + thumb_h + 4), cap, fill=(245, 245, 245), font=font)
sheet.save(dest)
`
  const result = spawnSync('python3', ['-c', py, files.join('|'), captions.join('|'), dest, String(columns), labelFont], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr || 'collage failed')
}

async function still(browser, serveUrl, composition, props, frame, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  await renderStill({
    composition,
    serveUrl,
    output: file,
    frame,
    inputProps: props,
    imageFormat: 'png',
    scale: 0.5,
    overwrite: true,
    timeoutInMilliseconds: 180000,
    puppeteerInstance: browser,
    chromiumOptions: { gl: 'swangle' },
  })
}

async function clip(browser, serveUrl, composition, props, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.rmSync(file, { force: true })
  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    crf: 28,
    outputLocation: file,
    inputProps: props,
    scale: 0.5,
    concurrency: 1,
    overwrite: true,
    timeoutInMilliseconds: 180000,
    puppeteerInstance: browser,
    chromiumOptions: { gl: 'swangle' },
    muted: true,
  })
}

async function main() {
  fs.writeFileSync(logFile, '')
  const publicDir = path.join(here, '..', '.style-preview-public')
  fs.rmSync(publicDir, { recursive: true, force: true })
  makePlaceholderAssets(publicDir)
  writeMark(path.join(publicDir, 'marks', 'a.png'), '0xE10600', 'A')
  writeMark(path.join(publicDir, 'marks', 'b.png'), '0x0B3D2E', 'B')
  const limit = Number(process.env.PREVIEW_LIMIT || 0)
  const ids = limit > 0 ? PRESET_IDS.slice(0, limit) : [...PRESET_IDS]
  log(`plan ${ids.length}`)
  const serveUrl = await bundle({ entryPoint: entry, publicDir })
  log(`bundled ${serveUrl}`)
  const browser = await openBrowser('chrome', {
    browserExecutable: chrome,
    chromeMode: 'chrome-for-testing',
    chromiumOptions: { gl: 'swangle' },
  })
  const mids = []
  try {
    for (const id of ids) {
      const look = resolveStyle({ preset: id })
      const props = { look }
      const composition = await selectComposition({
        serveUrl,
        id: 'StyleStudy',
        inputProps: props,
        puppeteerInstance: browser,
        timeoutInMilliseconds: 180000,
      })
      const plan = studyPlan(look.craft)
      const frame = shots(plan.totalFrames)
      const mp4 = path.join(outRoot, 'clips', `${id}.mp4`)
      log(`mp4 ${id} ${plan.totalFrames}`)
      await clip(browser, serveUrl, composition, props, mp4)
      for (const name of ['open', 'mid', 'end']) {
        const file = path.join(outRoot, 'frames', `${id}-${name}.png`)
        await still(browser, serveUrl, composition, props, frame[name], file)
        if (name === 'mid') mids.push({ file, caption: `${FAMILY_NAME[look.craft.family]} ${look.name}` })
      }
      log(`frames ${id}`)
    }
    if (limit === 0 || limit > 3) {
      for (const brand of BRANDS) {
        for (const id of BRAND_PACKS) {
          const look = resolveStyle({
            preset: id,
            brand: { primary: brand.primary, secondary: brand.secondary, font: brand.font, logo: `marks/${brand.id}.png` },
          })
          const props = { look }
          const composition = await selectComposition({
            serveUrl,
            id: 'StyleStudy',
            inputProps: props,
            puppeteerInstance: browser,
            timeoutInMilliseconds: 180000,
          })
          const frame = shots(studyPlan(look.craft).totalFrames)
          for (const name of ['open', 'mid', 'end']) {
            const file = path.join(outRoot, 'brands', `${brand.id}-${id}-${name}.png`)
            log(file)
            await still(browser, serveUrl, composition, props, frame[name], file)
          }
        }
      }
      for (const id of ['home', 'beauty']) {
        const loaded = loadTemplate('compare', compareProps(), { preset: id })
        const composition = await selectComposition({
          serveUrl,
          id: 'CompareReel',
          inputProps: loaded.props,
          puppeteerInstance: browser,
          timeoutInMilliseconds: 180000,
        })
        const frame = shots(loaded.totalFrames)
        for (const name of ['open', 'mid', 'end']) {
          const file = path.join(outRoot, 'compare', `${id}-${name}.png`)
          log(file)
          await still(browser, serveUrl, composition, loaded.props, frame[name], file)
        }
      }
    }
  } catch (err) {
    log(`render-error ${(err && err.stack) || err}`)
    throw err
  } finally {
    await browser.close({ silent: true })
  }
  if (mids.length > 0) {
    collage(mids.map((row) => row.file), mids.map((row) => row.caption), path.join(outRoot, 'overview-styles.png'), 4)
  }
  log(`done ${ids.length}`)
}

main().catch((err) => {
  process.stderr.write(`${err.stack || err.message}\n`)
  process.exit(1)
})
