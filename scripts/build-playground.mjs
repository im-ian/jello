// Builds the demo page from playground/index.html.
//
//   node scripts/build-playground.mjs          → playground/dist/index.html (single file, bundle inlined)
//   node scripts/build-playground.mjs --site   → site/ (GitHub Pages: full HTML document + the library files)
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const page = read('../playground/index.html')
const MARK = '<!-- @jello-bundle -->'
if (!page.includes(MARK)) throw new Error('playground: bundle marker missing')

if (!process.argv.includes('--site')) {
  const bundle = read('../dist/jello.global.js').replace(/<\/script/gi, '<\\/script')
  const out = page.replace(MARK, () => `<script>\n${bundle}\n</script>`)
  mkdirSync(new URL('../playground/dist/', import.meta.url), { recursive: true })
  writeFileSync(new URL('../playground/dist/index.html', import.meta.url), out)
  console.log(`playground/dist/index.html  ${(Buffer.byteLength(out) / 1024).toFixed(1)} kB`)
} else {
  const split = page.indexOf('</style>') + '</style>'.length
  const head = page.slice(0, split)
  const body = page.slice(split).replace(MARK, '<script src="./jello.global.js"></script>')
  const doc = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="누른 자리가 말랑하게 들어가고, 놓으면 출렁이는 UI 피드백 라이브러리">
${head.trim()}
</head>
<body>
${body.trim()}
</body>
</html>
`
  const site = new URL('../site/', import.meta.url)
  mkdirSync(site, { recursive: true })
  writeFileSync(new URL('index.html', site), doc)
  copyFileSync(new URL('../dist/jello.global.js', import.meta.url), new URL('jello.global.js', site))
  copyFileSync(new URL('../dist/index.js', import.meta.url), new URL('jello.js', site))
  copyFileSync(new URL('../dist/jello.css', import.meta.url), new URL('jello.css', site))
  writeFileSync(new URL('.nojekyll', site), '')
  console.log('site/  index.html, jello.js, jello.global.js, jello.css')
}
