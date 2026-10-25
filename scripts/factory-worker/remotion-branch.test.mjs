// Vitest for remotion-branch.mjs. All IO is faked through `deps`; real temp dirs are used only for files.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, symlinkSync, existsSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { RemotionOrderError, resolveEngine, checkRemotionHealth, processRemotionOrder, runRemotionRender, copyWithinRoot, assertMontageTextVisible, REMOTION_ENGINE_DIR, loadRemotionEngine, buildRemotionText, defaultMusicVocalGate, MUSIC_VOCAL_REGISTRY_PATH, buildAtmosphereText, buildAtmosphereCaption, buildAtmosphereSrt, assertAtmosphereTextVisible, assertAtmosphereClipUsable, defaultProbeClip } from './remotion-branch.mjs'
import { MusicVocalGateError } from './music-vocal-gate.mjs'
import { createHash } from 'node:crypto'

const roots = []
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true })
})

function makeEnv() {
  const root = mkdtempSync(join(tmpdir(), 'remotion-test-'))
  roots.push(root)
  const studio = join(root, 'studio')
  const acme = join(studio, 'ACME')
  mkdirSync(join(acme, 'brandkit', 'assets'), { recursive: true })
  writeFileSync(join(acme, 'brandkit', 'assets', 'watermark.png'), 'WATERMARK-BYTES')
  const lib = join(acme, 'remotion-assets')
  mkdirSync(join(lib, 'clips'), { recursive: true })
  for (const n of ['h', 'a', 'b', 'c', 'p']) writeFileSync(join(lib, 'clips', `${n}.mp4`), `clip-${n}`)
  const tmp = join(root, 'tmp')
  mkdirSync(tmp, { recursive: true })
  return { root, studio, acme, lib, tmp }
}

const PROPS = {
  logoFile: 'logo.png', musicFile: null, brandColor: '#112233', itemOverlayOpacity: 0.4,
  hook: { clip: 'clips/h.mp4', lines: [{ badge: '2', text: 'BEDS' }, { badge: null, text: 'VIEWS' }, { badge: null, text: 'OPEN' }] },
  items: [
    { text: 'ITEM ONE', clip: 'clips/a.mp4', blurBackdrop: false },
    { text: 'ITEM TWO', clip: 'clips/b.mp4', blurBackdrop: false },
    { text: 'ITEM THREE', clip: 'clips/c.mp4', blurBackdrop: false },
  ],
  itemLabel: 'INCLUDED', revealTitle: 'THE LIST.',
  price: { backdropClip: 'clips/p.mp4', fromLabel: 'FROM', currencyPrefix: 'A$', amount: 12345, qualifier: 'PER PERSON', dateLine: 'SAT 12 OCT', footnote: 'EXAMPLE ONLY' },
}

const FILES = ['logo.png', 'clips/h.mp4', 'clips/a.mp4', 'clips/b.mp4', 'clips/c.mp4', 'clips/p.mp4']
const TIMING = { hookFrames: 60, itemFrom: [60, 120, 180], itemDur: [60, 60, 60], revealFrom: 240, totalFrames: 360 }

const MONTAGE_PROPS = { logoFile: 'logo.png', musicFile: 'song-one.m4a', totalBeats: 8, beats: [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5], words: [{ at: 0, beats: 1, text: '3 BED' }, { at: 1, beats: 2, text: 'OPEN SAT' }] }
const MONTAGE_FILES = ['logo.png', 'song-one.m4a', 'clips/a.mp4', 'clips/b.mp4']

function makeEngine(over = {}) {
  return {
    FPS: 30,
    isTemplateId: (id) => id === 'list' || id === 'montage' || id === 'impact',
    loadTemplate: (id, p) => ({
      compositionId: id === 'list' ? 'ListReel' : 'MontageReel',
      props: p,
      assetFiles: id === 'list' ? FILES : MONTAGE_FILES,
      totalFrames: id === 'list' ? 360 : 150,
    }),
    computeTimingFromProps: () => TIMING,
    montageFrameOf: (beats, i) => (i === 0 ? 0 : Math.round(beats[i] * 30) + 2),
    musicSourceFor: () => null,
    contentSubstanceOf: () => ({ verdict: 'pass', kinds: ['brand_card'], textSeconds: 3, reason: 'ok', texts: [] }),
    ...over,
  }
}

function makeWo(over = {}) {
  return {
    work_order_id: 'wo-1', client_id: 'client-a',
    brief: { engine: 'remotion', remotion: { template: 'list', props: PROPS }, ...over },
    uploads: {
      video: { signed_url: 'https://sig/v', path: 'renders/c/wo-1/final.mp4' },
      segments_json: { signed_url: 'https://sig/s', path: 'renders/c/wo-1/segments.json' },
      srt: { signed_url: 'https://sig/t', path: 'renders/c/wo-1/captions.srt' },
    },
  }
}

function makeDeps(env, over = {}) {
  return {
    log: vi.fn(),
    heartbeatFn: vi.fn(async () => ({ ok: true, abort: false })),
    uploadSignedFn: vi.fn(async () => {}),
    completeFn: vi.fn(async () => ({ ok: true, status: 200, json: { status: 'in_review' } })),
    probeMediaEvidenceFn: vi.fn(() => ({ width: 1080, height: 1920, duration_seconds: 12, audio_stream_present: true })),
    brandkitFor: vi.fn(() => join(env.root, 'studio/ACME/brandkit')),
    studioRoot: join(env.root, 'studio'),
    clientStudio: { 'client-a': 'ACME' },
    allowedClientIds: ['client-a'],
    workerId: 'w1',
    healthFn: () => [],
    loadEngineFn: async () => makeEngine(),
    renderFn: vi.fn(async ({ outFile }) => { writeFileSync(outFile, 'video-bytes'); return { code: 0, stderrTail: '' } }),
    musicVocalGateFn: vi.fn(async ({ label }) => ({ sha256: 'a'.repeat(64), verdict: 'none', strength: 'signed', name: label, window: [0, 1], cleanUntilSec: null })),
    heartbeatIntervalMs: 10, timeoutSec: 600,
    ...over,
  }
}

const run = (env, deps, wo = makeWo()) => processRemotionOrder({ wo, tmp: env.tmp, deps })
const errOf = (p) => p.then(() => null, (e) => e)
const waitAbort = ({ signal }) => new Promise((r) => signal.addEventListener('abort', () => r({ code: null, stderrTail: '' }), { once: true }))
const recordingRender = (deps, fn) => {
  const inner = deps.renderFn
  deps.renderFn = vi.fn(async (a) => { fn(a); return inner(a) })
}
const sequence = (codes) => {
  let i = 0
  return vi.fn(async ({ outFile }) => {
    const code = codes[Math.min(i++, codes.length - 1)]
    if (code === 0) writeFileSync(outFile, 'video-bytes')
    return { code, stderrTail: code === 0 ? '' : `tail-${code}` }
  })
}

describe('resolveEngine', () => {
  it('defaults to legacy, accepts remotion, refuses unknown', () => {
    expect(resolveEngine({})).toBe('legacy')
    expect(resolveEngine({ engine: 'remotion' })).toBe('remotion')
    for (const engine of ['legacy', '', 'ffmpeg']) {
      const err = (() => { try { resolveEngine({ engine }) } catch (e) { return e } })()
      expect(err).toBeInstanceOf(RemotionOrderError)
      expect(err.retryable).toBe(false)
    }
  })
})

