// R13:worker recipe 顺序集成测试。所有 IO 注入,验证:
// - budget gate 在 provider 调用之前
// - heartbeat abort 阻止下一次 provider
// - provider payload 分别含 push-in / pull-back;两段同图;共 2 次调用
// - final loudness/duration 探测后才 complete;receipt validator 参与
// - 失败(BGM 缺 / 时长溢出 / 心跳 abort)一律在 assemble / upload / complete 之前抛
//
// 注:这里不 import worker.mjs 内部 wire — 而是直接 import runRecipeSequence,
// 用 fixture 依赖构造完整可执行 wo,验证 gate 顺序。

import { describe, expect, it, vi } from 'vitest'
import {
  RECIPE_ID,
  RECIPE_VERSION,
  buildRecipePlan,
  computeReviewFeedbackDigest,
  resolveRecipe,
} from './creative-recipe.mjs'
import { runRecipeSequence } from './worker.mjs'

// 生产 receipt validator 的 TS 模块无法直接从 mjs 侧动态 import(vitest 允许,但
// 我们希望 sequence 测试保持纯 mjs)。使用本地最小 assertion 覆盖:motion/tts/portable id
// 检查在 runRecipeSequence 内已由 receiptValidator 注入;这里断言其被调用即可。
const receiptValidatorStub = (payload, recipe) => {
  if (!payload?.recipe || payload.recipe.id !== recipe.id) {
    throw new Error('WINNER_RECIPE_PLAN_INVALID: stub validator saw mismatched recipe id')
  }
  if (payload.motion !== false || payload.tts !== false) {
    throw new Error('WINNER_RECIPE_PLAN_INVALID: stub validator saw motion/tts not false')
  }
  if (payload.music?.id?.startsWith('/')) {
    throw new Error('WINNER_RECIPE_PLAN_INVALID: stub validator saw non-portable music id')
  }
}

const RECIPE = resolveRecipe(RECIPE_ID)
const SOURCE = 'https://cdn.example.com/hero.jpg'
const NS = 'sig_test'
const SHA = 'a'.repeat(64)

function makeWo(overrides = {}) {
  const plan = buildRecipePlan({ recipe: RECIPE, angle: 'brand story', sourceImageUrl: SOURCE, keyNamespace: NS })
  return {
    work_order_id: 'wo-1',
    client_id: 'client-x',
    budget_cap_usd: 2,
    brief: {
      creative_recipe: { id: RECIPE_ID, version: RECIPE_VERSION },
      segments: plan.segments,
      clip_generation_plan: plan.clip_generation_plan,
      max_new_clips: plan.max_new_clips,
      creative_profile: { music_pool: ['soft.mp3'] },
      copy: { hook: 'Small group', cta: 'Book now' },
    },
    uploads: {
      video: { signed_url: 'https://sig/v', path: 'renders/x/wo-1/final.mp4' },
      segments_json: { signed_url: 'https://sig/s', path: 'renders/x/wo-1/segments.json' },
      srt: { signed_url: 'https://sig/srt', path: 'renders/x/wo-1/captions.srt' },
    },
    clip_uploads: plan.clip_generation_plan.map((p) => ({
      idempotency_key: p.idempotency_key,
      signed_url: `https://sig/${p.idempotency_key}`,
      path: `clips/b-generated/x/wo-1_${p.segment_role}_${p.position}.mp4`,
    })),
    ...overrides,
  }
}

