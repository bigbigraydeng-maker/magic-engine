import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseSkillCard } from './parse'
import type { SkillCard, SkillCardError } from './types'

export const SKILL_CARDS_DIR = 'docs/skill-cards'
export const RULEBOOK_PATH = 'docs/sops/2026-10-10-ads-agent-playbook-and-rules-v1.0.md'
export const DIGEST_PATH = 'docs/skill-cards/ME-ADS-RULES-DIGEST.md'
export const SKILL_CARD_URL = 'https://github.com/bigbigraydeng-maker/magic-engine/blob/main/docs/skill-cards/'
export const CARD_FILE_RE = /^\d{4}-\d{2}-\d{2}-.+\.md$/

export interface SkillCardLoad {
  cards: SkillCard[]
  errors: SkillCardError[]
  rulebookText: string
  digestText: string
}

/** 读一个可选文本文件，读不到就返回空串 */
function readOptional(path: string): string {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return ''
  }
}

export function loadSkillCards(root: string = process.cwd()): SkillCardLoad {
  const dir = join(root, SKILL_CARDS_DIR)
  const files = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && CARD_FILE_RE.test(entry.name))
    .map((entry) => entry.name)
    .sort()

  const cards: SkillCard[] = []
  const errors: SkillCardError[] = []

  for (const file of files) {
    const result = parseSkillCard(file, readFileSync(join(dir, file), 'utf8'))
    if (result.ok) {
      cards.push(result.card)
    } else {
      errors.push(result.error)
    }
  }

  return {
    cards,
    errors,
    rulebookText: readOptional(join(root, RULEBOOK_PATH)),
    digestText: readOptional(join(root, DIGEST_PATH)),
  }
}
