import type { JelloElement } from './motion'

/**
 * Reduced-motion feedback. WCAG 2.3.3 counts changes of size, position and
 * rotation as motion, but not changes of opacity or colour — so users who ask
 * for less motion still get a clear "you pressed it" signal, just without
 * anything moving.
 */

interface Fade {
  a: Animation
  base: number
}

const fades = new WeakMap<Element, Fade>()

export const isFaded = (el: Element) => fades.has(el)

function opacityOf(el: Element): number {
  if (typeof getComputedStyle !== 'function') return 1
  const o = parseFloat(getComputedStyle(el).opacity)
  return Number.isFinite(o) ? o : 1
}

/** Dim (`level` < 1) or restore (`level` = 1) the element's opacity. */
export function fadeTo(el: JelloElement, level: number, ms: number) {
  if (typeof el.animate !== 'function') return
  const prev = fades.get(el)
  const base = prev ? prev.base : opacityOf(el)
  const from = prev ? opacityOf(el) : base
  const a = el.animate([{ opacity: from }, { opacity: base * level }], {
    duration: ms,
    easing: 'ease-out',
    fill: 'forwards',
  })
  prev?.a.cancel()
  const rec = { a, base }
  fades.set(el, rec)
  if (level === 1) {
    a.onfinish = () => {
      if (fades.get(el) !== rec) return
      a.cancel()
      fades.delete(el)
    }
  }
}

/** A quick dip in opacity, `times` times — the reduced-motion stand-in for shake/jiggle/pop/hop. */
export function blink(el: JelloElement, times = 1) {
  if (typeof el.animate !== 'function') return
  const cur = opacityOf(el)
  const base = fades.get(el)?.base ?? cur
  const a = el.animate([{ opacity: cur }, { opacity: base * 0.4 }, { opacity: cur }], {
    duration: 180,
    iterations: times,
    easing: 'ease-in-out',
  })
  a.onfinish = () => a.cancel()
}
