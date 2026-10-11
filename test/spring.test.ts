import { describe, expect, it } from 'vitest'
import { impulse, returnTime, settleTime, solve, spring, type Spring } from '../src/spring'

/** Reference: RK4 integration of x'' = −ω²x − 2ζωx' with a tiny step. */
function rk4(s: Spring, x0: number, v0: number, t: number, dt = 1e-5): [number, number] {
  const w = s.omega
  const z = s.zeta
  const acc = (x: number, v: number) => -w * w * x - 2 * z * w * v
  let x = x0
  let v = v0
  const n = Math.round(t / dt)
  for (let i = 0; i < n; i++) {
    const k1x = v
    const k1v = acc(x, v)
    const k2x = v + (dt / 2) * k1v
    const k2v = acc(x + (dt / 2) * k1x, v + (dt / 2) * k1v)
    const k3x = v + (dt / 2) * k2v
    const k3v = acc(x + (dt / 2) * k2x, v + (dt / 2) * k2v)
    const k4x = v + dt * k3v
    const k4v = acc(x + dt * k3x, v + dt * k3v)
    x += (dt / 6) * (k1x + 2 * k2x + 2 * k3x + k4x)
    v += (dt / 6) * (k1v + 2 * k2v + 2 * k3v + k4v)
  }
  return [x, v]
}

const cases: Array<[string, Spring]> = [
  ['underdamped (bounce 0.6)', spring({ duration: 0.5, bounce: 0.6 })],
  ['critical (bounce 0)', spring({ duration: 0.4, bounce: 0 })],
  ['overdamped (bounce -0.5)', spring({ duration: 0.3, bounce: -0.5 })],
]

describe('solve', () => {
  for (const [name, s] of cases) {
    it(`matches numerical integration — ${name}`, () => {
      // an "interrupted" state: displaced and moving the other way
      for (const t of [0.03, 0.1, 0.25, 0.6]) {
        const [x, v] = solve(s, 1, -3, t)
        const [rx, rv] = rk4(s, 1, -3, t)
        expect(x).toBeCloseTo(rx, 6)
        expect(v).toBeCloseTo(rv, 5)
      }
    })

    it(`velocity is the derivative of position — ${name}`, () => {
      const h = 1e-6
      for (const t of [0.02, 0.2, 0.7]) {
        const fd = (solve(s, -0.4, 2, t + h)[0] - solve(s, -0.4, 2, t - h)[0]) / (2 * h)
        expect(solve(s, -0.4, 2, t)[1]).toBeCloseTo(fd, 4)
      }
    })
  }

  it('returns the initial state at t ≤ 0', () => {
    expect(solve(cases[0]![1], 0.3, 1.2, 0)).toEqual([0.3, 1.2])
    expect(solve(cases[0]![1], 0.3, 1.2, -1)).toEqual([0.3, 1.2])
  })
})

describe('spring() parameters', () => {
  it('duration/bounce equals the SwiftUI stiffness/damping conversion (mass 1)', () => {
    for (const [d, b] of [
      [0.5, 0.3],
      [0.35, 0],
      [0.8, 0.7],
    ] as const) {
      const a = spring({ duration: d, bounce: b })
      const stiffness = ((2 * Math.PI) / d) ** 2
      const damping = ((1 - b) * 4 * Math.PI) / d
      const p = spring({ stiffness, damping })
      expect(a.omega).toBeCloseTo(p.omega, 9)
      expect(a.zeta).toBeCloseTo(p.zeta, 9)
    }
  })

  it('negative bounce → damping 4π / (duration·(1 + bounce))', () => {
    const d = 0.5
    const b = -0.4
    const p = spring({ stiffness: ((2 * Math.PI) / d) ** 2, damping: (4 * Math.PI) / (d * (1 + b)) })
    const a = spring({ duration: d, bounce: b })
    expect(a.zeta).toBeCloseTo(p.zeta, 9)
    expect(a.zeta).toBeGreaterThan(1)
  })

  it('bounce 0 is critically damped; bounce is clamped short of ±1', () => {
    expect(spring({ bounce: 0 }).zeta).toBe(1)
    expect(spring({ bounce: 1 }).zeta).toBeCloseTo(0.05, 9)
    expect(Number.isFinite(spring({ bounce: -1 }).zeta)).toBe(true)
  })

  it('rejects nonsense', () => {
    expect(() => spring({ duration: 0 })).toThrow(RangeError)
    expect(() => spring({ stiffness: -1, damping: 1 })).toThrow(RangeError)
  })
})

describe('settleTime', () => {
  // deterministic pseudo-random
  let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)

  it('is never early (envelope bound), and not wildly late', () => {
    for (let i = 0; i < 300; i++) {
      const s = spring({ duration: 0.1 + rnd() * 0.9, bounce: rnd() * 1.6 - 0.7 })
      const x0 = (rnd() - 0.5) * 2
      const v0 = (rnd() - 0.5) * 20
      const eps = 1e-3
      const epsV = 1e-2
      const T = settleTime(s, x0, v0, eps, epsV, 30)
      // check densely after T
      for (let t = T; t < T + 2; t += 0.002) {
        const [x, v] = solve(s, x0, v0, t)
        expect(Math.abs(x)).toBeLessThan(eps)
        expect(Math.abs(v)).toBeLessThan(epsV)
      }
      // find the true last moment it was still visibly moving
      let last = 0
      for (let t = 0; t < T; t += 0.002) {
        const [x, v] = solve(s, x0, v0, t)
        if (Math.abs(x) >= eps || Math.abs(v) >= epsV) last = t
      }
      expect(T).toBeLessThan(last * 2.2 + 0.06)
    }
  })

  it('is 0 when already at rest', () => {
    expect(settleTime(cases[0]![1], 0, 0, 1e-3, 1e-2)).toBe(0)
  })
})

describe('impulse / returnTime', () => {
  for (const [name, s] of cases) {
    it(`a kick of impulse(s, A) peaks at exactly A — ${name}`, () => {
      const A = 8
      const v0 = impulse(s, A)
      let peak = 0
      for (let t = 0; t < 2; t += 1e-4) peak = Math.max(peak, solve(s, 0, v0, t)[0])
      expect(peak).toBeCloseTo(A, 3)
    })
  }

  it('returnTime is when a kicked bouncy spring comes back through 0', () => {
    const s = spring({ duration: 0.5, bounce: 0.45 })
    const v0 = impulse(s, 14)
    expect(Math.abs(solve(s, 0, v0, returnTime(s))[0])).toBeLessThan(1e-9)
  })
})
