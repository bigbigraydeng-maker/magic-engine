/**
 * Pre-confirmation itinerary ("确认单") sent by the ground operator to the
 * travel agent / traveller. One typed object drives the on-screen preview,
 * the PDF (browser print) and the Word export, so the tour code is entered once.
 */

export interface ConfirmationContact {
  name: string
  mobile: string
}

export interface ConfirmationFlight {
  /** Free text exactly as the operator wants it printed, e.g. "CA 852Z 28JUL LGWPEK HK2 1235 0545 29JUL" */
  text: string
}

export interface ConfirmationDay {
  /** e.g. "29 Jul" */
  date: string
  /** e.g. "Arrive Beijing" / "Beijing (B)" */
  route: string
  /** Highlights, one paragraph per line */
  highlights: string
  /** Overnight city */
  overnight: string
}

export interface ConfirmationHotel {
  city: string
  name: string
  stars: number
  address: string
  phone: string
  /** Optional Chinese name / address block */
  chinese: string
}

export interface ConfirmationTip {
  title: string
  body: string
}

/** photo = Tailor-made style cover page (big picture + cream panel); banner = compact red title bar */
export type CoverStyle = 'photo' | 'banner'

export interface ConfirmationCover {
  style: CoverStyle
  /** 'auto' = pick from the itinerary; otherwise a name from HERO_CHOICES */
  hero: string
  /** Big title on the cover; empty = use the default */
  title: string
}

export const DEFAULT_COVER: ConfirmationCover = { style: 'photo', hero: 'auto', title: '' }

export interface ConfirmationData {
  cover: ConfirmationCover
  tourCode: string
  groundOperator: string
  operatorTel: string
  departureDate: string
  emergencyContacts: ConfirmationContact[]
  paxCount: number
  rooms: string
  flights: ConfirmationFlight[]
  /** One name per line, printed on the pick-up card */
  pickupCardNames: string
  guideNote: string
  days: ConfirmationDay[]
  /** Shown under the itinerary table, e.g. Forbidden City ticket caveat */
  itineraryNote: string
  hotels: ConfirmationHotel[]
  inclusions: string[]
  exclusions: string[]
  tips: ConfirmationTip[]
}

export const EMPTY_DAY: ConfirmationDay = { date: '', route: '', highlights: '', overnight: '' }
export const EMPTY_HOTEL: ConfirmationHotel = { city: '', name: '', stars: 4, address: '', phone: '', chinese: '' }