function makeDeps(overrides = {}) {
  const providerCalls = []
  const heartbeatCalls = []
  const uploadCalls = []
  const completeCalls = []
  return {
    providerCalls,
    heartbeatCalls,
    uploadCalls,
    completeCalls,
    deps: {
      log: () => {},
      heartbeatFn: async (id, cost) => {
        heartbeatCalls.push({ id, cost })
        return { abort: false }
      },
      uploadSignedFn: async (url, buf, contentType) => {
        uploadCalls.push({ url, size: buf.length, contentType })
      },
      providerFn: async ({ plan, sourceImageUrl, durationSeconds }) => {
        providerCalls.push({
          role: plan.segment_role,
          motion: plan.motion_type,
          prompt: plan.prompt_hint,
          sourceImageUrl,
          durationSeconds,
          idempotency_key: plan.idempotency_key,
        })
        return {
          buf: Buffer.from(`fake-${plan.segment_role}`),
          cost: 0.225,
          provider: 'muapi',
          request_id: `req-${plan.position}`,
        }
      },
      readFileFn: () => 'renderer source: caption_mode endcard_dur transition music motion',
      writeFileFn: () => {},
      existsFn: (p) => p.includes('final.mp4') || p.includes('soft.mp3') || p.endsWith('renderer.py'),
      joinFn: (a, b) => `${a}/${b}`,
      tmpJoin: (a, b) => `${a}/${b}`,
      probeDurationFn: (p) => (p.includes('final') ? 12.0 : 5.0),
      probeLoudnessFn: () => -18,
      probeMediaEvidenceFn: () => ({
        audio_stream_present: true,
        audio_loudness_lufs: -18,
        width: 1080,
        height: 1920,
        duration_seconds: 12,
        subtitle_cues: [{ start_seconds: 0, end_seconds: 1, text: 'Discover China' }],
        cover_mean_luma: 100,
        cover_luma_range: 180,
        cover_placeholder_detected: false,
      }),
      hashFileFn: () => SHA,
      musicVocalGateFn: () => ({ verdict: 'none' }),
      execAssembleFn: async () => {},
      completeFn: async (payload) => {
        completeCalls.push(payload)
        return { ok: true, status: 200, json: { status: 'in_review' } }
      },
      receiptValidator: receiptValidatorStub,
      brandKit: '/tmp/brandkit',
      approvedRendererShas: [SHA],
      rendererPath: '/tmp/renderer.py',
      sharedMusicDir: '/tmp/_shared/music',
      musicLibrary: { epic_cinematic: [{ id: 'epic-a', file: 'epic_a.mp3' }] },
      workerId: 'worker-x',
      clipUnitCostUsd: 0.225,
      minBgmInputLoudnessLufs: -50,
      minLoudnessLufs: -55,
      ...overrides,
    },
  }
}

describe('runRecipeSequence — provider payload contract', () => {
  it('恰好 2 次 provider 调用;每段带独立 push-in / pull-back prompt,单图源', async () => {
    const wo = makeWo()
    const { deps, providerCalls, completeCalls } = makeDeps()
    const res = await runRecipeSequence({ wo, recipe: RECIPE, tmp: '/tmp/work', deps })
    expect(res.ok).toBe(true)
    expect(providerCalls).toHaveLength(2)
    expect(providerCalls[0].prompt.toLowerCase()).toContain('push-in')
    expect(providerCalls[1].prompt.toLowerCase()).toContain('pull-back')
    expect(providerCalls[0].motion).toBe('push_in')
    expect(providerCalls[1].motion).toBe('pull_back')
    expect(providerCalls[0].sourceImageUrl).toBe(SOURCE)
    expect(providerCalls[1].sourceImageUrl).toBe(SOURCE)
    expect(providerCalls[0].durationSeconds).toBe(5)
    expect(providerCalls[1].durationSeconds).toBe(5)
    expect(completeCalls).toHaveLength(1)
    expect(completeCalls[0].actual_cost_usd).toBeCloseTo(0.45, 3)
    expect(completeCalls[0].media_evidence.width).toBe(1080)
  })

  it('每段无 inventory clip_ids(合同 §1)', async () => {
    const wo = makeWo()
    const { deps, providerCalls } = makeDeps()
    await runRecipeSequence({ wo, recipe: RECIPE, tmp: '/tmp/work', deps })
    // plan 走的路径本就无 clip_ids;这里从 brief.segments 反向抽验,防止未来漂移。
    for (const seg of wo.brief.segments) expect(seg.clip_ids).toEqual([])
    // 上一次的 fixture 也保证 providerCalls 都有 source_image_url + prompt
    for (const call of providerCalls) {
      expect(call.sourceImageUrl.length).toBeGreaterThan(0)
      expect(call.prompt.length).toBeGreaterThan(0)
    }
  })
})

