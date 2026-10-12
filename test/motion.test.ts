// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { auto as realAuto, configure, hop, jello, motionFor, shake } from '../src'

/** auto() that is always torn down after the test, even when an expectation fails midway. */
const stops: Array<() => void> = []
const auto = (...args: Parameters<typeof realAuto>) => {
  const stop = realAuto(...args)
  stops.push(stop)
  return stop
}

/* ------------------------------------------------------------- test rig */

interface FakeAnim {
  keyframes: Keyframe[]
  options: KeyframeAnimationOptions
  startTime: number | null
  onfinish: null | (() => void)
  canceled: boolean
  cancel(): void
}

let clock = 1000 // ms, what performance.now() returns
const recorded = new WeakMap<Element, FakeAnim[]>()
function animsOf(el: Element): FakeAnim[] {
  let a = recorded.get(el)
  if (!a) recorded.set(el, (a = []))
  return a
}

/** Every element's animate() records its keyframes instead of running. */
function fakeAnimate(this: Element, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
  const a: FakeAnim = {
    keyframes,
    options,
    startTime: null,
    onfinish: null,
    canceled: false,
    cancel() {
      this.canceled = true
    },
  }
  animsOf(this).push(a)
  return a as unknown as Animation
}

function fakeEl(tag = 'button', attrs: Record<string, string> = {}, parent: Element = document.body) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  Object.defineProperty(el, 'offsetWidth', { value: 200, configurable: true })
  Object.defineProperty(el, 'offsetHeight', { value: 50, configurable: true })
  el.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 200, height: 50, right: 200, bottom: 50, x: 0, y: 0 }) as DOMRect
  parent.append(el)
  return { el, anims: animsOf(el) }
}

const scaleOf = (k: Keyframe) => String(k.scale).split(' ').map(Number) as [number, number]
const translateOf = (k: Keyframe) => String(k.translate).split(' ').map(parseFloat) as [number, number]
const rotateOf = (k: Keyframe) => (k.rotate === undefined ? 0 : parseFloat(String(k.rotate)))
const endOf = (a: FakeAnim) => a.startTime! + Number(a.options.duration)

/** Value of a keyframe series at absolute time `ms` (frames are evenly spaced). */
function sampleAt(a: FakeAnim, ms: number, read: (k: Keyframe) => number) {
  const n = a.keyframes.length - 1
  const p = Math.min(1, Math.max(0, (ms - a.startTime!) / Number(a.options.duration))) * n
  const i = Math.min(n - 1, Math.floor(p))
  const f = p - i
  return read(a.keyframes[i]!) * (1 - f) + read(a.keyframes[i + 1]!) * f
}

/** Where a local point (px from the top-left) ends up on screen. transform-origin = centre of 200×50. */
function screenOf(k: { sx: number; sy: number; r: number; tx: number; ty: number }, [px, py]: [number, number]) {
  const [ox, oy] = [100, 25]
  const dx = px - ox
  const dy = py - oy
  const a = (k.r * Math.PI) / 180
  const x = Math.cos(a) * k.sx * dx - Math.sin(a) * k.sy * dy
  const y = Math.sin(a) * k.sx * dx + Math.cos(a) * k.sy * dy
  return [ox + k.tx + x, oy + k.ty + y]
}
const stateOf = (k: Keyframe) => {
  const [sx, sy] = k.scale === undefined ? [1, 1] : scaleOf(k)
  const [tx, ty] = k.translate === undefined ? [0, 0] : translateOf(k)
  return { sx, sy, r: rotateOf(k), tx, ty }
}
const stateAt = (a: FakeAnim, ms: number) => ({
  sx: sampleAt(a, ms, (k) => stateOf(k).sx),
  sy: sampleAt(a, ms, (k) => stateOf(k).sy),
  r: sampleAt(a, ms, (k) => stateOf(k).r),
  tx: sampleAt(a, ms, (k) => stateOf(k).tx),
  ty: sampleAt(a, ms, (k) => stateOf(k).ty),
})

const down = (el: Element, id: number, x = 100, y = 25) =>
  el.dispatchEvent(new PointerEvent('pointerdown', { pointerId: id, button: 0, clientX: x, clientY: y, bubbles: true }))
const up = (id: number) => window.dispatchEvent(new PointerEvent('pointerup', { pointerId: id }))
const tick = () => new Promise((r) => setTimeout(r, 0))

let restoreAnimate: () => void
beforeEach(() => {
  clock = 1000
  vi.spyOn(performance, 'now').mockImplementation(() => clock)
  vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => 'none', opacity: '1' }))
  configure({ reducedMotion: 'never', driver: 'auto' })
  document.body.innerHTML = ''
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>
  const had = Object.getOwnPropertyDescriptor(proto, 'animate')
  Object.defineProperty(proto, 'animate', { configurable: true, writable: true, value: fakeAnimate })
  restoreAnimate = () => {
    if (had) Object.defineProperty(proto, 'animate', had)
    else delete proto.animate
  }
})

