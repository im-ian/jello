// Interaction
export { jello, auto, type JelloOptions, type JelloHandle, type AutoOptions } from './interact'
export { presets, type PresetName, type PressFeel } from './presets'

// One-shot effects
export {
  jiggle,
  shake,
  pop,
  hop,
  type EffectOptions,
  type PopOptions,
  type HopOptions,
} from './effects'

// Springs (also usable on their own)
export {
  spring,
  solve,
  settleTime,
  impulse,
  type Spring,
  type SpringConfig,
  type DurationBounce,
  type Physical,
} from './spring'
export { springEasing, type SpringEasing } from './css'

// Design tokens — springs baked into CSS variables alongside colours and the rest
export { tokens, type Theme, type Tokens, type TokenOptions, type TokenValue } from './tokens'

// Global behaviour + extension point for custom effects
export { configure, type JelloConfig } from './config'
export { motionFor, type Ctx, type ChannelName, type JelloElement } from './motion'
