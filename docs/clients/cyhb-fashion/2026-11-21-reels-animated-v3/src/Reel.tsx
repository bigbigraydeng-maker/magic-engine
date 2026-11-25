import React from 'react'
import {
  AbsoluteFill, Audio, OffthreadVideo, Sequence, interpolate, spring, staticFile,
  useCurrentFrame, useVideoConfig, Easing,
} from 'remotion'

export const FPS = 30
const GOLD = '#e2bf73'
const SANS = '"Futura", "Avenir Next Condensed", "Helvetica Neue", sans-serif'
const SERIF = 'Didot, "Bodoni 72", serif'
// Text column: x 60–900 (clear of the right-hand action rail), y 270–1248.
const COL: React.CSSProperties = { position: 'absolute', left: 60, width: 840 }

export type Seg =
  | { kind: 'hook'; flashes: string[]; clip: string; frames: number; question?: string }
  | { kind: 'label'; clip: string; frames: number; label: string; num?: number }
  | { kind: 'promo'; clip: string; frames: number; kicker: string; big: string; sub: string }
  | { kind: 'end'; clip: string; frames: number }

export const total = (segs: Seg[]) => segs.reduce((n, s) => n + s.frames, 0)

const Clip: React.FC<{ src: string; frames: number; rate?: number; punch?: boolean }> = ({ src, frames, rate = 1, punch = true }) => {
  const f = useCurrentFrame()
  // Small push-in on every cut so the picture never sits still.
  const z = punch ? interpolate(f, [0, Math.min(8, frames - 1), frames], [1.12, 1.04, 1.0], { extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) }) : 1
  return (
    <AbsoluteFill style={{ transform: `scale(${z})` }}>
      <OffthreadVideo src={staticFile(src)} muted playbackRate={rate} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
    </AbsoluteFill>
  )
}

const Veil: React.FC<{ top: number; height: number; strength?: number }> = ({ top, height, strength = 0.7 }) => {
  const f = useCurrentFrame()
  const o = interpolate(f, [0, 6], [0, 1], { extrapolateRight: 'clamp' })
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, top, height, opacity: o,
      background: `linear-gradient(to bottom, rgba(8,6,4,0), rgba(8,6,4,${strength}) 22%, rgba(8,6,4,${strength}) 78%, rgba(8,6,4,0))` }} />
  )
}

/** Line that rises out from behind a mask. */
const Rise: React.FC<{ at: number; children: React.ReactNode; style?: React.CSSProperties }> = ({ at, children, style }) => {
  const f = useCurrentFrame()
  const { fps } = useVideoConfig()
  const p = spring({ frame: f - at, fps, config: { damping: 16, stiffness: 190, mass: 0.7 } })
  return (
    <div style={{ overflow: 'hidden', ...style }}>
      <div style={{ transform: `translateY(${(1 - p) * 110}%)`, opacity: f >= at ? 1 : 0 }}>{children}</div>
    </div>
  )
}

/** Big figure that slams in from oversize, with a short shake on landing. */
const Slam: React.FC<{ at: number; children: React.ReactNode; style?: React.CSSProperties }> = ({ at, children, style }) => {
  const f = useCurrentFrame()
  const { fps } = useVideoConfig()
  const p = spring({ frame: f - at, fps, config: { damping: 22, stiffness: 210, mass: 0.6 } })
  const s = interpolate(p, [0, 1], [1.35, 1], { extrapolateRight: 'clamp' })
  const o = interpolate(f - at, [0, 3], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })
  const k = f - at
  const shake = k > 3 && k < 12 ? Math.sin(k * 2.6) * (12 - k) * 0.5 : 0
  return <div style={{ transform: `translateX(${shake}px) scale(${s})`, opacity: o, transformOrigin: 'center', ...style }}>{children}</div>
}

const CountUp: React.FC<{ at: number; to: number; frames?: number }> = ({ at, to, frames = 14 }) => {
  const f = useCurrentFrame()
  const v = Math.round(interpolate(f, [at, at + frames], [0, to], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) }))
  return <>{v}</>
}

const Rule: React.FC<{ at: number; width?: number }> = ({ at, width = 220 }) => {
  const f = useCurrentFrame()
  const w = interpolate(f, [at, at + 10], [0, width], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) })
  return <div style={{ height: 4, width: w, background: GOLD, margin: '18px auto' }} />
}

