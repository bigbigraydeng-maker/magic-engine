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
import {
  parseDataCardProps,
  collectDataCardAssetFiles,
  computeDataCardTiming,
} from './datacard.ts';
import { stagedFileName, type MusicCatalog } from './music.ts';

/** Allowed template ids. */
export const TEMPLATE_IDS = ['list', 'montage', 'datacard'] as const;

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

/** Footage-based recipe columns a pure data card can never satisfy (it has no shots); reported on every render. */
const DATACARD_RECIPE_GAPS: RecipeGap[] = [
  { column: '真人出镜/自拍感', status: '未满足', reason: '数据卡没有镜头素材，无真人画面' },
  { column: '真实感', status: '未满足', reason: '数据卡没有自有实拍素材' },
  { column: '航拍/空镜', status: '未满足', reason: '数据卡没有航拍或空镜画面' },
];

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
  if (id === 'datacard') {
    const props = parseDataCardProps(input);
    return {
      compositionId: 'DataCardReel',
      props,
      assetFiles: collectDataCardAssetFiles(props),
      totalFrames: computeDataCardTiming(props).totalFrames,
      recipeGaps: DATACARD_RECIPE_GAPS,
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
