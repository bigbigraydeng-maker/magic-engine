import { describe, expect, it } from 'vitest'
import { activationBlocker, normalizeClipTags, normalizeHttpsUrl, normalizeSceneTag, parseClipUploadMetadata, REQUIRED_LICENSE_SCOPES, serializeLicenseReviewEvidence } from './clip-library'

describe('视频工厂素材标签目录校验', () => {
  it('规范化标签，去重并拒绝无效的空白/超量值', () => {
    expect(normalizeSceneTag('  Chongqing River View ')).toBe('chongqing_river_view')
    expect(normalizeClipTags(['China', 'China', 'night market'])).toEqual(['china', 'night_market'])
    expect(normalizeClipTags(Array.from({ length: 21 }, () => 'tag'))).toBeNull()
  })

  it('来源链接必须为无凭据的 HTTPS URL', () => {
    expect(normalizeHttpsUrl('http://example.com')).toBeUndefined()
    expect(normalizeHttpsUrl('https://user:pass@example.com')).toBeUndefined()
    expect(normalizeHttpsUrl('https://example.com/source')).toBe('https://example.com/source')
  })

  it('入库元数据必须对应合法轨道、标签和每个文件的可读视频信息', () => {
    const metadata = {
      track: 'a_real', sceneTag: 'chongqing_river', tags: ['chongqing', 'river'],
      media: [{ name: 'clip.mp4', size: 123, durationSeconds: 6.5, aspectRatio: '9:16' }],
    }
    expect(parseClipUploadMetadata(JSON.stringify(metadata))).toMatchObject({ track: 'a_real', sceneTag: 'chongqing_river' })
    expect(parseClipUploadMetadata(JSON.stringify({ ...metadata, track: 'unknown' }))).toBeNull()
    expect(parseClipUploadMetadata(JSON.stringify({ ...metadata, media: [{ ...metadata.media[0], durationSeconds: 0 }] }))).toBeNull()
  })

  it('只在许可证据、文件指纹、时长和轨道标签满足后激活', () => {
    const candidate = {
      track: 'a_real' as const, sceneTag: 'chongqing_river', motionType: null, tags: ['chongqing'],
      sourceAuthor: 'CTS', sourceUrl: 'https://example.com/source', licenseName: 'Owned', licenseUrl: 'https://example.com/license',
      mediaType: 'video' as const, durationSeconds: 4, sha256: 'a'.repeat(64), licenseStatus: 'verified' as const,
      licenseReviewNote: serializeLicenseReviewEvidence('The official licence page permits reuse for this media in monetised edited online video.', [...REQUIRED_LICENSE_SCOPES]),
    }
    expect(activationBlocker(candidate, false)).toBeNull()
    expect(activationBlocker({ ...candidate, sha256: null }, false)).toContain('指纹')
    expect(activationBlocker({ ...candidate, licenseStatus: 'unknown' }, false)).toContain('许可尚未')
    expect(activationBlocker({ ...candidate, licenseReviewNote: null }, false)).toContain('商业使用')
    expect(activationBlocker({ ...candidate, licenseReviewNote: serializeLicenseReviewEvidence('Licence page reviewed; commercial use only.', ['commercial_use']) }, false)).toContain('商业使用')
    expect(activationBlocker({ ...candidate, track: 'b_generated', sceneTag: 'chongqing_landmark' }, false)).toContain('抽象白名单')
    expect(activationBlocker({ ...candidate, track: 'b_generated', sceneTag: 'chongqing_landmark' }, true)).toBeNull()
  })
})
