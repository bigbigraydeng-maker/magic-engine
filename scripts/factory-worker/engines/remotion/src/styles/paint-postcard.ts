import type { ResolvedLook } from './types.ts'

/** Fields the postcard chrome reads. Positions stay on the existing layout. */
export interface PostcardPaintInput {
  cardOpacity: number
  cardSide: 'left' | 'center'
  cardTop?: number
  accent?: string
}

/** Plain style bags. Animated opacity is applied by the template, not here. */
export interface PostcardPaint {
  hook: Record<string, string | number>
  scene: Record<string, string | number>
  place: Record<string, string | number>
  line: Record<string, string | number>
  end: Record<string, string | number>
  endScrim: string
}

function legacyHook(family: string): Record<string, string | number> {
  return {
    position: 'absolute',
    left: 90,
    top: 640,
    width: 790,
    fontFamily: family,
    color: '#fff',
    fontSize: 96,
    fontWeight: 900,
    lineHeight: 1.12,
    textShadow: '0 6px 30px rgba(0,0,0,0.7)',
  }
}

function legacyScene(props: PostcardPaintInput, family: string): Record<string, string | number> {
  return {
    position: 'absolute',
    left: props.cardSide === 'left' ? 60 : 120,
    top: props.cardTop ?? 800,
    width: props.cardSide === 'left' ? 900 : 840,
    background: `rgba(0,0,0,${props.cardOpacity})`,
    borderRadius: 24,
    padding: '28px 36px',
    fontFamily: family,
  }
}

function legacyPlace(props: PostcardPaintInput): Record<string, string | number> {
  return {
    fontSize: 44,
    fontWeight: 800,
    letterSpacing: 3,
    textTransform: 'uppercase',
    color: props.accent ?? '#ffffff',
    marginBottom: 14,
  }
}

function legacyLine(): Record<string, string | number> {
  return {
    fontSize: 66,
    fontWeight: 800,
    lineHeight: 1.15,
    color: '#fff',
    textShadow: '0 3px 16px rgba(0,0,0,0.6)',
  }
}

function legacyEnd(family: string): Record<string, string | number> {
  return {
    position: 'absolute',
    left: 60,
    top: 760,
    width: 840,
    textAlign: 'center',
    fontFamily: family,
    color: '#fff',
    fontSize: 84,
    fontWeight: 900,
    lineHeight: 1.1,
    textShadow: '0 6px 30px rgba(0,0,0,0.7)',
  }
}

function borderOf(look: ResolvedLook): string {
  if (look.shape.strokeWidth <= 0) return 'none'
  return `${look.shape.strokeWidth}px solid ${look.shape.strokeColor}`
}

function styledHook(look: ResolvedLook, family: string): Record<string, string | number> {
  return {
    position: 'absolute',
    left: 90,
    top: 640,
    width: 790,
    boxSizing: 'border-box',
    fontFamily: family,
    color: look.card.lineColor,
    fontSize: look.type.hook,
    fontWeight: look.type.weightHook,
    lineHeight: 1.12,
    letterSpacing: look.type.trackingLabel,
    background: look.card.fill,
    borderRadius: look.shape.radiusCard,
    border: borderOf(look),
    padding: '22px 28px',
    textShadow: look.card.shadow,
  }
}

function styledScene(look: ResolvedLook, props: PostcardPaintInput, family: string): Record<string, string | number> {
  return {
    position: 'absolute',
    left: props.cardSide === 'left' ? 60 : 120,
    top: props.cardTop ?? 800,
    width: props.cardSide === 'left' ? 900 : 840,
    boxSizing: 'border-box',
    background: look.card.fill,
    borderRadius: look.shape.radiusCard,
    border: borderOf(look),
    padding: '28px 36px',
    fontFamily: family,
    boxShadow: look.card.shadow,
  }
}

function styledPlace(look: ResolvedLook): Record<string, string | number> {
  return {
    fontSize: look.type.label,
    fontWeight: look.type.weightLabel,
    letterSpacing: look.type.trackingLabel,
    textTransform: look.type.labelCase === 'upper' ? 'uppercase' : 'none',
    color: look.card.placeColor,
    marginBottom: 14,
  }
}

function styledLine(look: ResolvedLook): Record<string, string | number> {
  return {
    fontSize: look.type.body,
    fontWeight: look.type.weightBody,
    lineHeight: 1.15,
    color: look.card.lineColor,
    textShadow: 'none',
  }
}

function styledEnd(look: ResolvedLook, family: string): Record<string, string | number> {
  return {
    position: 'absolute',
    left: 60,
    top: 760,
    width: 840,
    boxSizing: 'border-box',
    textAlign: 'center',
    fontFamily: family,
    color: look.card.lineColor,
    fontSize: look.type.title,
    fontWeight: look.type.weightTitle,
    lineHeight: 1.1,
    letterSpacing: look.type.trackingLabel,
    background: look.card.fill,
    borderRadius: look.shape.radiusCard,
    border: borderOf(look),
    padding: '28px 32px',
    textShadow: 'none',
  }
}

/** Postcard chrome. A null look returns the styles the template used before style packs existed. */
export function postcardPaint(look: ResolvedLook | null, props: PostcardPaintInput, family: string): PostcardPaint {
  if (!look) {
    return {
      hook: legacyHook(family),
      scene: legacyScene(props, family),
      place: legacyPlace(props),
      line: legacyLine(),
      end: legacyEnd(family),
      endScrim: 'rgba(5,10,18,0.35)',
    }
  }
  return {
    hook: styledHook(look, family),
    scene: styledScene(look, props, family),
    place: styledPlace(look),
    line: styledLine(look),
    end: styledEnd(look, family),
    endScrim: 'rgba(5,10,18,0.35)',
  }
}
