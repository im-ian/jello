import { settleTime, solve, spring, type Spring, type SpringConfig } from './spring'

export interface SpringEasing {
  /** A CSS `linear()` easing that traces the spring's step response. */
  easing: string
  /** How long the transition/animation must run, in ms. */
  duration: number
  /** `"<duration>ms linear(…)"`, ready for a `transition` shorthand. */
  toString(): string
}

/**
 * Bake a spring into a CSS easing, for places where JS isn't wanted:
 *
 *   const e = springEasing({ duration: 0.5, bounce: 0.4 })
 *   el.style.transition = `scale ${e}`
 *
 * `linear()` has been Baseline since December 2023. Unlike the JS springs, a
 * CSS transition can't carry velocity into an interruption.
 *
 * @param tolerance max vertical error (in progress units) when dropping points
 */
export function springEasing(config: SpringConfig | Spring = {}, tolerance = 0.002): SpringEasing {
  const s = 'omega' in config ? config : spring(config)
  const T = Math.max(settleTime(s, -1, 0, 1e-3, 1e-2, 5), 0.001)
  const N = 240
  const pts: Array<[number, number]> = []
  for (let i = 0; i <= N; i++) pts.push([i / N, 1 + solve(s, -1, 0, (T * i) / N)[0]])
  pts[N] = [1, 1]
  const kept = simplify(pts, tolerance)
  const last = kept.length - 1
  const stops = kept.map(([x, y], i) =>
    i === 0 ? '0' : i === last ? '1' : `${fmt(y, 4)} ${fmt(x * 100, 2)}%`,
  )
  const easing = `linear(${stops.join(', ')})`
  const duration = Math.round(T * 1000)
  return { easing, duration, toString: () => `${duration}ms ${easing}` }
}

const fmt = (n: number, d: number) => String(Number(n.toFixed(d)))

/** Ramer–Douglas–Peucker on vertical distance (error in output value at a given time). */
function simplify(pts: Array<[number, number]>, tol: number) {
  const keep = new Uint8Array(pts.length)
  keep[0] = keep[pts.length - 1] = 1
  const stack: Array<[number, number]> = [[0, pts.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    const [x1, y1] = pts[a]!
    const [x2, y2] = pts[b]!
    let max = 0
    let at = -1
    for (let i = a + 1; i < b; i++) {
      const [x, y] = pts[i]!
      const d = Math.abs(y - (y1 + ((y2 - y1) * (x - x1)) / (x2 - x1)))
      if (d > max) {
        max = d
        at = i
      }
    }
    if (max > tol) {
      keep[at] = 1
      stack.push([a, at], [at, b])
    }
  }
  return pts.filter((_, i) => keep[i])
}
