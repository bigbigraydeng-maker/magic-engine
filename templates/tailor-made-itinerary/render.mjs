#!/usr/bin/env node
/**
 * Render a tailor-made itinerary PDF from a JSON data file.
 *
 *   node render.mjs <data.json> [output.pdf]
 *
 * Injects the data into itinerary-template.html and prints it to PDF with
 * headless Chrome. No dependencies — Chrome is the only requirement.
 */
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const START = '/*__DATA_START__*/'
const END = '/*__DATA_END__*/'

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  process.env.CHROME_PATH,
].filter(Boolean)

function findChrome() {
  for (const p of CHROME_CANDIDATES) {
    try { readFileSync(p); return p } catch { /* keep looking */ }
  }
  throw new Error('Chrome not found. Install Google Chrome or set CHROME_PATH.')
}

const dataPath = process.argv[2]
if (!dataPath) {
  console.error('Usage: node render.mjs <data.json> [output.pdf]')
  process.exit(1)
}

const data = readFileSync(resolve(dataPath), 'utf8')
JSON.parse(data) // fail early on malformed JSON

const template = readFileSync(join(HERE, 'itinerary-template.html'), 'utf8')
const a = template.indexOf(START)
const b = template.indexOf(END)
if (a === -1 || b === -1) throw new Error('Template is missing its data markers.')

const html = template.slice(0, a + START.length) + data.trim() + template.slice(b)

const work = mkdtempSync(join(tmpdir(), 'cts-itinerary-'))
const htmlPath = join(work, 'itinerary.html')
writeFileSync(htmlPath, html)

const out = resolve(process.argv[3] || 'itinerary.pdf')
execFileSync(findChrome(), [
  '--headless',
  '--disable-gpu',
  '--no-pdf-header-footer',
  '--virtual-time-budget=10000',
  `--print-to-pdf=${out}`,
  pathToFileURL(htmlPath).href,
], { stdio: 'ignore' })

console.log(`PDF written to ${out}`)
