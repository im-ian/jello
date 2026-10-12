import { prefersReducedMotion } from './config'
import { pop, shake } from './effects'
import { dropOpen, openedByCode } from './fold'
import { motionFor, type JelloElement } from './motion'
import { slideMoved } from './slide'
import { impulse, spring } from './spring'

/**
 * jello doesn't ship its own inputs, switches or tabs. It reacts to the
 * components you already have — native elements first, ARIA states for custom
 * ones — so it works with any design system and never gets in the way of
 * built-in accessibility.
 *
 *   press       buttons, links, cards, tabs, menu items …          squash on press
 *   field       input, textarea, select, contenteditable, textbox   swell on focus, wiggle while typing, shake when invalid
 *   step        input[type=number], [role=spinbutton]               bumped the way the value moved: up lifts, down drops
 *   toggle      checkbox, radio, [role=switch|checkbox|radio]       boing when the checked state changes
 *   range       input[type=range], [role=slider]                    keeps its momentum: pushed on when it stops
 *   disclosure  summary, [aria-expanded][aria-controls]             title stays still, the panel drops open
 *   tablist     [role=tablist] holding a [data-jello-indicator]     the indicator glides onto the selected tab
 *
 * State changes picked up anywhere inside an enabled area:
 *   aria-checked / aria-pressed → boing       aria-selected="true" → pop + indicator glides
 *   aria-expanded (disclosure)  → panel drops aria-expanded (other)  → small pop
 *   aria-invalid="true"         → shake       aria-valuenow        → slider momentum / stepper bump
 *   <details> opened by code    → drops open  <dialog>/popover opened → springs in
 *   inserted [data-jello-enter] → springs in (value = start scale, default 0.6)
 */
export type Kind = 'press' | 'field' | 'step' | 'toggle' | 'range' | 'disclosure'

/** What counts as a control when looking up from the event target. */
export const CONTROL = [
  'button',
  'a[href]',
  'input:not([type="hidden"])',
  'textarea',
  'select',
  'summary',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
  ...[
    'button', 'link', 'switch', 'checkbox', 'radio', 'tab', 'menuitem', 'menuitemcheckbox',
    'menuitemradio', 'option', 'slider', 'textbox', 'combobox', 'searchbox', 'spinbutton', 'treeitem',
  ].map((r) => `[role="${r}"]`),
].join(',')

const TOGGLE_ROLE = /^(switch|checkbox|radio|menuitemcheckbox|menuitemradio)$/
const FIELD_ROLE = /^(textbox|combobox|searchbox)$/
const PRESS_INPUT = /^(button|submit|reset|image|color|file)$/

export function kindOf(el: Element): Kind {
  const tag = el.tagName
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type
    if (type === 'checkbox' || type === 'radio') return 'toggle'
    if (type === 'range') return 'range'
    if (type === 'number') return 'step'
    return PRESS_INPUT.test(type) ? 'press' : 'field'
  }
  if (tag === 'TEXTAREA' || tag === 'SELECT') return 'field'
  if (tag === 'SUMMARY' || isDisclosureButton(el)) return 'disclosure'
  const role = el.getAttribute('role') ?? ''
  if (TOGGLE_ROLE.test(role)) return 'toggle'
  if (role === 'slider') return 'range'
  if (role === 'spinbutton') return 'step'
  if (FIELD_ROLE.test(role) || (el as HTMLElement).isContentEditable) return 'field'
  return 'press'
}

/** An accordion header: expands a panel it controls (not a popup menu). */
const isDisclosureButton = (el: Element) =>
  el.hasAttribute('aria-expanded') && el.hasAttribute('aria-controls') && !el.hasAttribute('aria-haspopup')

/**
 * Custom switches often hide the real checkbox and draw a sibling instead
 * (`<label><input hidden-ish> <span class="track">`). Animate what people see.
 */
export function visualFor(el: JelloElement): JelloElement {
  if (el.tagName !== 'INPUT' || !(el instanceof HTMLElement)) return el
  const cs = getComputedStyle(el)
  const hidden = el.offsetWidth * el.offsetHeight <= 4 || cs.opacity === '0' || cs.visibility === 'hidden'
  if (!hidden) return el
  const sib = el.nextElementSibling
  if (sib instanceof HTMLElement && sib.offsetWidth) return sib
  return (el.closest('label') as HTMLElement | null) ?? el
}

