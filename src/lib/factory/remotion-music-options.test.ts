import { describe, expect, it } from 'vitest'
import { remotionMusicChoices, remotionMusicClearance, replaceRemotionMusic } from './remotion-music-options.mjs'

const postcardBrief = (timing = { hookSec: 3, sceneSec: 3, priceSec: 3 }) => ({
  template: 'postcard',
  props: {
    brandColor: '#123456',
    logoFile: 'cts-logo.png',
    musicFile: 'founders-at-dawn.mp3',
    musicStartSec: 5,
    cardOpacity: 0.7,
    cardSide: 'center',
    hook: { clip: 'hook.mp4', lines: ['China at dawn'] },
    scenes: [
      { clip: 'scene-one.mp4', place: 'Shanghai', line: 'Walk beside the old waterfront.', sourceUrl: 'https://example.com/one', sourceQuote: 'Walk beside the old waterfront in Shanghai.', placeSourceQuote: 'Shanghai waterfront.' },
      { clip: 'scene-two.mp4', place: 'Hangzhou', line: 'Follow the lake into the hills.', sourceUrl: 'https://example.com/two', sourceQuote: 'Follow the lake into the hills.', placeSourceQuote: 'Hangzhou lake.' },
    ],
    price: null,
    end: { backdropClip: 'end.mp4', title: 'Explore China' },
    timing,
  },
})

describe('Remotion music choices', () => {
  it('offers only human-cleared catalog tracks with enough clean window for this render', () => {
    const choices = remotionMusicChoices(postcardBrief())
    expect(choices.map((choice) => choice.id)).toEqual(expect.arrayContaining([
      'jade-river-journey',
      'horizons-call',
      'horizons-breath',
      'sunlit-kitchen-window',
      'second-hand-sunrise',
    ]))
    expect(choices.every((choice) => choice.clean_until_sec >= 13)).toBe(true)
    expect(choices.some((choice) => choice.id === 'pipa-trap')).toBe(false)
  })

  it('filters shorter cleared windows when the render needs a longer excerpt', () => {
    const longBrief = postcardBrief({ hookSec: 4, sceneSec: 3, priceSec: 8 })
    const longProps = longBrief.props as Record<string, unknown>
    longProps.scenes = [...longProps.scenes as unknown[], ...longProps.scenes as unknown[]]
    longProps.musicFile = 'pipa-trap.m4a'
    const choices = remotionMusicChoices(longBrief)
    expect(choices.map((choice) => choice.id)).toEqual(['founders-at-dawn'])
    expect(choices[0].max_video_seconds).toBe(26)
  })

  it('applies the selected track to valid props and resets its start offset', () => {
    const updated = replaceRemotionMusic(postcardBrief(), 'jade-river-journey')
    expect(updated?.remotion.props).toMatchObject({
      musicFile: 'jade-river-journey.mp3',
      musicStartSec: 0,
    })
    expect(updated?.choice.id).toBe('jade-river-journey')
  })
})

describe('Remotion music clearance', () => {
  it('passes a human-cleared track that covers this render', () => {
    expect(remotionMusicClearance(postcardBrief())).toMatchObject({
      verdict: 'pass',
      track_id: 'founders-at-dawn',
    })
  })

  it('fails a track that is not in the catalog', () => {
    const brief = postcardBrief()
    brief.props.musicFile = 'not-a-track.mp3'
    expect(remotionMusicClearance(brief).verdict).toBe('fail')
  })

  it('is unreadable when the brief has no music file', () => {
    const brief = postcardBrief()
    brief.props.musicFile = ''
    expect(remotionMusicClearance(brief)).toMatchObject({ verdict: 'unreadable', reason: '读不到' })
  })

  it('fails a track whose clean window does not cover the render', () => {
    const brief = postcardBrief()
    brief.props.musicFile = 'pipa-trap.m4a'
    expect(remotionMusicClearance(brief).verdict).toBe('fail')
  })
})

describe('Remotion music swap and musicGain', () => {
  it('drops musicGain when the track is replaced (the gain was calibrated for the old track)', () => {
    const brief = postcardBrief()
    ;(brief.props as Record<string, unknown>).musicGain = 1.9
    const swapped = replaceRemotionMusic(brief, 'jade-river-journey')
    expect(swapped).not.toBeNull()
    const props = swapped!.remotion.props as Record<string, unknown>
    expect(props).not.toHaveProperty('musicGain')
    expect(props.musicFile).not.toBe('founders-at-dawn.mp3')
  })
})