describe('processRemotionOrder refusals', () => {
  it.each([
    ['client not allowed', { client_id: 'client-z' }, {}, {}, null],
    ['creative_recipe present', {}, { creative_recipe: { id: 'x' } }, {}, null],
    ['reopened_from', {}, { reopened_from: 'wo-0' }, {}, null],
    ['remotion missing', {}, { remotion: undefined }, {}, null],
    ['health problems', {}, {}, { healthFn: () => ['缺少 zod'] }, /出片机还没装好 Remotion/],
    ['bad props', {}, {}, { loadEngineFn: async () => makeEngine({ loadTemplate: () => { throw new Error('字段 hook：太长') } }) }, /字段 hook：太长/],
  ])('%s', async (_name, woOver, briefOver, depsOver, re) => {
    const env = makeEnv()
    const deps = makeDeps(env, depsOver)
    const wo = makeWo(briefOver)
    Object.assign(wo, woOver)
    const err = await errOf(run(env, deps, wo))
    expect(err).toBeInstanceOf(RemotionOrderError)
    expect(err.retryable).toBe(false)
    if (re) expect(err.message).toMatch(re)
    expect(deps.renderFn).not.toHaveBeenCalled()
    expect(deps.uploadSignedFn).not.toHaveBeenCalled()
    expect(deps.completeFn).not.toHaveBeenCalled()
  })
})

describe('checkRemotionHealth', () => {
  it('reports missing deps, bad browser, old Node, and is clean on Node 22.18', () => {
    const nothing = checkRemotionHealth({ existsFn: () => false }).join(' ')
    expect(nothing).toMatch(/npm ci/)
    expect(nothing).toMatch(/浏览器/)
    const badBrowser = checkRemotionHealth({ env: { REMOTION_BROWSER_EXECUTABLE: '/nope' }, existsFn: (x) => x !== '/nope' }).join(' ')
    expect(badBrowser).toContain('/nope')
    expect(checkRemotionHealth({ nodeVersion: '20.1.0', existsFn: () => true }).join(' ')).toMatch(/Node/)
    expect(checkRemotionHealth({ nodeVersion: '22.18.0', existsFn: () => true })).toEqual([])
  })
})

describe('happy path', () => {
  it('renders, uploads three artifacts, completes, and captions every string', async () => {
    const env = makeEnv()
    const deps = makeDeps(env)
    let staged = null
    let logoBytes = null
    recordingRender(deps, (args) => {
      staged = readdirSync(args.publicDir, { recursive: true }).map(String)
      logoBytes = readFileSync(join(args.publicDir, 'logo.png'))
    })
    const props = { ...PROPS, hook: { ...PROPS.hook, lines: [{ badge: '2', text: 'BE\u200bDS' }, ...PROPS.hook.lines.slice(1)] } }
    const wo = makeWo({ remotion: { template: 'list', props } })
    const res = await run(env, deps, wo)
    expect(res).toEqual({ ok: true, cost: 0 })
    expect(deps.renderFn).toHaveBeenCalledTimes(1)
    expect(staged).toContain('logo.png')
    expect(staged).toContain(join('clips', 'a.mp4'))
    expect(logoBytes.toString()).toBe('WATERMARK-BYTES')
    expect(deps.uploadSignedFn).toHaveBeenCalledTimes(3)
    expect(deps.uploadSignedFn.mock.calls.map((c) => c[0])).toEqual([
      wo.uploads.video.signed_url, wo.uploads.segments_json.signed_url, wo.uploads.srt.signed_url,
    ])
    expect(deps.completeFn).toHaveBeenCalledTimes(1)
    const payload = deps.completeFn.mock.calls[0][0]
    expect(payload.actual_cost_usd).toBe(0)
    expect(payload.new_clips).toEqual([])
    expect('recipe_receipt' in payload).toBe(false)
    expect(payload.video_url).toBe(wo.uploads.video.path)
    expect(payload.segments_json_url).toBe(wo.uploads.segments_json.path)
    expect(payload.srt_url).toBe(wo.uploads.srt.path)
    expect(payload.worker_id).toBe('w1')
    const srt = deps.uploadSignedFn.mock.calls[2][1].toString()
    expect(srt.startsWith('1\n00:00:00,000 --> 00:00:02,000\n')).toBe(true)
    expect(srt.match(/-->/g)).toHaveLength(5)
    expect(existsSync(join(env.tmp, 'remotion'))).toBe(false)
    const caption = payload.caption
    for (const s of ['BEDS', 'VIEWS', 'OPEN', 'ITEM ONE', 'ITEM TWO', 'ITEM THREE',
      'INCLUDED', 'THE LIST.', 'FROM', 'PER PERSON', 'SAT 12 OCT', 'EXAMPLE ONLY', 'A$12,345',
      '2 BEDS', 'INCLUDED 1/3 ITEM ONE', 'INCLUDED 3/3 ITEM THREE']) {
      expect(caption).toContain(s)
    }
    expect(caption).not.toContain('\u200b')
  })
})

describe('render exit codes', () => {
  it('retries once on failure then succeeds, and fails after two generic failures', async () => {
    const env = makeEnv()
    const retryDeps = makeDeps(env, { renderFn: sequence([5, 0]) })
    const res = await run(env, retryDeps)
    expect(res.ok).toBe(true)
    expect(retryDeps.renderFn).toHaveBeenCalledTimes(2)

    const failDeps = makeDeps(env, { renderFn: sequence([5, 5]) })
    const err = await errOf(run(env, failDeps))
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(RemotionOrderError)
    expect(err.retryable).toBeUndefined()
    expect(failDeps.renderFn).toHaveBeenCalledTimes(2)
  })

  it.each([124, 3, 4])('fatal exit code %i', async (code) => {
    const env = makeEnv()
    const deps = makeDeps(env, { renderFn: vi.fn(async () => ({ code, stderrTail: `tail-${code}` })) })
    const err = await errOf(run(env, deps))
    expect(err).toBeInstanceOf(RemotionOrderError)
    expect(err.message).toContain(`tail-${code}`)
    expect(deps.renderFn).toHaveBeenCalledTimes(1)
  })
})

describe('heartbeat during render', () => {
  it('beats while rendering and stops after', async () => {
    const env = makeEnv()
    const deps = makeDeps(env, {
      renderFn: vi.fn(async ({ outFile }) => {
        await new Promise((r) => setTimeout(r, 80))
        writeFileSync(outFile, 'video-bytes')
        return { code: 0, stderrTail: '' }
      }),
    })
    await run(env, deps)
    expect(deps.heartbeatFn.mock.calls.length).toBeGreaterThanOrEqual(3)
    const after = deps.heartbeatFn.mock.calls.length
    await new Promise((r) => setTimeout(r, 50))
    expect(deps.heartbeatFn.mock.calls.length).toBe(after)
  })

  it.each([
    ['abort', async () => ({ abort: true }), /abort/],
    ['409', async () => { throw new Error('non-2xx status 409: x') }, /409/],
  ])('aborts on %s', async (_name, heartbeatFn, re) => {
    const env = makeEnv()
    const deps = makeDeps(env, { heartbeatFn: vi.fn(heartbeatFn), renderFn: vi.fn(waitAbort) })
    await expect(run(env, deps)).rejects.toThrow(re)
    expect(deps.uploadSignedFn).not.toHaveBeenCalled()
    expect(deps.completeFn).not.toHaveBeenCalled()
  })

  it('ignores transient heartbeat errors', async () => {
    const env = makeEnv()
    const deps = makeDeps(env, { heartbeatFn: vi.fn(async () => { throw new Error('network down') }) })
    const res = await run(env, deps)
    expect(res.ok).toBe(true)
    expect(deps.log).toHaveBeenCalled()
  })
})

