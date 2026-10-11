import { prefersReducedMotion } from './config'
import { blink } from './fade'
import { motionFor, type JelloElement } from './motion'
import { impulse, returnTime, spring } from './spring'

/**
 * One-shot effects. They are velocity kicks on the same springs the press
 * interaction uses, so they stack and interrupt naturally: shake a button
 * while it's held and it shakes *and* stays squashed.
 *
 * Amplitudes are given in visible units (px, deg, scale) and converted to the
 * kick that produces exactly that first peak.
 */

export interface EffectOptions {
  /** Multiplies the default amplitude. @default 1 */
  strength?: number
}

const S = {
  jiggle: /* @__PURE__ */ spring({ duration: 0.42, bounce: 0.72 }),
  sway: /* @__PURE__ */ spring({ duration: 0.5, bounce: 0.6 }),
  shake: /* @__PURE__ */ spring({ duration: 0.28, bounce: 0.8 }),
  bump: /* @__PURE__ */ spring({ duration: 0.38, bounce: 0.55 }),
  enter: /* @__PURE__ */ spring({ duration: 0.5, bounce: 0.45 }),
  wobble: /* @__PURE__ */ spring({ duration: 0.45, bounce: 0.7 }),
  crouch: /* @__PURE__ */ spring({ duration: 0.14, bounce: 0 }),
  air: /* @__PURE__ */ spring({ duration: 0.5, bounce: 0.45 }),
  land: /* @__PURE__ */ spring({ duration: 0.35, bounce: 0.5 }),
}

/** Wobble in place — squash/stretch with a little sway. "Look at me." */
export function jiggle(el: JelloElement, { strength = 1 }: EffectOptions = {}) {
  if (prefersReducedMotion()) return blink(el)
  motionFor(el).update((c) => {
    c.kick('squash', -impulse(S.jiggle, 0.12 * strength), S.jiggle)
    c.kick('tilt', impulse(S.sway, 2.5 * strength), S.sway)
  })
}

/** Side-to-side "nope" — wrong password, invalid input. Top lags behind like real jelly. */
export function shake(el: JelloElement, { strength = 1 }: EffectOptions = {}) {
  if (prefersReducedMotion()) return blink(el, 2)
  motionFor(el).update((c) => {
    c.kick('x', -impulse(S.shake, 8 * strength), S.shake)
    c.kick('tilt', impulse(S.shake, 1.5 * strength), S.shake)
  })
}

export interface PopOptions extends EffectOptions {
  /** Start from this scale and spring to 1 — e.g. `0` to make something appear. */
  from?: number
}

/** A quick swell (badge count changed), or an entrance with `{ from: 0 }`. */
export function pop(el: JelloElement, { strength = 1, from }: PopOptions = {}) {
  if (prefersReducedMotion()) {
    if (from === undefined) blink(el)
    else el.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' })
    return
  }
  motionFor(el).update((c) => {
    if (from !== undefined) {
      c.jump('grow', from - 1)
      c.to('grow', 0, S.enter)
      c.kick('squash', impulse(S.wobble, 0.06 * strength), S.wobble)
    } else {
      c.kick('grow', impulse(S.bump, 0.14 * strength), S.bump)
      c.kick('squash', -impulse(S.wobble, 0.04 * strength), S.wobble)
    }
  })
}

export interface HopOptions extends EffectOptions {
  /** Jump height in px. @default 14 */
  height?: number
}

/** Crouch, jump, land with a squish. Celebrations, "added to cart". */
export function hop(el: JelloElement, { strength = 1, height = 14 }: HopOptions = {}) {
  if (prefersReducedMotion()) return blink(el)
  motionFor(el).update((c) => {
    c.to('squash', -0.07 * strength, S.crouch) // anticipation
    c.later(0.08, (c) => {
      c.to('squash', 0, S.land)
      c.kick('squash', impulse(S.land, 0.09 * strength), S.land) // stretch on take-off
      c.kick('y', -impulse(S.air, height * strength), S.air)
      // squish exactly when it comes back down — computed, not guessed
      c.later(returnTime(S.air), (c) => c.kick('squash', -impulse(S.land, 0.08 * strength), S.land))
    })
  })
}
