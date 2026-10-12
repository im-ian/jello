// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { springEasing } from '../src/css'
import { spring } from '../src/spring'
import { tokens } from '../src/tokens'

const count = (haystack: string, needle: string) => haystack.split(needle).length - 1

describe('tokens', () => {
  it('nests into the variable name, camelCase and all', () => {
    const t = tokens({ color: { bg: '#fff', bgSoft: '#eee' }, space: { md: '16px' }, z: 3 }, { prefix: 'app' })
    expect(t.vars).toEqual({
      '--app-color-bg': '#fff',
      '--app-color-bg-soft': '#eee',
      '--app-space-md': '16px',
      '--app-z': '3',
    })
    expect(t.var('color.bgSoft')).toBe('var(--app-color-bg-soft)')
    expect(() => t.var('color.nope')).toThrow(/no token/)
  })

  it('works without a prefix and declares on :root by default', () => {
    const t = tokens({ ink: '#000' })
    expect(t.vars['--ink']).toBe('#000')
    expect(t.css.startsWith(':root {')).toBe(true)
  })

  it('expands a spring into the shorthand plus its two parts', () => {
    const s = spring({ duration: 0.5, bounce: 0.6 })
    const e = springEasing(s)
    const t = tokens({ motion: { press: s } }, { prefix: 'app' })
    expect(t.vars['--app-motion-press']).toBe(`${e.duration}ms ${e.easing}`)
    expect(t.vars['--app-motion-press-duration']).toBe(`${e.duration}ms`)
    expect(t.vars['--app-motion-press-easing']).toBe(e.easing)
    // the bare name is what a transition shorthand needs, so it points at the spring itself
    expect(t.var('motion.press')).toBe('var(--app-motion-press)')
  })

  it('a { duration, bounce } object is two tokens, not a spring', () => {
    const t = tokens({ press: { duration: 0.5, bounce: 0.6 } })
    expect(t.vars).toEqual({ '--press-duration': '0.5', '--press-bounce': '0.6' })
  })

  it('redefines only the dark overrides, and lets an explicit choice win either way', () => {
    const t = tokens({ color: { bg: '#fff', ink: '#000' } }, { prefix: 'app', dark: { color: { bg: '#111' } } })
    expect(count(t.css, '--app-color-bg: #111;')).toBe(2) // once for the OS, once for the toggle
    expect(count(t.css, '--app-color-ink')).toBe(1) // not carried into dark, it did not change
    expect(t.css).toContain('@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) {')
    expect(t.css).toContain(':root[data-theme="dark"] {')
  })

  it('scopes a narrower selector by an ancestor so the dark blocks still nest', () => {
    const t = tokens({ bg: '#fff' }, { selector: '.card', dark: { bg: '#111' } })
    expect(t.css).toContain('.card {')
    expect(t.css).toContain(':root:not([data-theme="light"]) .card {')
    expect(t.css).toContain(':root[data-theme="dark"] .card {')
  })

  it('apply() replaces its own style element instead of stacking them up', () => {
    const t = tokens({ bg: '#fff' }, { prefix: 'app' })
    const remove = t.apply()
    const el = document.getElementById('jello-tokens-app')
    expect(el?.textContent).toContain('--app-bg: #fff;')
    tokens({ bg: '#000' }, { prefix: 'app' }).apply()
    expect(document.querySelectorAll('#jello-tokens-app')).toHaveLength(1)
    expect(document.getElementById('jello-tokens-app')?.textContent).toContain('--app-bg: #000;')
    remove()
    expect(document.getElementById('jello-tokens-app')).toBe(null)
  })
})