describe('assets and client isolation', () => {
  it.each([
    ['missing asset', {}, null],
    ['non-png logo', { loadEngineFn: async () => makeEngine({ loadTemplate: (id, p) => ({ compositionId: 'ListReel', props: p, assetFiles: ['logo.jpg', ...FILES.slice(1)], totalFrames: 360 }) }) }, { remotion: { template: 'list', props: { ...PROPS, logoFile: 'logo.jpg' } } }],
  ])('rejects %s', async (_name, depsOver, woOver) => {
    const env = makeEnv()
    if (_name === 'missing asset') rmSync(join(env.lib, 'clips', 'b.mp4'))
    const wo = woOver ? makeWo(woOver) : makeWo()
    await expect(run(env, makeDeps(env, depsOver), wo)).rejects.toThrow(_name === 'missing asset' ? /clips\/b\.mp4/ : /\.png/)
  })

  it('rejects when brandkitFor throws', async () => {
    const env = makeEnv()
    const deps = makeDeps(env, { brandkitFor: vi.fn(() => { throw new Error('没配 studio 目录') }) })
    await expect(run(env, deps)).rejects.toThrow(/没配 studio 目录/)
    expect(deps.renderFn).not.toHaveBeenCalled()
  })

  it('rejects a symlinked asset library outside the client', async () => {
    const env = makeEnv()
    const other = join(env.studio, 'OTHER', 'remotion-assets')
    mkdirSync(join(other, 'clips'), { recursive: true })
    for (const n of ['h', 'a', 'b', 'c', 'p']) writeFileSync(join(other, 'clips', `${n}.mp4`), `clip-${n}`)
    rmSync(env.lib, { recursive: true, force: true })
    symlinkSync(other, env.lib)
    const deps = makeDeps(env)
    await expect(run(env, deps)).rejects.toThrow(RemotionOrderError)
    expect(deps.renderFn).not.toHaveBeenCalled()
  })
})

describe('post-render checks', () => {
  it.each([
    ['wrong resolution', { probeMediaEvidenceFn: vi.fn(() => ({ width: 720, height: 1280, duration_seconds: 12 })) }],
    ['wrong duration', { probeMediaEvidenceFn: vi.fn(() => ({ width: 1080, height: 1920, duration_seconds: 20 })) }],
    ['empty output', { renderFn: vi.fn(async ({ outFile }) => { writeFileSync(outFile, ''); return { code: 0, stderrTail: '' } }) }],
    ['music configured but no audio stream', { loadEngineFn: async () => makeEngine({ loadTemplate: (id, p) => ({ compositionId: 'ListReel', props: { ...p, musicFile: 'clips/a.mp4' }, assetFiles: FILES, totalFrames: 360 }) }), probeMediaEvidenceFn: vi.fn(() => ({ width: 1080, height: 1920, duration_seconds: 12, audio_stream_present: false })) }],
    ['ffprobe measured nothing', { probeMediaEvidenceFn: vi.fn(() => ({})) }],
  ])('rejects %s', async (_name, over) => {
    const env = makeEnv()
    const deps = makeDeps(env, over)
    await expect(run(env, deps)).rejects.toThrow(RemotionOrderError)
    expect(deps.uploadSignedFn).not.toHaveBeenCalled()
    expect(deps.completeFn).not.toHaveBeenCalled()
  })

  it.each([[422, true], [500, false]])('complete %i is %s non-retryable', async (status, flag) => {
    const env = makeEnv()
    const deps = makeDeps(env, { completeFn: vi.fn(async () => ({ ok: false, status, json: {} })) })
    const err = await errOf(run(env, deps))
    expect(err).toBeInstanceOf(Error)
    expect(err instanceof RemotionOrderError).toBe(flag)
  })
})

describe('dispatch through worker.processOrder', () => {
  const stubFetch = () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ ok: true, abort: false }) }))
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  it.each([
    ['unknown engine', { engine: 'bogus' }, null],
    ['remotion client not allowed', { engine: 'remotion', remotion: { template: 'list', props: {} } }, 'FACTORY_REMOTION_CLIENT_IDS'],
  ])('fails %s with retryable false', async (_name, brief, expectedError) => {
    const { processOrder } = await import('./worker.mjs')
    const fetchMock = stubFetch()
    const res = await processOrder({ work_order_id: 'wo-9', client_id: 'client-a', budget_cap_usd: 1, brief })
    expect(res).toBe(false)
    const failCall = fetchMock.mock.calls.find((c) => String(c[0]).endsWith('/wo-9/fail'))
    expect(failCall).toBeTruthy()
    const body = JSON.parse(failCall[1].body)
    expect(body.retryable).toBe(false)
    if (expectedError) expect(body.error).toContain(expectedError)
  })
})

