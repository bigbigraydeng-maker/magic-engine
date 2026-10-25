// Test support only: loads the REAL Remotion engine modules without a static `.ts` import
// (the engine folder is excluded from tsc and uses `.ts` extension imports). Never imported by runtime code.
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { MusicTrack } from './types'

const ENGINE_SRC = join(process.cwd(), 'scripts', 'factory-worker', 'engines', 'remotion', 'src')

export interface RealEngine {
  loadTemplate(id: 'montage' | 'impact' | 'list', input: unknown): { totalFrames: number; assetFiles: string[] }
  beatGrid(entry: MusicTrack, count: number): number[]
  stagedFileName(entry: Pick<MusicTrack, 'id' | 'file'>): string
}

async function importEngineModule(name: string): Promise<Record<string, unknown>> {
  const href = pathToFileURL(join(ENGINE_SRC, name)).href
  const mod: unknown = await import(/* @vite-ignore */ href)
  if (typeof mod !== 'object' || mod === null) throw new Error(`engine module ${name} did not load`)
  return mod as Record<string, unknown>
}

function fn<T>(mod: Record<string, unknown>, key: string): T {
  const value = mod[key]
  if (typeof value !== 'function') throw new Error(`engine export ${key} is missing`)
  return value as T
}

export async function loadRealEngine(): Promise<RealEngine> {
  const templates = await importEngineModule('templates.ts')
  const music = await importEngineModule('music.ts')
  return {
    loadTemplate: fn<RealEngine['loadTemplate']>(templates, 'loadTemplate'),
    beatGrid: fn<RealEngine['beatGrid']>(music, 'beatGrid'),
    stagedFileName: fn<RealEngine['stagedFileName']>(music, 'stagedFileName'),
  }
}
