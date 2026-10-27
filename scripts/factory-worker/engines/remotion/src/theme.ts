import { loadFont } from '@remotion/google-fonts/Montserrat'

export const { fontFamily } = loadFont('normal', { weights: ['600', '800', '900'], subsets: ['latin'] })
// Meta Reels safe zone on a 1080x1920 canvas: keep key content between y=270 and y=1248, off the right 120px rail.
// Other ratios reflow from this zone in src/lib/factory/video-aspects.ts (do not retune 9:16 here without that table).
// The numbers themselves live in safeZone.ts so the hook, end card, and corner logo share one inset.
export { SAFE_LEFT, SAFE_TOP, SAFE_BOTTOM, SAFE_RIGHT, CORNER_LOGO } from './safeZone.ts'