describe('montage template and shared music', () => {
  const montageWo = () => {
    const wo = makeWo()
    wo.brief.remotion = { template: 'montage', props: MONTAGE_PROPS }
    return wo
  }

  // Library music: the file exists under studio/Music and the engine maps the staged name to it.
  const libraryMusic = (env) => {
    mkdirSync(join(env.studio, 'Music'), { recursive: true })
    writeFileSync(join(env.studio, 'Music', 'Song One.m4a'), 'song-bytes')
    return makeEngine({ musicSourceFor: () => ({ id: 'song-one', folder: 'Music', file: 'Song One.m4a', status: 'ready' }) })
  }

  it('renders a montage order with music from the shared library', async () => {
    const env = makeEnv()
    mkdirSync(join(env.studio, 'Music'), { recursive: true })
    writeFileSync(join(env.studio, 'Music', 'Song One.m4a'), 'song-bytes')
    const deps = makeDeps(env, {
      loadEngineFn: async () => makeEngine({ musicSourceFor: () => ({ id: 'song-one', folder: 'Music', file: 'Song One.m4a', status: 'ready' }) }),
      probeMediaEvidenceFn: vi.fn(() => ({ width: 1080, height: 1920, duration_seconds: 5, audio_stream_present: true })),
    })
    let musicPresent = null
    let renderArgs = null
    recordingRender(deps, (a) => {
      renderArgs = a
      musicPresent = existsSync(join(a.publicDir, 'song-one.m4a'))
    })
    const res = await run(env, deps, montageWo())
    expect(res).toEqual({ ok: true, cost: 0 })
    expect(renderArgs.template).toBe('montage')
    expect(musicPresent).toBe(true)
    const segments = JSON.parse(deps.uploadSignedFn.mock.calls[1][1].toString())
    expect(segments.template).toBe('montage')
    expect(segments.music).toEqual({ source: 'catalog', id: 'song-one', folder: 'Music', file: 'Song One.m4a', status: 'ready' })
    expect(deps.completeFn.mock.calls[0][0].caption).toBe('3 BED OPEN SAT')
    const srt = deps.uploadSignedFn.mock.calls[2][1].toString()
    expect(srt).toBe('1\n00:00:00,000 --> 00:00:01,067\n3 BED\n\n2\n00:00:01,067 --> 00:00:02,067\nOPEN SAT\n\n')
  })

  it('carries the impact storyboard receipt into review metadata without changing media checks', async () => {
    const env = makeEnv()
    const plan = {
      schema_version: 1, hook_tag: 'hook', hook_beats: 2,
      build_tags: ['scene-one', 'scene-two', 'scene-three', 'scene-four'],
      payoff_tag: 'payoff', payoff_beats: 2, planned_scene_count: 6,
      rendered_clip_file_count: 12, human_review_required: true,
    }
    const deps = makeDeps(env, {
      probeMediaEvidenceFn: vi.fn(() => ({ width: 1080, height: 1920, duration_seconds: 5, audio_stream_present: true })),
      loadEngineFn: async () => makeEngine({
        loadTemplate: (template, props) => ({
          compositionId: 'MontageReel', props,
          assetFiles: ['logo.png', 'clips/a.mp4'], totalFrames: 150,
          creativePlan: template === 'impact' ? plan : null,
        }),
      }),
    })
    const wo = makeWo()
    wo.brief.remotion = { template: 'impact', props: { ...MONTAGE_PROPS, musicFile: null } }
    const res = await run(env, deps, wo)
    expect(res).toEqual({ ok: true, cost: 0 })
    const segments = JSON.parse(deps.uploadSignedFn.mock.calls[1][1].toString())
    expect(segments.creative_plan).toEqual(plan)
    expect(deps.completeFn.mock.calls[0][0].media_evidence.creative_plan).toEqual(plan)
  })

  it('keeps a multi-word red-line phrase intact in the caption', async () => {
    const env = makeEnv()
    const deps = makeDeps(env, {
      loadEngineFn: async () => libraryMusic(env),
      probeMediaEvidenceFn: vi.fn(() => ({ width: 1080, height: 1920, duration_seconds: 5, audio_stream_present: true })),
    })
    const wo = montageWo()
    wo.brief.remotion.props = {
      ...MONTAGE_PROPS,
      words: [{ at: 0, beats: 1, text: 'AUCKLAND' }, { at: 1, beats: 1, text: 'SINCE' }, { at: 2, beats: 1, text: '1928' }],
    }
    const res = await run(env, deps, wo)
    expect(res).toEqual({ ok: true, cost: 0 })
    expect(deps.completeFn.mock.calls[0][0].caption).toContain('AUCKLAND SINCE 1928')
  })

  it('clamps the last cue end to endSec - 0.1', async () => {
    const env = makeEnv()
    const deps = makeDeps(env, {
      loadEngineFn: async () => libraryMusic(env),
      probeMediaEvidenceFn: vi.fn(() => ({ width: 1080, height: 1920, duration_seconds: 5, audio_stream_present: true })),
    })
    const wo = montageWo()
    wo.brief.remotion.props = {
      ...MONTAGE_PROPS,
      words: [{ at: 0, beats: 1, text: '3 BED' }, { at: 6, beats: 2, text: 'LAST ONE' }],
    }
    const res = await run(env, deps, wo)
    expect(res).toEqual({ ok: true, cost: 0 })
    const srt = deps.uploadSignedFn.mock.calls[2][1].toString()
    expect(srt).toContain('--> 00:00:04,467\nLAST ONE')
  })

  it('checks the montage duration against the montage frames', async () => {
    const env = makeEnv()
    const deps = makeDeps(env, {
      loadEngineFn: async () => libraryMusic(env),
      probeMediaEvidenceFn: vi.fn(() => ({ width: 1080, height: 1920, duration_seconds: 12, audio_stream_present: true })),
    })
    const err = await errOf(run(env, deps, montageWo()))
    expect(err).toBeInstanceOf(RemotionOrderError)
    expect(err.message).toContain('时长')
    expect(deps.uploadSignedFn).not.toHaveBeenCalled()
  })

  it('rejects a montage word that is only invisible characters', async () => {
    const env = makeEnv()
    const deps = makeDeps(env, {
      probeMediaEvidenceFn: vi.fn(() => ({ width: 1080, height: 1920, duration_seconds: 5, audio_stream_present: true })),
    })
    const wo = montageWo()
    wo.brief.remotion.props = {
      ...MONTAGE_PROPS,
      words: [{ at: 0, beats: 1, text: '\u200b' }],
    }
    const err = await errOf(run(env, deps, wo))
    expect(err).toBeInstanceOf(RemotionOrderError)
    expect(err.message).toContain('清理后是空的')
    expect(deps.renderFn).not.toHaveBeenCalled()
  })

  it('reports an unknown template with a truncated, newline-free message', async () => {
    const env = makeEnv()
    const deps = makeDeps(env)
    const wo = makeWo()
    wo.brief.remotion = { template: 'car\nousel', props: MONTAGE_PROPS }
    const err = await errOf(run(env, deps, wo))
    expect(err).toBeInstanceOf(RemotionOrderError)
    expect(err.retryable).toBe(true)
    expect(err.message.startsWith('UNKNOWN_TEMPLATE:')).toBe(true)
    expect(err.message).not.toContain('\n')
    expect(deps.renderFn).not.toHaveBeenCalled()
  })

  it('rejects when the music catalog cannot be read', async () => {
    const env = makeEnv()
    const deps = makeDeps(env, {
      loadEngineFn: async () => makeEngine({ musicSourceFor: () => { throw new Error('bad catalog') } }),
      probeMediaEvidenceFn: vi.fn(() => ({ width: 1080, height: 1920, duration_seconds: 5, audio_stream_present: true })),
    })
    const err = await errOf(run(env, deps, montageWo()))
    expect(err).toBeInstanceOf(RemotionOrderError)
    expect(err.retryable).toBe(true)
    expect(err.message).toContain('音乐目录读不了')
    expect(deps.renderFn).not.toHaveBeenCalled()
  })

  it('prefers the shared library and warns when the client library shadows it', async () => {
    const env = makeEnv()
    mkdirSync(join(env.studio, 'Music'), { recursive: true })
    writeFileSync(join(env.studio, 'Music', 'Song One.m4a'), 'library-bytes')
    writeFileSync(join(env.lib, 'song-one.m4a'), 'client-bytes')
    const deps = makeDeps(env, {
      loadEngineFn: async () => makeEngine({ musicSourceFor: () => ({ id: 'song-one', folder: 'Music', file: 'Song One.m4a', status: 'ready' }) }),
      probeMediaEvidenceFn: vi.fn(() => ({ width: 1080, height: 1920, duration_seconds: 5, audio_stream_present: true })),
    })
    let stagedMusic = null
    recordingRender(deps, (a) => {
      stagedMusic = readFileSync(join(a.publicDir, 'song-one.m4a')).toString()
    })
    const res = await run(env, deps, montageWo())
    expect(res).toEqual({ ok: true, cost: 0 })
    expect(deps.log.mock.calls.some((c) => String(c[0]).includes('乐库优先'))).toBe(true)
    expect(stagedMusic).toBe('library-bytes')
  })

  it('records client-library music in segments.json', async () => {
    const env = makeEnv()
    writeFileSync(join(env.lib, 'song-one.m4a'), 'client-bytes')
    const deps = makeDeps(env, {
      loadEngineFn: async () => makeEngine({
        musicSourceFor: () => null,
        loadTemplate: (id, p) => ({ compositionId: 'MontageReel', props: p, assetFiles: MONTAGE_FILES, totalFrames: 150 }),
      }),
      probeMediaEvidenceFn: vi.fn(() => ({ width: 1080, height: 1920, duration_seconds: 5, audio_stream_present: true })),
    })
    const res = await run(env, deps, montageWo())
    expect(res).toEqual({ ok: true, cost: 0 })
    const segments = JSON.parse(deps.uploadSignedFn.mock.calls[1][1].toString())
    expect(segments.music).toEqual({ source: 'client_library', file: 'song-one.m4a' })
  })

  it('rejects music symlinked outside the music folder', async () => {
    const env = makeEnv()
    mkdirSync(join(env.studio, 'Music'), { recursive: true })
    writeFileSync(join(env.root, 'outside.m4a'), 'outside-bytes')
    symlinkSync(join(env.root, 'outside.m4a'), join(env.studio, 'Music', 'escape.m4a'))
    const deps = makeDeps(env, {
      loadEngineFn: async () => makeEngine({ musicSourceFor: () => ({ folder: 'Music', file: 'escape.m4a' }) }),
    })
    const err = await errOf(run(env, deps, montageWo()))
    expect(err).toBeInstanceOf(RemotionOrderError)
    expect(err.message).toContain('乐库里找不到音乐文件')
    expect(deps.renderFn).not.toHaveBeenCalled()
  })

  it('rejects music missing from the library', async () => {
    const env = makeEnv()
    const deps = makeDeps(env, {
      loadEngineFn: async () => makeEngine({ musicSourceFor: () => ({ folder: 'Music', file: 'nope.m4a' }) }),
    })
    const err = await errOf(run(env, deps, montageWo()))
    expect(err).toBeInstanceOf(RemotionOrderError)
    expect(err.message).toContain('乐库里找不到音乐文件')
    expect(err.message).toContain('乐库文件夹：Music')
    expect(err.message).not.toContain(env.root)
    expect(deps.renderFn).not.toHaveBeenCalled()
  })

  describe('datacard template', () => {
    const DC_PROPS = {
      logoFile: 'logo.png', musicFile: null,
      hook: { lines: ['SAME BOX', '3 PRICES'] },
      rows: [
        { label: 'Alpha', value: '$120', sublabel: 'per m3', bar: 0.4 },
        { label: 'Beta', value: '$210', sublabel: null, bar: 0.7 },
        { label: 'Gamma', value: '$300', sublabel: null, bar: 1 },
      ],
      disclaimer: 'Estimates only.',
    }
    const DC_TIMING = { hookFrames: 60, rowFrames: 36, rowFrom: [60, 96, 132], totalFrames: 240 }
    const dcEngine = () => makeEngine({
      isTemplateId: (id) => ['list', 'montage', 'datacard'].includes(id),
      loadTemplate: (id, p) => ({ compositionId: 'DataCardReel', props: p, assetFiles: ['logo.png'], totalFrames: 240 }),
      computeDataCardTiming: () => DC_TIMING,
    })
    const dcWo = (props = DC_PROPS) => {
      const wo = makeWo()
      wo.brief.remotion = { template: 'datacard', props }
      return wo
    }

    it('renders and sends every on-screen string as caption and SRT', async () => {
      const env = makeEnv()
      const deps = makeDeps(env, { loadEngineFn: async () => dcEngine(), probeMediaEvidenceFn: vi.fn(() => ({ width: 1080, height: 1920, duration_seconds: 8, audio_stream_present: false })) })
      const res = await run(env, deps, dcWo())
      expect(res.ok).toBe(true)
      const sent = deps.completeFn.mock.calls[0][0]
      for (const word of ['SAME BOX 3 PRICES', 'Alpha $120 per m3', 'Beta $210', 'Estimates only.']) expect(sent.caption).toContain(word)
      const srt = deps.uploadSignedFn.mock.calls.find((c) => c[2] === 'text/plain')[1].toString()
      expect(srt).toContain('Gamma $300 · Estimates only.')
      expect(srt).toContain('00:00:02,000 --> 00:00:03,200')
    })

    it('refuses bidi or invisible characters that could make caption differ from the screen', async () => {
      const env = makeEnv()
      const deps = makeDeps(env, { loadEngineFn: async () => dcEngine() })
      const props = { ...DC_PROPS, disclaimer: '\u202eemit detimil\u202c' }
      const err = await errOf(run(env, deps, dcWo(props)))
      expect(err).toBeInstanceOf(RemotionOrderError)
      expect(err.message).toContain('双向控制字符')
      expect(deps.renderFn).not.toHaveBeenCalled()
    })

    it('refuses bidi characters hidden in a row sublabel', async () => {
      const env = makeEnv()
      const deps = makeDeps(env, { loadEngineFn: async () => dcEngine() })
      const props = { ...DC_PROPS, rows: [{ ...DC_PROPS.rows[0], sublabel: '\u202eemit detimil\u202c' }, DC_PROPS.rows[1], DC_PROPS.rows[2]] }
      const err = await errOf(run(env, deps, dcWo(props)))
      expect(err).toBeInstanceOf(RemotionOrderError)
      expect(err.message).toContain('副标签')
      expect(deps.renderFn).not.toHaveBeenCalled()
    })

    it('refuses a client without a studio mapping with a non-retryable error', async () => {
      const env = makeEnv()
      const deps = makeDeps(env, { loadEngineFn: async () => dcEngine(), clientStudio: {} })
      const err = await errOf(run(env, deps, dcWo({ ...DC_PROPS, logoFile: null })))
      expect(err).toBeInstanceOf(RemotionOrderError)
      expect(err.retryable).toBeFalsy()
      expect(err.message).toContain('FACTORY_CLIENT_STUDIO')
    })

    it('refuses props whose label is only invisible characters', async () => {
      const env = makeEnv()
      const deps = makeDeps(env, { loadEngineFn: async () => dcEngine() })
      const props = { ...DC_PROPS, rows: [{ ...DC_PROPS.rows[0], label: '\u200b' }, DC_PROPS.rows[1], DC_PROPS.rows[2]] }
      const err = await errOf(run(env, deps, dcWo(props)))
      expect(err).toBeInstanceOf(RemotionOrderError)
      expect(err.message).toContain('清理后是空的')
      expect(deps.renderFn).not.toHaveBeenCalled()
    })

    it('is still refused for a client that is not on the remotion allowlist', async () => {
      const env = makeEnv()
      const deps = makeDeps(env, { loadEngineFn: async () => dcEngine(), allowedClientIds: [] })
      const err = await errOf(run(env, deps, dcWo()))
      expect(err).toBeInstanceOf(RemotionOrderError)
      expect(deps.renderFn).not.toHaveBeenCalled()
    })
  })

  it('rejects an unknown template', async () => {
    const env = makeEnv()
    const deps = makeDeps(env)
    const wo = makeWo()
    wo.brief.remotion = { template: 'carousel', props: MONTAGE_PROPS }
    const err = await errOf(run(env, deps, wo))
    expect(err).toBeInstanceOf(RemotionOrderError)
    expect(err.message).toContain('不认识的模板')
    expect(deps.renderFn).not.toHaveBeenCalled()
  })
})

