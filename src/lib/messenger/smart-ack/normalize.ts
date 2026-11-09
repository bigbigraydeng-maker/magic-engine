const ZERO_WIDTH = /[​-‍⁠﻿­]/g

/** NFKC-fold (full-width -> ASCII), drop zero-width chars, lowercase, collapse whitespace. */
export function foldText(input: string): string {
  return input.normalize('NFKC').replace(ZERO_WIDTH, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/** foldText then drop everything except letters, digits and CJK (defeats "p.r.i.c.e" / "pr ice"). */
export function squashText(input: string): string {
  return foldText(input).replace(/[^\p{L}\p{N}]/gu, '')
}
