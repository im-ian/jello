import { now, prefersReducedMotion } from './config'
import { Channel, FPS, MAX_PLAN } from './motion'
import { spring } from './spring'

/**
 * Accordions: the title stays put, the panel drops open. Its height springs
 * past the natural size and pulls back (stretch → elastic contraction) while
 * the content falls in from just under the title.
 *
 * Height changes layout, so unlike the rest of jello this runs on the main
 * thread — and that is the point: everything below is pushed down and pulled
 * back up with it.
 *
 * <details> can't be animated by CSS alone (the browser shows the content the
 * moment `open` is set), so a click on its summary is taken over: jello sets
 * `open` itself and animates; on close it animates first and removes `open`
 * at the end. The `toggle` event still fires as usual.
 */

const DROP = /* @__PURE__ */ spring({ duration: 0.55, bounce: 0.5 }) // overshoot ≈ 16%
const FOLD = /* @__PURE__ */ spring({ duration: 0.32, bounce: 0 }) // no overshoot: it would cut into the title

interface Fold {
  p: Channel // 0 = closed, 1 = open
  from: number // px, border-box height when closed
  to: number // px, border-box height when open
  kids: HTMLElement[]
  anims: Animation[]
  done: (() => void) | null
}

const folds = new WeakMap<HTMLElement, Fold>()

export const isFolding = (el: Element) => folds.has(el as HTMLElement)

const px = (v: string) => parseFloat(v) || 0

/** Height of a closed <details>: the summary plus the details' own padding and border. */
function closedHeight(d: HTMLDetailsElement, summary: HTMLElement): number {
  const c = getComputedStyle(d)
  const s = getComputedStyle(summary)
  return (
    summary.offsetHeight + px(s.marginTop) + px(s.marginBottom) +
    px(c.paddingTop) + px(c.paddingBottom) + px(c.borderTopWidth) + px(c.borderBottomWidth)
  )
}

const summaryOf = (d: HTMLDetailsElement) =>
  Array.from(d.children).find((c) => c.tagName === 'SUMMARY') as HTMLElement | undefined

const kidsOf = (el: HTMLElement, skip?: Element) =>
  Array.from(el.children).filter((c): c is HTMLElement => c !== skip && c instanceof HTMLElement && !c.hasAttribute('data-jello-dent'))

function play(el: HTMLElement, f: Fold) {
  const t = now()
  for (const a of f.anims) a.cancel()
  const end = Math.min(t + MAX_PLAN, f.p.settledAt())
  const count = Math.max(1, Math.ceil((end - t) * FPS))
  const drop = Math.min(28, Math.max(0, f.to - f.from) * 0.35)
  const box: Keyframe[] = []
  const kid: Keyframe[] = []
  for (let i = 0; i <= count; i++) {
    const ts = t + ((end - t) * i) / count
    let p = i === count && end < t + MAX_PLAN ? f.p.target : f.p.at(ts)[0]
    p = Math.max(0, p) // never shorter than closed: that would cut into the title
    // ...and never negative: the spring overshoots its target, so shrinking to a
    // small height takes the curve below zero. CSS rejects the length and the
    // browser drops the whole keyframe, leaving the animation broken.
    const h = Math.max(0, f.from + (f.to - f.from) * p)
    box.push({ height: `${h.toFixed(2)}px`, overflow: 'hidden', boxSizing: 'border-box' })
    kid.push({ translate: `0 ${(-drop * (1 - p)).toFixed(2)}px`, opacity: Number(Math.min(1, p / 0.35).toFixed(3)) })
  }
  const opts: KeyframeAnimationOptions = { duration: Math.max(1, (end - t) * 1000), easing: 'linear', fill: 'both' }
  const main = el.animate(box, opts)
  f.anims = [main, ...f.kids.map((k) => k.animate(kid, opts))]
  for (const a of f.anims) a.startTime = t * 1000
  main.onfinish = () => {
    if (folds.get(el) !== f || f.anims[0] !== main) return
    for (const a of f.anims) a.cancel()
    folds.delete(el)
    f.done?.()
  }
}

function start(el: HTMLElement, from: number, to: number, kids: HTMLElement[]): Fold {
  const f: Fold = { p: new Channel(DROP, 1e-3, 1e-2), from, to, kids, anims: [], done: null }
  folds.set(el, f)
  return f
}

/* ------------------------------------------------------------- <details> */

/** Close the other open members of a `name` group with an animation instead of instantly. */
function closeGroup(d: HTMLDetailsElement) {
  const name = d.getAttribute('name')
  if (!name) return
  const root = d.getRootNode() as Document | ShadowRoot
  for (const other of Array.from(root.querySelectorAll<HTMLDetailsElement>('details[open]'))) {
    if (other === d || other.getAttribute('name') !== name) continue
    other.removeAttribute('name') // so opening `d` doesn't snap it shut
    closeDetails(other, () => other.setAttribute('name', name))
  }
}

