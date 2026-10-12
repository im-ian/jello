import type { SpringConfig } from './spring'

export interface PressFeel {
  /** How much the element squashes while held (0–0.3). Wider + shorter, area preserved. */
  squash: number
  /** How much it shrinks while held (0–0.2). */
  depth: number
  /** Max degrees it leans toward the press point, reduced on wide elements so the corner never lifts far. 0 to disable. */
  tilt: number
  /** Spring used while pressing in. */
  press: SpringConfig
  /** Spring used when let go — the bounce here is the jelly. */
  release: SpringConfig
}

export type PresetName = 'gentle' | 'wobbly' | 'bouncy' | 'firm'

/**
 * The release spring decides the character. Overshoot after letting go,
 * as a share of the squash (e^(−ζπ/√(1−ζ²)), ζ = 1 − bounce):
 *   firm   bounce 0.3  →  5%   barely any wobble
 *   gentle bounce 0.4  → 10%   one soft stretch
 *   wobbly bounce 0.65 → 31%   two visible wobbles (default)
 *   bouncy bounce 0.75 → 44%   three or four wobbles
 */
export const presets: Record<PresetName, PressFeel> = {
  gentle: {
    squash: 0.05,
    depth: 0.03,
    tilt: 1.5,
    press: { duration: 0.22, bounce: 0.15 },
    release: { duration: 0.5, bounce: 0.4 },
  },
  wobbly: {
    squash: 0.1,
    depth: 0.05,
    tilt: 3,
    press: { duration: 0.2, bounce: 0.25 },
    release: { duration: 0.55, bounce: 0.65 },
  },
  bouncy: {
    squash: 0.14,
    depth: 0.06,
    tilt: 4,
    press: { duration: 0.2, bounce: 0.3 },
    release: { duration: 0.6, bounce: 0.75 },
  },
  firm: {
    squash: 0.03,
    depth: 0.06,
    tilt: 0,
    press: { duration: 0.12, bounce: 0 },
    release: { duration: 0.35, bounce: 0.3 },
  },
}

export const DEFAULT_PRESET: PresetName = 'wobbly'
