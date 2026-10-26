import { loadFont } from '@remotion/google-fonts/Montserrat'

export const { fontFamily } = loadFont('normal', { weights: ['600', '800', '900'], subsets: ['latin'] })
export { SAFE_LEFT, SAFE_TOP, SAFE_BOTTOM, SAFE_RIGHT, CORNER_LOGO } from './safeZone.ts'