export function openDetails(d: HTMLDetailsElement) {
  const summary = summaryOf(d)
  if (!summary) {
    d.open = true
    return
  }
  let f = folds.get(d)
  if (!f) {
    const from = d.open ? closedHeight(d, summary) : d.offsetHeight
    closeGroup(d)
    f = start(d, from, 0, kidsOf(d, summary))
    d.open = true
  } else {
    for (const a of f.anims) a.cancel() // measure the natural height below
  }
  f.to = d.offsetHeight
  f.done = null
  f.p.to(now(), 1, DROP)
  play(d, f)
}

export function closeDetails(d: HTMLDetailsElement, after?: () => void) {
  const summary = summaryOf(d)
  if (!summary || prefersReducedMotion()) {
    d.open = false
    after?.()
    return
  }
  let f = folds.get(d)
  if (!f) {
    f = start(d, closedHeight(d, summary), d.offsetHeight, kidsOf(d, summary))
    f.p.jump(now(), 1)
  }
  f.done = () => {
    d.open = false
    after?.()
  }
  f.p.to(now(), 0, FOLD)
  play(d, f)
}

/** Summary clicked: open or close with the animation. */
export function toggleDetails(d: HTMLDetailsElement) {
  const f = folds.get(d)
  const closing = f ? f.p.target === 1 : d.open
  if (closing) closeDetails(d)
  else openDetails(d)
}

/** `open` was set by code, not by a click: drop it open from its closed height. */
export function openedByCode(d: HTMLDetailsElement) {
  if (folds.has(d)) return
  if (prefersReducedMotion()) return fadeIn(kidsOf(d, summaryOf(d)))
  const summary = summaryOf(d)
  if (!summary) return
  const f = start(d, closedHeight(d, summary), d.offsetHeight, kidsOf(d, summary))
  f.p.to(now(), 1, DROP)
  play(d, f)
}

/* --------------------------------------------- ARIA disclosure (aria-controls) */

/** A panel that just became visible (its button got aria-expanded="true"). */
export function dropOpen(panel: HTMLElement) {
  if (!panel.offsetHeight && !panel.getClientRects().length) return // still hidden
  if (prefersReducedMotion()) return fadeIn(kidsOf(panel))
  const old = folds.get(panel)
  if (old) for (const a of old.anims) a.cancel()
  const f = start(panel, 0, panel.offsetHeight, kidsOf(panel))
  if (old) f.p = old.p
  f.p.to(now(), 1, DROP)
  play(panel, f)
}

function fadeIn(kids: HTMLElement[]) {
  for (const k of kids) k.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: 'ease-out' })
}

/* ------------------------------------------- list height (data-jello-height) */

const HEIGHT = '[data-jello-height]'

/**
 * A container's natural height from *before* its last child change: a
 * MutationObserver callback runs after the DOM is already updated, so
 * measuring there gives the new height, not the one to spring from.
 *
 * ponytail: goes stale if something else reflows the container between two
 * child changes (a resize, a late webfont). A ResizeObserver would notice, but
 * it also fires for the height animation below, so it needs the same "only
 * when settled" guard this does — more moving parts for the same answer.
 */
const natural = new WeakMap<HTMLElement, number>()

/** Measure the containers in `root` so their first child change has a height to spring from. */
export function seedHeights(root: Document | Element) {
  const els = Array.from(root.querySelectorAll<HTMLElement>(HEIGHT))
  if (root instanceof HTMLElement && root.matches(HEIGHT)) els.push(root)
  for (const el of els) if (!natural.has(el)) natural.set(el, el.offsetHeight)
}

/**
 * Children were added to or removed from `parent`: spring its height from the
 * one it had to the one it has now, with the accordion's spring. Other
 * mutations pass straight through.
 */
export function heightChanged(parent: Node) {
  if (!(parent instanceof HTMLElement) || !parent.matches(HEIGHT)) return
  const t = now()
  const old = folds.get(parent)
  // Mid-animation: carry on from the height on screen, and cancel before
  // measuring — our own `height` keyframes are layout and would read back as
  // the natural height.
  const from = old
    ? old.from + (old.to - old.from) * Math.max(0, old.p.at(t)[0])
    : (natural.get(parent) ?? parent.offsetHeight)
  if (old) for (const a of old.anims) a.cancel()
  const to = parent.offsetHeight
  natural.set(parent, to)
  if (to === from || prefersReducedMotion()) {
    folds.delete(parent)
    return
  }
  // No kids: they are already in place, only the box grows. An inserted child
  // springs in on its own with [data-jello-enter].
  const f = start(parent, from, to, [])
  f.done = () => natural.set(parent, parent.offsetHeight) // content may have reflowed on the way
  f.p.to(t, 1, DROP)
  play(parent, f)
}
