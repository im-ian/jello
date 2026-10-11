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
 *   toggle      checkbox, radio, [role=switch|checkbox|radio]       boing when the checked state changes
 *   range       input[type=range], [role=slider]                    keeps its momentum: pushed on when it stops
 *   disclosure  summary, [aria-expanded][aria-controls]             title stays still, the panel drops open
 *
 * State changes picked up anywhere inside an enabled area:
 *   aria-checked / aria-pressed → boing       aria-selected="true" → pop
 *   aria-expanded (disclosure)  → panel drops aria-expanded (other)  → small pop
 *   aria-invalid="true"         → shake       aria-valuenow        → slider momentum
 *   <details> opened by code    → drops open  <dialog>/popover opened → springs in
 *   inserted [data-jello-enter] → springs in (value = start scale, default 0.6)
 */
export type Kind = 'press' | 'field' | 'toggle' | 'range' | 'disclosure'

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
const FIELD_ROLE = /^(textbox|combobox|searchbox|spinbutton)$/
const PRESS_INPUT = /^(button|submit|reset|image|color|file)$/

export function kindOf(el: Element): Kind {
  const tag = el.tagName
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type
    if (type === 'checkbox' || type === 'radio') return 'toggle'
    if (type === 'range') return 'range'
    return PRESS_INPUT.test(type) ? 'press' : 'field'
  }
  if (tag === 'TEXTAREA' || tag === 'SELECT') return 'field'
  if (tag === 'SUMMARY' || isDisclosureButton(el)) return 'disclosure'
  const role = el.getAttribute('role') ?? ''
  if (TOGGLE_ROLE.test(role)) return 'toggle'
  if (role === 'slider') return 'range'
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
      if (value === 'true') selected(el)
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
    case 'aria-valuenow':
      slideMoved(el, old)
      break
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