const shadow = '0 4px 26px rgba(0,0,0,.55)'

const Hook: React.FC<{ s: Extract<Seg, { kind: 'hook' }> }> = ({ s }) => {
  const FL = 7 // frames per flash cut
  const lead = s.flashes.length * FL
  return (
    <AbsoluteFill>
      {s.flashes.map((c, i) => (
        <Sequence key={c + i} from={i * FL} durationInFrames={FL}><Clip src={c} frames={FL} /></Sequence>
      ))}
      <Sequence from={lead} durationInFrames={s.frames - lead}><Clip src={s.clip} frames={s.frames - lead} rate={0.7} /></Sequence>
      <Veil top={330} height={900} strength={0.72} />
      <div style={{ ...COL, top: 430, textAlign: 'center', color: '#fff', textShadow: shadow }}>
        <Rise at={2}><div style={{ font: `600 46px/1.1 ${SANS}`, letterSpacing: 16 }}>BLACK FRIDAY</div></Rise>
        <Rise at={4}><div style={{ font: `700 46px/1.3 ${SANS}`, letterSpacing: 16, marginTop: 8, color: GOLD }}>UP TO</div></Rise>
        <Slam at={lead - 2} style={{ marginTop: -10 }}>
          <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-start', color: GOLD, font: `800 400px/0.95 ${SANS}`, letterSpacing: -10 }}>
            <CountUp at={lead - 2} to={50} />
            <div style={{ fontSize: 150, lineHeight: 1.25, marginLeft: 8, letterSpacing: 0 }}>%<div style={{ fontSize: 76, color: '#fff', lineHeight: 0.9 }}>OFF</div></div>
          </div>
        </Slam>
        <div style={{ marginTop: -20 }}>
          <Rule at={lead + 12} />
          <Rise at={lead + 14}><div style={{ font: `600 50px/1.15 ${SANS}`, letterSpacing: 5 }}>{s.question ?? 'AT CYHB NEWMARKET'}</div></Rise>
          <Rise at={lead + 20}><div style={{ font: `700 50px/1.3 ${SANS}`, letterSpacing: 4, color: GOLD, marginTop: 8 }}>ENDS FRI 4 DEC</div></Rise>
        </div>
      </div>
    </AbsoluteFill>
  )
}

const Label: React.FC<{ s: Extract<Seg, { kind: 'label' }> }> = ({ s }) => {
  const f = useCurrentFrame()
  const { fps } = useVideoConfig()
  const pop = spring({ frame: f - 2, fps, config: { damping: 9, stiffness: 260, mass: 0.5 } })
  return (
    <AbsoluteFill>
      <Clip src={s.clip} frames={s.frames} />
      <Veil top={370} height={360} strength={0.72} />
      <div style={{ ...COL, top: 470, textAlign: 'center', color: '#fff', textShadow: shadow }}>
        <Rise at={1}><div style={{ font: `italic 400 ${s.label.length > 20 ? 68 : 96}px/1.15 ${SERIF}` }}>{s.label}</div></Rise>
      </div>
      {s.num !== undefined && (
        <div style={{ ...COL, top: 860, textAlign: 'center' }}>
          <div style={{ display: 'inline-block', transform: `scale(${pop})`, width: 210, height: 210, borderRadius: 105, border: `6px solid ${GOLD}`,
            background: 'rgba(8,6,4,.72)', color: '#fff', font: `800 150px/200px ${SANS}` }}>{s.num}</div>
        </div>
      )}
    </AbsoluteFill>
  )
}

