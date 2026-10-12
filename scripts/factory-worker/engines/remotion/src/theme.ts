import { loadFont } from '@remotion/google-fonts/Montserrat'

export const { fontFamily } = loadFont('normal', { weights: ['600', '800', '900'], subsets: ['latin'] })
// Meta Reels safe zone on a 1080x1920 canvas: keep key content between y=270 and y=1248, off the right 120px rail.
export const SAFE_TOP = 270
export const SAFE_BOTTOM = 1248
export const SAFE_RIGHT = 960
