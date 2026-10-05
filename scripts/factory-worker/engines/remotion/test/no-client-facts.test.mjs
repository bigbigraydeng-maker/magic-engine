import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

// Client-specific facts that must never appear in this generic template.
const BANNED = [
  { name: 'CTS', re: /\bCTS\b/i, sample: 'ask CTS Tours' },
  { name: 'ctstours', re: /ctstours/i, sample: 'ctstours.co.nz' },
  { name: 'NZ$', re: /NZ\$/, sample: 'NZ$10,899' },
  { name: 'China Panorama', re: /China\s+Panorama/i, sample: 'China Panorama' },
  { name: '10,899', re: /10,?899/, sample: '10,899' },
  { name: 'Auckland', re: /Auckland/i, sample: 'from Auckland' },
  { name: 'Yangtze', re: /Yangtze/i, sample: 'Yangtze river' },
]

const ROOT = new URL('..', import.meta.url)

// Recursively collect every file under a path, skipping node_modules.
const walk = (target, out) => {
  let stat
  try {
    stat = fs.statSync(target)
  } catch {
    return
  }
  if (stat.isFile()) {
    out.push(target)
    return
  }
  if (!stat.isDirectory()) {
    return
  }
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (entry.name === 'node_modules') {
      continue
    }
    walk(path.join(target, entry.name), out)
  }
}

// Build the list of files to scan.
const collectFiles = () => {
  const files = []
  for (const rel of ['src', 'examples', 'tools']) {
    walk(new URL(rel, ROOT).pathname, files)
  }
  const render = new URL('render.mjs', ROOT).pathname
  if (fs.existsSync(render)) {
    files.push(render)
  }
  return files
}

const FILES = collectFiles()

// Scan every file for every banned term, returning 'file:line  <term>' hits.
const scan = () => {
  const hits = []
  for (const file of FILES) {
    const text = fs.readFileSync(file, 'utf8')
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      for (const term of BANNED) {
        if (term.re.test(lines[i])) {
          hits.push(`${file}:${i + 1}  ${term.name}`)
        }
      }
    }
  }
  return hits
}

describe('scanner self-check', () => {
  test('every banned pattern matches its sample', () => {
    for (const term of BANNED) {
      assert.ok(term.re.test(term.sample), `pattern ${term.name} did not match`)
    }
  })

  test('a clean string matches none of the patterns', () => {
    const clean = 'effects of acting in Sydney'
    for (const term of BANNED) {
      assert.ok(!term.re.test(clean), `pattern ${term.name} matched clean text`)
    }
  })
})

describe('no client facts in the package', () => {
  test('the scan finds no banned terms', () => {
    const hits = scan()
    assert.deepEqual(hits, [], `banned terms found:\n${hits.join('\n')}`)
  })

  test('src/Root.tsx does not contain defaultProps', () => {
    const file = new URL('src/Root.tsx', ROOT).pathname
    if (fs.existsSync(file)) {
      const text = fs.readFileSync(file, 'utf8')
      assert.ok(!text.includes('defaultProps'))
    }
  })

  test('src/schema.ts does not contain .default(', () => {
    const file = new URL('src/schema.ts', ROOT).pathname
    const text = fs.readFileSync(file, 'utf8')
    assert.ok(!text.includes('.default('))
  })

  test('the walked file list is not empty and covers key files', () => {
    assert.ok(FILES.length > 0)
    const names = FILES.map((f) => f.replace(/\\/g, '/'))
    assert.ok(names.some((n) => n.endsWith('src/ListReel.tsx')))
    assert.ok(names.some((n) => n.endsWith('src/schema.ts')))
    assert.ok(names.some((n) => n.endsWith('render.mjs')))
  })
})
