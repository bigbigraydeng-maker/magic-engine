export interface VideoFacts {
  brand: string;
  durationSeconds: number;
  width: number;
  height: number;
}

export const VIDEO_LIMITS = {
  minSeconds: 1,
  maxSeconds: 60,
  minWidth: 540,
} as const;

interface Box {
  type: string;
  start: number;
  end: number;
}

function readU32(bytes: Uint8Array, offset: number): number | null {
  if (offset < 0 || offset + 4 > bytes.length) return null;
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}

function readU64(bytes: Uint8Array, offset: number): number | null {
  const hi = readU32(bytes, offset);
  const lo = readU32(bytes, offset + 4);
  if (hi === null || lo === null) return null;
  return hi * 0x100000000 + lo;
}

function readType(bytes: Uint8Array, offset: number): string | null {
  if (offset < 0 || offset + 4 > bytes.length) return null;
  return String.fromCharCode(
    bytes[offset],
    bytes[offset + 1],
    bytes[offset + 2],
    bytes[offset + 3],
  );
}

// Walk the boxes in [start, end). Returns null if a box is malformed/truncated.
function walkBoxes(bytes: Uint8Array, start: number, end: number): Box[] | null {
  const boxes: Box[] = [];
  let offset = start;
  while (offset < end) {
    if (offset + 8 > end) return null;
    const size = readU32(bytes, offset);
    const type = readType(bytes, offset + 4);
    if (size === null || type === null) return null;

    let headerSize = 8;
    let boxSize = size;
    if (size === 1) {
      const large = readU64(bytes, offset + 8);
      if (large === null) return null;
      headerSize = 16;
      boxSize = large;
    } else if (size === 0) {
      boxSize = end - offset;
    }

    if (boxSize < headerSize) return null;
    const boxEnd = offset + boxSize;
    if (boxEnd > end) return null;

    boxes.push({ type, start: offset + headerSize, end: boxEnd });
    offset = boxEnd;
  }
  return boxes;
}

function findBox(boxes: Box[], type: string): Box | null {
  for (const box of boxes) {
    if (box.type === type) return box;
  }
  return null;
}

function parseMvhd(bytes: Uint8Array, box: Box): { timescale: number; duration: number } | null {
  if (box.start >= box.end) return null;
  const version = bytes[box.start];
  if (version === 0) {
    const timescale = readU32(bytes, box.start + 12);
    const duration = readU32(bytes, box.start + 16);
    if (timescale === null || duration === null) return null;
    return { timescale, duration };
  }
  if (version === 1) {
    const timescale = readU32(bytes, box.start + 20);
    const duration = readU64(bytes, box.start + 24);
    if (timescale === null || duration === null) return null;
    return { timescale, duration };
  }
  return null;
}

function parseTkhd(bytes: Uint8Array, box: Box): { width: number; height: number } | null {
  const payloadLength = box.end - box.start;
  if (payloadLength < 8) return null;
  const widthRaw = readU32(bytes, box.end - 8);
  const heightRaw = readU32(bytes, box.end - 4);
  if (widthRaw === null || heightRaw === null) return null;
  return { width: widthRaw / 65536, height: heightRaw / 65536 };
}

export function inspectMp4(bytes: Uint8Array): VideoFacts | null {
  const top = walkBoxes(bytes, 0, bytes.length);
  if (top === null) return null;

  const ftyp = findBox(top, 'ftyp');
  if (ftyp === null) return null;
  const brand = readType(bytes, ftyp.start);
  if (brand === null) return null;

  const moov = findBox(top, 'moov');
  if (moov === null) return null;

  const moovChildren = walkBoxes(bytes, moov.start, moov.end);
  if (moovChildren === null) return null;

  const mvhd = findBox(moovChildren, 'mvhd');
  if (mvhd === null) return null;
  const timing = parseMvhd(bytes, mvhd);
  if (timing === null) return null;
  if (timing.timescale === 0) return null;

  let width = 0;
  let height = 0;
  for (const child of moovChildren) {
    if (child.type !== 'trak') continue;
    const trakChildren = walkBoxes(bytes, child.start, child.end);
    if (trakChildren === null) continue;
    const tkhd = findBox(trakChildren, 'tkhd');
    if (tkhd === null) continue;
    const dims = parseTkhd(bytes, tkhd);
    if (dims === null) continue;
    if (dims.width > 0 && dims.height > 0) {
      width = dims.width;
      height = dims.height;
      break;
    }
  }

  if (width <= 0 || height <= 0) return null;

  return {
    brand,
    durationSeconds: timing.duration / timing.timescale,
    width,
    height,
  };
}

export function judgeVideo(facts: VideoFacts): string | null {
  if (facts.durationSeconds < VIDEO_LIMITS.minSeconds) return 'VIDEO_TOO_SHORT';
  if (facts.durationSeconds > VIDEO_LIMITS.maxSeconds) return 'VIDEO_TOO_LONG';
  if (facts.height <= facts.width) return 'VIDEO_NOT_VERTICAL';
  if (facts.width < VIDEO_LIMITS.minWidth) return 'VIDEO_TOO_SMALL';
  return null;
}
