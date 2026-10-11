export interface JelloConfig {
  /**
   * - `'user'` (default): follow the OS/browser `prefers-reduced-motion` setting.
   * - `'always'`: always use the reduced (opacity-only) feedback.
   * - `'never'`: always animate. Only for previews — users who ask for less motion should get it.
   */
  reducedMotion: 'user' | 'always' | 'never'
  /**
   * - `'waapi'` (default when available): pre-computed keyframes played by the
   *   Web Animations API, which browsers can run off the main thread.
   * - `'raf'`: write inline styles every frame from requestAnimationFrame.
   *   Kept for comparison and for environments without `Element.animate`.
   */
  driver: 'auto' | 'waapi' | 'raf'
}

export const config: JelloConfig = { reducedMotion: 'user', driver: 'auto' }

/** Change global behaviour. Returns the resulting config. */
export function configure(next: Partial<JelloConfig>): JelloConfig {
  return Object.assign(config, next)
}

let query: MediaQueryList | null | undefined

export function prefersReducedMotion(): boolean {
  if (config.reducedMotion !== 'user') return config.reducedMotion === 'always'
  if (query === undefined) {
    query = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null
  }
  return !!query?.matches // `.matches` is live, no listener needed
}

export const now = () => performance.now() / 1000
