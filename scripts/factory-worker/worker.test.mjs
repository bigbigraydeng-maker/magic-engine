// #1218 回归测试 — resolveCopy() 本地 angle 兜底不许把非-hook 段全填成同一句品牌线
// (CTS work order 7c2809e1 实测:8 段字幕,hook 之后 7 段全复读同一句 tagline)。
// 只测纯函数,不跑 main() 主循环(worker.mjs 入口已加 import.meta.url 守卫)。

import { describe, expect, it } from 'vitest'
import {
  assertNoRecipeIntentInvalidReason,
  buildClaimBody,
  buildSrt,
  claimMatchesTarget,
  heartbeat,
  pingAlive,
  probeLoudnessLufs,
  resolveCopy,
} from './worker.mjs'

const ROLES = ['hook', 'middle', 'middle', 'middle', 'middle', 'middle', 'middle', 'cta']
const WO = {
  angle: 'Expertise & Heritage Stories',
  brief: { segments: ROLES.map((role) => ({ role })) },
}

describe('buildClaimBody — 可选单客户 claim', () => {
  it('配置目标客户 → claim 请求带 client_id', () => {
    expect(buildClaimBody('mac-1', 'client-1')).toEqual({ worker_id: 'mac-1', client_id: 'client-1' })
  })

  it('未配置目标客户 → 省略 client_id,保留服务端现有白名单行为', () => {
    expect(buildClaimBody('mac-1', '')).toEqual({ worker_id: 'mac-1' })
  })

  it('只接受目标客户响应', () => {
    expect(claimMatchesTarget({ client_id: 'client-1' }, 'client-1')).toBe(true)
    expect(claimMatchesTarget({ client_id: 'client-2' }, 'client-1')).toBe(false)
    expect(claimMatchesTarget({}, 'client-1')).toBe(false)
  })
})

describe('heartbeat — provider 前 hard gate', () => {
  const response = (status, body) => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  })

  it.each([500, 503])('HTTP %i → fail-closed', async (status) => {
    await expect(heartbeat('wo-1', 0, async () => response(status, '{"error":"down"}')))
      .rejects.toThrow(/HEARTBEAT_FAILED.*non-2xx/)
  })

  it('畸形 JSON → fail-closed', async () => {
    await expect(heartbeat('wo-1', 0, async () => response(200, '{bad')))
      .rejects.toThrow(/HEARTBEAT_FAILED.*malformed JSON/)
  })

  it('缺 abort 或 ok 确认 → fail-closed', async () => {
    await expect(heartbeat('wo-1', 0, async () => response(200, '{"ok":true}')))
      .rejects.toThrow(/response must confirm/)
    await expect(heartbeat('wo-1', 0, async () => response(200, '{"abort":false}')))
      .rejects.toThrow(/response must confirm/)
  })

  it('网络异常 → fail-closed', async () => {
    await expect(heartbeat('wo-1', 0, async () => { throw new Error('offline') }))
      .rejects.toThrow(/HEARTBEAT_FAILED.*offline/)
  })

  it('只有 {ok:true, abort:boolean} 才通过', async () => {
    await expect(heartbeat('wo-1', 0, async () => response(200, '{"ok":true,"abort":false}')))
      .resolves.toMatchObject({ ok: true, abort: false })
  })
})

describe('resolveCopy — #1218 angle 兜底不许满屏复读', () => {
  it('brief.copy 缺失 → 只在 hook 带一次 angle,所有非-hook 段留空', () => {
    const copy = resolveCopy(WO)
    expect(copy.segments).toHaveLength(8)
    expect(copy.segments[0]).toEqual({ role: 'hook', title_sub: WO.angle }) // hook 允许
    for (let i = 1; i < 8; i++) {
      expect(copy.segments[i]).toEqual({ role: ROLES[i] }) // middle×6 + cta 全部留空
    }
  })

  it('brief.copy.segments 已存在(后端生成成功)→ 原样返回,不套本地兜底', () => {
    const backendCopy = {
      segments: [
        { role: 'hook', title_main: 'CTS TOURS', title_sub: 'Expertise & Heritage Stories' },
        { role: 'middle', caption: 'Small group, big stories' },
      ],
      endcard: { cta: 'Enquire now', offer: [], url: 'ctstours.co.nz' },
    }
    const wo = { angle: 'x', brief: { segments: [{ role: 'hook' }, { role: 'middle' }], copy: backendCopy } }
    const copy = resolveCopy(wo)
    expect(copy).toBe(backendCopy)
  })
})