describe('runRemotionRender', () => {
  const fakeChild = () => Object.assign(new EventEmitter(), { pid: 4242, stdout: new EventEmitter(), stderr: new EventEmitter() })
  const args = (spawnFn, over = {}) => ({ propsFile: 'p', outFile: 'o', publicDir: 'd', tmpDir: '/t', spawnFn, ...over })

  it('spawns detached with a whitelisted env and reaps the group', async () => {
    vi.spyOn(process, 'kill').mockImplementation(() => true)
    const spawnFn = vi.fn(() => { const c = fakeChild(); setImmediate(() => c.emit('close', 0)); return c })
    const env = { PATH: '/bin', HOME: '/h', FACTORY_WORKER_TOKEN: 'secret', REMOTION_BROWSER_EXECUTABLE: '/b' }
    const result = await runRemotionRender(args(spawnFn, { env }))
    expect(result.code).toBe(0)
    const opts = spawnFn.mock.calls[0][2]
    expect(opts.detached).toBe(true)
    expect(opts.env).toEqual({ PATH: '/bin', HOME: '/h', TMPDIR: '/t', REMOTION_BROWSER_EXECUTABLE: '/b' })
    expect(process.kill).toHaveBeenCalledWith(-4242, 'SIGKILL')
  })

  it('resolves when the pipes stay open after the CLI exits', async () => {
    vi.useFakeTimers()
    vi.spyOn(process, 'kill').mockImplementation(() => true)
    const spawnFn = vi.fn(() => { const c = fakeChild(); setImmediate(() => c.emit('exit', 0)); return c })
    const p = runRemotionRender(args(spawnFn))
    await vi.advanceTimersByTimeAsync(3100)
    await expect(p).resolves.toMatchObject({ code: 0 })
  })

  it.each([
    ['montage', 'montage'],
    [undefined, 'list'],
  ])('passes template %s as %s', async (template, expected) => {
    vi.spyOn(process, 'kill').mockImplementation(() => true)
    const spawnFn = vi.fn(() => { const c = fakeChild(); setImmediate(() => c.emit('close', 0)); return c })
    await runRemotionRender(args(spawnFn, template === undefined ? {} : { template }))
    const argv = spawnFn.mock.calls[0][1]
    const i = argv.indexOf('--template')
    expect(i).toBeGreaterThanOrEqual(0)
    expect(argv[i + 1]).toBe(expected)
  })

  it('abort kills the whole process group', async () => {
    vi.spyOn(process, 'kill').mockImplementation(() => true)
    const ac = new AbortController()
    const child = fakeChild()
    const spawnFn = vi.fn(() => child)
    const p = runRemotionRender(args(spawnFn, { signal: ac.signal }))
    ac.abort()
    expect(process.kill).toHaveBeenCalledWith(-4242, 'SIGKILL')
    child.emit('close', null)
    await expect(p).resolves.toMatchObject({ code: null })
  })
})

