import { config, now } from './config'
import { settleTime, solve, spring, type Spring } from './spring'

/**
 * Every visual change jello makes is one of six springs ("channels"), all at
 * rest at 0. They are combined into the three individual transform properties
 * (`scale`, `rotate`, `translate`), so the element's own `transform` is never
 * touched — browsers apply the individual properties first and `transform`
 * last.
 *
 *   shrink  how far the element is pushed in        scale × (1 − shrink)
 *   grow    pop / appear                            scale × (1 + grow)
 *   squash  squash (−) / stretch (+), area kept     scaleY × (1 + q), scaleX ÷ (1 + q)
 *   tilt    lean toward the press point             rotate (deg)
 *   x, y    shake, hop                              translate (px)
 *
 * Pivot: the deformation (shrink/grow/squash/tilt) happens around a point the
 * caller picks — usually where the finger is. CSS can only pivot around
 * `transform-origin`, so instead of changing it (which would jump, and fight
 * the page's own styles) the offset is folded into `translate`:
 *
 *   scaling by M around P  ≡  scaling by M around O, then moving by (I − M)(P − O)
 */
export type ChannelName = 'shrink' | 'grow' | 'squash' | 'tilt' | 'x' | 'y'
/** Channel values at one instant, plus the pivot (px, relative to transform-origin). */
export type Values = Record<ChannelName, number> & { px: number; py: number }

const NAMES: readonly ChannelName[] = ['shrink', 'grow', 'squash', 'tilt', 'x', 'y']

// [position ε, velocity ε] in each channel's own unit — below this nobody can see it move.
const PRECISION: Record<ChannelName, readonly [number, number]> = {
  shrink: [2e-4, 2e-3],
  grow: [2e-4, 2e-3],
  squash: [2e-4, 2e-3],
  tilt: [0.02, 0.2],
  x: [0.05, 0.5],
  y: [0.05, 0.5],
}

/** Longest trajectory ever planned, in seconds. */
export const MAX_PLAN = 4
/** Keyframes per second when baking a trajectory for the Web Animations API. */
export const FPS = 60
const DEFAULT_SPRING = spring({ duration: 0.5 })

/** One spring-driven number with an exact, interruptible trajectory. */
export class Channel {
  target = 0
  x0 = 0
  v0 = 0
  t0 = 0
  constructor(
    public s: Spring,
    readonly eps: number,
    readonly epsV: number,
  ) {}

  at(t: number): [number, number] {
    const [x, v] = solve(this.s, this.x0, this.v0, t - this.t0)
    return [this.target + x, v]
  }

  private reseed(t: number, target: number, dx: number, dv: number, s?: Spring) {
    const [p, v] = this.at(t)
    this.target = target
    this.x0 = p + dx - target
    this.v0 = v + dv
    this.t0 = t
    if (s) this.s = s
  }

  /** Retarget, keeping the current position and velocity (no jump, no stall). */
  to(t: number, target: number, s?: Spring) {
    this.reseed(t, target, 0, 0, s)
  }

  /** Add velocity, e.g. a flick. Position stays continuous. */
  kick(t: number, dv: number, s?: Spring) {
    this.reseed(t, this.target, 0, dv, s)
  }

  /** Offset the position, keep the velocity (used to hide a pivot change). */
  shift(t: number, dx: number) {
    this.reseed(t, this.target, dx, 0)
  }

  /** Teleport (used for "appear from 0"). */
  jump(t: number, value: number) {
    this.x0 = value - this.target
    this.v0 = 0
    this.t0 = t
  }

  settledAt(): number {
    return this.t0 + settleTime(this.s, this.x0, this.v0, this.eps, this.epsV, MAX_PLAN)
  }

  copy(): Channel {
    const c = new Channel(this.s, this.eps, this.epsV)
    c.target = this.target
    c.x0 = this.x0
    c.v0 = this.v0
    c.t0 = this.t0
    return c
  }
}

/* ------------------------------------------------------------ 2×2 matrices */

/** Row-major 2×2: [m11, m12, m21, m22]. */
type Mat = readonly [number, number, number, number]

/** rotate(deg) · scale(sx, sy) — the order CSS applies the individual properties. */
function mat(deg: number, sx: number, sy: number): Mat {
  const r = (deg * Math.PI) / 180
  const c = Math.cos(r)
  const s = Math.sin(r)
  return [c * sx, -s * sy, s * sx, c * sy]
}

/** Our own deformation (no base styles). */
function ours(v: Values): Mat {
  const s = (1 - v.shrink) * (1 + v.grow)
  const q = 1 + Math.max(v.squash, -0.8)
  return mat(v.tilt, s / q, s * q)
}

/** Base linear part as [rotateDeg, sx, sy]. */
type Lin = readonly [number, number, number]