afterEach(() => {
  while (stops.length) stops.pop()!()
  vi.useRealTimers()
  restoreAnimate()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/* ------------------------------------------------------------------ tests */

describe('press / release (WAAPI driver)', () => {
  it('bakes the press into keyframes that start at rest and end squashed', () => {
    const { el, anims } = fakeEl()
    jello(el).press()
    expect(anims).toHaveLength(1)
    const a = anims[0]!
    expect(a.options).toMatchObject({ easing: 'linear', fill: 'both' })
    expect(a.startTime).toBe(1000) // pinned to the moment the springs were seeded
    expect(scaleOf(a.keyframes[0]!)).toEqual([1, 1])
    const [sx, sy] = scaleOf(a.keyframes.at(-1)!)
    // wobbly: depth 0.05, squash 0.1 → wider and shorter, area kept apart from the shrink
    expect(sx).toBeCloseTo(0.95 / 0.9, 3)
    expect(sy).toBeCloseTo(0.95 * 0.9, 3)
    // pressed from code: no pointer, so no lean and no pivot offset
    expect(a.keyframes.every((k) => k.rotate === undefined && k.translate === undefined)).toBe(true)
  })

  it('keeps a held press filled, and cleans up after the release settles', () => {
    const { el, anims } = fakeEl()
    const h = jello(el)
    h.press()
    const pressAnim = anims[0]!
    clock = endOf(pressAnim)
    pressAnim.onfinish!()
    expect(pressAnim.canceled).toBe(false) // still held → keep showing it

    h.release()
    const releaseAnim = anims[1]!
    expect(pressAnim.canceled).toBe(true) // replaced
    const sy = releaseAnim.keyframes.map((k) => scaleOf(k)[1])
    expect(Math.max(...sy)).toBeGreaterThan(1.02) // it stretches past rest — the jelly
    expect(scaleOf(releaseAnim.keyframes.at(-1)!)).toEqual([1, 1])
    clock = endOf(releaseAnim)
    releaseAnim.onfinish!()
    expect(releaseAnim.canceled).toBe(true) // back to the element's own styles
  })

  it('an interruption continues from the exact on-screen state, momentum included', () => {
    const { el, anims } = fakeEl()
    const h = jello(el)
    h.press()
    clock = 1060
    h.release()
    const [a, b] = anims as [FakeAnim, FakeAnim]
    const sy = (k: Keyframe) => scaleOf(k)[1]
    // no jump
    expect(Math.abs(sy(b.keyframes[0]!) - sampleAt(a, 1060, sy))).toBeLessThan(2e-3) // < 0.1px on a 50px button
    // no stall: still moving the same way at a similar speed
    const before = (sampleAt(a, 1060, sy) - sampleAt(a, 1052, sy)) / 8
    const dt = Number(b.options.duration) / (b.keyframes.length - 1)
    const after = (sy(b.keyframes[1]!) - sy(b.keyframes[0]!)) / dt
    expect(Math.sign(after)).toBe(Math.sign(before))
    expect(Math.abs(after / before)).toBeGreaterThan(0.6)
    expect(Math.abs(after / before)).toBeLessThan(1.4)
  })

  it('tap() plans press and release in one go — no timers', () => {
    const { el, anims } = fakeEl()
    jello(el).tap()
    expect(anims).toHaveLength(1)
    const sy = anims[0]!.keyframes.map((k) => scaleOf(k)[1])
    expect(Math.min(...sy)).toBeLessThan(0.93)
    expect(Math.max(...sy)).toBeGreaterThan(1.01)
    expect(sy.at(-1)).toBe(1)
  })

  it('leans toward the press point', () => {
    const { el, anims } = fakeEl()
    jello(el)
    down(el, 1, 200, 25)
    const rot = anims[0]!.keyframes.map(rotateOf)
    expect(rot.at(-1)).toBeCloseTo(3, 1) // wobbly tilt = 3°, pressed at the right edge
    clock += 150
    up(1)
    expect(anims).toHaveLength(2)
    expect(rotateOf(anims[1]!.keyframes.at(-1)!)).toBeCloseTo(0, 2)
  })

  it('caps how far the corner lifts, so a wide element does not heave', () => {
    const wide = (w: number) => {
      const made = fakeEl()
      Object.defineProperty(made.el, 'offsetWidth', { value: w, configurable: true })
      made.el.getBoundingClientRect = () =>
        ({ left: 0, top: 0, width: w, height: 50, right: w, bottom: 50, x: 0, y: 0 }) as DOMRect
      jello(made.el)
      return made
    }
    const tilt = (a: FakeAnim) => rotateOf(a.keyframes.at(-1)!)
    const lift = (a: FakeAnim, w: number) => (w / 2) * Math.sin((tilt(a) * Math.PI) / 180)

    const btn = wide(94)
    const card = wide(800)
    down(btn.el, 81, 94, 25) // the right edge of each: full lean
    down(card.el, 82, 800, 25)
    expect(tilt(btn.anims[0]!)).toBeCloseTo(3, 2) // button-sized: wobbly's 3°, untouched
    expect(lift(btn.anims[0]!, 94)).toBeCloseTo(2.46, 1)
    expect(tilt(card.anims[0]!)).toBeCloseTo(0.86, 2) // 800px: asin(6 / 400)
    expect(lift(card.anims[0]!, 800)).toBeCloseTo(6, 1) // the lift is capped, so the angle gives way
    up(81)
    up(82)
  })
})

describe('deforms around the press point', () => {
  it('the spot under the finger stays put while the rest squashes around it', () => {
    const { el, anims } = fakeEl()
    jello(el)
    down(el, 11, 40, 10)
    const held = stateOf(anims[0]!.keyframes.at(-1)!)
    const [x, y] = screenOf(held, [40, 10])
    expect(x).toBeCloseTo(40, 1)
    expect(y).toBeCloseTo(10, 1)
    // the far corner does move
    const [fx, fy] = screenOf(held, [200, 50])
    expect(Math.hypot(fx - 200, fy - 50)).toBeGreaterThan(5)
    // and it is a real squash: shorter and wider than rest
    expect(held.sy).toBeLessThan(0.9)
    expect(held.sx).toBeGreaterThan(1)
    up(11)
  })

  it('moving the pivot mid-motion causes no jump', () => {
    const { el, anims } = fakeEl()
    jello(el)
    down(el, 12, 40, 10)
    clock = 1080
    motionFor(el).update((c) => c.pivot(60, 15)) // pivot at the right-bottom quarter
    const [a, b] = anims as [FakeAnim, FakeAnim]
    for (const p of [[0, 0], [200, 50], [40, 10], [120, 30]] as Array<[number, number]>) {
      const before = screenOf(stateAt(a, 1080), p)
      const after = screenOf(stateOf(b.keyframes[0]!), p)
      expect(Math.hypot(before[0] - after[0], before[1] - after[1])).toBeLessThan(0.25)
    }
    up(12)
  })

  it('pivot="origin" keeps the CSS transform-origin (e.g. a jelly sitting on a plate)', () => {
    const { el, anims } = fakeEl('button', { 'data-jello': '', 'data-jello-pivot': 'origin' })
    const stop = auto()
    down(el, 13, 40, 10)
    expect(anims[0]!.keyframes.every((k) => k.translate === undefined)).toBe(true)
    up(13)
    stop()
  })
})

describe('dimple', () => {
  it('sinks in where the finger is and springs back out', () => {
    const { el } = fakeEl()
    jello(el)
    down(el, 21, 40, 10)
    const host = el.querySelector('[data-jello-dent]') as HTMLElement
    expect(host).not.toBeNull()
    expect(host.getAttribute('aria-hidden')).toBe('true')
    const dot = host.firstElementChild as HTMLElement
    // size: 1.1 × min(200, 50) = 55px, centred on the finger
    expect(dot.style.width).toBe('55px')
    expect(dot.style.left).toBe('12.5px')
    expect(dot.style.top).toBe('-17.5px')
    const pressIn = animsOf(dot)[0]!
    expect(Number(pressIn.keyframes.at(-1)!.opacity)).toBe(1)
    expect(pressIn.keyframes.every((k) => k.scale !== undefined && k.opacity !== undefined)).toBe(true) // compositor-only
    clock += 200
    up(21)
    expect(Number(animsOf(dot)[1]!.keyframes.at(-1)!.opacity)).toBe(0)
  })

  it('is skipped for elements that cannot hold children, and can be turned off', () => {
    const { el: input } = fakeEl('input')
    jello(input)
    down(input, 22, 10, 10)
    expect(input.children.length).toBe(0)
    up(22)
    const { el } = fakeEl()
    jello(el, { dent: false })
    down(el, 23, 10, 10)
    expect(el.querySelector('[data-jello-dent]')).toBeNull()
    up(23)
  })

  it('comes back if a framework wipes the element’s children', () => {
    const { el } = fakeEl()
    jello(el)
    down(el, 24)
    clock += 100
    up(24)
    el.textContent = 're-rendered' // what React does for a string child
    clock += 2000
    down(el, 25)
    expect(el.querySelectorAll('[data-jello-dent]')).toHaveLength(1)
    up(25)
  })
})

describe('effects', () => {
  it('shake goes left first, ~8px, and comes back', () => {
    const { el, anims } = fakeEl('div')
    shake(el)
    const xs = anims[0]!.keyframes.map((k) => translateOf(k)[0])
    const min = Math.min(...xs)
    expect(min).toBeCloseTo(-8, 0)
    expect(xs.indexOf(min)).toBeLessThan(xs.indexOf(Math.max(...xs)))
    expect(xs.at(-1)).toBeCloseTo(0, 1)
  })

  it('hop rises ~14px and squishes when it lands', () => {
    const { el, anims } = fakeEl('div')
    hop(el)
    const k = anims[0]!.keyframes
    const ys = k.map((f) => translateOf(f)[1])
    const top = ys.indexOf(Math.min(...ys))
    expect(ys[top]).toBeCloseTo(-14, 0)
    const land = ys.findIndex((y, i) => i > top && y >= 0)
    const sy = k.map((f) => scaleOf(f)[1])
    expect(Math.min(...sy.slice(land - 2, land + 8))).toBeLessThan(0.97)
    expect(Math.max(...sy.slice(0, top + 1))).toBeGreaterThan(1.03) // stretched on take-off
  })

  it('effects stack with a held press instead of fighting it', () => {
    const { el, anims } = fakeEl()
    jello(el).press()
    clock = 1300
    shake(el)
    const last = anims[1]!.keyframes.at(-1)!
    expect(scaleOf(last)[1]).toBeCloseTo(0.855, 3) // still squashed
    expect(translateOf(last)[0]).toBeCloseTo(0, 1) // shake settled
  })
})

describe('components', () => {
  function form() {
    const f = document.createElement('form')
    f.setAttribute('data-jello', '')
    document.body.append(f)
    return f
  }

  it('a container passes presses on to its controls but is not pressed itself', () => {
    const stop = auto()
    const f = form()
    const { el: p, anims: pAnims } = fakeEl('p', {}, f)
    const { el: input, anims } = fakeEl('input', { type: 'text' }, f)
    down(p, 31)
    up(31)
    expect(pAnims).toHaveLength(0)
    expect(animsOf(f)).toHaveLength(0)
    down(input, 32)
    const [, sy] = scaleOf(anims[0]!.keyframes.at(-1)!)
    expect(sy).toBeCloseTo(0.98 * 0.975, 3) // fields get a much gentler press
    up(32)
    stop()
  })

  it('fields: keyboard focus swells, typing wiggles, invalid shakes', () => {
    const stop = auto()
    const f = form()
    const { el: input, anims } = fakeEl('input', { type: 'email' }, f)
    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    expect(Math.max(...anims[0]!.keyframes.map((k) => scaleOf(k)[0]))).toBeGreaterThan(1.02)
    clock += 2000
    input.dispatchEvent(new Event('input', { bubbles: true }))
    const wiggle = anims[1]!.keyframes.map((k) => scaleOf(k)[1])
    expect(Math.max(...wiggle.map((v) => Math.abs(v - 1)))).toBeLessThan(0.03)
    expect(Math.max(...wiggle.map((v) => Math.abs(v - 1)))).toBeGreaterThan(0.005)
    clock += 2000
    input.dispatchEvent(new Event('invalid')) // does not bubble — caught in capture
    expect(Math.min(...anims[2]!.keyframes.map((k) => translateOf(k)[0]))).toBeCloseTo(-6.4, 0)
    stop()
  })

  it('focus right after a pointer press is not doubled', () => {
    const stop = auto()
    const { el: input, anims } = fakeEl('input', { type: 'text', 'data-jello': '' })
    down(input, 33)
    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    expect(anims).toHaveLength(1)
    up(33)
    stop()
  })

  it('toggles: checking a checkbox boings it; a hidden native one boings what you see', () => {
    const stop = auto()
    const f = form()
    const { el: box, anims } = fakeEl('input', { type: 'checkbox' }, f)
    ;(box as HTMLInputElement).checked = true
    box.dispatchEvent(new Event('change', { bubbles: true }))
    expect(Math.max(...anims[0]!.keyframes.map((k) => scaleOf(k)[0]))).toBeGreaterThan(1.08)

    const label = document.createElement('label')
    f.append(label)
    const hidden = document.createElement('input')
    hidden.type = 'checkbox' // offsetWidth 0 → visually hidden
    label.append(hidden)
    const { anims: trackAnims } = fakeEl('span', {}, label)
    hidden.dispatchEvent(new Event('change', { bubbles: true }))
    expect(trackAnims).toHaveLength(1)
    stop()
  })

  it('ARIA states of custom components: aria-checked, aria-selected, aria-invalid', async () => {
    const stop = auto()
    const f = form()
    const { el: sw, anims: swAnims } = fakeEl('button', { role: 'switch', 'aria-checked': 'false' }, f)
    const { el: tab, anims: tabAnims } = fakeEl('button', { role: 'tab', 'aria-selected': 'false' }, f)
    const { el: box, anims: boxAnims } = fakeEl('div', { role: 'textbox', 'aria-invalid': 'false' }, f)
    sw.setAttribute('aria-checked', 'true')
    tab.setAttribute('aria-selected', 'true')
    box.setAttribute('aria-invalid', 'true')
    await tick()
    expect(swAnims).toHaveLength(1)
    expect(tabAnims).toHaveLength(1)
    expect(boxAnims[0]!.keyframes.some((k) => k.translate !== undefined)).toBe(true) // shake
    tab.setAttribute('aria-selected', 'false') // deselecting is quiet
    await tick()
    expect(tabAnims).toHaveLength(1)
    stop()
  })

  it('springs in a dialog when it opens and [data-jello-enter] elements when inserted', async () => {
    const stop = auto()
    const { el: dialog, anims } = fakeEl('dialog', { 'data-jello': '' })
    dialog.setAttribute('open', '')
    await tick()
    expect(scaleOf(anims[0]!.keyframes[0]!)[0]).toBeCloseTo(0.9, 1)

    const toast = document.createElement('div')
    toast.setAttribute('data-jello-enter', '')
    document.body.append(toast)
    await tick()
    expect(scaleOf(animsOf(toast)[0]!.keyframes[0]!)[1]).toBeCloseTo(0.6, 1)
    stop()
  })

  it('data-jello="off" opts a part out', () => {
    const stop = auto()
    const f = form()
    const off = document.createElement('div')
    off.setAttribute('data-jello', 'off')
    f.append(off)
    const { el, anims } = fakeEl('button', {}, off)
    down(el, 34)
    up(34)
    expect(anims).toHaveLength(0)
    stop()
  })

  it('list rows get a press meant for a row, buttons keep theirs', async () => {
    const stop = auto()
    const box = container()
    box.setAttribute('role', 'listbox')
    const { el: row, anims: rowAnims } = fakeEl('div', { role: 'option', 'aria-selected': 'false' }, box)
    const { el: btn, anims: btnAnims } = fakeEl('button', {}, box)
    const peakSx = (a: FakeAnim) => Math.max(...a.keyframes.map((k) => scaleOf(k)[0]))

    down(row, 71, 170, 25) // 85% along a 200px-wide row
    up(71)
    row.setAttribute('aria-selected', 'true') // and the app selects it
    await tick()
    expect(rowAnims.every((a) => a.keyframes.every((k) => k.rotate === undefined))).toBe(true) // no tilt
    expect(row.querySelector('[data-jello-dent]')).toBeNull() // no dimple
    expect(Math.max(...rowAnims.map(peakSx))).toBeLessThan(1.03) // never pushes out of the list
    expect(scaleOf(rowAnims[0]!.keyframes.at(-1)!)[1]).toBeCloseTo(0.98 * 0.975, 3) // still reacts

    down(btn, 72, 170, 25)
    expect(rotateOf(btnAnims[0]!.keyframes.at(-1)!)).toBeCloseTo(2.1, 2) // wobbly tilt, unchanged
    expect(scaleOf(btnAnims[0]!.keyframes.at(-1)!)[0]).toBeCloseTo(0.95 / 0.9, 3)
    expect(btn.querySelector('[data-jello-dent]')).not.toBeNull()
    up(72)
    stop()
  })

  it('range sliders are not squashed while dragging', () => {
    const stop = auto()
    const f = form()
    const { el, anims } = fakeEl('input', { type: 'range' }, f)
    down(el, 35)
    expect(anims).toHaveLength(0)
    up(35) // no value change → no momentum either
    expect(anims).toHaveLength(0)
    stop()
  })
})

describe('plays well with the element’s own styles', () => {
  it('multiplies/adds onto existing scale, rotate and translate instead of replacing them', () => {
    vi.stubGlobal('getComputedStyle', () => ({
      getPropertyValue: (p: string) =>
        ({ scale: '1.5', rotate: '10deg', translate: '50% 4px' })[p as 'scale'] ?? '',
      opacity: '1',
    }))
    const { el, anims } = fakeEl()
    jello(el, { dent: false })
    down(el, 2, 100, 25)
    const first = anims[0]!.keyframes[0]!
    expect(scaleOf(first)).toEqual([1.5, 1.5])
    clock += 3000
    up(2)
    clock += 3000
    shake(el)
    const k = anims.at(-1)!.keyframes
    expect(String(k[0]!.translate)).toBe('calc(50% + 0px) 4px')
    expect(rotateOf(k.at(-1)!)).toBeCloseTo(10, 1)
  })
})

describe('input handling', () => {
  it('Space presses while held, Enter taps', () => {
    const { el, anims } = fakeEl()
    jello(el)
    el.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
    expect(anims).toHaveLength(1)
    el.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', repeat: true, bubbles: true }))
    expect(anims).toHaveLength(1) // auto-repeat ignored
    clock += 150
    el.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true }))
    expect(anims).toHaveLength(2)
    clock += 2000
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(anims).toHaveLength(3)
  })

  it('ignores disabled buttons and non-primary mouse buttons', () => {
    const { el, anims } = fakeEl('button', { disabled: '' })
    jello(el)
    down(el, 3)
    const { el: el2, anims: anims2 } = fakeEl()
    jello(el2)
    el2.dispatchEvent(
      new PointerEvent('pointerdown', { pointerId: 4, button: 2, pointerType: 'mouse', bubbles: true }),
    )
    expect(anims).toHaveLength(0)
    expect(anims2).toHaveLength(0)
  })

  it('auto() handles [data-jello] elements, including ones added later, with presets', () => {
    const stop = auto()
    const { el, anims } = fakeEl('button', { 'data-jello': 'bouncy' })
    const child = document.createElement('span')
    el.append(child)
    child.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 5, button: 0, clientX: 100, clientY: 25, bubbles: true }))
    const [sx, sy] = scaleOf(anims[0]!.keyframes.at(-1)!)
    expect(sx).toBeCloseTo(0.94 / 0.86, 3) // bouncy: depth .06, squash .14
    expect(sy).toBeCloseTo(0.94 * 0.86, 3)
    clock += 150
    up(5)
    stop()
    down(child, 6)
    expect(anims).toHaveLength(2) // press + release only; nothing after stop()
  })

  it('destroy() removes listeners', () => {
    const { el, anims } = fakeEl()
    jello(el).destroy()
    down(el, 7)
    expect(anims).toHaveLength(0)
  })
})

