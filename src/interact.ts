import {
  attributeChanged,
  CONTROL,
  entered,
  focused,
  invalid,
  kindOf,
  toggled,
  typed,
  WATCHED,
  type Kind,
} from './components'
import { pop } from './effects'
import { toggleDetails } from './fold'
import { prefersReducedMotion } from './config'
import { slideMoved, slideSeed, slideStart } from './slide'
import type { JelloElement } from './motion'
import { DEFAULT_PRESET, presets, type PresetName, type PressFeel } from './presets'
import { dropPresses, letGo, onKey, pressedRecently, pressIn, startPress, tapOnce, type Feel } from './press'
import { spring } from './spring'

export interface JelloOptions extends Partial<PressFeel> {
  /** Start from a preset, then override any field. @default 'wobbly' */
  preset?: PresetName
  /** Dimple at the press point. Off for elements that can't hold children (input…). @default true */
  dent?: boolean
  /** Deform around the finger, or around the element's CSS transform-origin. @default 'pointer' */
  pivot?: 'pointer' | 'origin'
}

export function resolveFeel(o: JelloOptions = {}): Feel {
  const p = presets[o.preset ?? DEFAULT_PRESET] ?? presets[DEFAULT_PRESET]
  return {
    squash: o.squash ?? p.squash,
    depth: o.depth ?? p.depth,
    tilt: o.tilt ?? p.tilt,
    press: spring(o.press ?? p.press),
    release: spring(o.release ?? p.release),
    dent: o.dent ?? true,
    pivot: o.pivot ?? 'pointer',
  }
}

/**
 * Fields get a much gentler press and no dimple (they can't hold one anyway).
 * Accordion titles don't move at all — only the dimple shows where you pressed.
 */
const kindFeels = { field: new WeakMap<Feel, Feel>(), disclosure: new WeakMap<Feel, Feel>() }
function feelForKind(f: Feel, kind: Kind): Feel {
  if (kind !== 'field' && kind !== 'disclosure') return f
  const cache = kindFeels[kind]
  let g = cache.get(f)
  if (!g) {
    g =
      kind === 'field'
        ? { ...f, depth: Math.min(f.depth, 0.02), squash: Math.min(f.squash, 0.025), tilt: 0, dent: false }
        : { ...f, depth: 0, squash: 0, tilt: 0 }
    cache.set(f, g)
  }
  return g
}

const isOff = (el: Element) => /^(off|none|false)$/.test(el.getAttribute('data-jello') ?? '')

/* ------------------------------------------------------------------ scopes */

interface Scope {
  /** Where to listen. */
  root: Document | Element
  /** The element that switches jello on for `node` (itself or an ancestor), if any. */
  hostOf(node: Element): Element | null
  /** Options for presses inside `host`. */
  feelOf(host: Element): Feel
}

interface Target {
  el: JelloElement
  feel: Feel
  kind: Kind
}

/**
 * From an event target to the control it belongs to.
 * A host that contains controls (a form, a toolbar) passes presses on to them
 * and is not pressed itself; a host without controls (a card, a jelly) is.
 */
function targetOf(scope: Scope, t: EventTarget | null): Target | null {
  const node = t instanceof Element ? t : ((t as Node | null)?.parentElement ?? null)
  if (!node) return null
  const host = scope.hostOf(node)
  if (!host || isOff(host)) return null
  let el: Element | null = node.closest(CONTROL)
  if (!el || !host.contains(el)) el = host.matches(CONTROL) || !host.querySelector(CONTROL) ? host : null
  if (!el) return null
  const kind = kindOf(el)
  return { el: el as JelloElement, feel: feelForKind(scope.feelOf(host), kind), kind }
}

function enabled(scope: Scope, el: Element): boolean {
  const host = scope.hostOf(el)
  return !!host && !isOff(host)
}

const LISTEN = ['pointerdown', 'keydown', 'keyup', 'focusout', 'focusin', 'input', 'change', 'invalid', 'toggle'] as const

