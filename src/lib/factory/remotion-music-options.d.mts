export interface RemotionMusicChoice {
  id: string
  file: string
  mood: string
  style: string
  energy: string
  status: string
  clean_until_sec: number
  max_video_seconds: number
}

export interface RemotionMusicReplacement {
  remotion: {
    template?: unknown
    props?: unknown
    [key: string]: unknown
  }
  choice: RemotionMusicChoice
}

export interface RemotionMusicClearance {
  verdict: 'pass' | 'fail' | 'unreadable'
  reason: string
  track_id: string | null
  clean_until_sec: number | null
}

export function remotionMusicChoices(rawBriefRemotion: unknown): RemotionMusicChoice[]

export function remotionMusicClearance(rawBriefRemotion: unknown): RemotionMusicClearance

export function replaceRemotionMusic(
  rawBriefRemotion: unknown,
  musicId: string,
): RemotionMusicReplacement | null
