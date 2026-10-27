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
import {
  parseCompareProps,
  collectCompareAssetFiles,
  computeCompareTiming,
} from './compare.ts';
import { stagedFileName, type MusicCatalog } from './music.ts';
import { effectiveShotSec } from './styles/craft.ts';
import { styledPostcardTiming } from './styles/rules.ts';
import { styledDataCardTiming, styledListTiming, styledMontageTiming } from './styles/template-craft.ts';
import { peelStyle, resolveRenderLook } from './styles/select.ts';
import type { ResolvedLook } from './styles/types.ts';

/** Allowed template ids. */
export const TEMPLATE_IDS = ['list', 'montage', 'datacard', 'postcard', 'atmosphere', 'compare'] as const;

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

function withLook(loaded: LoadedTemplate, style: unknown, carried: unknown): LoadedTemplate {
  const look = resolveRenderLook(style, carried);
  if (!look) return loaded;
  const logo = look.logoFile;
  const assetFiles = logo !== undefined && !loaded.assetFiles.includes(logo) ? [...loaded.assetFiles, logo] : loaded.assetFiles;
  const props = { ...(loaded.props as object), look } as LoadedTemplate['props'] & { look: ResolvedLook };
  return { ...loaded, props, assetFiles, totalFrames: framesWithLook(loaded, look) };
}

function framesWithLook(loaded: LoadedTemplate, look: ResolvedLook): number {
  if (loaded.compositionId === 'PostcardReel') {
    const scenes = (loaded.props as { scenes?: unknown[] }).scenes ?? [];
    return styledPostcardTiming({ scenes }, look.rules, 30, effectiveShotSec(look)).totalFrames;
  }
  if (loaded.compositionId === 'CompareReel') {
    return computeCompareTiming(look.rules, effectiveShotSec(look)).totalFrames;
  }
  if (loaded.compositionId === 'ListReel') {
    const props = loaded.props as { items: unknown[]; logoMode?: 'last_beats' | 'always' };
    return styledListTiming(props.items.length, look, 30, props.logoMode).totalFrames;
  }
  if (loaded.compositionId === 'MontageReel') {
    const props = loaded.props as { clips: unknown[]; words: unknown[] };
    return styledMontageTiming(props.clips.length, props.words.length, look).totalFrames;
  }
  if (loaded.compositionId === 'DataCardReel') {
    const props = loaded.props as { rows: { value: string }[] };
    return styledDataCardTiming(props.rows, look).totalFrames;
  }
  return loaded.totalFrames;
}

/** Parse and validate input for a template. A third argument is brief.remotion.style; omit it to keep today's picture. */
export function loadTemplate(id: TemplateId, input: unknown, style?: unknown): LoadedTemplate {
  const peeled = peelStyle(input);
  const styleInput = style !== undefined ? style : peeled.style;
  return withLook(loadTemplateBody(id, peeled.body), styleInput, peeled.look);
}

/** Parse and validate input for a template, returning everything the renderer needs. */
function loadTemplateBody(id: TemplateId, input: unknown): LoadedTemplate {
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
  if (id === 'compare') {
    const props = parseCompareProps(input);
    return {
      compositionId: 'CompareReel',
      props,
      assetFiles: collectCompareAssetFiles(props),
      totalFrames: computeCompareTiming(null).totalFrames,
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
  if (id !== 'montage') {
    // Never fall through to montage for an unknown id: a missed template must be refused, not mis-rendered.
    throw new Error(`未知模板：${String(id)}`);
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