describe('assertMontageTextVisible', () => {
  it('accepts visible words and rejects invisible-only words', () => {
    expect(() => assertMontageTextVisible({ words: [{ text: '3 BED' }] })).not.toThrow()
    expect(() => assertMontageTextVisible({ words: [{ text: '\u200b' }] })).toThrow(RemotionOrderError)
  })
})

describe('copyWithinRoot', () => {
  it('copies a regular file inside the root', () => {
    const env = makeEnv()
    const rootReal = realpathSync(env.lib)
    const src = realpathSync(join(env.lib, 'clips', 'a.mp4'))
    const dest = join(env.root, 'copy.mp4')
    copyWithinRoot(src, rootReal, dest)
    expect(readFileSync(dest).toString()).toBe('clip-a')
  })

  it('rejects a symlink source and leaves no dest', () => {
    const env = makeEnv()
    const link = join(env.lib, 'clips', 'link.mp4')
    symlinkSync(join(env.lib, 'clips', 'a.mp4'), link)
    const dest = join(env.root, 'copy.mp4')
    expect(() => copyWithinRoot(link, realpathSync(env.lib), dest)).toThrow(/ELOOP|symbolic|regular/i)
    expect(existsSync(dest)).toBe(false)
  })

  it('rejects a source whose real path is outside the root', () => {
    const env = makeEnv()
    const outside = join(env.root, 'outside.mp4')
    writeFileSync(outside, 'outside-bytes')
    const dest = join(env.root, 'copy.mp4')
    expect(() => copyWithinRoot(realpathSync(outside), realpathSync(env.lib), dest)).toThrow(/source changed/)
    expect(existsSync(dest)).toBe(false)
  })

  it('rejects a directory source', () => {
    const env = makeEnv()
    const dest = join(env.root, 'copy.mp4')
    expect(() => copyWithinRoot(realpathSync(join(env.lib, 'clips')), realpathSync(env.lib), dest)).toThrow()
    expect(existsSync(dest)).toBe(false)
  })

  it('streams a multi-chunk file byte-for-byte', () => {
    const env = makeEnv()
    const src = join(env.lib, 'clips', 'big.mp4')
    const bytes = Buffer.alloc(5 * 1024 * 1024 + 123, 7)
    writeFileSync(src, bytes)
    const dest = join(env.root, 'big-copy.mp4')
    copyWithinRoot(realpathSync(src), realpathSync(env.lib), dest)
    expect(Buffer.compare(readFileSync(dest), bytes)).toBe(0)
  })
})

describe('real engine contract', () => {
  const hasEngine = existsSync(join(REMOTION_ENGINE_DIR, 'node_modules', 'zod'))

  it.skipIf(!hasEngine)('renders the sydney montage example with library music', async () => {
    const props = JSON.parse(readFileSync(join(REMOTION_ENGINE_DIR, 'examples', 'sydney-montage.props.json'), 'utf8'))
    props.musicFile = 'pipa-trap.m4a'
    const env = makeEnv()
    mkdirSync(join(env.studio, 'Music'), { recursive: true })
    writeFileSync(join(env.studio, 'Music', '琵琶陷阱.m4a'), 'song')
    for (const clip of props.clips) {
      const dest = join(env.lib, clip.file)
      mkdirSync(dirname(dest), { recursive: true })
      writeFileSync(dest, 'clip')
    }
    const deps = makeDeps(env, {
      loadEngineFn: () => loadRemotionEngine(),
      probeMediaEvidenceFn: vi.fn(() => ({ width: 1080, height: 1920, duration_seconds: 16.267, audio_stream_present: true })),
    })
    const wo = makeWo()
    wo.brief.remotion = { template: 'montage', props }
    const res = await run(env, deps, wo)
    expect(res).toEqual({ ok: true, cost: 0 })
    const srt = deps.uploadSignedFn.mock.calls[2][1].toString()
    expect(srt.match(/-->/g)).toHaveLength(props.words.length)
    expect(deps.completeFn.mock.calls[0][0].caption).toBe(props.words.map((w) => w.text).join(' '))
    const segments = JSON.parse(deps.uploadSignedFn.mock.calls[1][1].toString())
    expect(segments.template).toBe('montage')
    expect(segments.music.id).toBe('pipa-trap')
    expect(deps.renderFn.mock.calls[0][0].template).toBe('montage')
  })

  it.skipIf(!hasEngine)('runs the fictional data-card example through the real engine', async () => {
    const props = JSON.parse(readFileSync(join(REMOTION_ENGINE_DIR, 'examples', 'fictional-datacard.props.json'), 'utf8'))
    const env = makeEnv()
    const deps = makeDeps(env, {
      loadEngineFn: () => loadRemotionEngine(),
      probeMediaEvidenceFn: vi.fn((_f, _srt) => ({ width: 1080, height: 1920, duration_seconds: 11, audio_stream_present: false })),
    })
    writeFileSync(join(env.lib, 'logo.png'), 'logo')
    const wo = makeWo()
    wo.brief.remotion = { template: 'datacard', props }
    const eng = await loadRemotionEngine()
    expect(typeof eng.computeDataCardTiming).toBe('function')
    const res = await run(env, deps, wo)
    expect(res).toEqual({ ok: true, cost: 0 })
    expect(deps.completeFn.mock.calls[0][0].caption).toContain('Town Alpha $120')
  })
})

describe('buildRemotionText optional dateLine', () => {
  it('includes dateLine between qualifier and footnote when present', () => {
    expect(buildRemotionText(PROPS).reveal).toBe(
      'THE LIST. FROM A$12,345 PER PERSON SAT 12 OCT EXAMPLE ONLY',
    )
  })

  it('omits dateLine cleanly when it is deleted', () => {
    const clone = structuredClone(PROPS)
    delete clone.price.dateLine
    const reveal = buildRemotionText(clone).reveal
    expect(reveal).toBe('THE LIST. FROM A$12,345 PER PERSON EXAMPLE ONLY')
    expect(reveal).not.toContain('undefined')
  })
})

