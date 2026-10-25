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
  impactPlanReport,
  type RecipeGap,
} from './montage.ts';
import {
  parseDataCardProps,
  collectDataCardAssetFiles,
  computeDataCardTiming,
} from './datacard.ts';
import {
  parsePostcardProps,
  collectPostcardAssetFiles,
  computePostcardTiming,
} from './postcard.ts';
import {
  parseAtmosphereProps,
  collectAtmosphereAssetFiles,
  computeAtmosphereTiming,
} from './atmosphere.ts';
import { stagedFileName, type MusicCatalog } from './music.ts';

/** Allowed template ids. */
export const TEMPLATE_IDS = ['list', 'montage', 'impact', 'datacard', 'postcard', 'atmosphere'] as const;

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
  /** Rendered storyboard receipt; this is structural evidence, not a creative pass. */
  creativePlan?: ReturnType<typeof impactPlanReport>;
}

/** Recipe columns a pure data card cannot satisfy (no shots, no industry recipe); mirrors DATACARD_RECIPE_RECONCILIATION.md and is reported on every render. */
const DATACARD_RECIPE_GAPS: RecipeGap[] = [
  { column: '开场钩子 visual_shock', status: '未满足', reason: '数据卡是纯色底加文字，没有强视觉冲击' },
  { column: '真人出镜/自拍感', status: '未满足', reason: '数据卡没有镜头素材，无真人画面' },
  { column: '真实感', status: '未满足', reason: '数据卡没有自有实拍素材' },
  { column: '行业配方', status: '未满足', reason: '配方库没有物流/贸易等行业记录，行业层配方空白' },
];

/** Recipe columns a single-shot ambience reel cannot satisfy; reported on every render so the gap is visible, never silent. */
const ATMOSPHERE_RECIPE_GAPS: RecipeGap[] = [
  { column: '真人背影/真人出镜', status: '未满足', reason: '氛围片只有一段实拍风景素材，没有人物画面（无自有素材、无肖像授权）' },
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
  if (id === 'postcard') {
    const props = parsePostcardProps(input);
    return {
      compositionId: 'PostcardReel',
      props,
      assetFiles: collectPostcardAssetFiles(props),
      totalFrames: computePostcardTiming(props).totalFrames,
    };
  }
  if (id === 'atmosphere') {
    const props = parseAtmosphereProps(input);
    return {
      compositionId: 'AtmosphereReel',
      props,
      assetFiles: collectAtmosphereAssetFiles(props),
      totalFrames: computeAtmosphereTiming(props).totalFrames,
      recipeGaps: ATMOSPHERE_RECIPE_GAPS,
    };
  }
  if (id !== 'montage' && id !== 'impact') {
    // Never fall through to montage for an unknown id: a missed template must be refused, not mis-rendered.
    throw new Error(`未知模板：${String(id)}`);
  }
  const props = parseMontageReelProps(input);
  if (id === 'impact' && !props.impactPlan) {
    throw new Error('冲击叙事模板需要 impactPlan（钩子、中段场景和结尾画面）');
  }
  const totalFrames = computeMontageTiming(props).totalFrames;
  // Throws a readable error for layouts that would only crash later at render time.
  buildMontageSegments(props);
  return {
    compositionId: 'MontageReel',
    props,
    assetFiles: collectMontageAssetFiles(props),
    totalFrames,
    recipeGaps: recipeGapsOf(props),
    ...(id === 'impact' ? { creativePlan: impactPlanReport(props) } : {}),
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