const Promo: React.FC<{ s: Extract<Seg, { kind: 'promo' }> }> = ({ s }) => {
  const f = useCurrentFrame()
  // Gold bar sweeps across first, then the figure slams in on top of it.
  const sweep = interpolate(f, [0, 9], [-100, 0], { extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic) })
  const out = interpolate(f, [s.frames - 6, s.frames], [1, 0], { extrapolateLeft: 'clamp' })
  return (
    <AbsoluteFill>
      <Clip src={s.clip} frames={s.frames} />
      <Veil top={380} height={820} strength={0.74} />
      <div style={{ ...COL, top: 500, textAlign: 'center', color: '#fff', textShadow: shadow, opacity: out }}>
        <div style={{ overflow: 'hidden', display: 'inline-block' }}>
          <div style={{ transform: `translateX(${sweep}%)`, background: GOLD, color: '#14100a', textShadow: 'none', padding: '12px 34px 8px',
            font: `700 50px/1.1 ${SANS}`, letterSpacing: 8 }}>{s.kicker}</div>
        </div>
        <Slam at={7} style={{ marginTop: 22 }}>
          <div style={{ font: `800 300px/0.95 ${SANS}`, letterSpacing: -6 }}>{s.big}</div>
        </Slam>
        <Rule at={16} width={300} />
        <Rise at={18}><div style={{ font: `700 78px/1.1 ${SANS}`, letterSpacing: 6, color: GOLD }}>{s.sub}</div></Rise>
      </div>
    </AbsoluteFill>
  )
}

const END_HOLD = 14
const FadeIn: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const f = useCurrentFrame()
  return <AbsoluteFill style={{ opacity: interpolate(f, [0, 8], [0, 1], { extrapolateRight: 'clamp' }) }}>{children}</AbsoluteFill>
}

const End: React.FC<{ s: Extract<Seg, { kind: 'end' }> }> = ({ s }) => (
  <AbsoluteFill>
    <Clip src={s.clip} frames={s.frames} rate={0.62} punch={false} />
    {/* Let the storefront read for half a second before the card comes in. */}
    <Sequence from={END_HOLD}>
    <FadeIn><div style={{ position: 'absolute', left: 0, right: 0, top: 1180, bottom: 0, background: 'linear-gradient(to bottom, rgba(11,11,11,0) 0, rgba(11,11,11,.97) 120px, #0b0b0b 100%)' }} /></FadeIn>
    <Veil top={520} height={760} strength={0.78} />
    <div style={{ ...COL, top: 640, textAlign: 'center', color: '#fff' }}>
      <Rise at={2}><div style={{ font: `400 150px/1.05 ${SERIF}`, letterSpacing: 22, paddingLeft: 22 }}>CYHB</div></Rise>
      <Rise at={6}><div style={{ font: `italic 400 44px/1.3 ${SERIF}`, color: '#f3e6c8' }}>Capture Your Heartbeat</div></Rise>
      <Rule at={10} width={260} />
      <Rise at={12}><div style={{ font: `700 58px/1.15 ${SANS}`, letterSpacing: 4, color: GOLD }}>SHOP IN STORE</div></Rise>
      <Rise at={15}><div style={{ font: `600 50px/1.3 ${SANS}`, letterSpacing: 3 }}>BLACK FRIDAY · ENDS 4 DEC</div></Rise>
      <Rise at={20}><div style={{ font: `500 50px/1.4 "Helvetica Neue", sans-serif`, marginTop: 18 }}>34 Nuffield St, Newmarket</div></Rise>
      <Rise at={23}><div style={{ font: `500 50px/1.3 "Helvetica Neue", sans-serif`, color: '#f3e6c8' }}>Tue–Sun 10am–6pm</div></Rise>
    </div>
    </Sequence>
  </AbsoluteFill>
)

export const Reel: React.FC<{ segs: Seg[] }> = ({ segs }) => {
  const dur = total(segs)
  let at = 0
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      {segs.map((s, i) => {
        const from = at
        at += s.frames
        return (
          <Sequence key={i} from={from} durationInFrames={s.frames}>
            {s.kind === 'hook' ? <Hook s={s} /> : s.kind === 'label' ? <Label s={s} /> : s.kind === 'promo' ? <Promo s={s} /> : <End s={s} />}
          </Sequence>
        )
      })}
      {/* Brand mark, always on, with its own backing block. */}
      <div style={{ position: 'absolute', left: 56, top: 292, background: 'rgba(11,11,11,.72)', color: '#fff', font: `400 44px/1 ${SERIF}`, letterSpacing: 10, padding: '14px 18px 12px 26px' }}>CYHB</div>
      <Audio src={staticFile('music.mp3')} volume={(f) => 0.9 * interpolate(f, [0, 9, dur - 36, dur], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })} />
    </AbsoluteFill>
  )
}
