import { describe, expect, it } from 'vitest';
import { inspectMp4, judgeVideo, VIDEO_LIMITS } from '../video-inspect';

function u32(value: number): number[] {
  return [
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ];
}

function u64(value: number): number[] {
  const hi = Math.floor(value / 0x100000000);
  const lo = value % 0x100000000;
  return [...u32(hi), ...u32(lo)];
}

function ascii(text: string): number[] {
  return Array.from(text).map((c) => c.charCodeAt(0));
}

function box(type: string, payload: number[]): number[] {
  return [...u32(payload.length + 8), ...ascii(type), ...payload];
}

function box64(type: string, payload: number[]): number[] {
  return [...u32(1), ...ascii(type), ...u64(payload.length + 16), ...payload];
}

function ftyp(brand: string): number[] {
  return box('ftyp', [...ascii(brand), ...u32(0), ...ascii('isom')]);
}

function mvhdV0(timescale: number, duration: number): number[] {
  const payload = [
    0, // version
    0, 0, 0, // flags
    ...u32(0), // creation
    ...u32(0), // modification
    ...u32(timescale),
    ...u32(duration),
  ];
  return box('mvhd', payload);
}

function mvhdV1(timescale: number, duration: number): number[] {
  const payload = [
    1, // version
    0, 0, 0, // flags
    ...u64(0), // creation
    ...u64(0), // modification
    ...u32(timescale),
    ...u64(duration),
  ];
  return box('mvhd', payload);
}

function tkhd(width: number, height: number): number[] {
  const payload = [
    0, // version
    0, 0, 0, // flags
    ...u32(0), // creation
    ...u32(0), // modification
    ...u32(1), // track id
    ...u32(0), // reserved
    ...u32(0), // duration
    ...u32(0), // reserved
    ...u32(0), // layer
    ...u32(0), // alternate group
    ...u32(0), // volume
    ...u32(0), // reserved
    ...u32(0), // matrix a
    ...u32(0), // matrix b
    ...u32(0), // matrix c
    ...u32(0), // matrix d
    ...u32(0), // matrix e
    ...u32(0), // matrix f
    ...u32(0), // matrix g
    ...u32(0), // matrix h
    ...u32(0), // matrix i
    ...u32(Math.round(width * 65536)),
    ...u32(Math.round(height * 65536)),
  ];
  return box('tkhd', payload);
}

function trak(width: number, height: number): number[] {
  return box('trak', tkhd(width, height));
}

function moov(children: number[][]): number[] {
  return box('moov', children.flat());
}

function mdat(size: number): number[] {
  return box('mdat', new Array<number>(size).fill(0));
}

function bytes(...parts: number[][]): Uint8Array {
  return new Uint8Array(parts.flat());
}

