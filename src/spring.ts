/**
 * Analytical damped harmonic oscillator.
 *
 * Everything in jello is built on this closed-form solution instead of
 * per-frame numerical integration, so the state of a spring can be read at any
 * time `t` exactly. That is what lets a whole trajectory be pre-computed into
 * Web Animations keyframes (compositor thread) and still be interrupted later
 * with the exact position and velocity it had at that moment.
 *
 * Convention: `x` is the displacement from the target (position − target),
 * `v` its velocity. Units are whatever the caller uses (px, deg, scale…).
 */

/** SwiftUI-style parameters (WWDC23 "Animate with springs"). */
export interface DurationBounce {
  /** Perceptual duration in seconds — the pace of the spring, not its settling time. @default 0.5 */
  duration?: number
  /**
   * How bouncy the spring is, in (-1, 1).
   * `0` = critically damped (no overshoot), `0.5` = clearly bouncy,
   * negative = overdamped (slower settle, no overshoot). @default 0
   */
  bounce?: number
}

/** Classic physical parameters, for people who think in stiffness/damping. */
export interface Physical {
  stiffness: number
  damping: number
  /** @default 1 */
  mass?: number
}

export type SpringConfig = DurationBounce | Physical

/** A spring reduced to its two essentials. */
export interface Spring {
  /** Natural (undamped) angular frequency ω₀, rad/s. */
  readonly omega: number
  /** Damping ratio ζ. <1 bounces, =1 critical, >1 overdamped. */
  readonly zeta: number
}

const TAU = Math.PI * 2
const CRITICAL_BAND = 1e-6

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/**
 * Normalise any spring config.
 *
 * duration/bounce → ω₀ = 2π / duration, ζ = 1 − bounce (bounce ≥ 0) or
 * 1 / (1 + bounce) (bounce < 0). With mass = 1 this is exactly
 * stiffness = (2π / duration)² and damping = 2ζω₀, the conversion Apple
 * documents for SwiftUI springs.
 */
export function spring(config: SpringConfig = {}): Spring {
  if ('stiffness' in config) {
    const m = config.mass ?? 1
    const k = config.stiffness
    const c = config.damping
    if (!(k > 0) || !(m > 0) || !(c >= 0)) {
      throw new RangeError('jello: stiffness and mass must be > 0 and damping >= 0')
    }
    return { omega: Math.sqrt(k / m), zeta: c / (2 * Math.sqrt(k * m)) }
  }
  const duration = config.duration ?? 0.5
  if (!(duration > 0)) throw new RangeError('jello: duration must be > 0')
  // ±1 would mean an undamped (never settling) or infinitely overdamped spring.
  const bounce = clamp(config.bounce ?? 0, -0.95, 0.95)
  return { omega: TAU / duration, zeta: bounce >= 0 ? 1 - bounce : 1 / (1 + bounce) }
}

/** Displacement and velocity `t` seconds after starting at `x0` with velocity `v0`. */
export function solve(s: Spring, x0: number, v0: number, t: number): [x: number, v: number] {
  if (t <= 0) return [x0, v0]
  const w = s.omega
  const z = s.zeta

  if (Math.abs(z - 1) < CRITICAL_BAND) {
    const e = Math.exp(-w * t)
    const c = v0 + w * x0
    return [e * (x0 + c * t), e * (v0 - w * c * t)]
  }

  if (z < 1) {
    const a = z * w
    const wd = w * Math.sqrt(1 - z * z)
    const e = Math.exp(-a * t)
    const cos = Math.cos(wd * t)
    const sin = Math.sin(wd * t)
    const b = (v0 + a * x0) / wd
    return [e * (x0 * cos + b * sin), e * ((b * wd - a * x0) * cos - (x0 * wd + a * b) * sin)]
  }

  const r = w * Math.sqrt(z * z - 1)
  const r1 = -z * w + r // slow root
  const r2 = -z * w - r // fast root
  const c2 = (v0 - r1 * x0) / (r2 - r1)
  const c1 = x0 - c2
  const e1 = Math.exp(r1 * t)
  const e2 = Math.exp(r2 * t)
  return [c1 * e1 + c2 * e2, c1 * r1 * e1 + c2 * r2 * e2]
}

