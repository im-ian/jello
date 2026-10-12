import { springEasing } from './css'
import type { Spring } from './spring'

/**
 * Design tokens as CSS custom properties, where a spring is a value.
 *
 *   const theme = tokens({
 *     color: { bg: '#f6f1f5', accent: '#d2234c' },
 *     motion: { press: spring({ duration: 0.5, bounce: 0.6 }) },
 *   }, { prefix: 'app', dark: { color: { bg: '#1a121e' } } })
 *
 *   theme.apply()                 // → --app-color-bg, --app-motion-press, …
 *   theme.var('color.bg')         // → "var(--app-color-bg)"
 *
 * Colours, sizes and the rest pass straight through — plenty of tools do that.
 * The part jello is here for is the spring: a `Spring` becomes a CSS
 * `linear()` easing plus its duration, so the same curve drives both the
 * JS animations and the transitions you write by hand. The bare name holds the
 * `transition` shorthand, so `transition: scale var(--app-motion-press)` is all
 * a stylesheet needs; `-duration` and `-easing` are there when the parts are
 * wanted on their own.
 */

/** Anything that can sit at a leaf. A `Spring` (what `spring()` returns) expands to three variables. */
export type TokenValue = string | number | Spring

export interface Tokens {
  [key: string]: TokenValue | Tokens
}

export interface TokenOptions {
  /** Prefixes every variable: `--<prefix>-…`. Off by default. */
  prefix?: string
  /** Overrides for dark mode. Only the tokens named here are redefined. */
  dark?: Tokens
  /** Where the variables are declared. @default ':root' */
  selector?: string
}

export interface Theme {
  /** The whole stylesheet, light and dark. */
  css: string
  /** Every variable, by name: `{ '--app-color-bg': '#f6f1f5', … }`. */
  vars: Record<string, string>
  /** `var()` reference for one token: `theme.var('color.bg')`. Throws on an unknown path. */
  var(path: string): string
  /** Put the stylesheet in the document (replacing an earlier one with the same prefix). Returns a remove function. */
  apply(doc?: Document): () => void
}

/** `bgSoft` → `bg-soft`. Token objects are written in JS, variables are read in CSS. */
const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()

/**
 * A `Spring` is `{ omega, zeta }` and nothing else jello hands out looks like
 * that, so it needs no marker. A plain `{ duration, bounce }` is NOT treated as
 * one — it is indistinguishable from a group of two number tokens. Call
 * `spring()` on it first.
 */
const isSpring = (v: unknown): v is Spring =>
  typeof v === 'object' && v !== null && typeof (v as Spring).omega === 'number' && typeof (v as Spring).zeta === 'number'

/** Walk the tree, emitting `[variable name, value]` and recording where each token came from. */
function flatten(t: Tokens, prefix: string, paths?: Map<string, string>): Array<[string, string]> {
  const out: Array<[string, string]> = []
  const walk = (node: Tokens, trail: string[]) => {
    for (const [key, value] of Object.entries(node)) {
      const path = [...trail, key]
      const name = `--${[prefix, ...path].filter(Boolean).map(kebab).join('-')}`
      if (isSpring(value)) {
        const e = springEasing(value)
        paths?.set(path.join('.'), name)
        out.push([name, e.toString()], [`${name}-duration`, `${e.duration}ms`], [`${name}-easing`, e.easing])
      } else if (typeof value === 'object' && value !== null) {
        walk(value as Tokens, path)
      } else {
        paths?.set(path.join('.'), name)
        out.push([name, String(value)])
      }
    }
  }
  walk(t, [])
  return out
}

const block = (selector: string, decls: Array<[string, string]>) =>
  `${selector} {\n${decls.map(([k, v]) => `  ${k}: ${v};`).join('\n')}\n}\n`

/**
 * Build a theme from a token tree. Nesting becomes the variable name:
 * `{ color: { bgSoft } }` → `--color-bg-soft`.
 */
export function tokens(t: Tokens, { prefix = '', dark, selector = ':root' }: TokenOptions = {}): Theme {
  const paths = new Map<string, string>()
  const light = flatten(t, prefix, paths)
  // Dark overrides ride on the light names, so they need no paths of their own.
  const night = dark ? flatten(dark, prefix) : []

  // A theme on :root is scoped by :root itself; one on a narrower selector is
  // scoped by an ancestor, so both forms collapse out of the same expression.
  const scope = (guard: string) => (selector === ':root' ? `:root${guard}` : `:root${guard} ${selector}`)

  let css = block(selector, light)
  if (night.length) {
    // The explicit choice wins in both directions: a light-themed page stays
    // light under a dark OS, and the toggle still overrides the OS either way.
    css += `@media (prefers-color-scheme: dark) {\n${block(scope(':not([data-theme="light"])'), night).replace(/^/gm, '  ').trimEnd()}\n}\n`
    css += block(scope('[data-theme="dark"]'), night)
  }

  return {
    css,
    vars: Object.fromEntries(light),
    var(path) {
      const name = paths.get(path)
      if (!name) throw new RangeError(`jello: no token "${path}"`)
      return `var(${name})`
    },
    apply(doc = document) {
      const id = `jello-tokens${prefix ? `-${prefix}` : ''}`
      let el = doc.getElementById(id) as HTMLStyleElement | null
      if (!el) {
        el = doc.createElement('style')
        el.id = id
        doc.head.append(el)
      }
      el.textContent = css
      return () => el?.remove()
    },
  }
}
