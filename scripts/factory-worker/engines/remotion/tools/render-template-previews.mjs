import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { bundle } from '@remotion/bundler'
import { openBrowser, renderMedia, selectComposition } from '@remotion/renderer'
import { studyPlan } from '../src/styles/craft.ts'
import { loadTemplate } from '../src/templates.ts'
import { makePlaceholderAssets } from './make-placeholder-assets.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const entry = path.join(here, '..', 'src', 'index.ts')
const outDir = '/opt/cursor/artifacts/styles/templates'
const chrome = '/usr/bin/google-chrome'
const logFile = '/tmp/template-previews.log'
const PACKS = ['vivid', 'travel', 'b2b']

function log(line) {
  fs.appendFileSync(logFile, `${line}\n`)
}

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(here, '..', 'examples', name), 'utf8'))
}

function montageProps() {
  const files = ['hook', 'item1', 'item2', 'item3', 'item4', 'item5', 'item6', 'item7']
  const kinds = ['aerial', 'street', 'person', 'detail']
  const clips = files.map((name, i) => ({
    file: `clips/${name}.mp4`,
    tag: i % 2 === 0 ? 'beach' : 'kitchen',
    kind: kinds[i % 4],
    source: 'own',
    lenFrames: 120,
  }))
  const words = []
  for (let i = 0; i < 10; i++) {
    words.push({ at: i * 2, beats: 1, text: i === 0 ? '1 个开头' : `词${i}`, bg: 'black', rot: 0 })
  }
  const beats = []
  for (let i = 0; i < 40; i++) beats.push(0.5 + i * 0.45)
  return {
    brandColor: '#0B6E99',
    logoFile: 'logo.png',
    musicFile: 'track.m4a',
    beats,
    totalBeats: 32,
    fastBars: [2, 5],
    placeTerms: [],
    words,
    clips,
  }
}

function atmosphereProps() {
  return {
    logoFile: 'logo.png',
    musicFile: null,
    clip: 'clips/hook.mp4',
    durationSec: 15,
    line: {
      text: '热汤刚出锅',
      sourceUrl: 'https://example.com/bowl',
      sourceQuote: '热汤刚出锅',
    },
  }
}

function jobs() {
  return [
    ['list', readJson('sydney-apartment.props.json')],
    ['montage', montageProps()],
    ['datacard', readJson('fictional-datacard.props.json')],
    ['atmosphere', atmosphereProps()],
  ]
}

function silentTrack(file) {
  const result = spawnSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-t', '2', '-c:a', 'aac', file], { encoding: 'utf8' })
  if (result.status !== 0) throw new Error(result.stderr || 'silent track failed')
}

async function main() {
  fs.writeFileSync(logFile, '')
  fs.mkdirSync(outDir, { recursive: true })
  const publicDir = path.join(here, '..', '.style-preview-public')
  fs.rmSync(publicDir, { recursive: true, force: true })
  makePlaceholderAssets(publicDir)
  silentTrack(path.join(publicDir, 'track.m4a'))
  const serveUrl = await bundle({ entryPoint: entry, publicDir })
  log(`bundled ${serveUrl}`)
  const browser = await openBrowser('chrome', {
    browserExecutable: chrome,
    chromeMode: 'chrome-for-testing',
    chromiumOptions: { gl: 'swangle' },
  })
  try {
    for (const [template, raw] of jobs()) {
      for (const pack of PACKS) {
        const loaded = loadTemplate(template, raw, { preset: pack })
        const composition = await selectComposition({
          serveUrl,
          id: loaded.compositionId,
          inputProps: loaded.props,
          puppeteerInstance: browser,
          timeoutInMilliseconds: 180000,
        })
        const want = studyPlan(loaded.props.look.craft).totalFrames
        const frames = Math.min(want, composition.durationInFrames)
        const file = path.join(outDir, `${template}-${pack}.mp4`)
        log(`mp4 ${template} ${pack} ${frames} of ${composition.durationInFrames}`)
        fs.rmSync(file, { force: true })
        await renderMedia({
          composition,
          serveUrl,
          codec: 'h264',
          crf: 28,
          outputLocation: file,
          inputProps: loaded.props,
          frameRange: [0, frames - 1],
          scale: 0.5,
          concurrency: 1,
          overwrite: true,
          timeoutInMilliseconds: 180000,
          puppeteerInstance: browser,
          chromiumOptions: { gl: 'swangle' },
          muted: true,
        })
      }
    }
  } catch (err) {
    log(`render-error ${(err && err.stack) || err}`)
    throw err
  } finally {
    await browser.close({ silent: true })
  }
  log('done 12')
}

main().catch((err) => {
  fs.appendFileSync(logFile, `EXIT:1 ${(err && err.stack) || err}\n`)
  process.exit(1)
})