/* ----------------------------------------------------------------- reactions */

const WIGGLE = /* @__PURE__ */ spring({ duration: 0.3, bounce: 0.6 })
const lastWiggle = new WeakMap<Element, number>()
let sign = 1

/** Each keystroke: a tiny alternating squash, at most every 45ms. */
export function typed(el: JelloElement) {
  if (prefersReducedMotion()) return
  const t = performance.now()
  if (t - (lastWiggle.get(el) ?? -1e9) < 45) return
  lastWiggle.set(el, t)
  sign = -sign
  motionFor(el).update((c) => c.kick('squash', sign * impulse(WIGGLE, 0.012), WIGGLE))
}

const BUMP = /* @__PURE__ */ spring({ duration: 0.34, bounce: 0.5 })
const lastStep = new WeakMap<Element, number>()
const lastBump = new WeakMap<Element, number>()

/** Current value — native number input, or the ARIA role. `raw` overrides it. */
function stepValue(el: Element, raw?: string | null): number {
  const v = raw ?? (el instanceof HTMLInputElement ? el.value : el.getAttribute('aria-valuenow'))
  return v == null || v === '' ? NaN : Number(v)
}

/**
 * The value moved: a nudge that way — up lifts and stretches, down drops and
 * squashes. `previous` is the old raw value when known (from the attribute
 * change), else the last value seen here, falling back to the `value`
 * attribute so the very first step already counts.
 *
 * Spinner buttons auto-repeat about every 100ms while held, so at most one
 * bump every 150ms: a held button pulses instead of blurring, and no single
 * click is ever swallowed.
 */
export function stepped(el: JelloElement, previous?: string | null) {
  if (prefersReducedMotion()) return
  const v = stepValue(el)
  const from = previous != null ? stepValue(el, previous) : (lastStep.get(el) ?? stepValue(el, el.getAttribute('value')))
  if (Number.isFinite(v)) lastStep.set(el, v)
  const dir = Math.sign(v - from) // 0 if unchanged, NaN if either side isn't a number
  const t = performance.now()
  if (!dir || t - (lastBump.get(el) ?? -1e9) < 150) return
  lastBump.set(el, t)
  motionFor(el).update((c) => {
    c.kick('y', -dir * impulse(BUMP, 3), BUMP) // negative y is up
    c.kick('squash', dir * impulse(BUMP, 0.03), BUMP)
  })
}

/** Keyboard focus on a field: a small swell that settles back (nothing stays scaled while you type). */
export function focused(el: JelloElement) {
  if (!prefersReducedMotion()) pop(el, { strength: 0.3 })
}

export function toggled(el: JelloElement, on: boolean) {
  pop(visualFor(el), { strength: on ? 0.9 : 0.5 })
}

export function invalid(el: JelloElement) {
  shake(visualFor(el), { strength: 0.8 })
}

export function selected(el: JelloElement) {
  pop(el, { strength: 0.45 })
}

const GLIDE = /* @__PURE__ */ spring({ duration: 0.45, bounce: 0.35 })
const STRETCH = /* @__PURE__ */ spring({ duration: 0.4, bounce: 0.6 })

/** The indicator the app put in this tab's tablist, if any. jello never makes one. */
function indicatorOf(tab: Element): { ind: HTMLElement; vertical: boolean } | null {
  const list = tab.getAttribute('role') === 'tab' ? tab.closest('[role="tablist"]') : null
  const ind = list?.querySelector('[data-jello-indicator]')
  if (!(ind instanceof HTMLElement)) return null
  return { ind, vertical: list!.getAttribute('aria-orientation') === 'vertical' }
}