describe('inspectMp4', () => {
  it('reads brand, duration and size from a 6.0s 1080x1920 file', () => {
    const file = bytes(
      ftyp('isom'),
      moov([mvhdV0(1000, 6000), trak(1080, 1920)]),
    );
    const facts = inspectMp4(file);
    expect(facts).not.toBeNull();
    expect(facts?.brand).toBe('isom');
    expect(facts?.durationSeconds).toBeCloseTo(6.0, 5);
    expect(facts?.width).toBe(1080);
    expect(facts?.height).toBe(1920);
  });

  it('reads a version-1 mvhd', () => {
    const file = bytes(
      ftyp('mp42'),
      moov([mvhdV1(600, 3000), trak(720, 1280)]),
    );
    const facts = inspectMp4(file);
    expect(facts?.brand).toBe('mp42');
    expect(facts?.durationSeconds).toBeCloseTo(5.0, 5);
    expect(facts?.width).toBe(720);
    expect(facts?.height).toBe(1280);
  });

  it('finds moov before an mdat box', () => {
    const file = bytes(
      ftyp('isom'),
      moov([mvhdV0(1000, 2000), trak(1080, 1920)]),
      mdat(64),
    );
    const facts = inspectMp4(file);
    expect(facts?.durationSeconds).toBeCloseTo(2.0, 5);
  });

  it('finds moov after an mdat box', () => {
    const file = bytes(
      ftyp('isom'),
      mdat(64),
      moov([mvhdV0(1000, 2000), trak(1080, 1920)]),
    );
    const facts = inspectMp4(file);
    expect(facts?.durationSeconds).toBeCloseTo(2.0, 5);
  });

  it('handles a 64-bit box size', () => {
    const file = bytes(
      ftyp('isom'),
      box64('moov', [mvhdV0(1000, 4000), trak(1080, 1920)].flat()),
    );
    const facts = inspectMp4(file);
    expect(facts?.durationSeconds).toBeCloseTo(4.0, 5);
  });

  it('returns null for truncated input', () => {
    const full = bytes(ftyp('isom'), moov([mvhdV0(1000, 6000), trak(1080, 1920)]));
    const truncated = full.slice(0, full.length - 4);
    expect(inspectMp4(truncated)).toBeNull();
  });

  it('returns null when moov is missing', () => {
    const file = bytes(ftyp('isom'), mdat(32));
    expect(inspectMp4(file)).toBeNull();
  });

  it('returns null when ftyp is missing', () => {
    const file = bytes(moov([mvhdV0(1000, 6000), trak(1080, 1920)]));
    expect(inspectMp4(file)).toBeNull();
  });

  it('returns null for a zero timescale', () => {
    const file = bytes(ftyp('isom'), moov([mvhdV0(0, 6000), trak(1080, 1920)]));
    expect(inspectMp4(file)).toBeNull();
  });

  it('returns null when no track has non-zero size', () => {
    const file = bytes(ftyp('isom'), moov([mvhdV0(1000, 6000), trak(0, 0)]));
    expect(inspectMp4(file)).toBeNull();
  });

  it('never throws on random garbage', () => {
    const garbage = new Uint8Array(256);
    for (let i = 0; i < garbage.length; i++) {
      garbage[i] = (i * 37 + 11) & 0xff;
    }
    expect(() => inspectMp4(garbage)).not.toThrow();
    expect(inspectMp4(garbage)).toBeNull();
  });

  it('never throws on empty input', () => {
    expect(() => inspectMp4(new Uint8Array(0))).not.toThrow();
    expect(inspectMp4(new Uint8Array(0))).toBeNull();
  });
});

describe('judgeVideo', () => {
  const good = { brand: 'isom', durationSeconds: 6, width: 1080, height: 1920 };

  it('returns null for a good file', () => {
    expect(judgeVideo(good)).toBeNull();
  });

  it('flags VIDEO_TOO_SHORT', () => {
    expect(judgeVideo({ ...good, durationSeconds: 0.5 })).toBe('VIDEO_TOO_SHORT');
  });

  it('flags VIDEO_TOO_LONG', () => {
    expect(judgeVideo({ ...good, durationSeconds: 61 })).toBe('VIDEO_TOO_LONG');
  });

  it('flags VIDEO_NOT_VERTICAL', () => {
    expect(judgeVideo({ ...good, width: 1920, height: 1080 })).toBe('VIDEO_NOT_VERTICAL');
  });

  it('flags VIDEO_TOO_SMALL', () => {
    expect(judgeVideo({ ...good, width: 480, height: 854 })).toBe('VIDEO_TOO_SMALL');
  });

  it('returns the first failing reason (too long AND not vertical)', () => {
    expect(judgeVideo({ ...good, durationSeconds: 120, width: 1920, height: 1080 })).toBe(
      'VIDEO_TOO_LONG',
    );
  });

  it('accepts the boundary values', () => {
    expect(judgeVideo({ ...good, durationSeconds: VIDEO_LIMITS.minSeconds })).toBeNull();
    expect(judgeVideo({ ...good, durationSeconds: VIDEO_LIMITS.maxSeconds })).toBeNull();
    expect(judgeVideo({ ...good, width: VIDEO_LIMITS.minWidth, height: 1920 })).toBeNull();
  });
});
