import { prefersReducedMotion } from './config'
import { motionFor, type JelloElement } from './motion'
import { impulse, spring } from './spring'

/**
 * Sliders keep their momentum: when the thumb stops, the slider is carried a
 * few px further in the direction it was moving and springs back.
 *
 * - Pointer: on release. Pushing while the finger is still on the thumb would
 *   move the slider under it, and the browser maps the next finger move to a
 *   different value.
 * - Keyboard / other changes: when the value has stopped changing for a moment.
 *
 * The push is proportional to the speed just before stopping, and fades if the
 * user paused before letting go (momentum doesn't survive a pause).
 */

const PUSH = /* @__PURE__ */ spring({ duration: 0.45, bounce: 0.55 })
const WOBBLE = /* @__PURE__ */ spring({ duration: 0.4, bounce: 0.6 })
const STOP_MS = 80
const PX_PER_SPEED = 0.006 // 1000 px/s → 6 px
const MIN_PX = 1.5
const MAX_PX = 8

interface Slide {
  last: number // value as a fraction 0…1
  t: number // ms of the last change
  speed: number // px/s along the track, + = toward max
  moved: boolean
  dragging: boolean
  timer: ReturnType<typeof setTimeout> | undefined
}

const slides = new WeakMap<Element, Slide>()

function num(v: string | null | undefined, fallback: number) {
  const n = v === null || v === undefined || v === '' ? NaN : Number(v)
  return Number.isFinite(n) ? n : fallback
}

/** Value as 0…1 (native range or role="slider"); `raw` overrides the current value. */
function fraction(el: Element, raw?: string | null): number {
  let v: number, min: number, max: number
  if (el instanceof HTMLInputElement) {
    min = num(el.min, 0)
    max = num(el.max, 100)
    v = num(raw ?? el.value, min)
  } else {
    min = num(el.getAttribute('aria-valuemin'), 0)
    max = num(el.getAttribute('aria-valuemax'), 100)
    v = num(raw ?? el.getAttribute('aria-valuenow'), min)
  }
  return max > min ? (v - min) / (max - min) : 0
}

const vertical = (el: Element) => el.getAttribute('aria-orientation') === 'vertical'

/** Track length in px. For an APG-style slider the role sits on the small thumb; use its track then. */
function trackLength(el: Element): number {
  const own = el instanceof HTMLElement ? (vertical(el) ? el.offsetHeight : el.offsetWidth) : 0
  if (own >= 60 || !(el.parentElement instanceof HTMLElement)) return own || 100
  const p = el.parentElement
  return (vertical(el) ? p.offsetHeight : p.offsetWidth) || 100
}

function stateOf(el: Element): Slide {
  let s = slides.get(el)
  if (!s) {
    s = { last: fraction(el), t: performance.now(), speed: 0, moved: false, dragging: false, timer: undefined }
    slides.set(el, s)
  }
  return s
}

/** A pointer went down on the slider: wait for the release to push. */
export function slideStart(el: JelloElement) {
  const s = stateOf(el)
  s.dragging = true
  s.moved = false
  s.speed = 0
  s.last = fraction(el)
  s.t = performance.now()
  const end = () => {
    removeEventListener('pointerup', end, true)
    removeEventListener('pointercancel', end, true)
    s.dragging = false
    if (s.moved) push(el, s)
  }
  addEventListener('pointerup', end, true)
  addEventListener('pointercancel', end, true)
}

/** Remember where the value starts (on focus), so the first keyboard step already counts. */
export function slideSeed(el: JelloElement) {
  const s = stateOf(el)
  if (s.moved) return
  s.last = fraction(el)
  s.t = performance.now()
}

/**
 * The value changed (input event, or aria-valuenow for custom sliders).
 * `previous` is the old raw value when known (from the attribute change).
 */
export function slideMoved(el: JelloElement, previous?: string | null) {
  if (!slides.has(el) && previous != null) stateOf(el).last = fraction(el, previous)
  const s = stateOf(el)
  const now = performance.now()
  const f = fraction(el)
  if (f === s.last) return
  const dt = Math.max(8, now - s.t) / 1000
  const v = ((f - s.last) * trackLength(el)) / dt
  s.speed = s.moved ? s.speed * 0.4 + v * 0.6 : v
  s.last = f
  s.t = now
  s.moved = true
  if (s.dragging) return
  clearTimeout(s.timer)
  s.timer = setTimeout(() => {
    if (s.moved && !s.dragging) push(el, s)
  }, STOP_MS)
}

function push(el: JelloElement, s: Slide) {
  s.moved = false
  if (prefersReducedMotion()) return
  const pause = performance.now() - s.t
  const px = Math.min(MAX_PX, Math.max(MIN_PX, Math.abs(s.speed) * PX_PER_SPEED)) * Math.exp(-Math.max(0, pause - STOP_MS) / 250)
  if (px < 0.5 || !s.speed) return
  let dir = Math.sign(s.speed)
  const vert = vertical(el)
  if (vert) dir = -dir // larger values sit higher up
  else if (getComputedStyle(el).direction === 'rtl') dir = -dir
  motionFor(el).update((c) => {
    c.kick(vert ? 'y' : 'x', dir * impulse(PUSH, px), PUSH)
    // a little squash as it brakes: wider along a horizontal track
    c.kick('squash', (vert ? 1 : -1) * impulse(WOBBLE, px * 0.004), WOBBLE)
  })
}