describe('runRecipeSequence — heartbeat abort(R7)', () => {
  it('heartbeat transport/shape 失败 → 零 provider 调用', async () => {
    const wo = makeWo()
    const { deps, providerCalls, completeCalls } = makeDeps({
      heartbeatFn: async () => {
        throw new Error('WINNER_RECIPE_HEARTBEAT_FAILED: non-2xx status 503')
      },
    })
    await expect(runRecipeSequence({ wo, recipe: RECIPE, tmp: '/tmp/work', deps }))
      .rejects.toThrow(/HEARTBEAT_FAILED/)
    expect(providerCalls).toHaveLength(0)
    expect(completeCalls).toHaveLength(0)
  })
  it('第一次 heartbeat 返回 abort → 零 provider 调用,零上传,零 complete', async () => {
    const wo = makeWo()
    const { deps, providerCalls, uploadCalls, completeCalls } = makeDeps({
      heartbeatFn: async () => ({ abort: true }),
    })
    await expect(runRecipeSequence({ wo, recipe: RECIPE, tmp: '/tmp/work', deps }))
      .rejects.toThrow(/HEARTBEAT_ABORT/)
    expect(providerCalls).toHaveLength(0)
    expect(uploadCalls).toHaveLength(0)
    expect(completeCalls).toHaveLength(0)
  })
  it('第一段成功后 heartbeat abort → 第二次 provider 不发生,不组装,不 complete', async () => {
    const wo = makeWo()
    let n = 0
    const { deps, providerCalls, completeCalls } = makeDeps({
      heartbeatFn: async () => ({ abort: n++ >= 1 }),
    })
    await expect(runRecipeSequence({ wo, recipe: RECIPE, tmp: '/tmp/work', deps }))
      .rejects.toThrow(/HEARTBEAT_ABORT/)
    expect(providerCalls).toHaveLength(1)
    expect(completeCalls).toHaveLength(0)
  })
})

describe('runRecipeSequence — budget gate(R7)', () => {
  it('budget_cap_usd 太小 → 零 provider 调用', async () => {
    const wo = makeWo({ budget_cap_usd: 0.1 })
    const { deps, providerCalls, completeCalls } = makeDeps()
    await expect(runRecipeSequence({ wo, recipe: RECIPE, tmp: '/tmp/work', deps }))
      .rejects.toThrow(/BUDGET_INSUFFICIENT/)
    expect(providerCalls).toHaveLength(0)
    expect(completeCalls).toHaveLength(0)
  })
  it('max_new_clips < recipe.segments → 零 provider 调用(在 plan 校验就拦住)', async () => {
    const wo = makeWo()
    wo.brief.max_new_clips = 1
    const { deps, providerCalls } = makeDeps()
    await expect(runRecipeSequence({ wo, recipe: RECIPE, tmp: '/tmp/work', deps }))
      .rejects.toThrow(/max_new_clips/)
    expect(providerCalls).toHaveLength(0)
  })
  it('provider 回报 NaN 成本 → 第一段后停止，绝不调用第二段或 complete', async () => {
    const wo = makeWo()
    let calls = 0
    const { deps, completeCalls } = makeDeps({
      providerFn: async () => {
        calls++
        return { buf: Buffer.from('x'), cost: NaN, provider: 'muapi', request_id: 'req-bad' }
      },
    })
    await expect(runRecipeSequence({ wo, recipe: RECIPE, tmp: '/tmp/work', deps }))
      .rejects.toThrow(/BUDGET_INSUFFICIENT/)
    expect(calls).toBe(1)
    expect(completeCalls).toHaveLength(0)
  })
})

describe('runRecipeSequence — final probes + receipt validator(R12)', () => {
  it('final duration > 12.0 → 拒(在 complete 之前)', async () => {
    const wo = makeWo()
    const { deps, completeCalls } = makeDeps({
      probeDurationFn: (p) => (p.includes('final') ? 12.5 : 5.0),
    })
    await expect(runRecipeSequence({ wo, recipe: RECIPE, tmp: '/tmp/work', deps }))
      .rejects.toThrow(/DURATION_INVALID/)
    expect(completeCalls).toHaveLength(0)
  })
  it('final loudness 静音 → 拒(在 complete 之前)', async () => {
    const wo = makeWo()
    let n = 0
    const { deps, completeCalls } = makeDeps({
      probeLoudnessFn: () => (n++ === 0 ? -18 : -60), // BGM ok, final silent
    })
    await expect(runRecipeSequence({ wo, recipe: RECIPE, tmp: '/tmp/work', deps }))
      .rejects.toThrow(/LOUDNESS_INVALID/)
    expect(completeCalls).toHaveLength(0)
  })
  it('receipt validator 拒 → 不 complete', async () => {
    const wo = makeWo()
    const { deps, completeCalls } = makeDeps({
      receiptValidator: () => { throw new Error('WINNER_RECIPE_PLAN_INVALID: injected validator failure') },
    })
    await expect(runRecipeSequence({ wo, recipe: RECIPE, tmp: '/tmp/work', deps }))
      .rejects.toThrow(/injected validator failure/)
    expect(completeCalls).toHaveLength(0)
  })
})

