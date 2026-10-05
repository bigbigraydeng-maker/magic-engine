import type { ListReelProps } from './schema';

/** Frames per second of the rendered video. */
export const FPS = 30;
/** Video width in pixels. */
export const WIDTH = 1080;
/** Video height in pixels. */
export const HEIGHT = 1920;
/** Constant frame offset applied to every beat-derived frame. */
export const SYNC_SHIFT_FRAMES = 1;
/** Number of beats consumed by the hook scene. */
export const HOOK_BEATS = 4;
/** Number of beats consumed by each item. */
export const ITEM_BEATS = 2;
/** Shortest video length accepted (2 seconds), keeps the audio fade envelope valid. */
export const MIN_TOTAL_FRAMES = 60;
/** Number of beats consumed by the price reveal. */
export const REVEAL_BEATS = 8;

/** Frame timing layout for the checklist video. */
export interface ListReelTiming {
  hookFrames: number;
  itemFrom: number[];
  itemDur: number[];
  revealFrom: number;
  totalFrames: number;
}

/** Number of beats the layout needs for a given item count (last one marks the end). */
export function requiredBeatCount(itemCount: number): number {
  return HOOK_BEATS + ITEM_BEATS * itemCount + REVEAL_BEATS + 1;
}

/** Convert a beat time (seconds) to a frame index with the sync shift applied. */
function fb(beats: readonly number[], i: number): number {
  return Math.round(Math.max(0, beats[i]) * FPS) + SYNC_SHIFT_FRAMES;
}

/** Compute the frame timing layout from beat times and item count. */
export function computeTiming(
  beats: readonly number[],
  itemCount: number,
): ListReelTiming {
  const needed = requiredBeatCount(itemCount);
  if (beats.length < needed) {
    throw new Error(
      `节拍数量不够：${itemCount} 个条目至少需要 ${needed} 个节拍，现在只有 ${beats.length} 个`,
    );
  }

  const hookFrames = fb(beats, HOOK_BEATS);
  if (hookFrames < 1) {
    throw new Error('开场段时长为 0 帧（节拍间隔太近）');
  }
  const itemFrom: number[] = [];
  const itemDur: number[] = [];

  for (let i = 0; i < itemCount; i++) {
    const from = fb(beats, HOOK_BEATS + ITEM_BEATS * i);
    const to = fb(beats, HOOK_BEATS + ITEM_BEATS * (i + 1));
    const dur = to - from;
    if (dur < 1) {
      throw new Error(
        `第 ${i + 1} 个条目的节拍间隔太近，至少需要 1 帧的时长`,
      );
    }
    itemFrom.push(from);
    itemDur.push(dur);
  }

  const revealFrom = fb(beats, HOOK_BEATS + ITEM_BEATS * itemCount);
  const totalFrames = fb(
    beats,
    HOOK_BEATS + ITEM_BEATS * itemCount + REVEAL_BEATS,
  );

  if (totalFrames - revealFrom < 1) {
    throw new Error('价格段时长为 0 帧（节拍间隔太近）');
  }
  if (totalFrames < MIN_TOTAL_FRAMES) {
    throw new Error(`成片太短：只有 ${totalFrames} 帧，至少需要 ${MIN_TOTAL_FRAMES} 帧（节拍间隔太近）`);
  }

  return { hookFrames, itemFrom, itemDur, revealFrom, totalFrames };
}

/** Compute the frame timing layout directly from validated props. */
export function computeTimingFromProps(
  props: Pick<ListReelProps, 'beats' | 'items'>,
): ListReelTiming {
  return computeTiming(props.beats, props.items.length);
}
