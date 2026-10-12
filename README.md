<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/wordmark-dark.svg">
    <img src="assets/wordmark.svg" alt="jello" width="220">
  </picture>
</p>

<p align="center">누른 자리가 말랑하게 들어가고, 놓으면 출렁이는 UI 피드백 라이브러리.</p>

<p align="center"><a href="https://im-ian.github.io/jello/"><b>데모 보기</b></a></p>

## 설치

```bash
npm install github:im-ian/jello
```

빌드 없이 쓰기:

```html
<script type="module">
  import { auto } from 'https://im-ian.github.io/jello/jello.js'
  auto()
</script>
```

`<script src="https://im-ian.github.io/jello/jello.global.js">`로 넣으면 `window.Jello`로 씁니다.

## 빠른 시작

```html
<button data-jello>장바구니 담기</button>
<button data-jello="bouncy">좋아요</button>

<form data-jello>                <!-- 안의 컨트롤 전부 -->
  <input type="email" required>
  <div data-jello="off">…</div>  <!-- 여기만 제외 -->
</form>
```

```js
import { auto } from 'jello'

auto() // 앱 시작 때 한 번. 나중에 그려진 요소에도 적용
```

React·Vue·Svelte도 같습니다. `auto()`를 한 번 부르고 컴포넌트에는 속성만 붙입니다.

## 속성

| 속성 | 값 | 설명 |
| --- | --- | --- |
| `data-jello` | 없음 · `firm` · `gentle` · `wobbly` · `bouncy` · `off` | 켜기, 프리셋, 끄기. 하위 요소에 적용 |
| `data-jello-pivot` | `pointer`(기본) · `origin` | 찌그러지는 기준점: 누른 자리 / CSS `transform-origin` |
| `data-jello-dent` | `off` | 누른 자리 보조개 끄기 |
| `data-jello-enter` | 숫자(선택, 기본 0.6) | DOM에 추가될 때 이 크기에서 튀어나옴 |
| `data-jello-indicator` | 없음 | `[role=tablist]` 안의 탭 인디케이터. 선택된 탭으로 미끄러짐 |

`data-jello-indicator`는 tablist의 `aria-orientation`을 따릅니다. 가로면 탭의 넓이에, `vertical`이면 높이에 맞춰요.

컨트롤이 들어 있는 요소에 붙이면 그 요소는 눌리지 않고 안의 컨트롤만 반응합니다. 컨트롤이 없는 요소(카드 등)는 그 자체가 눌립니다.

## 컴포넌트

| 종류 | 요소 | 동작 |
| --- | --- | --- |
| 누르기 | `button`, `a[href]`, `[role=button\|tab\|menuitem\|option]`, 카드 | 누른 자리 기준으로 찌그러졌다 출렁, 보조개 |
| 입력 | `input`, `textarea`, `select`, `contenteditable`, `[role=textbox\|combobox]` | 키보드 포커스 시 부풂, 입력할 때 흔들림, `invalid` 시 흔들기 |
| 스테퍼 | `input[type=number]`, `[role=spinbutton]` | 값이 오르면 위로 늘어나고, 내리면 아래로 눌림 |
| 토글 | `checkbox`, `radio`, `[role=switch\|checkbox\|radio]` | 체크 상태가 바뀌면 통통 |
| 탭 | `[role=tablist]` + `[data-jello-indicator]` | 선택된 탭으로 인디케이터가 미끄러지고 도착할 때 찌그러짐. 가로·세로 모두 |
| 슬라이더 | `input[type=range]`, `[role=slider]` | 손을 떼면 끌던 방향으로 밀렸다 돌아옴 |
| 아코디언 | `<details>`, `[aria-expanded][aria-controls]` | 제목은 고정, 내용 높이가 늘었다 탄성으로 수축 |
| 겹쳐 뜨는 요소 | `<dialog>`, `[popover]`, `[data-jello-enter]` | 열리거나 추가될 때 튀어나옴 |

`aria-checked`, `aria-pressed`, `aria-selected`, `aria-expanded`, `aria-invalid`, `aria-valuenow`가 바뀌어도 반응합니다. `aria-valuenow`는 `[role=slider]`와 `[role=spinbutton]`에서만 반응합니다.

## API

### `auto(options?) → stop()`

| 옵션 | 기본값 | 설명 |
| --- | --- | --- |
| `selector` | `'[data-jello]'` | 켤 요소 |
| `root` | `document` | 리스너를 붙일 곳 |
| `enter` | `true` | `[data-jello-enter]` 감지 |

그 밖의 옵션은 `jello()`와 같고 기본값으로 쓰입니다.

### `jello(target, options?) → handle`

```js
const h = jello('#buy', { preset: 'firm', tilt: 0 })
h.press()
h.release()
h.tap()
h.destroy()
```

`target`: 요소, 요소 목록, 선택자.

| 옵션 | 기본값 (wobbly) | 설명 |
| --- | --- | --- |
| `preset` | `'wobbly'` | `firm` · `gentle` · `wobbly` · `bouncy` |
| `squash` | `0.1` | 누를 때 찌그러지는 정도 |
| `depth` | `0.05` | 누를 때 작아지는 정도 |
| `tilt` | `3` | 누른 쪽으로 기우는 최대 각도(°). 가로로 긴 요소는 모서리가 6px보다 더 들리지 않도록 각도를 줄입니다 |
| `pivot` | `'pointer'` | `'pointer'` · `'origin'` |
| `dent` | `true` | 보조개 |
| `press` | `{ duration: 0.2, bounce: 0.25 }` | 누를 때 스프링 |
| `release` | `{ duration: 0.55, bounce: 0.65 }` | 놓을 때 스프링 |

