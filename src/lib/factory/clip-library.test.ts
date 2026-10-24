import { describe, expect, it } from 'vitest'
import { activationBlocker, clipCanEnterFactoryPool, hasCurrentLicenseEvidence, normalizeClipTags, normalizeHttpsUrl, normalizeSceneTag, parseClipUploadMetadata, REQUIRED_LICENSE_SCOPES, serializeLicenseReviewEvidence } from './clip-library'

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
      licenseReviewedByUserId: 'reviewer-1', reviewedByUserId: 'reviewer-2',
      licenseReviewNote: serializeLicenseReviewEvidence({
        summary: 'The official licence page permits reuse for this media in monetised edited online video.',
        permittedScopes: [...REQUIRED_LICENSE_SCOPES],
        sourceUrl: 'https://example.com/source',
        licenseUrl: 'https://example.com/license',
        assetSha256: 'a'.repeat(64),
        basis: 'license_page',
      }),
    }
    expect(activationBlocker(candidate, false)).toBeNull()
    expect(activationBlocker({ ...candidate, sha256: null }, false)).toContain('指纹')
    expect(activationBlocker({ ...candidate, licenseStatus: 'unknown' }, false)).toContain('许可尚未')
    expect(activationBlocker({ ...candidate, licenseReviewNote: null }, false)).toContain('绑定当前素材')
    expect(activationBlocker({ ...candidate, licenseReviewNote: serializeLicenseReviewEvidence({ summary: 'Licence page reviewed; commercial use only.', permittedScopes: ['commercial_use'], sourceUrl: 'https://example.com/source', licenseUrl: 'https://example.com/license', assetSha256: 'a'.repeat(64), basis: 'license_page' }) }, false)).toContain('商业使用')
    expect(activationBlocker({ ...candidate, licenseReviewNote: serializeLicenseReviewEvidence({ summary: 'The page supports these specific uses and this asset.', permittedScopes: [...REQUIRED_LICENSE_SCOPES], sourceUrl: 'https://example.com/other-source', licenseUrl: 'https://example.com/license', assetSha256: 'a'.repeat(64), basis: 'license_page' }) }, false)).toContain('绑定当前素材')
    expect(activationBlocker({ ...candidate, licenseReviewNote: serializeLicenseReviewEvidence({ summary: 'The page supports these specific uses and this asset.', permittedScopes: [...REQUIRED_LICENSE_SCOPES], sourceUrl: 'https://example.com/source', licenseUrl: 'https://example.com/license', assetSha256: 'b'.repeat(64), basis: 'license_page' }) }, false)).toContain('绑定当前素材')
    expect(activationBlocker({ ...candidate, track: 'b_generated', sceneTag: 'chongqing_landmark' }, false)).toContain('抽象白名单')
    expect(activationBlocker({ ...candidate, track: 'b_generated', sceneTag: 'chongqing_landmark' }, true)).toBeNull()
  })

  it('B 轨只允许自身证据通过，或精确继承已核 AI 改图源图的许可', () => {
    const clearedSources = new Set(['https://storage.example.test/cleared-image.png'])
    const base = { track: 'b_generated' as const, isStillImage: false, isAiTransformed: false, hasCurrentEvidence: false, sourceImageUrl: null }
    expect(clipCanEnterFactoryPool({ ...base, sourceImageUrl: 'https://storage.example.test/cleared-image.png' }, clearedSources)).toBe(true)
    expect(clipCanEnterFactoryPool({ ...base, sourceImageUrl: 'https://storage.example.test/other-image.png' }, clearedSources)).toBe(false)
    expect(clipCanEnterFactoryPool({ ...base, sourceImageUrl: null }, clearedSources)).toBe(false)
    expect(clipCanEnterFactoryPool({ ...base, track: 'a_real', sourceImageUrl: 'https://storage.example.test/cleared-image.png' }, clearedSources)).toBe(false)
    expect(clipCanEnterFactoryPool({ ...base, hasCurrentEvidence: true }, clearedSources)).toBe(true)
  })

  it('许可证据双人审核使用稳定用户 ID，不因邮箱变化把同一人算成两人', () => {
    const evidence = {
      licenseStatus: 'verified' as const,
      licenseReviewNote: serializeLicenseReviewEvidence({ summary: 'The licence page permits the exact commercial and edited distribution uses.', permittedScopes: [...REQUIRED_LICENSE_SCOPES], sourceUrl: 'https://example.com/source', licenseUrl: 'https://example.com/license', assetSha256: 'a'.repeat(64), basis: 'license_page' }),
      sourceAuthor: 'Author', sourceUrl: 'https://example.com/source', licenseName: 'CC BY 4.0', licenseUrl: 'https://example.com/license', sha256: 'a'.repeat(64),
      licenseReviewedByUserId: 'auth-user-1', reviewedByUserId: 'auth-user-2',
    }
    expect(hasCurrentLicenseEvidence(evidence)).toBe(true)
    expect(hasCurrentLicenseEvidence({ ...evidence, reviewedByUserId: 'auth-user-1' })).toBe(false)
    expect(hasCurrentLicenseEvidence({ ...evidence, licenseReviewedByUserId: null })).toBe(false)
  })
})