/** Extra translation that makes `M` act around the pivot: Mb · (I − M) · d. */
function pivotOffset(m: Mat, base: Lin, dx: number, dy: number): [number, number] {
  if (!dx && !dy) return [0, 0]
  const ux = dx - (m[0] * dx + m[1] * dy)
  const uy = dy - (m[2] * dx + m[3] * dy)
  const b = mat(base[0], base[1], base[2])
  return [b[0] * ux + b[1] * uy, b[2] * ux + b[3] * uy]
}

/* ------------------------------------------------------------------ state */

/** What an interaction or effect gets to work with. Pure: no DOM access. */
export interface Ctx {
  readonly t: number
  value(name: ChannelName): number
  to(name: ChannelName, target: number, s?: Spring): void
  kick(name: ChannelName, dv: number, s?: Spring): void
  jump(name: ChannelName, value: number): void
  /**
   * Deform around this point (px from the element's transform-origin).
   * Changing it mid-motion is seamless: the difference goes into x/y and springs away.
   */
  pivot(dx: number, dy: number): void
  /** Run `fn` `delay` seconds from now — baked into the same plan, no timers. */
  later(delay: number, fn: (c: Ctx) => void, tag?: string): void
  /** Drop scheduled steps with this tag (e.g. a pending auto-release). */
  cancel(tag: string): void
}

interface Step {
  at: number
  run: (c: Ctx) => void
  tag?: string | undefined
}

interface State {
  ch: Record<ChannelName, Channel>
  queue: Step[]
  pivot: [number, number]
  /** The element's own rotate/scale, for exact pivot compensation. */
  base: Lin
}

function newState(): State {
  const ch = {} as Record<ChannelName, Channel>
  for (const n of NAMES) ch[n] = new Channel(DEFAULT_SPRING, PRECISION[n][0], PRECISION[n][1])
  return { ch, queue: [], pivot: [0, 0], base: [0, 1, 1] }
}

function cloneState(st: State): State {
  const ch = {} as Record<ChannelName, Channel>
  for (const n of NAMES) ch[n] = st.ch[n].copy()
  return { ch, queue: st.queue.slice(), pivot: [st.pivot[0], st.pivot[1]], base: st.base }
}

function values(st: State, t: number): Values {
  const v = { px: st.pivot[0], py: st.pivot[1] } as Values
  for (const n of NAMES) v[n] = st.ch[n].at(t)[0]
  return v
}

function ctx(st: State, t: number): Ctx {
  return {
    t,
    value: (n) => st.ch[n].at(t)[0],
    to: (n, target, s) => st.ch[n].to(t, target, s),
    kick: (n, dv, s) => st.ch[n].kick(t, dv, s),
    jump: (n, v) => st.ch[n].jump(t, v),
    pivot(dx, dy) {
      const [ox, oy] = st.pivot
      if (ox === dx && oy === dy) return
      // What's on screen now must not move: put the change of pivot offset into x/y.
      const m = ours(values(st, t))
      const [ax, ay] = pivotOffset(m, st.base, ox, oy)
      const [bx, by] = pivotOffset(m, st.base, dx, dy)
      st.ch.x.shift(t, ax - bx)
      st.ch.y.shift(t, ay - by)
      st.pivot = [dx, dy]
    },
    later(delay, run, tag) {
      const step: Step = { at: t + Math.max(0, delay), run, tag }
      const i = st.queue.findIndex((s) => s.at > step.at)
      st.queue.splice(i < 0 ? st.queue.length : i, 0, step)
    },
    cancel(tag) {
      st.queue = st.queue.filter((s) => s.tag !== tag)
    },
  }
}

/** Apply every scheduled step due by `t`, each at its own exact time. */
function advance(st: State, t: number) {
  for (let guard = 0; st.queue.length && st.queue[0]!.at <= t && guard < 256; guard++) {
    const step = st.queue.shift()!
    step.run(ctx(st, step.at))
  }
}

function isRest(st: State, t: number): boolean {
  if (st.queue.length) return false
  return NAMES.every((n) => st.ch[n].target === 0 && t >= st.ch[n].settledAt())
}

/** Simulate forward from `t`: when does everything settle, and what happens on the way. */
function plan(st: State, t: number): { end: number; frames: Values[] } {
  const probe = cloneState(st)
  let end = t
  for (let guard = 0; probe.queue.length && guard < 256; guard++) {
    end = probe.queue[0]!.at
    advance(probe, end)
  }
  for (const n of NAMES) end = Math.max(end, probe.ch[n].settledAt())
  end = Math.min(end, t + MAX_PLAN)

  const sim = cloneState(st)
  const count = Math.max(1, Math.ceil((end - t) * FPS))
  const frames: Values[] = []
  for (let i = 0; i <= count; i++) {
    const ts = t + ((end - t) * i) / count
    advance(sim, ts)
    frames.push(values(sim, ts))
  }
  // Settled (not cut off by MAX_PLAN): land exactly on the targets, not ε away.
  if (end < t + MAX_PLAN) {
    const last = frames[count]!
    for (const n of NAMES) last[n] = sim.ch[n].target
  }
  return { end, frames }
}