describe('probeLoudnessLufs — ffmpeg ebur128 stderr 捕获(exec 修复)', () => {
  it('runner 返回 stderr 摘要 → 解析出真实 LUFS(execFileSync 曾丢 stderr → 全变 -70)', () => {
    const runner = () => ({
      stderr: 'Integrated loudness:\n    I:   -19.3 LUFS\n    Threshold: -29.2 LUFS',
      stdout: '',
    })
    expect(probeLoudnessLufs('/x/song.mp3', runner)).toBe(-19.3)
  })
  it('摘要落在 stdout(仍能命中,不假设走哪个流)', () => {
    const runner = () => ({
      stderr: '',
      stdout: 'Integrated loudness:\n    I:         -22.4 LUFS',
    })
    expect(probeLoudnessLufs('/x/song.mp3', runner)).toBe(-22.4)
  })
  it('runner 抛错(把 stderr 挂在 error 上)→ 也能解析,不吞掉真实摘要', () => {
    const runner = () => {
      const e = new Error('nonzero exit')
      e.stderr = 'Integrated loudness:\n    I:   -14.1 LUFS'
      throw e
    }
    expect(probeLoudnessLufs('/x/song.mp3', runner)).toBe(-14.1)
  })
  it('无输出 → -70 兜底(视作静音,让 BGM/final gate reject)', () => {
    expect(probeLoudnessLufs('/x/song.mp3', () => ({ stderr: '', stdout: '' }))).toBe(-70)
  })
})

describe('assertNoRecipeIntentInvalidReason — recipe_intent 解析失败必须在 provider 之前拒', () => {
  it('reason=null / 空串 → 无操作(legacy + 合法 recipe 都能继续)', () => {
    expect(() => assertNoRecipeIntentInvalidReason(null)).not.toThrow()
    expect(() => assertNoRecipeIntentInvalidReason('')).not.toThrow()
    expect(() => assertNoRecipeIntentInvalidReason('   ')).not.toThrow()
    expect(() => assertNoRecipeIntentInvalidReason(undefined)).not.toThrow()
  })
  it('reason=非空 → 抛 WINNER_RECIPE_CONFIG_INVALID', () => {
    expect(() => assertNoRecipeIntentInvalidReason('creative_recipe.version 缺失'))
      .toThrow(/WINNER_RECIPE_CONFIG_INVALID/)
  })
})

describe('buildSrt — 空 caption 的段落不许在字幕里复读兜底文案', () => {
  it('#1218 修复后:8 段里只有 hook 有字幕,所有 middle + cta 不出字幕行', () => {
    const copy = resolveCopy(WO)
    const segments = ROLES.map(() => ({ duration_hint_s: 2 }))
    const srt = buildSrt(segments, copy)
    const blocks = srt.trim().split('\n\n').filter(Boolean)
    expect(blocks).toHaveLength(1) // 只有 hook 段产出字幕
    expect(srt).toContain(WO.angle)
    // 品牌线只允许作为 hook 出现 1 次,不得落入 middle/cta
    const occurrences = srt.split(WO.angle).length - 1
    expect(occurrences).toBe(1)
  })

  it('修复前的旧行为(对照组):angle 塞满每个非-hook 段 → 会复读 7 次,证明测试确实在盯这个问题', () => {
    const buggyCopy = {
      segments: ROLES.map((role, i) => ({
        role,
        ...(i === 0 ? { title_sub: WO.angle } : { caption: WO.angle }),
      })),
    }
    const segments = ROLES.map(() => ({ duration_hint_s: 2 }))
    const srt = buildSrt(segments, buggyCopy)
    const occurrences = srt.split(WO.angle).length - 1
    expect(occurrences).toBe(8) // 旧 bug:8 段全复读同一句
  })
})

describe('pingAlive — 空闲存活信号', () => {
  it('4 分钟内不重复发；失败只返回 false 不抛错', async () => {
    const calls = []
    const ok = async (url) => { calls.push(url); return { ok: true, status: 200 } }
    const t0 = Date.now() + 3_600_000 // heartbeat 测试也会触发一次 ping，时间要在它之后
    expect(await pingAlive(ok, t0)).toBe(true)
    expect(await pingAlive(ok, t0 + 60_000)).toBe(false)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('/api/factory/worker/ping')
    const boom = async () => { throw new Error('offline') }
    expect(await pingAlive(boom, t0 + 5 * 60_000)).toBe(false)
  })

  it('存活信号带上这次渲染检查，失败原因原样送出', async () => {
    const bodies = []
    const ok = async (_url, init) => {
      bodies.push(JSON.parse(init.body))
      return { ok: true, status: 200 }
    }
    const later = Date.now() + 6 * 3_600_000
    expect(await pingAlive(ok, later, { ok: false, watched: true, reason: 'engine down' })).toBe(true)
    expect(bodies[0].render_worker).toEqual({ ok: false, reason: 'engine down' })
  })
})
