import { useVideoConfig } from 'remotion'
import { aspectFromCanvas, dataCardFrame, logoBox, placeBox, scalePx } from './aspect'
import type { AspectId, PlaceBoxInput, PlacedBox } from './aspect'

/** Canvas metrics for the composition currently rendering. 9:16 numbers stay exact. */
export function useStage() {
  const { width, height } = useVideoConfig()
  const aspect: AspectId = aspectFromCanvas(width, height)
  return {
    aspect,
    width,
    height,
    logo: logoBox(width, height),
    dataCard: dataCardFrame(width, height),
    place: (box: PlaceBoxInput): PlacedBox => placeBox(width, height, box),
    px: (n: number): number => scalePx(width, height, n),
    fit: (designPx: number, placed: PlacedBox, designBase: number): number => {
      if (aspect === '9:16') return designPx
      const sized = placed.fontSize ?? designBase
      return Math.max(16, Math.round((designPx * sized) / designBase))
    },
  }
}
