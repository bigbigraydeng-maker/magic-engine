import { describe, expect, it } from 'vitest'
import { CHUNK_SIZE, chunkRange, humanTikTokError, planChunks } from './tiktok-adapter'

const MB = 1024 * 1024

describe('planChunks(TikTok 的分块规矩很挑)', () => {
  it('小于一块的片子:整条一块,块大小必须等于文件大小', () => {
    expect(planChunks(3 * MB)).toEqual({ chunkSize: 3 * MB, totalChunks: 1 })
  })

  it('余数并进最后一块,不能单独多出一个小尾巴块', () => {
    // 25MB ÷ 10MB = 2 块(第二块 15MB)。算成 3 块会被 TikTok 直接拒。
    expect(planChunks(25 * MB)).toEqual({ chunkSize: CHUNK_SIZE, totalChunks: 2 })
  })

  it('正好整除', () => {
    expect(planChunks(30 * MB)).toEqual({ chunkSize: CHUNK_SIZE, totalChunks: 3 })
  })

  it('大小不对直接拒,不带着 0 块往下走', () => {
    expect(() => planChunks(0)).toThrow()
    expect(() => planChunks(-1)).toThrow()
  })
})

describe('chunkRange(字节区间必须严丝合缝盖满整条片)', () => {
  it('最后一块吃掉所有余数', () => {
    const size = 25 * MB
    const { chunkSize, totalChunks } = planChunks(size)
    expect(chunkRange(0, totalChunks, chunkSize, size)).toEqual({ start: 0, end: 10 * MB - 1 })
    expect(chunkRange(1, totalChunks, chunkSize, size)).toEqual({ start: 10 * MB, end: size - 1 })
  })

  it('每一块首尾相接、没有空洞、最后一块正好到结尾', () => {
    const size = 29_600_000
    const { chunkSize, totalChunks } = planChunks(size)
    let expected = 0
    for (let i = 0; i < totalChunks; i++) {
      const { start, end } = chunkRange(i, totalChunks, chunkSize, size)
      expect(start).toBe(expected)
      expected = end + 1
    }
    expect(expected).toBe(size)
  })

  it('单块片子覆盖全文件', () => {
    const size = 2 * MB
    const { chunkSize, totalChunks } = planChunks(size)
    expect(chunkRange(0, totalChunks, chunkSize, size)).toEqual({ start: 0, end: size - 1 })
  })
})

describe('humanTikTokError', () => {
  it('未过审说清「不是失败,是只有自己看得见」', () => {
    expect(humanTikTokError('unaudited_client_can_only_post_to_private_accounts'))
      .toContain('仅自己可见')
  })

  it('授权问题指向具体按钮,不是「联系我们」', () => {
    expect(humanTikTokError('scope_not_authorized')).toContain('连接 TikTok')
    expect(humanTikTokError('access_token invalid')).toContain('连接 TikTok')
  })

  it('认不出的报错也给人话,不返回空', () => {
    expect(humanTikTokError('ECONNRESET')).toBeTruthy()
  })
})
