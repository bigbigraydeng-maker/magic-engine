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

export function remotionMusicChoices(rawBriefRemotion: unknown): RemotionMusicChoice[]

export function replaceRemotionMusic(
  rawBriefRemotion: unknown,
  musicId: string,
): RemotionMusicReplacement | null