describe('music vocal gate', () => {
  const montageWo = () => {
    const wo = makeWo()
    wo.brief.remotion = { template: 'montage', props: MONTAGE_PROPS }
    return wo
  }
  const clientMusicDeps = (env, over = {}) => {
    writeFileSync(join(env.lib, 'song-one.m4a'), 'client-bytes')
    return makeDeps(env, {
      loadEngineFn: async () => makeEngine({
        loadTemplate: (id, p) => ({ compositionId: 'MontageReel', props: p, assetFiles: MONTAGE_FILES, totalFrames: 150 }),
      }),
      probeMediaEvidenceFn: vi.fn(() => ({ width: 1080, height: 1920, duration_seconds: 5, audio_stream_present: true })),
      ...over,
    })
  }

  it('checks the STAGED music file with the used window and records the receipt', async () => {
    const env = makeEnv()
    const deps = clientMusicDeps(env)
    const res = await run(env, deps, montageWo())
    expect(res).toEqual({ ok: true, cost: 0 })
    const call = deps.musicVocalGateFn.mock.calls[0][0]
    expect(call.stagedPath.endsWith('assets/song-one.m4a')).toBe(true)
    expect(call.totalFrames).toBe(150)
    expect(call.fps).toBe(30)
    const segments = JSON.parse(deps.uploadSignedFn.mock.calls[1][1].toString())
    expect(segments.music_vocal_gate.verdict).toBe('none')
  })

  it('blocks the render (non-retryable) when the gate says vocals are present', async () => {
    const env = makeEnv()
    const deps = clientMusicDeps(env, {
      musicVocalGateFn: vi.fn(async () => { throw new MusicVocalGateError('MUSIC_VOCAL_PRESENT', '音乐含人声') }),
    })
    const err = await errOf(run(env, deps, montageWo()))
    expect(err).toBeInstanceOf(RemotionOrderError)
    expect(err.retryable).toBe(false)
    expect(err.message).toMatch(/音乐人声检查没过.*MUSIC_VOCAL_PRESENT/)
    expect(deps.renderFn).not.toHaveBeenCalled()
  })

  it('fails closed when the gate itself errors', async () => {
    const env = makeEnv()
    const deps = clientMusicDeps(env, { musicVocalGateFn: vi.fn(async () => { throw new Error('boom') }) })
    const err = await errOf(run(env, deps, montageWo()))
    expect(err).toBeInstanceOf(RemotionOrderError)
    expect(err.message).toMatch(/检查本身出错/)
    expect(deps.renderFn).not.toHaveBeenCalled()
  })

  it('production wiring: with NO injected gate the shipped registry blocks unregistered music before render', async () => {
    const env = makeEnv()
    const deps = clientMusicDeps(env, { musicVocalGateFn: undefined })
    const err = await errOf(run(env, deps, montageWo()))
    expect(err).toBeInstanceOf(RemotionOrderError)
    expect(err.message).toMatch(/音乐人声检查没过.*MUSIC_VOCAL_UNREGISTERED/)
    expect(deps.renderFn).not.toHaveBeenCalled()
  })

  it('does not run the gate when the order has no music', async () => {
    const env = makeEnv()
    const deps = makeDeps(env)
    await run(env, deps)
    expect(deps.musicVocalGateFn).not.toHaveBeenCalled()
  })

  describe('defaultMusicVocalGate', () => {
    const setup = (entries) => {
      const dir = mkdtempSync(join(tmpdir(), 'mvg-'))
      const music = join(dir, 'm.mp3')
      writeFileSync(music, 'tiny-music')
      const sha = createHash('sha256').update('tiny-music').digest('hex')
      const reg = join(dir, 'reg.json')
      writeFileSync(reg, JSON.stringify(entries(sha)))
      return { music, reg, sha }
    }
    const base = { name: 'm', signedAt: '2026-10-16T00:00:00.000Z', evidence: 'doc:x' }
    const args = (t, over = {}) => ({ stagedPath: t.music, props: { musicStartSec: 0 }, totalFrames: 300, fps: 30, label: 'm.mp3', registryPath: t.reg, ...over })

    it('passes a signed vocal-free track', async () => {
      const t = setup((sha) => [{ ...base, sha256: sha, verdict: 'none', signedBy: 'human:Ray' }])
      const receipt = await defaultMusicVocalGate(args(t))
      expect(receipt.verdict).toBe('none')
    })
    it('rejects an unregistered file by content hash', async () => {
      const t = setup(() => [])
      await expect(defaultMusicVocalGate(args(t))).rejects.toMatchObject({ code: 'MUSIC_VOCAL_UNREGISTERED' })
    })
    it('rejects a vocal track and a window past cleanUntilSec', async () => {
      const t1 = setup((sha) => [{ ...base, sha256: sha, verdict: 'present', signedBy: 'auto-scan' }])
      await expect(defaultMusicVocalGate(args(t1))).rejects.toMatchObject({ code: 'MUSIC_VOCAL_PRESENT' })
      const t2 = setup((sha) => [{ ...base, sha256: sha, verdict: 'unknown', cleanUntilSec: 10, signedBy: 'PM审片@abcdef12', strength: 'approval-only' }])
      await expect(defaultMusicVocalGate(args(t2))).rejects.toMatchObject({ code: 'MUSIC_VOCAL_UNKNOWN' })
    })
    it('refuses to run when the registry is missing (never an empty table)', async () => {
      const t = setup(() => [])
      await expect(defaultMusicVocalGate(args(t, { registryPath: join(tmpdir(), 'nope-registry.json') }))).rejects.toMatchObject({ code: 'MUSIC_VOCAL_REGISTRY_INVALID' })
    })
    it('the shipped registry parses and blocks the known vocal tracks', async () => {
      const { loadMusicVocalRegistry } = await import('./music-vocal-gate.mjs')
      const reg = loadMusicVocalRegistry(MUSIC_VOCAL_REGISTRY_PATH)
      expect(reg.filter((e) => e.verdict === 'present').length).toBeGreaterThanOrEqual(3)
    })
  })
})