/** Wire one scope. Returns a function that unwires it. */
function bind(scope: Scope, enter: boolean): () => void {
  const handle = (e: Event) => {
    if (e.type === 'toggle') {
      // popover opened (details are already covered by the summary press)
      const src = e.target as Element
      const state = (e as Event & { newState?: string }).newState
      if (state === 'open' && src.hasAttribute?.('popover') && enabled(scope, src)) entered(src as JelloElement, 0.85)
      return
    }
    const r = targetOf(scope, e.target)
    if (!r) return
    const { el, feel, kind } = r
    switch (e.type) {
      case 'pointerdown':
        if (kind === 'range') slideStart(el)
        else startPress(el, feel, e as PointerEvent)
        break
      case 'keydown':
      case 'keyup':
      case 'focusout':
        if (kind === 'press' || kind === 'disclosure') onKey(el, feel, e as KeyboardEvent)
        break
      case 'focusin':
        if (kind === 'field' && e.target === el && !pressedRecently(el)) focused(el)
        else if (kind === 'range') slideSeed(el)
        break
      case 'input':
        if (kind === 'field') typed(el)
        else if (kind === 'range') slideMoved(el)
        break
      case 'change':
        if (kind === 'toggle') toggled(el, !!(el as HTMLInputElement).checked)
        else if (el.tagName === 'SELECT') pop(el, { strength: 0.5 })
        break
      case 'invalid':
        invalid(el)
        break
    }
  }
  // capture: also catches non-bubbling events (invalid, toggle) and runs before app handlers stop propagation
  for (const type of LISTEN) scope.root.addEventListener(type, handle, true)

  // Accordion: take over the summary click so the panel can drop open / fold shut.
  // Bubble phase, so an app that calls preventDefault() on its own keeps control.
  const click = (e: Event) => {
    if (e.defaultPrevented || prefersReducedMotion()) return
    const r = targetOf(scope, e.target)
    const d = r?.el.parentElement
    if (r?.el.tagName === 'SUMMARY' && d instanceof HTMLDetailsElement && d.querySelector(':scope > summary') === r.el) {
      e.preventDefault()
      toggleDetails(d)
    }
  }
  scope.root.addEventListener('click', click)

  const mo =
    typeof MutationObserver === 'function'
      ? new MutationObserver((records) => {
          for (const r of records) {
            if (r.type === 'attributes') {
              const el = r.target as Element
              const value = el.getAttribute(r.attributeName!)
              if (value !== r.oldValue && enabled(scope, el)) {
                attributeChanged(el as JelloElement, r.attributeName!, value, r.oldValue)
              }
            } else if (enter) {
              r.addedNodes.forEach((n) => {
                if (!(n instanceof Element)) return
                const found = n.matches('[data-jello-enter]') ? [n] : []
                found.push(...Array.from(n.querySelectorAll('[data-jello-enter]')))
                for (const el of found) entered(el as JelloElement, Number(el.getAttribute('data-jello-enter')) || 0.6)
              })
            }
          }
        })
      : null
  mo?.observe(scope.root, {
    subtree: true,
    attributes: true,
    attributeOldValue: true,
    attributeFilter: WATCHED,
    childList: enter,
  })

  return () => {
    for (const type of LISTEN) scope.root.removeEventListener(type, handle, true)
    scope.root.removeEventListener('click', click)
    mo?.disconnect()
  }
}

/* ------------------------------------------------------------- public API */

export interface JelloHandle {
  /** Remove listeners (and let go if currently pressed). */
  destroy(): void
  /** Press in programmatically. */
  press(): void
  /** Let go programmatically. */
  release(): void
  /** A quick press-and-release, like a keyboard Enter. */
  tap(): void
}

type Targets = JelloElement | Iterable<JelloElement> | ArrayLike<JelloElement> | string

function toList(t: Targets): JelloElement[] {
  if (typeof t === 'string') return Array.from(document.querySelectorAll<HTMLElement>(t))
  if (t instanceof Element) return [t as JelloElement]
  return Array.from(t as ArrayLike<JelloElement>)
}

/**
 * Make elements feel like jelly. A button gets pressed; a form or toolbar
 * passes it on to every control inside (inputs, checkboxes, tabs …).
 *
 *   const h = jello('#buy', { preset: 'bouncy' })
 *   jello(form)            // everything inside
 *   h.destroy()
 */
export function jello(target: Targets, options?: JelloOptions): JelloHandle {
  const f = resolveFeel(options)
  const nested = attrFeels(options)
  const els = toList(target)
  const offs = els.map((root) => {
    const scope: Scope = {
      root,
      hostOf(node) {
        if (!root.contains(node)) return null
        // nested data-jello inside can still switch off or pick another preset
        const inner = node.closest('[data-jello]')
        return inner && inner !== root && root.contains(inner) ? inner : root
      },
      feelOf: (host) => (host === root ? f : nested(host)),
    }
    const off = bind(scope, false)
    return () => {
      off()
      dropPresses(root)
      letGo(root, f)
    }
  })
  return {
    destroy: () => offs.forEach((off) => off()),
    press: () => els.forEach((el) => pressIn(el, f)),
    release: () => els.forEach((el) => letGo(el, f)),
    tap: () => els.forEach((el) => tapOnce(el, f)),
  }
}

/**
 * Options for a host from its attributes — data-jello="bouncy",
 * data-jello-dent="off", data-jello-pivot="origin" — on top of `base`.
 */
function attrFeels(base: JelloOptions = {}): (host: Element) => Feel {
  const cache = new Map<string, Feel>()
  return (host) => {
    const name = host.getAttribute('data-jello') ?? ''
    const dent = host.getAttribute('data-jello-dent')
    const pivot = host.getAttribute('data-jello-pivot')
    const key = `${name}|${dent}|${pivot}`
    let f = cache.get(key)
    if (!f) {
      f = resolveFeel({
        ...base,
        ...(name in presets ? { preset: name as PresetName } : {}),
        ...(dent !== null ? { dent: !/^(off|false|none)$/.test(dent) } : {}),
        ...(pivot === 'origin' || pivot === 'pointer' ? { pivot } : {}),
      })
      cache.set(key, f)
    }
    return f
  }
}

export interface AutoOptions extends JelloOptions {
  /** What switches jello on — an element, or a container for the controls inside. @default '[data-jello]' */
  selector?: string
  /** Where to listen. @default document */
  root?: Document | Element
  /** Spring in elements marked `data-jello-enter` when they are inserted. @default true */
  enter?: boolean
}

/**
 * One set of delegated listeners for the whole page, including elements
 * rendered later by React/Vue/etc. — no per-element setup or cleanup.
 *
 *   <button data-jello>          pressable
 *   <form data-jello="gentle">   every control inside
 *   <div data-jello="off">       opt out
 *
 * Returns a function that removes the listeners.
 */
export function auto(options: AutoOptions = {}): () => void {
  const { selector = '[data-jello]', root = document, enter = true, ...base } = options
  const scope: Scope = {
    root,
    hostOf: (node) => {
      const h = node.closest(selector)
      return h && root.contains(h) ? h : null
    },
    feelOf: attrFeels(base),
  }
  return bind(scope, enter)
}