describe('reduced motion', () => {
  it('swaps motion for an opacity dip (WCAG 2.3.3: opacity is not motion)', () => {
    configure({ reducedMotion: 'always' })
    const { el, anims } = fakeEl()
    const h = jello(el, { dent: false })
    h.press()
    expect(anims[0]!.keyframes.at(-1)).toEqual({ opacity: 0.7 })
    h.release()
    expect(anims[1]!.keyframes.at(-1)).toEqual({ opacity: 1 })
    shake(el)
    expect(anims[2]!.options.iterations).toBe(2)
    expect(anims.every((a) => a.keyframes.every((k) => k.scale === undefined))).toBe(true)
  })

  it('the dimple only fades — it does not grow', () => {
    configure({ reducedMotion: 'always' })
    const { el } = fakeEl()
    jello(el)
    down(el, 41, 40, 10)
    const dot = el.querySelector('[data-jello-dent]')!.firstElementChild!
    expect(animsOf(dot)[0]!.keyframes.every((k) => k.scale === '1')).toBe(true)
    up(41)
  })
})

describe('rAF driver', () => {
  it('writes inline styles each frame and restores them afterwards', () => {
    configure({ driver: 'raf' })
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb))
    const { el } = fakeEl()
    el.style.scale = ''
    const h = jello(el)
    h.press()
    const run = (ms: number) => {
      clock = ms
      const cb = frames.shift()
      cb?.(ms)
    }
    run(1100)
    expect(el.style.scale).not.toBe('')
    h.release()
    for (let t = 1116; frames.length && t < 6000; t += 16) run(t)
    expect(frames.length).toBe(0)
    expect(el.style.scale).toBe('')
  })
})

