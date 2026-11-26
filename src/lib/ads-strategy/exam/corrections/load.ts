import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertValidCorrectionsFile, type CorrectionValidationResult, validateCorrectionsFile } from './validate'
import type { AdsAgentCorrection, AdsCorrectionRecordsFile } from './types'

const HERE = dirname(fileURLToPath(import.meta.url))
const RECORDS_PATH = join(HERE, 'records.json')

export function correctionRecordsPath(): string {
  return RECORDS_PATH
}

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown
}

export function loadCorrectionRecordsFile(): AdsCorrectionRecordsFile {
  const raw = readJsonFile(RECORDS_PATH)
  assertValidCorrectionsFile(raw)
  return raw
}

export function loadAdsAgentCorrections(): readonly AdsAgentCorrection[] {
  return loadCorrectionRecordsFile().corrections
}

export function validateStoredCorrections(): CorrectionValidationResult {
  return validateCorrectionsFile(readJsonFile(RECORDS_PATH))
}
