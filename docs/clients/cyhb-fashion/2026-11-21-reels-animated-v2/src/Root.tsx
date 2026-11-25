import React from 'react'
import { Composition } from 'remotion'
import { Reel, FPS, total, type Seg } from './Reel'

const promos = (buy2: string): Seg[] => [
  { kind: 'promo', clip: 'c4flower.mp4', frames: 60, kicker: 'BLACK FRIDAY', big: '20%', sub: 'OFF STOREWIDE' },
  { kind: 'promo', clip: buy2, frames: 60, kicker: 'BUY 2', big: '40%', sub: 'OFF BOTH' },
  { kind: 'promo', clip: 'c41z.mp4', frames: 60, kicker: 'SALE SECTION', big: '50%', sub: 'OFF' },
  { kind: 'end', clip: 'store_door.mp4', frames: 116 },
]

const A: Seg[] = [
  { kind: 'hook', flashes: ['c9_1.mp4', 'c45_3.mp4', 'c10_1.mp4'], clip: 'c8_0.5.mp4', frames: 110 },
  { kind: 'label', clip: 'c8_3.mp4', frames: 48, label: 'Which stack is you?', num: 1 },
  { kind: 'label', clip: 'c9_1.mp4', frames: 48, label: 'Which stack is you?', num: 2 },
  { kind: 'label', clip: 'c10_1.mp4', frames: 48, label: 'Which stack is you?', num: 3 },
  { kind: 'label', clip: 'c11_1.mp4', frames: 48, label: 'Which stack is you?', num: 4 },
  ...promos('c27two_z.mp4'),
]

const B: Seg[] = [
  { kind: 'hook', flashes: ['knit_new.mp4', 'c44_2.mp4', 'c28c.mp4', 'c45_3.mp4'], clip: 'c27_6.mp4', frames: 110 },
  { kind: 'label', clip: 'c18emb.mp4', frames: 48, label: 'Which look is yours?' },
  { kind: 'label', clip: 'c44_2.mp4', frames: 48, label: 'Look 1' },
  { kind: 'label', clip: 'c28c.mp4', frames: 48, label: 'Look 2' },
  { kind: 'label', clip: 'c45_3.mp4', frames: 48, label: 'Look 3' },
  ...promos('c27two_z.mp4'),
]

const C: Seg[] = [
  { kind: 'hook', flashes: ['c45_1.mp4', 'c8_3.mp4', 'c37_3.mp4'], clip: 'store_wide.mp4', frames: 110 },
  { kind: 'label', clip: 'c37_3.mp4', frames: 54, label: 'Personal styling, in store' },
  { kind: 'label', clip: 'c45_1.mp4', frames: 54, label: 'Seen this in Newmarket?' },
  ...promos('c27two_z.mp4'),
]

export const Root: React.FC = () => (
  <>
    {([['A', A], ['B', B], ['C', C]] as const).map(([id, segs]) => (
      <Composition key={id} id={id} component={Reel} defaultProps={{ segs: segs as Seg[] }} durationInFrames={total(segs as Seg[])} fps={FPS} width={1080} height={1920} />
    ))}
  </>
)
