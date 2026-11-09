/**
 * Exam question 1 (PM 2026-11-05): CTS Facebook reels made since 2026-09-06, as read from production on 2026-11-05.
 * Source: content_work_orders (status approved / published / in_review), brief.remotion.template / props.musicFile / props.scenes.
 * PM's verdict on this set: "内容同质化太严重——视觉风格、剪辑风格、BGM". The audit must find it.
 * variantOf for the three 11-03 paid variants comes from ledger 2026-11-03-cts-winner-variants-3-orders (base 164a29c1).
 */
import type { AuditReel } from '../../audit'

type Row = [id: string, createdOn: string, template: 'postcard' | 'list', music: string, scenes: number, brand: string, variantOf: string | null]

const ROWS: Row[] = [
  ['2a423cdf', '2026-11-03', 'postcard', 'horizons-call.mp3', 3, '#B61E2E', 'f4bdd5f6'],
  ['45489557', '2026-11-03', 'list', 'music/horizons-call.mp3', 3, '#B61E2E', '164a29c1'],
  ['4bb9453c', '2026-11-03', 'list', 'music/jade_river_journey.mp3', 3, '#B61E2E', '164a29c1'],
  ['1f77d528', '2026-11-03', 'list', 'music/jade_river_journey.mp3', 3, '#B61E2E', '164a29c1'],
  ['f868fb79', '2026-10-27', 'postcard', 'music/horizons-call.mp3', 3, '#B61E2E', null],
  ['f4bdd5f6', '2026-10-27', 'postcard', 'music/horizons-breath.m4a', 3, '#B61E2E', null],
  ['cd0dea98', '2026-10-27', 'postcard', 'music/jade_river_journey.mp3', 3, '#B61E2E', null],
  ['6efd57bb', '2026-10-25', 'postcard', 'music/horizons-breath.m4a', 4, '#B61E2E', null],
  ['932e022b', '2026-10-25', 'postcard', 'river-pandas-peaks-b2-2.mp3', 4, '#B61E2E', null],
  ['ef4460b3', '2026-10-25', 'postcard', 'music/jade_river_journey.mp3', 3, '#B61E2E', null],
  ['5cc3d35d', '2026-10-25', 'postcard', 'river-pandas-peaks-b2-2.mp3', 4, '#B61E2E', null],
  ['3f79a2ce', '2026-10-25', 'postcard', 'music/horizons-breath.m4a', 4, '#B61E2E', null],
  ['90506421', '2026-10-25', 'postcard', 'music/jade_river_journey.mp3', 3, '#B61E2E', null],
  ['e3d8e19a', '2026-10-25', 'postcard', 'music/horizons-call.mp3', 3, '#B61E2E', null],
  ['9e9a1545', '2026-10-25', 'postcard', 'river-pandas-peaks-b2-2.mp3', 4, '#B61E2E', null],
  ['f9084614', '2026-10-25', 'postcard', 'founders-at-dawn.mp3', 4, '#B61E2E', null],
  ['681d6792', '2026-10-25', 'postcard', 'founders-at-dawn.mp3', 4, '#B61E2E', null],
  ['7dba89ce', '2026-10-24', 'postcard', 'jade-river-journey.mp3', 2, '#B61E2E', null],
  ['5d0ea1ee', '2026-10-22', 'postcard', 'founders-at-dawn.mp3', 2, '#B61E2E', null],
  ['2fe19fe6', '2026-10-22', 'postcard', 'founders-at-dawn.mp3', 2, '#B61E2E', null],
  ['f3dd9f83', '2026-10-20', 'list', 'music/horizons-breath.m4a', 3, '#B61E2E', null],
  ['f61c2bf3', '2026-10-20', 'list', 'music/jade_river_journey.mp3', 3, '#B61E2E', null],
  ['242784cb', '2026-10-20', 'postcard', 'music/horizons-call.mp3', 3, '#B61E2E', null],
  ['b2e5025f', '2026-10-20', 'list', 'music/horizons-breath.m4a', 3, '#B61E2E', null],
  ['812221fd', '2026-10-18', 'list', 'music/horizons-breath.m4a', 3, '#B61E2E', null],
  ['6149a614', '2026-10-18', 'list', 'music/horizons-call.mp3', 3, '#B61E2E', null],
  ['49fe022e', '2026-10-18', 'postcard', 'music/jade_river_journey.mp3', 2, '#B61E2E', null],
  ['ef24296d', '2026-10-15', 'postcard', 'music/founders-in-motion_n.mp3', 2, '#B61E2E', null],
  ['cb752a8f', '2026-10-15', 'postcard', 'music/horizons-call.mp3', 3, '#B61E2E', null],
  ['bb6b51b7', '2026-10-15', 'postcard', 'music/second-hand-sunrise_n.mp3', 2, '#B61E2E', null],
  ['46fb06b8', '2026-10-15', 'postcard', 'music/sunlit-kitchen-window_n.mp3', 2, '#B61E2E', null],
  ['2ef627ff', '2026-10-14', 'postcard', 'music/second-hand-sunrise.mp3', 2, '#B61E2E', null],
  ['fd7e3e5a', '2026-10-14', 'postcard', 'music/sunlit-kitchen-window.mp3', 2, '#B61E2E', null],
  ['00f23d78', '2026-10-14', 'postcard', 'music/horizons-call.mp3', 3, '#B61E2E', null],
  ['4bd78644', '2026-10-14', 'postcard', 'music/horizons-breath.m4a', 3, '#B61E2E', null],
  ['e29b0986', '2026-10-11', 'list', 'music/founders-at-dawn.mp3', 3, '#B61E2E', null],
  ['7ed7645b', '2026-10-11', 'list', 'music/founders-at-dawn.mp3', 3, '#B61E2E', null],
  ['fa4fdd89', '2026-10-10', 'list', 'music/founders-at-dawn.mp3', 3, '#B61E2E', null],
  ['59282423', '2026-10-06', 'list', 'music/founders-at-dawn.mp3', 4, '#C41E3A', null],
  ['e8c5b66a', '2026-10-06', 'list', 'music/founders-at-dawn.mp3', 4, '#C41E3A', null],
  ['9fcb4ae6', '2026-10-05', 'list', 'music/jade_river_journey.mp3', 5, '#D11D3A', null],
]

export const CTS_REELS_2026_11_05: AuditReel[] = ROWS.map(([id, createdOn, template, music, scenes, brandColor, variantOf]) => ({
  id, createdOn, template, engine: 'remotion', music, scenes, brandColor, variantOf, format: null, pillar: null,
}))

export const CTS_AS_OF = '2026-11-05'