### 효과

```js
import { jiggle, shake, pop, hop } from 'jello'

jiggle(el)               // 제자리에서 출렁
shake(input)             // 좌우로 흔들기
pop(badge)               // 살짝 부풀었다 돌아오기
pop(toast, { from: 0 })  // 0에서 튀어나오기
hop(icon)                // 웅크렸다 점프
```

모두 `{ strength }`(기본 1)를 받습니다.

### 스프링

```js
import { spring, solve, springEasing } from 'jello'

const s = spring({ duration: 0.5, bounce: 0.3 })  // 또는 { stiffness, damping, mass }
const [x, v] = solve(s, x0, v0, t)                // t초 뒤 변위와 속도

const e = springEasing({ duration: 0.5, bounce: 0.4 })
el.style.transition = `scale ${e}`                // "976ms linear(…)"
```

`duration`: 체감 속도(초). `bounce`: -1 ~ 1 (0 = 튀지 않음).

### `tokens(tree, options?) → theme`

디자인 토큰을 CSS 변수로 내보냅니다. 색·간격 같은 값은 그대로 지나가고, **스프링은 값이 됩니다**.

```js
import { spring, tokens } from 'jello'

const theme = tokens({
  color: { bg: '#f6f1f5', accent: '#d2234c' },
  motion: { press: spring({ duration: 0.5, bounce: 0.6 }) },
}, { prefix: 'app', dark: { color: { bg: '#1a121e' } } })

theme.apply()              // <style>를 넣습니다. 지우는 함수를 돌려줍니다
theme.var('color.bg')      // "var(--app-color-bg)"
```

```css
:root {
  --app-color-bg: #f6f1f5;
  --app-color-accent: #d2234c;
  --app-motion-press: 976ms linear(…);   /* transition 축약형 */
  --app-motion-press-duration: 976ms;
  --app-motion-press-easing: linear(…);
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { --app-color-bg: #1a121e; }
}
:root[data-theme="dark"] { --app-color-bg: #1a121e; }
```

같은 곡선을 JS 애니메이션과 손으로 쓴 transition이 함께 씁니다.

```css
.card { transition: scale var(--app-motion-press); }
```

| 옵션 | 기본값 | 설명 |
| --- | --- | --- |
| `prefix` | 없음 | 모든 변수 앞에 `--<prefix>-` |
| `dark` | 없음 | 다크 모드에서 덮어쓸 토큰. 적은 것만 다시 선언됩니다 |
| `selector` | `':root'` | 변수를 선언할 위치 |

중첩이 이름이 됩니다: `{ color: { bgSoft } }` → `--color-bg-soft`. `spring()`이 돌려준 값만 스프링으로 봅니다 — `{ duration, bounce }`는 숫자 토큰 두 개와 구분할 수 없으니 `spring()`을 먼저 씌우세요.

### `configure(options)`

```js
configure({ reducedMotion: 'user' })  // 'user'(기본) · 'always' · 'never'
configure({ driver: 'auto' })         // 'auto'(기본) · 'waapi' · 'raf'
```

### 직접 만든 효과

```js
import { motionFor, spring, impulse } from 'jello'

const s = spring({ duration: 0.6, bounce: 0.7 })
motionFor(el).update((c) => c.kick('tilt', impulse(s, 6), s))
```

채널: `shrink`, `grow`, `squash`, `tilt`(°), `x`, `y`(px). `c.to()`, `c.kick()`, `c.jump()`, `c.pivot()`, `c.later()`.

## CSS만 쓰기

```html
<link rel="stylesheet" href="https://im-ian.github.io/jello/jello.css">
<button class="jello">담기</button>
<button class="jello jello--gentle">다음</button>
```

누르기만 지원합니다.

## 동작 줄이기

`prefers-reduced-motion: reduce`이면 움직임 대신 투명도로 반응합니다.

## 주의

- 보조개를 위해 요소 안에 `<span data-jello-dent aria-hidden="true">`를 추가하고, `position: static`이면 `relative`로 바꿉니다. 원하지 않으면 `data-jello-dent="off"`.
- `display: inline` 요소에는 변형이 적용되지 않습니다. `inline-block`을 쓰세요.
- 같은 요소에 `auto()`와 `jello()`를 함께 쓰지 마세요.

## 브라우저

| 기능 | 버전 |
| --- | --- |
| JS | Chrome 104, Firefox 72, Safari 14.1 |
| `jello.css`, `springEasing()` | `linear()` 지원 브라우저 (2023년 12월 이후 주요 브라우저) |

## 개발

```bash
npm install
npm test
npm run build       # dist/
npm run site        # site/ (데모)
```

데모 미리보기:

```bash
npm run preview     # 빌드 후 http://127.0.0.1:4173 — 배포본과 같은 구성
npm run playground  # playground/dist/index.html — 한 파일, 브라우저로 바로 열기
```

`site/`는 라이브러리를 별도 파일로 불러오므로 `file://`로 열면 안 되고 `preview`가 필요합니다. `playground`는 번들을 끼워 넣은 한 파일이라 그냥 열어도 됩니다.
