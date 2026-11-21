import React from 'react'
import { cancelRender, continueRender, delayRender } from 'remotion'
import { loadFont as loadBebas } from '@remotion/google-fonts/BebasNeue'
import { loadFont as loadCormorant } from '@remotion/google-fonts/CormorantGaramond'
import { loadFont as loadDmSans } from '@remotion/google-fonts/DMSans'
import { loadFont as loadFraunces } from '@remotion/google-fonts/Fraunces'
import { loadFont as loadLibre } from '@remotion/google-fonts/LibreBaskerville'
import { loadFont as loadMontserrat } from '@remotion/google-fonts/Montserrat'
import { loadFont as loadNotoSans } from '@remotion/google-fonts/NotoSansSC'
import { loadFont as loadNotoSerif } from '@remotion/google-fonts/NotoSerifSC'
import { loadFont as loadNunito } from '@remotion/google-fonts/Nunito'
import { loadFont as loadOswald } from '@remotion/google-fonts/Oswald'
import { loadFont as loadOutfit } from '@remotion/google-fonts/Outfit'
import { loadFont as loadPlayfair } from '@remotion/google-fonts/PlayfairDisplay'
import { loadFont as loadSpace } from '@remotion/google-fonts/SpaceGrotesk'
import { loadFont as loadZcool } from '@remotion/google-fonts/ZCOOLKuaiLe'
import { loadFont as loadXiao } from '@remotion/google-fonts/ZCOOLXiaoWei'
import { fontFamily as legacyFamily } from '../theme'
import type { ResolvedLook } from './types.ts'

const cache = new Map<string, Promise<string>>()

function stack(cjk: string, latin: string): string {
  return `"${cjk}", "${latin}", "WenQuanYi Micro Hei", "Droid Sans Fallback", sans-serif`
}

function loadLatin(id: string): { fontFamily: string; waitUntilDone: () => Promise<undefined> } {
  if (id === 'Montserrat') return loadMontserrat('normal', { weights: ['600', '800', '900'], subsets: ['latin'] })
  if (id === 'Oswald') return loadOswald('normal', { weights: ['500', '600', '700'], subsets: ['latin'] })
  if (id === 'PlayfairDisplay') return loadPlayfair('normal', { weights: ['600', '700', '900'], subsets: ['latin'] })
  if (id === 'CormorantGaramond') return loadCormorant('normal', { weights: ['600', '700'], subsets: ['latin'] })
  if (id === 'DMSans') return loadDmSans('normal', { weights: ['600', '700', '800'], subsets: ['latin'] })
  if (id === 'Nunito') return loadNunito('normal', { weights: ['700', '800', '900'], subsets: ['latin'] })
  if (id === 'SpaceGrotesk') return loadSpace('normal', { weights: ['500', '600', '700'], subsets: ['latin'] })
  if (id === 'Fraunces') return loadFraunces('normal', { weights: ['600', '700', '900'], subsets: ['latin'] })
  if (id === 'Outfit') return loadOutfit('normal', { weights: ['600', '700', '800'], subsets: ['latin'] })
  if (id === 'BebasNeue') return loadBebas('normal', { weights: ['400'], subsets: ['latin'] })
  if (id === 'LibreBaskerville') return loadLibre('normal', { weights: ['400', '700'], subsets: ['latin'] })
  throw new Error(`没有这套拉丁字体：${id}`)
}

function loadCjk(id: string): { fontFamily: string; waitUntilDone: () => Promise<undefined> } {
  const warn = { ignoreTooManyRequestsWarning: true as const }
  if (id === 'NotoSansSC') {
    return loadNotoSans('normal', { weights: ['700', '900'], subsets: ['chinese-simplified'], ...warn })
  }
  if (id === 'NotoSerifSC') {
    return loadNotoSerif('normal', { weights: ['700', '900'], subsets: ['chinese-simplified'], ...warn })
  }
  if (id === 'ZCOOLKuaiLe') return loadZcool('normal', { weights: ['400'], subsets: ['chinese-simplified'], ...warn })
  if (id === 'ZCOOLXiaoWei') return loadXiao('normal', { weights: ['400'], subsets: ['chinese-simplified'], ...warn })
  throw new Error(`没有这套中文字体：${id}`)
}

/** Load the Latin and Chinese faces for one pack. Repeated calls share one download. */
export function ensureFonts(fonts: { latinId: string; cjkId: string }): Promise<string> {
  const key = `${fonts.latinId}/${fonts.cjkId}`
  const hit = cache.get(key)
  if (hit) return hit
  const latin = loadLatin(fonts.latinId)
  const cjk = loadCjk(fonts.cjkId)
  const pending = Promise.all([latin.waitUntilDone(), cjk.waitUntilDone()]).then(() => stack(cjk.fontFamily, latin.fontFamily))
  cache.set(key, pending)
  return pending
}

/** Legacy reels get the existing Montserrat name immediately. A style pack waits until both faces are ready. */
export function useStyleFamily(look: ResolvedLook | null): string | null {
  const fontKey = look ? `${look.fonts.latinId}/${look.fonts.cjkId}` : ''
  const [family, setFamily] = React.useState<string | null>(fontKey === '' ? legacyFamily : null)
  React.useEffect(() => {
    if (!look || fontKey === '') return undefined
    const handle = delayRender(`style-fonts-${fontKey}`, { timeoutInMilliseconds: 120000 })
    let live = true
    ensureFonts(look.fonts)
      .then((stackName) => {
        if (live) setFamily(stackName)
        continueRender(handle)
      })
      .catch((err: unknown) => {
        cancelRender(err instanceof Error ? err : new Error('风格字体加载失败'))
      })
    return () => {
      live = false
    }
  }, [fontKey, look])
  return family
}
