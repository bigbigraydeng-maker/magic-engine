import { describe, expect, it } from 'vitest'
import { looksLikeVideoResponse, normalizeRecordingLink } from './recording-link'

describe('normalizeRecordingLink · Dropbox', () => {
  it('分享链接 dl=0 转成直下 dl=1，且保留 rlkey', () => {
    const r = normalizeRecordingLink('https://www.dropbox.com/scl/fi/abc123/lesson1.mp4?rlkey=xyz789&dl=0')
    expect(r.ok).toBe(true)
    expect(r.url).toContain('dl=1')
    expect(r.url).not.toContain('dl=0')
    expect(r.url).toContain('rlkey=xyz789')
  })

  it('没带 dl 参数的也补上 dl=1', () => {
    const r = normalizeRecordingLink('https://www.dropbox.com/s/abc/lesson1.mov')
    expect(r.url).toContain('dl=1')
  })

  it('raw=1 的老写法换成 dl=1(不留两个冲突参数)', () => {
    const r = normalizeRecordingLink('https://www.dropbox.com/s/abc/a.mp4?raw=1')
    expect(r.url).toContain('dl=1')
    expect(r.url).not.toContain('raw=1')
  })

  it('已是直下域名的原样保留', () => {
    const url = 'https://uc123.dl.dropboxusercontent.com/cd/0/get/abc/lesson1.mp4'
    expect(normalizeRecordingLink(url)).toEqual({ ok: true, url })
  })

  it('前后空格容错', () => {
    expect(normalizeRecordingLink('  https://www.dropbox.com/s/a/b.mp4?dl=0  ').ok).toBe(true)
  })
})

describe('normalizeRecordingLink · 挡掉的情况', () => {
  it('空输入', () => {
    expect(normalizeRecordingLink('').ok).toBe(false)
    expect(normalizeRecordingLink('   ').ok).toBe(false)
  })
  it('不是链接', () => {
    expect(normalizeRecordingLink('我的视频.mp4').ok).toBe(false)
  })
  it('非 https 一律拒绝', () => {
    expect(normalizeRecordingLink('http://www.dropbox.com/s/a/b.mp4').ok).toBe(false)
    expect(normalizeRecordingLink('file:///etc/passwd').ok).toBe(false)
  })
  it('私网/元数据地址挡住(防让后台去抓内网)', () => {
    for (const u of [
      'https://localhost/a.mp4',
      'https://127.0.0.1/a.mp4',
      'https://10.0.0.5/a.mp4',
      'https://169.254.169.254/latest/meta-data/',
      'https://192.168.1.10/a.mp4',
      'https://172.16.0.9/a.mp4',
    ]) {
      expect(normalizeRecordingLink(u).ok, u).toBe(false)
    }
  })
  it('iCloud / Google Drive 分享页当场说清楚，不拖到做片才失败', () => {
    expect(normalizeRecordingLink('https://www.icloud.com/iclouddrive/abc').error).toContain('iCloud')
    expect(normalizeRecordingLink('https://drive.google.com/file/d/abc/view').error).toContain('Google')
  })
})

describe('looksLikeVideoResponse', () => {
  it('video/* 认', () => {
    expect(looksLikeVideoResponse('video/mp4', 'https://x/a')).toBe(true)
  })
  it('octet-stream 认(Dropbox 直下常见)', () => {
    expect(looksLikeVideoResponse('application/octet-stream', 'https://x/a')).toBe(true)
  })
  it('没 content-type 时看扩展名', () => {
    expect(looksLikeVideoResponse(null, 'https://x/lesson.mp4?dl=1')).toBe(true)
    expect(looksLikeVideoResponse(null, 'https://x/lesson')).toBe(false)
  })
  it('HTML 预览页判否(这正是 dl=0 的坑)', () => {
    expect(looksLikeVideoResponse('text/html; charset=utf-8', 'https://www.dropbox.com/s/a/b')).toBe(false)
  })
})