describe('runRecipeSequence — renderer + BGM gates', () => {
  it('renderer SHA 不匹配 → 零 provider 调用', async () => {
    const wo = makeWo()
    const { deps, providerCalls } = makeDeps({
      approvedRendererShas: ['b'.repeat(64)], // different sha
    })
    await expect(runRecipeSequence({ wo, recipe: RECIPE, tmp: '/tmp/work', deps }))
      .rejects.toThrow(/RENDERER_UNAPPROVED/)
    expect(providerCalls).toHaveLength(0)
  })
  it('BGM 静音 → 零 provider 调用', async () => {
    const wo = makeWo()
    const { deps, providerCalls } = makeDeps({
      probeLoudnessFn: () => -60, // BGM silent → BGM gate rejects before provider
    })
    await expect(runRecipeSequence({ wo, recipe: RECIPE, tmp: '/tmp/work', deps }))
      .rejects.toThrow(/BGM_MISSING/)
    expect(providerCalls).toHaveLength(0)
  })
})

describe('runRecipeSequence — copy contract(R9)', () => {
  it('brief.copy 缺 → 拒(no angle fallback)', async () => {
    const wo = makeWo()
    delete wo.brief.copy
    const { deps, providerCalls } = makeDeps()
    // R5 defense-in-depth 会在 R9 之前先抛 PLAN_INVALID(hook / cta missing) —— 更强的拒收,
    // 保证「有兜底就跑」路径彻底不存在。任何一个先抛都算 OK。
    await expect(runRecipeSequence({ wo, recipe: RECIPE, tmp: '/tmp/work', deps }))
      .rejects.toThrow(/COPY_INVALID|hook \/ cta missing/)
    expect(providerCalls).toHaveLength(0)
  })
  it('hook = cta(复读)→ 拒', async () => {
    const wo = makeWo()
    wo.brief.copy = { hook: 'Book now', cta: 'Book now' }
    const { deps, providerCalls } = makeDeps()
    await expect(runRecipeSequence({ wo, recipe: RECIPE, tmp: '/tmp/work', deps }))
      .rejects.toThrow(/differ/)
    expect(providerCalls).toHaveLength(0)
  })
})

