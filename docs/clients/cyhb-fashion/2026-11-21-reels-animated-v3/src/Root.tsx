import React from 'react'
import { Composition } from 'remotion'
import { Reel, FPS, total, type Seg } from './Reel'

const promos = (buy2: string): Seg[] => [
  { kind: 'promo', clip: 'bf_balloon.mp4', frames: 60, kicker: 'BLACK FRIDAY', big: '20%', sub: 'OFF STOREWIDE' },
  { kind: 'promo', clip: buy2, frames: 60, kicker: 'BUY 2', big: '40%', sub: 'OFF BOTH' },
  { kind: 'promo', clip: 'rack_hand.mp4', frames: 60, kicker: 'SALE SECTION', big: '50%', sub: 'OFF' },
  { kind: 'end', clip: 'store_sign.mp4', frames: 116 },
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
  { kind: 'hook', flashes: ['c45_1.mp4', 'c8_3.mp4', 'c37_3.mp4'], clip: 'walk_in.mp4', frames: 110 },
  { kind: 'label', clip: 'wall_script.mp4', frames: 54, label: 'Personal styling, in store' },
  { kind: 'label', clip: 'c45_1.mp4', frames: 54, label: 'Seen this in Newmarket?' },
  ...promos('c27two_z.mp4'),
]

const D: Seg[] = [
  { kind: 'hook', flashes: ['e_flower.mp4', 'e_jewel.mp4', 'f_two.mp4'], clip: 'd_front.mp4', frames: 110 },
  { kind: 'label', clip: 'd_stepin.mp4', frames: 48, label: 'Step inside' },
  { kind: 'label', clip: 'd_racks.mp4', frames: 48, label: 'New season, on the racks' },
  { kind: 'label', clip: 'd_hand.mp4', frames: 48, label: 'Find your piece' },
  ...promos('c27two_z.mp4'),
]

const E: Seg[] = [
  { kind: 'hook', flashes: ['e_dress.mp4', 'd_hand.mp4', 'e_jewel.mp4'], clip: 'e_bloom.mp4', frames: 110 },
  { kind: 'label', clip: 'e_dress.mp4', frames: 48, label: 'What catches your eye?', num: 1 },
  { kind: 'label', clip: 'e_jewel.mp4', frames: 48, label: 'What catches your eye?', num: 2 },
  { kind: 'label', clip: 'f_two.mp4', frames: 48, label: 'What catches your eye?', num: 3 },
  ...promos('c27two_z.mp4'),
]

const F: Seg[] = [
  { kind: 'hook', flashes: ['f_one.mp4', 'd_hand.mp4', 'f_two.mp4'], clip: 'f_browse.mp4', frames: 110 },
  { kind: 'label', clip: 'f_one.mp4', frames: 54, label: 'Pick one.' },
  { kind: 'label', clip: 'f_two.mp4', frames: 54, label: 'Pick two.' },
  ...promos('c27two_z.mp4'),
]

const G: Seg[] = [
  { kind: 'label', clip: 'g_flower.mp4', frames: 48, label: 'Inside CYHB Newmarket' },
  { kind: 'label', clip: 'g_door.mp4', frames: 54, label: '34 Nuffield St' },
  { kind: 'label', clip: 'wall_script.mp4', frames: 54, label: 'Capture Your Heartbeat' },
  { kind: 'label', clip: 'd_racks.mp4', frames: 54, label: 'Take your time' },
  { kind: 'label', clip: 'f_two.mp4', frames: 54, label: 'Find your piece' },
  { kind: 'end', clip: 'store_sign.mp4', frames: 116 },
]

const H: Seg[] = [
  { kind: 'label', clip: 'f_browse.mp4', frames: 66, label: 'Have a browse' },
  { kind: 'label', clip: 'f_one.mp4', frames: 54, label: 'Bold prints' },
  { kind: 'label', clip: 'f_two.mp4', frames: 54, label: 'Soft textures' },
  { kind: 'label', clip: 'e_dress.mp4', frames: 54, label: 'Florals' },
  { kind: 'end', clip: 'store_sign.mp4', frames: 116 },
]

const I: Seg[] = [
  { kind: 'label', clip: 'c18emb.mp4', frames: 60, label: 'It’s in the details' },
  { kind: 'label', clip: 'c4flower.mp4', frames: 54, label: 'Petals' },
  { kind: 'label', clip: 'c45_3.mp4', frames: 54, label: 'Bows' },
  { kind: 'label', clip: 'c8_0.5.mp4', frames: 54, label: 'Beads' },
  { kind: 'end', clip: 'store_sign.mp4', frames: 116 },
]

const J: Seg[] = [
  { kind: 'label', clip: 'bf_balloon.mp4', frames: 54, label: 'Black Friday is on' },
  { kind: 'label', clip: 'd_front.mp4', frames: 66, label: 'At CYHB Newmarket' },
  ...promos('c27two_z.mp4'),
]

const K: Seg[] = [
  { kind: 'label', clip: 'c4flower.mp4', frames: 54, label: 'The jewellery corner' },
  { kind: 'label', clip: 'c3flower.mp4', frames: 54, label: 'Flowers' },
  { kind: 'label', clip: 'c9_1.mp4', frames: 54, label: 'Stacks' },
  { kind: 'label', clip: 'c11_1.mp4', frames: 54, label: 'Gold tones' },
  { kind: 'end', clip: 'store_sign.mp4', frames: 116 },
]

export const Root: React.FC = () => (
  <>
    {([['A', A], ['B', B], ['C', C], ['D', D], ['E', E], ['F', F], ['G', G], ['H', H], ['I', I], ['J', J], ['K', K]] as const).map(([id, segs]) => (
      <Composition key={id} id={id} component={Reel} defaultProps={{ segs: segs as Seg[] }} durationInFrames={total(segs as Seg[])} fps={FPS} width={1080} height={1920} />
    ))}
  </>
)
