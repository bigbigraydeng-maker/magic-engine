import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  loadLecturePrefs: vi.fn(),
  saveLecturePrefs: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from } }))

// extractTermEdits/mergeGlossary 是纯函数，让它们真跑；只 mock 会碰数据库的两个
vi.mock('./lecture-learning', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lecture-learning')>()
  return { ...actual, loadLecturePrefs: mocks.loadLecturePrefs, saveLecturePrefs: mocks.saveLecturePrefs }
})

import { saveReelCaptions, loadReelCaptionState } from './reel-post'

const CLIENT = 'client-1'
const POST = 'post-1'

/**
 * select().eq().eq().maybeSingle() 读；
 * update().eq().eq().eq('status','approved').select() 写 —— saveReelCaptions 走
 * requireApproved 那条(跟 stageRawRecording/clearVideo 同一条防线：状态条件并进
 * update 本身，不是先读后判)，第三层 eq + select 就是为了让这条命中率可控。
 */
function fakeDb(snapshot: Record<string, unknown> | null, opts: { updateHits?: number } = {}) {
  const hits = opts.updateHits ?? 1
  const updateSelect = vi.fn().mockResolvedValue({
    data: Array.from({ length: hits }, () => ({ id: 'x' })),
    error: null,
  })
  const updateEq3 = vi.fn(() => ({ select: updateSelect }))
  const updateEq2 = vi.fn(() => ({ eq: updateEq3 }))
  const updateEq1 = vi.fn(() => ({ eq: updateEq2 }))
  const update = vi.fn(() => ({ eq: updateEq1 }))
  mocks.from.mockReturnValue({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn().mockResolvedValue({
            data: snapshot ? { generation_context_snapshot: snapshot } : null,
            error: null,
          }),
          single: vi.fn().mockResolvedValue({
            data: snapshot ? { generation_context_snapshot: snapshot } : null,
            error: snapshot ? null : new Error('not found'),
          }),
        })),
      })),
    })),
    update,
  })
  return { update, updateEq1, updateEq2, updateEq3, updateSelect }
}

const EXISTING_CAPTIONS = [
  { start: 0, end: 2, text: '我今天要说的这件事' },
  { start: 2, end: 4, text: '比没装追踪严重得多' },
]

beforeEach(() => {
  vi.resetAllMocks()
  mocks.loadLecturePrefs.mockResolvedValue({ glossary: {}, headTrimSec: 0, faceY: null, faceZoom: null, redoReasons: {} })
  mocks.saveLecturePrefs.mockResolvedValue(undefined)
})

describe('loadReelCaptionState', () => {
  it('找不到内容 → null', async () => {
    fakeDb(null)
    expect(await loadReelCaptionState(CLIENT, POST)).toBeNull()
  })

  it('🔴 查询报错(网络抖一下) → 抛错，不能跟"没这条内容"混为一谈(Codex 六审：reel-render.ts 靠这个函数判断要不要复用客户校对过的字幕，查询出错被当成null会让它当成"从没做过"重新听写，用机器字幕把校对结果冲掉)', async () => {
    mocks.from.mockReturnValue({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: new Error('网络抖了一下') }),
          })),
        })),
      })),
    })
    await expect(loadReelCaptionState(CLIENT, POST)).rejects.toThrow('网络抖了一下')
  })

  it('三个字段都从 snapshot 里正确取出', async () => {
    fakeDb({
      raw_recording_url: 'https://x/raw.mp4',
      reel_transcript: { recordingUrl: 'https://x/raw.mp4', segments: [], words: [], savedAt: 't' },
      reel_captions: EXISTING_CAPTIONS,
    })
    const state = await loadReelCaptionState(CLIENT, POST)
    expect(state?.rawRecordingUrl).toBe('https://x/raw.mp4')
    expect(state?.captions).toEqual(EXISTING_CAPTIONS)
  })

  it('snapshot 是空对象也不崩，三个字段都是 null', async () => {
    fakeDb({})
    const state = await loadReelCaptionState(CLIENT, POST)
    expect(state).toEqual({ rawRecordingUrl: null, transcript: null, captions: null })
  })
})

