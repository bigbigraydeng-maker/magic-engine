/**
 * Stand-ins for what jsdom cannot do and the Reel cover needs: telling when a row is on screen, drawing on a canvas,
 * loading a video, and announcing that the browser has shown a video frame. Call `restoreCoverStubs` after each test.
 */
import { act } from '@testing-library/react'
import { vi } from 'vitest'

const restorers: Array<() => void> = []

/** Replaces `target[name]` and remembers how to put it back (or remove it, when it was not there). */
function define(target: object, name: string, value: unknown) {
  const original = Object.getOwnPropertyDescriptor(target, name)
  Object.defineProperty(target, name, { configurable: true, writable: true, value })
  restorers.push(() => {
    if (original) Object.defineProperty(target, name, original)
    else Reflect.deleteProperty(target, name)
  })
}

export interface ScreenWatcher {
  callback: (entries: Array<{ isIntersecting: boolean }>) => void
  options: { rootMargin?: string } | undefined
  targets: Element[]
  disconnected: boolean
}

/** Stands in for the browser's "is this on screen yet" watcher, so a test can decide when a row comes into view. */
export function stubScreenWatcher(): ScreenWatcher[] {
  const watchers: ScreenWatcher[] = []
  class FakeObserver {
    private readonly watcher: ScreenWatcher
    constructor(callback: ScreenWatcher['callback'], options?: ScreenWatcher['options']) {
      this.watcher = { callback, options, targets: [], disconnected: false }
      watchers.push(this.watcher)
    }
    observe(target: Element) {
      this.watcher.targets.push(target)
    }
    unobserve() {}
    disconnect() {
      this.watcher.disconnected = true
    }
  }
  define(globalThis, 'IntersectionObserver', FakeObserver)
  return watchers
}

export type CoverMediaMode = 'works' | 'no-canvas-support' | 'cannot-draw' | 'no-frame-callback'

export interface DrawCall {
  canvas: HTMLCanvasElement
  video: HTMLVideoElement
  /** The video's `src` attribute at the moment of drawing: null means the download had already been stopped. */
  srcWhenDrawn: string | null
  args: number[]
}

export interface FrameRequest {
  video: HTMLVideoElement
  callback: () => void
  /** The video's `src` attribute when the page asked to be told about a frame: null means it asked before setting it. */
  srcWhenAsked: string | null
  fired: boolean
}

/**
 * Gives jsdom what the cover needs. `videos` lists every video element the page made off-screen, `tell` makes one of them
 * report an event, `showFrame` makes the browser "show" the frames the page asked to be told about, `drawCalls` records
 * what was drawn on which canvas, and `stopDownload` records each time a video was told to stop loading.
 */
export function stubCoverMedia(mode: CoverMediaMode = 'works') {
  const drawCalls: DrawCall[] = []
  const frameRequests: FrameRequest[] = []
  const stopDownload = vi.fn()
  const videos: HTMLVideoElement[] = []

  define(HTMLCanvasElement.prototype, 'getContext', function (this: HTMLCanvasElement) {
    if (mode === 'no-canvas-support') return null
    return {
      drawImage: (video: HTMLVideoElement, ...args: number[]) => {
        if (mode === 'cannot-draw') throw new Error('cannot draw')
        drawCalls.push({ canvas: this, video, srcWhenDrawn: video.getAttribute('src'), args })
      },
    }
  })
  define(HTMLMediaElement.prototype, 'load', stopDownload)
  if (mode !== 'no-frame-callback') {
    define(HTMLVideoElement.prototype, 'requestVideoFrameCallback', function (this: HTMLVideoElement, callback: () => void) {
      frameRequests.push({ video: this, callback, srcWhenAsked: this.getAttribute('src'), fired: false })
      return frameRequests.length
    })
  }

  const realCreate = document.createElement.bind(document)
  const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?: ElementCreationOptions) => {
    const element = realCreate(tag, options)
    if (element instanceof HTMLVideoElement) videos.push(element)
    return element
  })
  restorers.push(() => spy.mockRestore())

  return {
    drawCalls,
    frameRequests,
    stopDownload,
    videos,
    tell: async (video: HTMLVideoElement, type: string) => {
      await act(async () => {
        video.dispatchEvent(new Event(type))
      })
    },
    showFrame: async () => {
      await act(async () => {
        // Only the frames asked for before now are shown now; covers that start because one finished ask for theirs later.
        for (const request of [...frameRequests]) {
          if (request.fired) continue
          request.fired = true
          request.callback()
        }
      })
    },
  }
}

export function restoreCoverStubs() {
  for (const restore of restorers.splice(0).reverse()) restore()
}