/* ------------------------------------------------------------------ styles */

type Group = 'scale' | 'rotate' | 'translate'
const GROUPS: readonly Group[] = ['scale', 'rotate', 'translate']
type Len = number | string

/** The element's own individual-transform values, so jello multiplies/adds on top instead of replacing them. */
interface Base {
  sx: number
  sy: number
  /** NaN when the element has a 3D rotation we can't add a 2D tilt to — tilt is skipped then. */
  r: number
  tx: Len
  ty: Len
  tz: string
}

const NO_BASE: Base = { sx: 1, sy: 1, r: 0, tx: 0, ty: 0, tz: '' }
const PX = /^-?\d*\.?\d+(e[-+]?\d+)?px$/i

function readBase(el: Element): Base {
  if (typeof getComputedStyle !== 'function') return NO_BASE
  const cs = getComputedStyle(el)
  const b = { ...NO_BASE }
  const scale = cs.getPropertyValue('scale').trim()
  if (scale && scale !== 'none') {
    const [sx = 1, sy = sx] = scale.split(/\s+/).map(Number)
    b.sx = Number.isFinite(sx) ? sx : 1
    b.sy = Number.isFinite(sy) ? sy : 1
  }
  const rotate = cs.getPropertyValue('rotate').trim()
  if (rotate && rotate !== 'none') {
    const m = /^(-?\d*\.?\d+(?:e[-+]?\d+)?)(deg|rad|turn|grad)$/i.exec(rotate)
    const unit = m?.[2]?.toLowerCase()
    const n = m ? Number(m[1]) : NaN
    b.r = unit === 'rad' ? (n * 180) / Math.PI : unit === 'turn' ? n * 360 : unit === 'grad' ? n * 0.9 : n
  }
  const translate = cs.getPropertyValue('translate').trim()
  if (translate && translate !== 'none') {
    const parts = translate.split(/\s+(?![^(]*\))/)
    const len = (p: string | undefined): Len => (!p ? 0 : PX.test(p) ? parseFloat(p) : p)
    b.tx = len(parts[0])
    b.ty = len(parts[1])
    b.tz = parts[2] ?? ''
  }
  return b
}

const round = (n: number, d: number) => {
  const r = Number(n.toFixed(d))
  return r === 0 ? 0 : r // no "-0"
}
const offset = (base: Len, d: number) =>
  typeof base === 'number' ? `${round(base + d, 2)}px` : `calc(${base} + ${round(d, 2)}px)`

const linOf = (b: Base): Lin => [Number.isNaN(b.r) ? 0 : b.r, b.sx, b.sy]

/** Total translation jello adds: its own x/y plus the pivot offset. */
function moveOf(v: Values, b: Base): [number, number] {
  const [px, py] = pivotOffset(ours(v), linOf(b), v.px, v.py)
  return [v.x + px, v.y + py]
}

function toKeyframe(v: Values, b: Base, groups: ReadonlySet<Group>): Keyframe {
  const k: Keyframe = {}
  if (groups.has('scale')) {
    const s = (1 - v.shrink) * (1 + v.grow)
    const q = 1 + Math.max(v.squash, -0.8)
    k.scale = `${round((s / q) * b.sx, 4)} ${round(s * q * b.sy, 4)}`
  }
  if (groups.has('rotate')) k.rotate = `${round(v.tilt + b.r, 3)}deg`
  if (groups.has('translate')) {
    const [x, y] = moveOf(v, b)
    k.translate = `${offset(b.tx, x)} ${offset(b.ty, y)}${b.tz ? ` ${b.tz}` : ''}`
  }
  return k
}

/** Only animate properties that actually move — fewer properties, less to override. */
function usedGroups(frames: Values[], b: Base): Set<Group> {
  const g = new Set<Group>()
  for (const v of frames) {
    if (Math.abs(v.shrink) > 1e-5 || Math.abs(v.grow) > 1e-5 || Math.abs(v.squash) > 1e-5) g.add('scale')
    if (Math.abs(v.tilt) > 1e-4 && !Number.isNaN(b.r)) g.add('rotate')
    if (!g.has('translate')) {
      const [x, y] = moveOf(v, b)
      if (Math.abs(x) > 1e-3 || Math.abs(y) > 1e-3) g.add('translate')
    }
  }
  return g
}