describe('saveReelCaptions', () => {
  it('🔴 还没有字幕可改 → 报错，不写库', async () => {
    const db = fakeDb({})
    await expect(saveReelCaptions({ clientId: CLIENT, postId: POST, texts: ['x'] }))
      .rejects.toThrow('先做一次自动剪辑')
    expect(db.update).not.toHaveBeenCalled()
  })

  it('🔴 条数对不上 → 报错，不写库(时间轴对不齐比留旧字幕更危险)', async () => {
    const db = fakeDb({ reel_captions: EXISTING_CAPTIONS })
    await expect(saveReelCaptions({ clientId: CLIENT, postId: POST, texts: ['只给一条'] }))
      .rejects.toThrow('字幕条数对不上')
    expect(db.update).not.toHaveBeenCalled()
  })

  it('保存时时间不变，只换文字', async () => {
    const db = fakeDb({ reel_captions: EXISTING_CAPTIONS })
    await saveReelCaptions({ clientId: CLIENT, postId: POST, texts: ['改好的第一句', '改好的第二句'] })
    expect(db.update).toHaveBeenCalledWith({
      generation_context_snapshot: {
        reel_captions: [
          { start: 0, end: 2, text: '改好的第一句' },
          { start: 2, end: 4, text: '改好的第二句' },
        ],
      },
    })
  })

  it('🔴 清空某条字幕 → 保留空文本，不许缩短数组(Codex 复审属实：重做片按长度比对校对结果，缩短了会让整批校对失效)', async () => {
    const db = fakeDb({ reel_captions: EXISTING_CAPTIONS })
    const { saved } = await saveReelCaptions({ clientId: CLIENT, postId: POST, texts: ['留着', '  '] })
    expect(saved).toBe(2) // 条数不变，不是"少了一条"
    expect(db.update).toHaveBeenCalledWith({
      generation_context_snapshot: {
        reel_captions: [
          { start: 0, end: 2, text: '留着' },
          { start: 2, end: 4, text: '' }, // 清空的那条留空文本，不是被删掉
        ],
      },
    })
  })

  it('🔴 真改了专有名词写法 → 学进客户词表(下次自动纠正，不用改第二遍)', async () => {
    // 学习只认拉丁词(工具名/术语大小写这类) —— 纯中文的整句改写不算，
    // 这是 extractTermEdits 自己的边界(LATIN_TOKEN)，不是这里的假设。
    fakeDb({ reel_captions: [{ start: 0, end: 2, text: '打开ga4看一眼' }] })
    await saveReelCaptions({ clientId: CLIENT, postId: POST, texts: ['打开GA4看一眼'] })
    expect(mocks.saveLecturePrefs).toHaveBeenCalledWith(
      CLIENT,
      expect.objectContaining({
        glossary: expect.objectContaining({ ga4: expect.objectContaining({ to: 'GA4' }) }),
      }),
    )
  })

  it('纯中文的整句改写不算术语学习(设计如此，不是bug)', async () => {
    fakeDb({ reel_captions: [{ start: 0, end: 2, text: '身影不好做' }] })
    await saveReelCaptions({ clientId: CLIENT, postId: POST, texts: ['生意不好做'] })
    expect(mocks.saveLecturePrefs).not.toHaveBeenCalled()
  })

  it('没改词就不该去碰词表(省一次写)', async () => {
    fakeDb({ reel_captions: EXISTING_CAPTIONS })
    await saveReelCaptions({ clientId: CLIENT, postId: POST, texts: EXISTING_CAPTIONS.map((c) => c.text) })
    expect(mocks.saveLecturePrefs).not.toHaveBeenCalled()
  })

  it('🔴 写库时状态条件并进 update 本身，不是先读后判(Codex 复审)', async () => {
    const db = fakeDb({ reel_captions: EXISTING_CAPTIONS })
    await saveReelCaptions({ clientId: CLIENT, postId: POST, texts: ['改好1', '改好2'] })
    expect(db.updateEq3).toHaveBeenCalledWith('status', 'approved')
  })

  it('🔴 保存这一刻内容状态已经变了(排期/发布) → 报错，不假装保存成功(路由调用前查过一次，但那是先读后判，真正拦住竞态的是这次原子条件)', async () => {
    const db = fakeDb({ reel_captions: EXISTING_CAPTIONS }, { updateHits: 0 })
    await expect(saveReelCaptions({ clientId: CLIENT, postId: POST, texts: ['改好1', '改好2'] }))
      .rejects.toThrow('状态已经变了')
    expect(db.updateSelect).toHaveBeenCalled()
  })

  it('学习失败不影响这次保存已经成功', async () => {
    const db = fakeDb({ reel_captions: [{ start: 0, end: 2, text: '身影不好做' }] })
    mocks.loadLecturePrefs.mockRejectedValue(new Error('boom'))
    const res = await saveReelCaptions({ clientId: CLIENT, postId: POST, texts: ['生意不好做'] })
    expect(res.saved).toBe(1)
    expect(db.update).toHaveBeenCalled()
  })
})
