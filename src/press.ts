import { prefersReducedMotion } from './config'
import { canDent, dentIn, dentMove, dentOut } from './dent'
import { blink, fadeTo, isFaded } from './fade'
import { existingMotion, motionFor, type JelloElement } from './motion'
import type { Spring } from './spring'

/** Everything a press needs to know, resolved from presets/options. */
export interface Feel {
  squash: number
  depth: number
  tilt: number
  press: Spring
  release: Spring
  /** Show the dimple where the finger is. */
  dent: boolean
  /** Deform around the finger (`'pointer'`) or around the CSS transform-origin (`'origin'`). */
  pivot: 'pointer' | 'origin'
}

const DIM = 0.7 // reduced-motion "pressed" opacity

const clamp1 = (v: number) => Math.max(-1, Math.min(1, v))

function sizeOf(el: Element): [number, number] {
  if (el instanceof HTMLElement) return [el.offsetWidth, el.offsetHeight]
  const r = el.getBoundingClientRect()
  return [r.width, r.height]
}

/** Pointer position in the element's own, untransformed px (from its border-box corner). */
function localPoint(el: Element, cx: number, cy: number): [number, number] {
  const r = el.getBoundingClientRect()
  const [w, h] = sizeOf(el)
  return [(cx - r.left) * (r.width ? w / r.width : 1), (cy - r.top) * (r.height ? h / r.height : 1)]
}

/** transform-origin in px (the computed value is always resolved to px). */
function originOf(el: Element, w: number, h: number): [number, number] {
  const [x, y] = (getComputedStyle(el).transformOrigin || '').split(' ').map(parseFloat)
  return [Number.isFinite(x) ? x! : w / 2, Number.isFinite(y) ? y! : h / 2]
}

/** Push in. Returns the lean angle used (for pointer-move updates). */
export function pressIn(el: JelloElement, f: Feel, cx?: number, cy?: number): number {
  const reduced = prefersReducedMotion()
  const [w, h] = sizeOf(el)
  const pointer = cx !== undefined && cy !== undefined
  const [lx, ly] = pointer ? localPoint(el, cx, cy) : [w / 2, h / 2]
  if (f.dent && canDent(el)) dentIn(el, lx, ly, f.press, reduced)
  if (reduced) {
    fadeTo(el, DIM, 90)
    return 0
  }
  const lean = pointer && f.tilt && w ? f.tilt * clamp1((lx - w / 2) / (w / 2)) : 0
  let px = 0
  let py = 0
  if (pointer && f.pivot === 'pointer') {
    const [ox, oy] = originOf(el, w, h)
    px = lx - ox
    py = ly - oy
  }
  motionFor(el).update((c) => {
    c.cancel('release')
    c.pivot(px, py)
    c.to('shrink', f.depth, f.press)
    c.to('squash', -f.squash, f.press)
    c.to('tilt', lean, f.press)
  })
  return lean
}

export function letGo(el: JelloElement, f: Feel) {
  if (isFaded(el)) fadeTo(el, 1, 160)
  dentOut(el, f.release)
  // Always release the springs, even if reduced motion was switched on mid-press.
  existingMotion(el)?.update((c) => {
    c.to('shrink', 0, f.release)
    c.to('squash', 0, f.release)
    c.to('tilt', 0, f.release)
  })
}

/** A quick press-and-release (keyboard Enter, or `handle.tap()`), planned in one go. */
export function tapOnce(el: JelloElement, f: Feel) {
  const reduced = prefersReducedMotion()
  const dent = f.dent && canDent(el)
  if (dent) {
    const [w, h] = sizeOf(el)
    dentIn(el, w / 2, h / 2, f.press, reduced, [0.09, f.release])
  }
  if (reduced) {
    if (!dent) blink(el)
    return
  }
  motionFor(el).update((c) => {
    c.cancel('release')
    c.pivot(0, 0)
    c.to('shrink', f.depth, f.press)
    c.to('squash', -f.squash, f.press)
    c.later(
      0.09,
      (c) => {
        c.to('shrink', 0, f.release)
        c.to('squash', 0, f.release)
        c.to('tilt', 0, f.release)
      },
      'release',
    )
  })
}