/* ------------------------------------------------------------------ motion */

export type JelloElement = HTMLElement | SVGElement

/**
 * Owns the springs of one element and renders them.
 *
 * WAAPI driver: on every change the whole future trajectory is simulated
 * (analytically, so it is exact) and handed to `element.animate()` as
 * keyframes. Nothing runs per frame in JS, so the browser can keep the motion
 * going on the compositor even while the main thread is busy handling the
 * very click that started it.
 */
export class Motion {
  /** Per-element override of the global `driver` setting (e.g. for side-by-side comparisons). */
  driver: 'waapi' | 'raf' | undefined

  private st = newState()
  private anim: Animation | null = null
  private base: Base = NO_BASE
  private raf = 0
  private rafEnd = 0
  private groups: Set<Group> = new Set()
  private saved: Record<Group, string> | null = null

  constructor(readonly el: JelloElement) {}

  update(fn: (c: Ctx) => void): void {
    const t = now()
    advance(this.st, t)
    if (this.idle() || isRest(this.st, t)) {
      // Nothing is moving: a fresh start, so read the element's own styles again
      // and forget the old pivot.
      this.base = readBase(this.el)
      this.st.base = linOf(this.base)
      this.st.pivot = [0, 0]
    }
    fn(ctx(this.st, t))
    this.render(t)
  }

  /** Current value of a channel (handy for tests and debugging). */
  value(name: ChannelName): number {
    const t = now()
    advance(this.st, t)
    return this.st.ch[name].at(t)[0]
  }

  private idle() {
    return !this.anim && !this.raf && !this.saved
  }

  private render(t: number) {
    const wanted = this.driver ?? config.driver
    const driver = wanted === 'auto' ? (typeof this.el.animate === 'function' ? 'waapi' : 'raf') : wanted
    const { end, frames } = plan(this.st, t)
    const groups = usedGroups(frames, this.base)
    if (driver === 'raf') this.renderRaf(end, groups)
    else this.renderWaapi(t, end, frames, groups)
  }

  private renderWaapi(t: number, end: number, frames: Values[], groups: Set<Group>) {
    if (this.raf) {
      cancelAnimationFrame(this.raf)
      this.raf = 0
    }
    if (this.saved) {
      for (const g of GROUPS) this.el.style[g] = this.saved[g]
      this.saved = null
    }
    const old = this.anim
    this.anim = null
    if (groups.size) {
      const a = this.el.animate(
        frames.map((v) => toKeyframe(v, this.base, groups)),
        { duration: Math.max(1, (end - t) * 1000), easing: 'linear', fill: 'both' },
      )
      // Pin the animation to the moment the springs were seeded, so what's on
      // screen and the model never drift apart (fill: 'both' covers the gap
      // until the next frame).
      a.startTime = t * 1000
      a.onfinish = () => {
        if (this.anim === a) this.settle()
      }
      this.anim = a
    }
    old?.cancel()
  }

  private settle() {
    const t = now()
    advance(this.st, t)
    if (!isRest(this.st, t)) {
      // A step was due (e.g. scheduled release) or a held target: keep going.
      if (this.st.queue.length) this.render(t)
      return
    }
    this.anim?.cancel()
    this.anim = null
  }

  private renderRaf(end: number, groups: Set<Group>) {
    this.anim?.cancel()
    this.anim = null
    if (!this.saved) {
      const s = this.el.style
      this.saved = { scale: s.scale, rotate: s.rotate, translate: s.translate }
    }
    this.rafEnd = end
    this.groups = groups
    if (!this.raf) this.raf = requestAnimationFrame(this.tick)
  }

  private tick = (ms: number) => {
    const t = Math.max(ms / 1000, 0)
    advance(this.st, t)
    const k = toKeyframe(values(this.st, t), this.base, this.groups)
    const s = this.el.style
    const saved = this.saved!
    for (const g of GROUPS) s[g] = (k[g] as string | undefined) ?? saved[g]
    if (t < this.rafEnd || this.st.queue.length) {
      this.raf = requestAnimationFrame(this.tick)
      return
    }
    this.raf = 0
    if (isRest(this.st, t)) {
      for (const g of GROUPS) s[g] = saved[g]
      this.saved = null
    }
  }
}

const motions = new WeakMap<Element, Motion>()

/**
 * The springs of an element (created on first use). Also the extension point
 * for custom effects:
 *
 *   motionFor(el).update(c => c.kick('tilt', 120, spring({ bounce: 0.7 })))
 */
export function motionFor(el: JelloElement): Motion {
  let m = motions.get(el)
  if (!m) motions.set(el, (m = new Motion(el)))
  return m
}

export function existingMotion(el: Element): Motion | undefined {
  return motions.get(el)
}