/* ------------------------------------------------------------ slider + accordion */

function container() {
  const c = document.createElement('div')
  c.setAttribute('data-jello', '')
  document.body.append(c)
  return c
}

function setValue(el: Element, v: number, dt = 16) {
  clock += dt
  ;(el as HTMLInputElement).value = String(v)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('slider momentum', () => {
  it('after a fast drag it is carried on in that direction when let go, then springs back', () => {
    const stop = auto()
    const { el, anims } = fakeEl('input', { type: 'range', min: '0', max: '100', value: '20' }, container())
    down(el, 51)
    for (const v of [30, 40, 50, 60]) setValue(el, v) // 20px per 16ms on a 200px track ≈ 1250 px/s
    expect(anims).toHaveLength(0) // nothing moves under the finger
    clock += 10
    up(51)
    const xs = anims[0]!.keyframes.map((k) => translateOf(k)[0])
    expect(Math.max(...xs)).toBeCloseTo(7.5, 0) // speed × 0.006, capped at 8px
    expect(xs.indexOf(Math.max(...xs))).toBeLessThan(xs.indexOf(Math.min(...xs))) // forward first
    expect(xs.at(-1)).toBeCloseTo(0, 1)
    stop()
  })

  it('dragging left pushes left; a pause before letting go uses up the momentum', () => {
    const stop = auto()
    const c = container()
    const { el, anims } = fakeEl('input', { type: 'range', min: '0', max: '100', value: '80' }, c)
    down(el, 52)
    for (const v of [70, 60, 50]) setValue(el, v)
    clock += 5
    up(52)
    expect(Math.min(...anims[0]!.keyframes.map((k) => translateOf(k)[0]))).toBeLessThan(-5)

    const { el: el2, anims: anims2 } = fakeEl('input', { type: 'range', min: '0', max: '100', value: '20' }, c)
    clock += 3000
    down(el2, 53)
    for (const v of [30, 40, 50]) setValue(el2, v)
    clock += 700 // held still for 0.7s
    up(53)
    const peak = Math.max(...anims2.flatMap((a) => a.keyframes.map((k) => Math.abs(translateOf(k)[0]))))
    expect(peak).toBeLessThan(1)
    stop()
  })

  it('keyboard: a small nudge once the value stops changing', async () => {
    const stop = auto()
    const { el, anims } = fakeEl('input', { type: 'range', min: '0', max: '100', value: '50' }, container())
    el.dispatchEvent(new FocusEvent('focusin', { bubbles: true })) // remembers where it starts
    setValue(el, 51, 200)
    setValue(el, 52, 30) // key repeat
    expect(anims).toHaveLength(0)
    await new Promise((r) => setTimeout(r, 120))
    const xs = anims[0]!.keyframes.map((k) => translateOf(k)[0])
    expect(Math.max(...xs)).toBeGreaterThanOrEqual(1.4)
    expect(Math.max(...xs)).toBeLessThan(3)
    stop()
  })

  it('custom role="slider": follows aria-valuenow, first change included', async () => {
    const stop = auto()
    const { el, anims } = fakeEl('div', { role: 'slider', 'aria-valuemin': '0', 'aria-valuemax': '10', 'aria-valuenow': '5' }, container())
    clock += 16
    el.setAttribute('aria-valuenow', '7')
    await new Promise((r) => setTimeout(r, 120))
    expect(Math.max(...anims[0]!.keyframes.map((k) => translateOf(k)[0]))).toBeGreaterThan(1)
    stop()
  })
})

describe('stepper', () => {
  const tys = (a: FakeAnim) => a.keyframes.map((k) => stateOf(k).ty)

  it('number input: pressed like a field, lifted when the value goes up, dropped when it goes down', () => {
    const stop = auto()
    const { el, anims } = fakeEl('input', { type: 'number', value: '3' }, container())
    down(el, 61)
    expect(scaleOf(anims.at(-1)!.keyframes.at(-1)!)[1]).toBeCloseTo(0.98 * 0.975, 3) // not a button press
    up(61)
    clock += 2000
    setValue(el, 4) // the value attribute still says 3, so the first step counts
    expect(Math.min(...tys(anims.at(-1)!))).toBeLessThan(-1)
    clock += 2000
    setValue(el, 3)
    expect(Math.max(...tys(anims.at(-1)!))).toBeGreaterThan(1)
    stop()
  })

  it('number input: an unchanged or non-numeric value does not move it', () => {
    const stop = auto()
    const { el, anims } = fakeEl('input', { type: 'number', value: '3' }, container())
    setValue(el, 3)
    expect(anims).toHaveLength(0)
    clock += 2000
    ;(el as HTMLInputElement).value = 'x'
    el.dispatchEvent(new Event('input', { bubbles: true }))
    expect(anims).toHaveLength(0)
    clock += 2000
    setValue(el, 4)
    expect(Math.min(...tys(anims.at(-1)!))).toBeLessThan(-1) // a NaN would have stuck to the channel for good
    stop()
  })

  it('aria-valuenow: a spinbutton is bumped, a slider still gets its momentum, a progressbar nothing', async () => {
    const stop = auto()
    const c = container()
    const attrs = { 'aria-valuemin': '0', 'aria-valuemax': '10', 'aria-valuenow': '5' }
    const { el: spin, anims: spinAnims } = fakeEl('div', { role: 'spinbutton', ...attrs }, c)
    const { el: slider, anims: sliderAnims } = fakeEl('div', { role: 'slider', ...attrs }, c)
    const { el: bar, anims: barAnims } = fakeEl('div', { role: 'progressbar', ...attrs }, c)
    clock += 16
    for (const el of [spin, slider, bar]) el.setAttribute('aria-valuenow', '7')
    await tick()
    expect(Math.min(...tys(spinAnims.at(-1)!))).toBeLessThan(-1) // straight away, no waiting for a stop
    expect(barAnims).toHaveLength(0)
    await new Promise((r) => setTimeout(r, 120))
    expect(Math.max(...sliderAnims[0]!.keyframes.map((k) => translateOf(k)[0]))).toBeGreaterThan(1)
    stop()
  })
})

describe('tab indicator', () => {
  /**
   * A tablist whose layout we fake: tabs laid end to end along the track, and
   * an indicator CSS left sitting on the first one.
   */
  function tablist(sizes = [60, 80, 100], vertical = false) {
    const list = container()
    list.setAttribute('role', 'tablist')
    if (vertical) list.setAttribute('aria-orientation', 'vertical')
    const lay = (el: Element, offset: number, size: number) => {
      Object.defineProperty(el, vertical ? 'offsetTop' : 'offsetLeft', { value: offset, configurable: true })
      Object.defineProperty(el, vertical ? 'offsetHeight' : 'offsetWidth', { value: size, configurable: true })
      Object.defineProperty(el, 'offsetParent', { value: list, configurable: true })
    }
    const { el: ind } = fakeEl('span', { 'data-jello-indicator': '' }, list)
    lay(ind, 0, sizes[0]!)
    let at = 0
    const tabs = sizes.map((s, i) => {
      const { el } = fakeEl('button', { role: 'tab', 'aria-selected': String(i === 0) }, list)
      lay(el, at, s)
      at += s
      return el
    })
    return { ind, tabs }
  }

  it('snaps onto the already-selected tab at bind time, without animating', () => {
    const { ind, tabs } = tablist()
    tabs[0]!.setAttribute('aria-selected', 'false')
    tabs[1]!.setAttribute('aria-selected', 'true')
    const stop = auto()
    const a = animsOf(ind).at(-1)!
    expect(stateOf(a.keyframes[0]!).tx).toBeCloseTo(70, 1) // (60 + 80/2) − (0 + 60/2)
    expect(stateOf(a.keyframes[0]!)).toEqual(stateOf(a.keyframes.at(-1)!)) // placed, not travelled
    stop()
  })

  it('glides onto a newly selected tab: its centre, its width, same height', async () => {
    const { ind, tabs } = tablist()
    const stop = auto()
    tabs[0]!.setAttribute('aria-selected', 'false')
    tabs[2]!.setAttribute('aria-selected', 'true')
    await tick()
    const a = animsOf(ind).at(-1)!
    const end = stateOf(a.keyframes.at(-1)!)
    expect(end.tx).toBeCloseTo(160, 1) // (140 + 100/2) − (0 + 60/2)
    expect(end.sx).toBeCloseTo(100 / 60, 2)
    expect(end.sy).toBeCloseTo(1, 2)
    expect(stateOf(a.keyframes[0]!).tx).toBeCloseTo(0, 1) // starts where it was
    expect(Math.min(...a.keyframes.map((k) => stateOf(k).sy))).toBeLessThan(0.99) // stretched on the way
    stop()
  })

  it('follows aria-orientation="vertical" down the y axis, taking the height instead', async () => {
    const { ind, tabs } = tablist([60, 80, 100], true)
    const stop = auto()
    tabs[0]!.setAttribute('aria-selected', 'false')
    tabs[2]!.setAttribute('aria-selected', 'true')
    await tick()
    const a = animsOf(ind).at(-1)!
    const end = stateOf(a.keyframes.at(-1)!)
    expect(end.ty).toBeCloseTo(160, 1) // (140 + 100/2) − (0 + 60/2)
    expect(end.sy).toBeCloseTo(100 / 60, 2) // the tab's height
    expect(end.sx).toBeCloseTo(1, 2) // width untouched, the mirror of the horizontal case
    expect(end.tx).toBeCloseTo(0, 1) // and it never moved sideways
    expect(Math.min(...a.keyframes.map((k) => stateOf(k).sx))).toBeLessThan(0.99) // narrowed on the way down
    stop()
  })

  it('a tablist without an indicator just pops the tab', async () => {
    const stop = auto()
    const list = container()
    list.setAttribute('role', 'tablist')
    const { el: tab, anims } = fakeEl('button', { role: 'tab', 'aria-selected': 'false' }, list)
    tab.setAttribute('aria-selected', 'true')
    await tick()
    expect(anims).toHaveLength(1)
    stop()
  })
})

describe('accordion', () => {
  /** <details> whose layout we fake: closed 40px tall, open 140px. */
  function details(parent: Element, name?: string) {
    const d = document.createElement('details')
    if (name) d.setAttribute('name', name)
    const s = document.createElement('summary')
    s.textContent = 'Title'
    const p = document.createElement('p')
    p.textContent = 'Body'
    d.append(s, p)
    Object.defineProperty(s, 'offsetHeight', { value: 40, configurable: true })
    Object.defineProperty(s, 'offsetWidth', { value: 200, configurable: true })
    s.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 40, right: 200, bottom: 40, x: 0, y: 0 }) as DOMRect
    Object.defineProperty(d, 'offsetHeight', { get: () => (d.open ? 140 : 40), configurable: true })
    parent.append(d)
    return { d, s, p }
  }
  const heights = (a: FakeAnim) => a.keyframes.map((k) => parseFloat(String(k.height)))
  // A plain Event: browsers and happy-dom both skip the built-in toggle for it, so only jello's handling runs.
  // (happy-dom toggles <details> before the click reaches document; real browsers do it after dispatch.)
  const click = (el: Element) => el.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }))

  it('opening: the height drops past its natural size and pulls back; the content falls in', () => {
    const stop = auto()
    const { d, s, p } = details(container())
    expect(click(s)).toBe(false) // the browser's instant toggle is taken over
    expect(d.open).toBe(true)
    const h = heights(animsOf(d)[0]!)
    expect(h[0]).toBe(40)
    expect(Math.max(...h)).toBeGreaterThan(150) // ≈ 16% past the 100px it grows by
    expect(h.at(-1)).toBe(140)
    const kid = animsOf(p)[0]!.keyframes
    expect(translateOf(kid[0]!)[1]).toBeCloseTo(-28, 0) // starts tucked under the title
    expect(Math.max(...kid.map((k) => translateOf(k)[1]))).toBeGreaterThan(2) // falls a little past
    expect(translateOf(kid.at(-1)!)[1]).toBeCloseTo(0, 2)
    expect(Number(kid[0]!.opacity)).toBe(0)
    expect(animsOf(s).length).toBe(0) // the title stays still
    stop()
  })

  it('pressing the title only shows the dimple', () => {
    const stop = auto()
    const { s } = details(container())
    down(s, 61, 30, 20)
    expect(animsOf(s)).toHaveLength(0)
    expect(s.querySelector('[data-jello-dent]')).not.toBeNull()
    up(61)
    stop()
  })

  it('closing: folds up without cutting into the title, then removes `open`', () => {
    const stop = auto()
    const { d, s } = details(container())
    click(s)
    clock += 2000
    animsOf(d).at(-1)!.onfinish!()
    click(s)
    expect(d.open).toBe(true) // still visible while folding
    const a = animsOf(d).at(-1)!
    const h = heights(a)
    expect(h[0]).toBe(140)
    expect(Math.min(...h)).toBeGreaterThanOrEqual(40)
    expect(h.at(-1)).toBe(40)
    clock = endOf(a)
    a.onfinish!()
    expect(d.open).toBe(false)
    stop()
  })

  it('re-opening mid-fold continues from where it is', () => {
    const stop = auto()
    const { d, s } = details(container())
    click(s)
    clock += 2000
    animsOf(d).at(-1)!.onfinish!()
    click(s) // close
    const closing = animsOf(d).at(-1)!
    clock += 100
    click(s) // open again
    const reopening = animsOf(d).at(-1)!
    const at = sampleAt(closing, clock, (k) => parseFloat(String(k.height)))
    expect(Math.abs(heights(reopening)[0]! - at)).toBeLessThan(2)
    expect(d.open).toBe(true)
    stop()
  })

  it('exclusive groups (name=…): the open one folds shut instead of snapping', () => {
    const stop = auto()
    const c = container()
    const a = details(c, 'faq')
    const b = details(c, 'faq')
    click(a.s)
    clock += 2000
    animsOf(a.d).at(-1)!.onfinish!()
    click(b.s)
    expect(b.d.open).toBe(true)
    expect(a.d.open).toBe(true) // still folding
    expect(a.d.hasAttribute('name')).toBe(false)
    const fold = animsOf(a.d).at(-1)!
    expect(heights(fold).at(-1)).toBe(40)
    clock = endOf(fold)
    fold.onfinish!()
    expect(a.d.open).toBe(false)
    expect(a.d.getAttribute('name')).toBe('faq')
    stop()
  })

  it('opened by code: drops open too (no flash — runs before paint)', async () => {
    const stop = auto()
    const { d } = details(container())
    d.open = true
    await tick()
    const h = heights(animsOf(d)[0]!)
    expect(h[0]).toBe(40)
    expect(h.at(-1)).toBe(140)
    stop()
  })

  it('ARIA accordion: aria-expanded="true" drops the controlled panel open, the header stays still', async () => {
    const stop = auto()
    const c = container()
    const { el: btn, anims: btnAnims } = fakeEl('button', { 'aria-expanded': 'false', 'aria-controls': 'panel-1' }, c)
    const panel = document.createElement('div')
    panel.id = 'panel-1'
    panel.hidden = true
    panel.append(document.createElement('p'))
    Object.defineProperty(panel, 'offsetHeight', { get: () => (panel.hidden ? 0 : 120), configurable: true })
    c.append(panel)
    // what the app does on click:
    panel.hidden = false
    btn.setAttribute('aria-expanded', 'true')
    await tick()
    const h = heights(animsOf(panel)[0]!)
    expect(h[0]).toBe(0)
    expect(Math.max(...h)).toBeGreaterThan(130)
    expect(h.at(-1)).toBe(120)
    expect(btnAnims).toHaveLength(0)
    stop()
  })

  it('reduced motion: no take-over, the browser toggles as usual', () => {
    configure({ reducedMotion: 'always' })
    const stop = auto()
    const { s } = details(container())
    expect(click(s)).toBe(true)
    stop()
  })

  /** <ul data-jello-height> whose layout we fake: 30px per row. */
  function list() {
    const ul = document.createElement('ul')
    ul.setAttribute('data-jello-height', '')
    Object.defineProperty(ul, 'offsetHeight', { get: () => ul.children.length * 30, configurable: true })
    document.body.append(ul)
    return ul
  }
  const li = () => document.createElement('li')

  it('data-jello-height: the height springs when a row is added, and when one is removed', async () => {
    const ul = list()
    ul.append(li(), li()) // 60px before anything is watching
    const stop = auto()

    ul.append(li())
    await tick()
    const grow = heights(animsOf(ul)[0]!)
    expect(grow[0]).toBe(60) // the height it had, not the one it has
    expect(Math.max(...grow)).toBeGreaterThan(93) // past the 30px it grows by, then back
    expect(grow.at(-1)).toBe(90)
    clock = endOf(animsOf(ul)[0]!)
    animsOf(ul)[0]!.onfinish!()

    ul.lastElementChild!.remove()
    await tick()
    const shrink = heights(animsOf(ul).at(-1)!)
    expect(shrink[0]).toBe(90)
    expect(Math.min(...shrink)).toBeLessThan(57)
    expect(shrink.at(-1)).toBe(60)
    stop()
  })

  it('data-jello-height: shrinking to an empty list never bakes a negative height', async () => {
    const ul = list()
    ul.append(li()) // 30px
    const stop = auto()
    ul.firstElementChild!.remove() // filtered down to nothing
    await tick()
    const h = heights(animsOf(ul)[0]!)
    expect(Math.min(...h)).toBe(0) // the spring overshoots past 0 — clamped, not rejected by CSS
    expect(h.at(-1)).toBe(0)
    stop()
  })

  it('data-jello-height: a change that leaves the height alone does not animate', async () => {
    const ul = list()
    ul.append(li())
    const stop = auto()
    ul.replaceChild(li(), ul.firstElementChild!) // one in, one out
    await tick()
    expect(animsOf(ul)).toHaveLength(0)
    stop()
  })
})
