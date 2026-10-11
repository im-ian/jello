import { now } from './config'
import { Channel, FPS, MAX_PLAN } from './motion'
import { spring, type Spring } from './spring'

/**
 * The dimple: a soft dark-centred, light-rimmed spot that sinks in where the
 * finger is and springs back out on release. Material Design asks for the
 * same thing in its own language — feedback "at the point of contact" that
 * spreads radially from there.
 *
 * It lives in a small `aria-hidden` overlay appended to the element and only
 * ever animates `scale` and `opacity`, so it stays on the compositor. Elements
 * that can't hold children (input, textarea, select, img…) don't get one.
 */

const VOID = new Set([
  'INPUT', 'TEXTAREA', 'SELECT', 'IMG', 'VIDEO', 'AUDIO', 'CANVAS', 'IFRAME',
  'OBJECT', 'EMBED', 'BR', 'HR', 'PROGRESS', 'METER', 'OPTION',
])

const SHADE =
  'radial-gradient(circle closest-side, rgb(0 0 0 / 0.2), rgb(0 0 0 / 0.1) 45%, rgb(255 255 255 / 0.22) 72%, rgb(255 255 255 / 0))'

const FADE = /* @__PURE__ */ spring({ duration: 0.25, bounce: 0 })

interface Dent {
  host: HTMLSpanElement
  dot: HTMLSpanElement
  depth: Channel
  release: { at: number; s: Spring } | null
  anim: Animation | null
  reduced: boolean
}

const dents = new WeakMap<Element, Dent>()

export function canDent(el: Element): el is HTMLElement {
  return (
    typeof HTMLElement !== 'undefined' &&
    el instanceof HTMLElement &&
    !VOID.has(el.tagName) &&
    typeof el.animate === 'function'
  )
}

function mount(el: HTMLElement): Dent {
  const prev = dents.get(el)
  // Frameworks may wipe children (e.g. React setting textContent): re-mount then.
  if (prev && prev.host.parentNode === el) return prev
  const host = document.createElement('span')
  const dot = document.createElement('span')
  host.setAttribute('aria-hidden', 'true')
  host.setAttribute('data-jello-dent', '')
  host.style.cssText = 'position:absolute;inset:0;border-radius:inherit;overflow:hidden;pointer-events:none;user-select:none'
  dot.style.cssText = `position:absolute;left:0;top:0;border-radius:50%;opacity:0;background:${SHADE}`
  host.append(dot)
  if (getComputedStyle(el).position === 'static') el.style.position = 'relative'
  el.append(host)
  const d: Dent = prev ?? {
    host,
    dot,
    depth: new Channel(FADE, 2e-3, 2e-2),
    release: null,
    anim: null,
    reduced: false,
  }
  d.host = host
  d.dot = dot
  dents.set(el, d)
  return d
}

/** Sink a dimple in at (x, y) — px from the element's border-box corner. */
export function dentIn(el: HTMLElement, x: number, y: number, press: Spring, reduced: boolean, releaseAfter?: [number, Spring]) {
  const d = mount(el)
  const t = now()
  const cs = getComputedStyle(el)
  const w = el.offsetWidth
  const h = el.offsetHeight
  const size = Math.max(36, Math.min(160, Math.min(w, h) * 1.1))
  Object.assign(d.dot.style, {
    width: `${size}px`,
    height: `${size}px`,
    left: `${x - (parseFloat(cs.borderLeftWidth) || 0) - size / 2}px`,
    top: `${y - (parseFloat(cs.borderTopWidth) || 0) - size / 2}px`,
  })
  sync(d, t)
  d.reduced = reduced
  d.depth.to(t, 1, reduced ? FADE : press)
  d.release = releaseAfter ? { at: t + releaseAfter[0], s: releaseAfter[1] } : null
  play(d, t)
}

/** Follow a sliding finger (only moves the dot; nothing is re-planned). */
export function dentMove(el: Element, x: number, y: number) {
  const d = dents.get(el)
  if (!d || d.host.parentNode !== el) return
  const size = parseFloat(d.dot.style.width) || 0
  const cs = getComputedStyle(el)
  d.dot.style.left = `${x - (parseFloat(cs.borderLeftWidth) || 0) - size / 2}px`
  d.dot.style.top = `${y - (parseFloat(cs.borderTopWidth) || 0) - size / 2}px`
}

/** Let the dimple spring back out. */
export function dentOut(el: Element, release: Spring) {
  const d = dents.get(el)
  if (!d || d.host.parentNode !== el) return
  const t = now()
  sync(d, t)
  d.release = null
  d.depth.to(t, 0, d.reduced ? FADE : release)
  play(d, t)
}

/** Apply a scheduled release (from a tap) that has already happened on screen. */
function sync(d: Dent, t: number) {
  if (d.release && t >= d.release.at) {
    d.depth.to(d.release.at, 0, d.release.s)
    d.release = null
  }
}

function play(d: Dent, t: number) {
  const ch = d.depth.copy()
  let rel = d.release
  // where does it settle?
  const probe = ch.copy()
  if (rel) probe.to(rel.at, 0, rel.s)
  const end = Math.min(t + MAX_PLAN, Math.max(rel?.at ?? t, probe.settledAt()))
  const count = Math.max(1, Math.ceil((end - t) * FPS))
  const frames: Keyframe[] = []
  for (let i = 0; i <= count; i++) {
    const ts = t + ((end - t) * i) / count
    if (rel && ts >= rel.at) {
      ch.to(rel.at, 0, rel.s)
      rel = null
    }
    const v = ch.at(ts)[0]
    const k = Math.max(0, Math.min(1.2, v))
    frames.push({
      opacity: Number(Math.min(1, k * 1.4).toFixed(3)),
      scale: d.reduced ? '1' : (0.3 + 0.7 * k).toFixed(3),
    })
  }
  const old = d.anim
  const a = d.dot.animate(frames, { duration: Math.max(1, (end - t) * 1000), easing: 'linear', fill: 'both' })
  a.startTime = t * 1000
  a.onfinish = () => {
    // fully released: drop the animation, the dot's own style is invisible anyway
    if (d.anim !== a) return
    sync(d, now())
    if (!d.release && d.depth.target === 0) {
      a.cancel()
      d.anim = null
    }
  }
  d.anim = a
  old?.cancel()
}
