import {
  parseListReelProps,
  collectAssetFiles,
} from './schema.ts';
import { computeTimingFromProps } from './timing.ts';
import {
  parseMontageReelProps,
  collectMontageAssetFiles,
  computeMontageTiming,
  buildMontageSegments,
  recipeGapsOf,
  type RecipeGap,
} from './montage.ts';
import { stagedFileName, type MusicCatalog } from './music.ts';

/** Allowed template ids. */
export const TEMPLATE_IDS = ['list', 'montage'] as const;

/** One supported template id. */
export type TemplateId = (typeof TEMPLATE_IDS)[number];

/** Type guard for a supported template id. */
export function isTemplateId(value: unknown): value is TemplateId {
  return (
    typeof value === 'string' &&
    (TEMPLATE_IDS as readonly string[]).includes(value)
  );
}

/** A validated template ready to be rendered. */
export interface LoadedTemplate {
  compositionId: string;
  props: object;
  assetFiles: string[];
  totalFrames: number;
  /** Columns of the recipe the template cannot satisfy for these props; absent means not evaluated. */
  recipeGaps?: RecipeGap[];
}

/** Parse and validate input for a template, returning everything the renderer needs. */
export function loadTemplate(id: TemplateId, input: unknown): LoadedTemplate {
  if (id === 'list') {
    const props = parseListReelProps(input);
    const totalFrames = computeTimingFromProps(props).totalFrames;
    return {
      compositionId: 'ListReel',
      props,
      assetFiles: collectAssetFiles(props),
      totalFrames,
    };
  }
  const props = parseMontageReelProps(input);
  const totalFrames = computeMontageTiming(props).totalFrames;
  // Throws a readable error for layouts that would only crash later at render time.
  buildMontageSegments(props);
  return {
    compositionId: 'MontageReel',
    props,
    assetFiles: collectMontageAssetFiles(props),
    totalFrames,
    recipeGaps: recipeGapsOf(props),
  };
}

/** Where a staged music file name (props.musicFile) lives in the shared music library, or null if it is not a catalog track. */
export function musicSourceOf(
  catalog: MusicCatalog,
  stagedName: string,
): { id: string; folder: string; file: string; status: string } | null {
  for (const track of catalog.tracks) {
    let name: string;
    try {
      name = stagedFileName(track);
    } catch {
      continue;
    }
    if (name === stagedName) {
      return {
        id: track.id,
        folder: track.folder,
        file: track.file,
        status: track.status,
      };
    }
  }
  return null;
}