// ── R13 全链 ordering(一次调用,断言事件顺序;不打第三方 IO)────────────────
describe('runRecipeSequence — 全链 ordering(preflight → provider ×2 → receipt → complete)', () => {
  it('captured call log 严格递增序号,receipt 校验在 complete 之前,provider 之前无 upload / complete', async () => {
    const wo = makeWo()
    const events = []
    let seq = 0
    const stamp = (name, extra = {}) => events.push({ n: ++seq, name, ...extra })
    const { deps } = makeDeps({
      hashFileFn: (p) => { stamp('renderer_sha', { p }); return SHA },
      readFileFn: (p) => {
        stamp('renderer_preflight_read', { p })
        return 'renderer source: caption_mode endcard_dur transition music motion'
      },
      probeLoudnessFn: (p) => {
        // BGM 探测 vs final 探测:凭调用序号区分;这里都返回 -18(有声)
        stamp('probe_loudness', { p })
        return -18
      },
      probeDurationFn: (p) => {
        stamp('probe_duration', { p })
        return p.includes('final') ? 12.0 : 5.0
      },
      heartbeatFn: async (id, cost) => {
        stamp('heartbeat', { cost })
        return { abort: false }
      },
      providerFn: async ({ plan }) => {
        stamp('provider', { role: plan.segment_role, motion: plan.motion_type })
        return {
          buf: Buffer.from(`fake-${plan.segment_role}`), cost: 0.225,
          provider: 'muapi', request_id: `req-${plan.position}`,
        }
      },
      uploadSignedFn: async (url, buf) => {
        // 区分 clip upload(每段生成 → b-generated 桶)与三件套 upload(final 完成后)
        const kind = url === wo.uploads.video.signed_url
          ? 'upload_final_video'
          : url === wo.uploads.segments_json.signed_url
            ? 'upload_final_segments_json'
            : url === wo.uploads.srt.signed_url
              ? 'upload_final_srt'
              : 'upload_clip'
        stamp(kind, { size: buf.length })
      },
      execAssembleFn: async ({ cfgPath, outputPath }) => { stamp('assemble', { cfgPath, outputPath }) },
      completeFn: async (payload) => {
        stamp('complete', { cost: payload.actual_cost_usd })
        return { ok: true, status: 200, json: { status: 'in_review' } }
      },
      receiptValidator: (payload, recipe) => {
        stamp('receipt_validate', { recipeId: recipe.id })
        // 让本 stub 也做基本 sanity(避免与真实 mjs receipt validator 分歧)
        if (!payload?.recipe || payload.recipe.id !== recipe.id) {
          throw new Error('WINNER_RECIPE_PLAN_INVALID: stub validator saw mismatched recipe id')
        }
        if (payload.motion !== false || payload.tts !== false) {
          throw new Error('WINNER_RECIPE_PLAN_INVALID: stub validator saw motion/tts not false')
        }
        if (payload.music?.id?.startsWith('/')) {
          throw new Error('WINNER_RECIPE_PLAN_INVALID: stub validator saw non-portable music id')
        }
      },
    })

    const res = await runRecipeSequence({ wo, recipe: RECIPE, tmp: '/tmp/work', deps })
    expect(res.ok).toBe(true)

    const idxOf = (predicate) => events.findIndex(predicate)
    const rendererShaIdx = idxOf((e) => e.name === 'renderer_sha')
    const preflightReadIdx = idxOf((e) => e.name === 'renderer_preflight_read')
    const firstProviderIdx = idxOf((e) => e.name === 'provider')
    const lastProviderIdx = events.map((e) => e.name).lastIndexOf('provider')
    const assembleIdx = idxOf((e) => e.name === 'assemble')
    const receiptIdx = idxOf((e) => e.name === 'receipt_validate')
    const firstFinalUploadIdx = idxOf((e) => e.name.startsWith('upload_final_'))
    const completeIdx = idxOf((e) => e.name === 'complete')

    // 全部关键事件都必须存在
    expect(rendererShaIdx).toBeGreaterThanOrEqual(0)
    expect(preflightReadIdx).toBeGreaterThanOrEqual(0)
    expect(firstProviderIdx).toBeGreaterThanOrEqual(0)
    expect(receiptIdx).toBeGreaterThanOrEqual(0)
    expect(completeIdx).toBeGreaterThanOrEqual(0)
    expect(firstFinalUploadIdx).toBeGreaterThanOrEqual(0)

    // 强顺序断言:renderer preflight → provider → assemble → receipt validator → 三件套 upload → complete
    // (clip upload 发生在 provider 循环里,是必要副作用;receipt validator 只需在 final 三件套上传之前)
    expect(rendererShaIdx).toBeLessThan(firstProviderIdx)
    expect(preflightReadIdx).toBeLessThan(firstProviderIdx)
    expect(lastProviderIdx).toBeLessThan(assembleIdx)
    expect(assembleIdx).toBeLessThan(receiptIdx)
    expect(receiptIdx).toBeLessThan(firstFinalUploadIdx)
    expect(firstFinalUploadIdx).toBeLessThan(completeIdx)

    // provider 恰好 2 次,camera actions 分别是 push_in / pull_back
    const providerEvents = events.filter((e) => e.name === 'provider')
    expect(providerEvents).toHaveLength(2)
    expect(providerEvents[0].motion).toBe('push_in')
    expect(providerEvents[1].motion).toBe('pull_back')

    // provider 之前不许有任何 final-三件套 upload、任何 complete
    for (let i = 0; i < firstProviderIdx; i++) {
      expect(events[i].name).not.toMatch(/^upload_final_/)
      expect(events[i].name).not.toBe('complete')
    }
    // complete 事件恰好一次(通过 stamp 记录;completeCalls 在 override 后不再被默认 push)
    expect(events.filter((e) => e.name === 'complete')).toHaveLength(1)
    // provider 之前必须至少已发过一次 heartbeat(R7 abort/preflight)
    const firstHeartbeatIdx = idxOf((e) => e.name === 'heartbeat')
    expect(firstHeartbeatIdx).toBeGreaterThanOrEqual(0)
    expect(firstHeartbeatIdx).toBeLessThan(firstProviderIdx)
    // upload 总数:每段 clip upload(2) + 三件套(3) = 5
    const allUploads = events.filter((e) => e.name === 'upload_clip' || e.name.startsWith('upload_final_'))
    expect(allUploads.length).toBe(5)
    // provider 只跑了 2 次(卡不到额外次数)—— 已由 providerEvents 长度保证
    // 三件套 upload 齐,receipt payload 走的是 segments_json 那条
    const finalUploads = events.filter((e) => e.name.startsWith('upload_final_'))
    expect(finalUploads.map((e) => e.name).sort()).toEqual([
      'upload_final_segments_json',
      'upload_final_srt',
      'upload_final_video',
    ])
  })
})

