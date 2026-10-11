import { describe, expect, it } from 'vitest'
import { springEasing } from '../src/css'
import { solve, spring } from '../src/spring'

/** Evaluate a `linear()` easing the way the CSS spec does (piecewise linear). */
function evalLinear(easing: string, p: number): number {
  const body = easing.slice('linear('.length, -1)
  const raw = body.split(',').map((s) => s.trim().split(/\s+/))
  const stops = raw.map(([v, pos], i) => ({
    v: Number(v),
    x: pos ? parseFloat(pos) / 100 : i === 0 ? 0 : 1,
  }))
  for (let i = 1; i < stops.length; i++) {
    const a = stops[i - 1]!
    const b = stops[i]!
    if (p <= b.x) return a.v + ((b.v - a.v) * (p - a.x)) / (b.x - a.x || 1)
  }
  return stops[stops.length - 1]!.v
}

describe('springEasing', () => {
  it('produces a valid linear() with increasing stops', () => {
    const { easing, duration } = springEasing({ duration: 0.5, bounce: 0.5 })
    expect(easing.startsWith('linear(0, ')).toBe(true)
    expect(easing.endsWith(', 1)')).toBe(true)
    expect(duration).toBeGreaterThan(400)
    const xs = [...easing.matchAll(/ ([\d.]+)%/g)].map((m) => Number(m[1]))
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1]!)
  })

  it('reproduces the spring within the tolerance', () => {
    const cfg = { duration: 0.6, bounce: 0.6 }
    const s = spring(cfg)
    const { easing, duration } = springEasing(cfg)
    let maxErr = 0
    for (let i = 0; i <= 1000; i++) {
      const p = i / 1000
      const exact = 1 + solve(s, -1, 0, (p * duration) / 1000)[0]
      maxErr = Math.max(maxErr, Math.abs(evalLinear(easing, p) - exact))
    }
    expect(maxErr).toBeLessThan(0.004)
  })

  it('overshoots only when bouncy', () => {
    const peak = (e: string) => Math.max(...[...e.matchAll(/(?:\(|, )([\d.]+)(?= [\d.]+%)/g)].map((m) => Number(m[1])))
    expect(peak(springEasing({ bounce: 0.5 }).easing)).toBeGreaterThan(1.1)
    expect(peak(springEasing({ bounce: 0 }).easing)).toBeLessThanOrEqual(1)
  })

  it('stays compact', () => {
    const stops = springEasing({ duration: 0.55, bounce: 0.65 }).easing.split(',').length
    expect(stops).toBeLessThan(60)
  })

  it('stringifies for the transition shorthand', () => {
    expect(String(springEasing({ bounce: 0.2 }))).toMatch(/^\d+ms linear\(/)
  })
})
