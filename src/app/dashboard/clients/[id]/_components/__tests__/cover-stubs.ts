/**
 * Stand-ins for what jsdom cannot do and the Reel cover needs: telling when a row is on screen, drawing on a canvas,
 * loading a video, and announcing that the browser has shown a video frame. Call `restoreCoverStubs` after each test.
 */
import { act } from '@testing-library/react'
import { vi } from 'vitest'

export interface ScreenWatcher {
  callback: (entries: Array<{ isIntersecting: boolean }>) => void
  disconnected: boolean
}

/** Stands in for the browser's "is this on screen yet" watcher, so a test can decide when a row comes into view. */
export function stubScreenWatcher(): ScreenWatcher[] {
  const watchers: ScreenWatcher[] = []
  class FakeObserver {
    private readonly watcher: ScreenWatcher
    constructor(callback: ScreenWatcher['callback']) {
      this.watcher = { callback, disconnected: false }
      watchers.push(this.watcher)
    }
    observe() {}
    unobserve() {}
    disconnect() {
      this.watcher.disconnected = true
    }
  }
  vi.stubGlobal('IntersectionObserver', FakeObserver)
  return watchers
}

export type CoverMediaMode = 'works' | 'no-canvas-support' | 'cannot-draw' | 'no-frame-callback'

const restorers: Array<() => void> = []

/**
 * Gives jsdom what the cover needs. `videos` lists every video element the page made off-screen, `tell` makes one of them
 * report an event, `showFrame` makes the browser "show" the frames the page asked to be told about, `drawImage` records what
 * was drawn on any canvas and `stopDownload` records each time a video was told to stop loading.
 */
export function stubCoverMedia(mode: CoverMediaMode = 'works') {
  const drawImage = vi.fn(() => {
    if (mode === 'cannot-draw') throw new Error('cannot draw')
  })
  const stopDownload = vi.fn()
  const videos: HTMLVideoElement[] = []
  const frameCallbacks: Array<() => void> = []

  const define = (target: object, name: string, value: unknown) => {
    const original = Object.getOwnPropertyDescriptor(target, name)
    Object.defineProperty(target, name, { configurable: true, writable: true, value })
    restorers.push(() => {
      if (original) Object.defineProperty(target, name, original)
      else Reflect.deleteProperty(target, name)
    })
  }
  define(HTMLCanvasElement.prototype, 'getContext', () => (mode === 'no-canvas-support' ? null : { drawImage }))
  define(HTMLMediaElement.prototype, 'load', stopDownload)
  if (mode !== 'no-frame-callback') {
    define(HTMLVideoElement.prototype, 'requestVideoFrameCallback', (callback: () => void) => frameCallbacks.push(callback))
  }

  const realCreate = document.createElement.bind(document)
  const spy = vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?: ElementCreationOptions) => {
    const element = realCreate(tag, options)
    if (element instanceof HTMLVideoElement) videos.push(element)
    return element
  })
  restorers.push(() => spy.mockRestore())

  return {
    drawImage,
    stopDownload,
    videos,
    tell: (video: HTMLVideoElement, type: string) => {
      act(() => {
        video.dispatchEvent(new Event(type))
      })
    },
    showFrame: () => {
      act(() => {
        for (const callback of frameCallbacks.splice(0)) callback()
      })
    },
  }
}

export function restoreCoverStubs() {
  for (const restore of restorers.splice(0).reverse()) restore()
}