/**
 * Slide the tablist's indicator onto `tab` and squash it on arrival.
 * `snap` puts it there with no motion (bind time, reduced motion).
 *
 * Follows the tablist's aria-orientation: along x by default, along y for
 * "vertical".
 *
 * Measured with offsetLeft/offsetWidth (offsetTop/offsetHeight when vertical):
 * those are layout, so the scale and translate jello writes don't change them
 * and every move re-measures from the same ground truth. A rect would feed the
 * last transform into the next target and drift.
 *
 * There is no scaleX channel on purpose — squash keeps the area — but grow and
 * squash together span every (sx, sy): sx = (1+grow)/(1+squash), sy = (1+grow)(1+squash).
 * Both solve from one √R, where R is the ratio along the track:
 *
 *   horizontal  sx = R, sy = 1   grow = √R − 1, squash = 1/√R − 1
 *   vertical    sy = R, sx = 1   grow = √R − 1, squash =  √R − 1
 *
 * ours() clamps squash at −0.8, so R tops out near 25× across and bottoms out
 * near 1/25 down. No tablist is that lopsided.
 *
 * ponytail: measured at bind and on each selection, so a webfont landing later
 * leaves it a px or two off until the next selection. ResizeObserver on the
 * tablist is the upgrade.
 */
export function moveIndicator(tab: Element, snap = prefersReducedMotion()) {
  const found = indicatorOf(tab)
  if (!found || !(tab instanceof HTMLElement)) return
  const { ind, vertical } = found
  if (ind.offsetParent !== tab.offsetParent) return // not a shared frame
  const own = vertical ? ind.offsetHeight : ind.offsetWidth
  if (!own) return // not laid out
  const axis = vertical ? 'y' : 'x'
  const sq = Math.sqrt((vertical ? tab.offsetHeight : tab.offsetWidth) / own)
  const squash = (vertical ? sq : 1 / sq) - 1
  const d = vertical
    ? tab.offsetTop + tab.offsetHeight / 2 - (ind.offsetTop + ind.offsetHeight / 2)
    : tab.offsetLeft + tab.offsetWidth / 2 - (ind.offsetLeft + ind.offsetWidth / 2)
  motionFor(ind).update((c) => {
    const travel = Math.abs(d - c.value(axis))
    c.to(axis, d, GLIDE)
    c.to('grow', sq - 1, GLIDE)
    c.to('squash', squash, GLIDE)
    if (snap) {
      c.jump(axis, d)
      c.jump('grow', sq - 1)
      c.jump('squash', squash)
    } else {
      // stretched along the way, the further it goes the more: wider when it
      // travels sideways, taller when it travels down
      c.kick('squash', (vertical ? 1 : -1) * impulse(STRETCH, Math.min(0.1, travel * 4e-4)), STRETCH)
    }
  })
}

export function expanded(el: JelloElement) {
  pop(el, { strength: 0.35 })
}

export function entered(el: JelloElement, from: number) {
  pop(el, { from })
}

/** Reaction to an ARIA/`open` attribute change. */
export function attributeChanged(el: JelloElement, name: string, value: string | null, old?: string | null) {
  switch (name) {
    case 'aria-checked':
    case 'aria-pressed':
      toggled(el, value === 'true' || value === 'mixed')
      break
    case 'aria-selected':
      if (value === 'true') {
        selected(el)
        moveIndicator(el)
      }
      break
    case 'aria-expanded':
      if (!isDisclosureButton(el)) expanded(el)
      else if (value === 'true') {
        for (const id of (el.getAttribute('aria-controls') ?? '').split(/\s+/)) {
          const panel = id ? el.ownerDocument.getElementById(id) : null
          if (panel) dropOpen(panel)
        }
      }
      break
    case 'aria-valuenow': {
      // only the controls that own a value: not role="progressbar" & co.
      const kind = kindOf(el)
      if (kind === 'range') slideMoved(el, old)
      else if (kind === 'step') stepped(el, old)
      break
    }
    case 'aria-invalid':
      if (value && value !== 'false') invalid(el)
      break
    case 'open':
      if (value === null) break
      if (el.tagName === 'DIALOG') entered(el, 0.9)
      else if (el instanceof HTMLDetailsElement) openedByCode(el)
      break
  }
}

export const WATCHED = [
  'aria-checked', 'aria-pressed', 'aria-selected', 'aria-expanded', 'aria-invalid', 'aria-valuenow', 'open',
]