describe('atmosphere template wiring', () => {
  const PROPS_ATMOS = { logoFile: 'logo.png', musicFile: null, clip: 'clips/a.mp4', durationSec: 15, line: null }
  const atmosEngine = (over = {}) => makeEngine({
    isTemplateId: (id) => ['atmosphere', 'weird'].includes(id),
    loadTemplate: (id, p) => ({ compositionId: 'AtmosphereReel', props: p, assetFiles: ['clips/a.mp4', 'logo.png'], totalFrames: 450, recipeGaps: [{ column: '真人背影/真人出镜', status: '未满足', reason: 'x' }] }),
    computeAtmosphereTiming: () => ({ totalFrames: 450 }),
    contentSubstanceOf: (_t, p) => (p.line
      ? { verdict: 'pass', kinds: ['selling_line'], textSeconds: 5, reason: 'ok', texts: [] }
      : { verdict: 'fail', kinds: [], textSeconds: 0, reason: '没有文字', texts: [] }),
    ...over,
  })
  const atmosWo = (props = PROPS_ATMOS, template = 'atmosphere', deliverable = undefined) => {
    const wo = makeWo()
    wo.brief.remotion = { template, props, ...(deliverable === undefined ? {} : { deliverable }) }
    return wo
  }
  const probe = (over = {}) => vi.fn(() => ({ durationSec: 20, width: 1080, height: 1920, ...over }))
  const mk = (env, over = {}) => makeDeps(env, {
    loadEngineFn: async () => atmosEngine(),
    probeClipFn: probe(),
    probeMediaEvidenceFn: vi.fn(() => ({ width: 1080, height: 1920, duration_seconds: 15, audio_stream_present: true })),
    ...over,
  })

  it('a reel with no text renders only when marked asset_only: neutral sidecar cue, empty caption, preflight and substance receipts', async () => {
    const env = makeEnv()
    const deps = mk(env)
    const res = await run(env, deps, atmosWo(PROPS_ATMOS, 'atmosphere', 'asset_only'))
    expect(res).toEqual({ ok: true, cost: 0 })
    const segments = JSON.parse(deps.uploadSignedFn.mock.calls[1][1].toString())
    expect(segments.content_substance).toMatchObject({ verdict: 'asset_only' })
    expect(deps.completeFn.mock.calls[0][0].media_evidence).toMatchObject({
      content_substance: { verdict: 'asset_only' },
      capabilities: ['content_substance_v1'],
    })
    expect(segments.atmosphere_preflight).toMatchObject({ upscale: 1, quality: 'ok' })
    expect(segments.recipe_gaps[0].column).toBe('真人背影/真人出镜')
    expect(deps.uploadSignedFn.mock.calls[2][1].toString()).toContain('♪')
    expect(deps.completeFn.mock.calls[0][0].caption).toBe('')
  })

  it('content gate: an unmarked reel with no text is refused before staging, probing or rendering', async () => {
    const env = makeEnv()
    const deps = mk(env)
    const err = await errOf(run(env, deps, atmosWo()))
    expect(err).toBeInstanceOf(RemotionOrderError)
    expect(err.message).toMatch(/内容闸/)
    expect(deps.renderFn).not.toHaveBeenCalled()
    expect(deps.probeClipFn).not.toHaveBeenCalled()
  })

  it('content gate: a mistyped deliverable is not a pass (strict enum, treated as a normal deliverable)', async () => {
    for (const bad of ['Asset_Only', 'asset-only', 'asset_only ', true, null]) {
      const env = makeEnv()
      const deps = mk(env)
      const err = await errOf(run(env, deps, atmosWo(PROPS_ATMOS, 'atmosphere', bad)))
      expect(err).toBeInstanceOf(RemotionOrderError)
      expect(err.message).toMatch(/内容闸/)
      expect(deps.renderFn).not.toHaveBeenCalled()
    }
  })

  it('content gate: a worker engine without contentSubstanceOf refuses (fail-closed)', async () => {
    const env = makeEnv()
    const deps = mk(env, { loadEngineFn: async () => atmosEngine({ contentSubstanceOf: undefined }) })
    const err = await errOf(run(env, deps, atmosWo(PROPS_ATMOS, 'atmosphere', 'asset_only')))
    expect(err).toBeInstanceOf(RemotionOrderError)
    expect(err.message).toMatch(/内容闸/)
    expect(deps.renderFn).not.toHaveBeenCalled()
  })

  it('refuses before rendering when the staged clip is shorter than sourceIn + durationSec', async () => {
    const env = makeEnv()
    const deps = mk(env, { probeClipFn: probe({ durationSec: 9 }) })
    const err = await errOf(run(env, deps, atmosWo(PROPS_ATMOS, 'atmosphere', 'asset_only')))
    expect(err).toBeInstanceOf(RemotionOrderError)
    expect(err.message).toMatch(/素材不够长/)
    expect(deps.renderFn).not.toHaveBeenCalled()
  })

  it('refuses when ffprobe itself fails (fail-closed)', async () => {
    const env = makeEnv()
    const deps = mk(env, { probeClipFn: vi.fn(() => { throw new Error('ffprobe missing') }) })
    const err = await errOf(run(env, deps, atmosWo(PROPS_ATMOS, 'atmosphere', 'asset_only')))
    expect(err).toBeInstanceOf(RemotionOrderError)
    expect(err.message).toMatch(/素材检查本身出错/)
    expect(deps.renderFn).not.toHaveBeenCalled()
  })

  it('a template the engine knows but the worker has no text wiring for is refused, never rendered as montage', async () => {
    const env = makeEnv()
    const deps = mk(env)
    const err = await errOf(run(env, deps, atmosWo(PROPS_ATMOS, 'weird')))
    expect(err).toBeInstanceOf(RemotionOrderError)
    expect(err.message).toMatch(/没有.*模板的文字复扫接线/)
    expect(deps.renderFn).not.toHaveBeenCalled()
  })

  it('builders: no line -> empty text and caption; invisible characters are refused', () => {
    expect(buildAtmosphereText({ line: null })).toBe('')
    expect(buildAtmosphereCaption({ line: { text: '  A calm view ' } })).toBe('A calm view')
    expect(() => assertAtmosphereTextVisible({ line: null })).not.toThrow()
    expect(() => assertAtmosphereTextVisible({ line: { text: 'A calm view' } })).not.toThrow()
    expect(() => assertAtmosphereTextVisible({ line: { text: 'A calm\u200b view' } })).toThrow(RemotionOrderError)
    expect(buildAtmosphereSrt({ line: null }, { totalFrames: 450 }, 30)).toMatch(/^1\n00:00:00,000 --> 00:00:14,9\d\d\n♪\n/)
  })

  it('clip preflight: crop must be 9:16, upscale is reported, weak quality is flagged', () => {
    const p4k = { durationSec: 20, width: 3840, height: 2160 }
    expect(() => assertAtmosphereClipUsable({ sourceIn: 0, durationSec: 15, crop: { x: 0, y: 0, w: 0.5, h: 1 } }, p4k)).toThrow(/9:16/)
    const ok = assertAtmosphereClipUsable({ sourceIn: 2, durationSec: 15, crop: { x: 0.3, y: 0, w: 0.31640625, h: 1 } }, p4k)
    expect(ok).toMatchObject({ regionPx: { width: 1215, height: 2160 }, quality: 'ok' })
    const weak = assertAtmosphereClipUsable({ sourceIn: 0, durationSec: 15, crop: { x: 0.3, y: 0, w: 0.31640625, h: 1 } }, { durationSec: 20, width: 1920, height: 1080 })
    expect(weak.quality).toBe('weak: upscaled')
    expect(weak.upscale).toBeGreaterThan(1.5)
    expect(() => assertAtmosphereClipUsable({ sourceIn: 6, durationSec: 15 }, p4k)).toThrow(/素材不够长/)
    expect(() => assertAtmosphereClipUsable({ sourceIn: 0, durationSec: 15 }, { durationSec: NaN, width: 1080, height: 1920 })).toThrow(/读不出/)
  })

  it('defaultProbeClip swaps width and height for a sideways (rotated 90) clip', () => {
    const exec = vi.fn(() => JSON.stringify({ streams: [{ width: 1920, height: 1080, side_data_list: [{ rotation: -90 }] }], format: { duration: '14.0' } }))
    expect(defaultProbeClip('/x.mp4', exec)).toEqual({ durationSec: 14, width: 1080, height: 1920 })
    const old = vi.fn(() => JSON.stringify({ streams: [{ width: 1920, height: 1080, tags: { rotate: '270' } }], format: { duration: '14.0' } }))
    expect(defaultProbeClip('/x.mp4', old)).toEqual({ durationSec: 14, width: 1080, height: 1920 })
    const flat = vi.fn(() => JSON.stringify({ streams: [{ width: 1920, height: 1080, side_data_list: [{ rotation: 180 }] }], format: { duration: '14.0' } }))
    expect(defaultProbeClip('/x.mp4', flat)).toEqual({ durationSec: 14, width: 1920, height: 1080 })
  })

  it('defaultProbeClip parses ffprobe json', () => {
    const exec = vi.fn(() => JSON.stringify({ streams: [{ width: 1080, height: 1920 }], format: { duration: '14.0' } }))
    expect(defaultProbeClip('/x.mp4', exec)).toEqual({ durationSec: 14, width: 1080, height: 1920 })
  })
})