// ── R3 digest ack(mjs 内断言;不需 spy,直接触发 processOrder 前置检查)────
describe('assertRecipeReplanAcknowledged 在 worker preflight 阻断 stale reopens(R3)', () => {
  it('digest 存在但无 ack → 拒(不进 runRecipeSequence)', async () => {
    // 直接测 mjs 侧断言的行为(processOrder 拿它做 preflight)
    const { assertRecipeReplanAcknowledged } = await import('./creative-recipe.mjs')
    const digest = computeReviewFeedbackDigest('画面太慢')
    expect(() =>
      assertRecipeReplanAcknowledged({
        review_feedback_digest: digest,
        creative_recipe: { id: RECIPE_ID, version: RECIPE_VERSION },
      }),
    ).toThrow(/REPLAN_REQUIRED/)
  })
  it('replan 单里 recipe 明确 ack 了当前 digest → 通过', async () => {
    const { assertRecipeReplanAcknowledged } = await import('./creative-recipe.mjs')
    const digest = computeReviewFeedbackDigest('画面太慢')
    expect(() =>
      assertRecipeReplanAcknowledged({
        review_feedback_digest: digest,
        creative_recipe: {
          id: RECIPE_ID, version: RECIPE_VERSION,
          acknowledged_review_feedback_digest: digest,
        },
      }),
    ).not.toThrow()
  })
})

// ── R5 brief completeness — worker 侧 pre-provider 兜底 ──────────────────────
describe('runRecipeSequence — brief completeness pre-provider(R5 defense-in-depth)', () => {
  it('brief 缺 copy(壳单被抢跑)→ 零 provider 调用,零 complete', async () => {
    const wo = makeWo()
    delete wo.brief.copy
    const { deps, providerCalls, completeCalls } = makeDeps()
    await expect(runRecipeSequence({ wo, recipe: RECIPE, tmp: '/tmp/work', deps }))
      .rejects.toThrow(/hook \/ cta missing/)
    expect(providerCalls).toHaveLength(0)
    expect(completeCalls).toHaveLength(0)
  })
  it('idempotency_key 是占位符 → 零 provider 调用', async () => {
    const wo = makeWo()
    wo.brief.clip_generation_plan[0].idempotency_key = '{work_order_id}:hook:0'
    const { deps, providerCalls, completeCalls } = makeDeps()
    await expect(runRecipeSequence({ wo, recipe: RECIPE, tmp: '/tmp/work', deps }))
      .rejects.toThrow(/placeholder/)
    expect(providerCalls).toHaveLength(0)
    expect(completeCalls).toHaveLength(0)
  })
})

// 让 vitest 承认 vi 使用(实际这里未 spy;保留 API 以便未来加断言)
void vi

describe('runRecipeSequence — music vocal gate', () => {
  it('an async gate function is refused (its rejection would be ignored)', async () => {
    const { deps, providerCalls } = makeDeps({ musicVocalGateFn: async () => { throw new Error('MUSIC_VOCAL_PRESENT') } })
    await expect(runRecipeSequence({ wo: makeWo(), recipe: RECIPE, tmp: '/tmp/x', deps })).rejects.toThrow(/同步函数/)
    expect(providerCalls?.length ?? 0).toBe(0)
  })
  it('no gate function injected → refuses before any provider call', async () => {
    const { deps, providerCalls } = makeDeps({ musicVocalGateFn: undefined })
    await expect(runRecipeSequence({ wo: makeWo(), recipe: RECIPE, tmp: '/tmp/x', deps })).rejects.toThrow(/人声检查/)
    expect(providerCalls?.length ?? 0).toBe(0)
  })
  it('gate says vocals present → refuses before any provider call', async () => {
    const { deps, providerCalls } = makeDeps({ musicVocalGateFn: () => { throw new Error('MUSIC_VOCAL_PRESENT') } })
    await expect(runRecipeSequence({ wo: makeWo(), recipe: RECIPE, tmp: '/tmp/x', deps })).rejects.toThrow(/MUSIC_VOCAL_PRESENT/)
    expect(providerCalls?.length ?? 0).toBe(0)
  })
})