/* ---------------------------------------------------------------- pointer */

interface Held {
  el: JelloElement
  f: Feel
  lean: number
}

/** pointerId → what it is pressing. Multi-touch safe. */
const held = new Map<number, Held>()
const lastPress = new WeakMap<Element, number>()

export function isDisabled(el: Element): boolean {
  try {
    return el.matches(':disabled, [aria-disabled="true"]')
  } catch {
    return false
  }
}

function isHeld(el: Element) {
  for (const h of held.values()) if (h.el === el) return true
  return false
}

/** Was this element pressed by a pointer a moment ago? (so focus doesn't double the feedback) */
export const pressedRecently = (el: Element) => performance.now() - (lastPress.get(el) ?? -1e9) < 600

function onMove(e: PointerEvent) {
  const h = held.get(e.pointerId)
  if (!h) return
  const [lx, ly] = localPoint(h.el, e.clientX, e.clientY)
  dentMove(h.el, lx, ly)
  if (!h.f.tilt || prefersReducedMotion()) return
  const [w] = sizeOf(h.el)
  const lean = w ? h.f.tilt * clamp1((lx - w / 2) / (w / 2)) : 0
  if (Math.abs(lean - h.lean) < 0.25) return // don't re-plan for sub-pixel wiggles
  h.lean = lean
  motionFor(h.el).update((c) => c.to('tilt', lean, h.f.press))
}

function onUp(e: PointerEvent) {
  const h = held.get(e.pointerId)
  if (!h) return
  held.delete(e.pointerId)
  if (!held.size) unbindWindow()
  if (!isHeld(h.el)) letGo(h.el, h.f)
}

const CAPTURE = { capture: true, passive: true } as const

function bindWindow() {
  addEventListener('pointermove', onMove, CAPTURE)
  addEventListener('pointerup', onUp, CAPTURE)
  addEventListener('pointercancel', onUp, CAPTURE)
}

function unbindWindow() {
  removeEventListener('pointermove', onMove, CAPTURE)
  removeEventListener('pointerup', onUp, CAPTURE)
  removeEventListener('pointercancel', onUp, CAPTURE)
}

export function startPress(el: JelloElement, f: Feel, e: PointerEvent) {
  if (e.pointerType === 'mouse' && e.button !== 0) return
  if (isDisabled(el) || held.has(e.pointerId)) return
  lastPress.set(el, performance.now())
  const second = isHeld(el)
  const h: Held = { el, f, lean: 0 }
  if (!held.size) bindWindow()
  held.set(e.pointerId, h)
  if (!second) h.lean = pressIn(el, f, e.clientX, e.clientY)
}

/** Forget any presses on `el` (used by destroy). */
export function dropPresses(el: Element) {
  for (const [id, h] of held) if (h.el === el) held.delete(id)
  if (!held.size) unbindWindow()
}

/* --------------------------------------------------------------- keyboard */

const BUTTONLIKE =
  'button, [role="button"], [role="tab"], [role="menuitem"], input[type="button"], input[type="submit"], input[type="reset"], summary'
const spaceHeld = new WeakSet<Element>()

export function onKey(el: JelloElement, f: Feel, e: KeyboardEvent | FocusEvent) {
  if (e.type === 'keydown') {
    const k = e as KeyboardEvent
    if (k.repeat || k.target !== el || isDisabled(el)) return
    if (k.key === ' ' && el.matches(BUTTONLIKE)) {
      spaceHeld.add(el)
      pressIn(el, f)
    } else if (k.key === 'Enter' && el.matches(`${BUTTONLIKE}, a[href]`)) {
      tapOnce(el, f)
    }
    return
  }
  // keyup (Space) or focus leaving while Space is down
  if ((e.type === 'focusout' || (e as KeyboardEvent).key === ' ') && spaceHeld.delete(el)) letGo(el, f)
}