/**
 * Time (s) after which |x| < eps and |v| < epsV forever.
 *
 * Works on an upper bound of |x| and |v| that only ever decreases (after its
 * peak), so the answer is never too early and needs no scanning of the curve:
 * closed form for bouncy springs, a short bisection otherwise.
 */
export function settleTime(
  s: Spring,
  x0: number,
  v0: number,
  eps: number,
  epsV: number,
  max = 10,
): number {
  const ax = Math.abs(x0)
  const av = Math.abs(v0)
  if (ax < eps && av < epsV) return 0
  const w = s.omega
  const z = s.zeta
  if (z <= 0) return max

  if (z < 1 && Math.abs(z - 1) >= CRITICAL_BAND) {
    // |x| ≤ A·e^{−ζω₀t}, |v| ≤ V·e^{−ζω₀t}
    const a = z * w
    const wd = w * Math.sqrt(1 - z * z)
    const b = (v0 + a * x0) / wd
    const A = Math.hypot(x0, b)
    const V = Math.hypot(b * wd - a * x0, x0 * wd + a * b)
    return Math.min(max, Math.max(Math.log(A / eps), Math.log(V / epsV), 0) / a)
  }

  if (Math.abs(z - 1) < CRITICAL_BAND) {
    // |x| ≤ e^{−ω₀t}(|x0| + |c|t), |v| ≤ e^{−ω₀t}(|v0| + ω₀|c|t): rise, then fall
    const c = Math.abs(v0 + w * x0)
    const peak = (a: number, b: number) => (b > 0 ? Math.max(0, 1 / w - a / b) : 0)
    const tx = cross((t) => Math.exp(-w * t) * (ax + c * t), eps, peak(ax, c), max)
    const tv = cross((t) => Math.exp(-w * t) * (av + w * c * t), epsV, peak(av, w * c), max)
    return Math.max(tx, tv)
  }

  // overdamped: |x| ≤ |c1|e^{r1t} + |c2|e^{r2t}, decreasing from t = 0
  const r = w * Math.sqrt(z * z - 1)
  const r1 = -z * w + r
  const r2 = -z * w - r
  const c2 = (v0 - r1 * x0) / (r2 - r1)
  const c1 = x0 - c2
  const tx = cross((t) => Math.abs(c1) * Math.exp(r1 * t) + Math.abs(c2) * Math.exp(r2 * t), eps, 0, max)
  const tv = cross(
    (t) => Math.abs(c1 * r1) * Math.exp(r1 * t) + Math.abs(c2 * r2) * Math.exp(r2 * t),
    epsV,
    0,
    max,
  )
  return Math.max(tx, tv)
}

/** First t ≥ from where f(t) < eps, for f decreasing on [from, max] (f(from) is its maximum). */
function cross(f: (t: number) => number, eps: number, from: number, max: number): number {
  if (f(from) < eps) return 0
  if (f(max) >= eps) return max
  let lo = from
  let hi = max
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2
    if (f(mid) < eps) hi = mid
    else lo = mid
  }
  return hi
}

/**
 * Peak |x| reached when a spring at rest receives a unit velocity kick.
 * Lets effects be specified as "move 8px" instead of "add 290px/s".
 */
export function peakPerVelocity(s: Spring): number {
  const w = s.omega
  const z = s.zeta
  if (Math.abs(z - 1) < CRITICAL_BAND) return 1 / (Math.E * w)
  if (z < 1) {
    const a = z * w
    const wd = w * Math.sqrt(1 - z * z)
    const tp = Math.atan2(wd, a) / wd
    return (Math.exp(-a * tp) * Math.sin(wd * tp)) / wd
  }
  const r = w * Math.sqrt(z * z - 1)
  const r1 = -z * w + r
  const r2 = -z * w - r
  const tp = Math.log(r1 / r2) / (r2 - r1)
  return (Math.exp(r1 * tp) - Math.exp(r2 * tp)) / (r1 - r2)
}

/** Velocity kick that makes a resting spring's first peak reach `amplitude`. */
export function impulse(s: Spring, amplitude: number): number {
  return amplitude / peakPerVelocity(s)
}

/** For a bouncy spring kicked from rest: when it first comes back through zero. */
export function returnTime(s: Spring): number {
  const z = Math.min(s.zeta, 0.999)
  return Math.PI / (s.omega * Math.sqrt(1 - z * z))
}
