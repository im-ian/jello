// Builds the demo page from playground/index.html, which is a fragment: the
// document shell (doctype, charset, viewport) lives here so both outputs get it.
// Without the charset the file:// preview falls back to the locale encoding and
// the Korean text turns to mojibake — there is no Content-Type header off disk.
//
//   node scripts/build-playground.mjs          → playground/dist/index.html (single file, bundle inlined)
//   node scripts/build-playground.mjs --site   → site/ (GitHub Pages: the library as separate files)
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const page = read('../playground/index.html')
const MARK = '<!-- @jello-bundle -->'
if (!page.includes(MARK)) throw new Error('playground: bundle marker missing')
const split = page.indexOf('</style>')
if (split < 0) throw new Error('playground: <style> block missing')

const forSite = process.argv.includes('--site')
// Pages serves the library as its own file; the local preview inlines it so the page works straight off disk.
const script = forSite
  ? '<script src="./jello.global.js"></script>'
  : `<script>\n${read('../dist/jello.global.js').replace(/<\/script/gi, '<\\/script')}\n</script>`

// The jelly symbol as a data URI, so the single-file preview carries its own
// icon and neither output needs the file copied next to it. encodeURI leaves
// "#" alone (it reads as a fragment delimiter), which would cut the colours off.
const icon = encodeURI(read('../assets/jelly.svg').trim()).replace(/#/g, '%23')

const head = page.slice(0, split + '</style>'.length)
const body = page.slice(split + '</style>'.length).replace(MARK, () => script) // fn: a bundle can contain $&
const doc = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="누른 자리가 말랑하게 들어가고, 놓으면 출렁이는 UI 피드백 라이브러리">
<link rel="icon" href="data:image/svg+xml,${icon}">
${head.trim()}
</head>
<body>
${body.trim()}
</body>
</html>
`

if (!forSite) {
  mkdirSync(new URL('../playground/dist/', import.meta.url), { recursive: true })
  writeFileSync(new URL('../playground/dist/index.html', import.meta.url), doc)
  console.log(`playground/dist/index.html  ${(Buffer.byteLength(doc) / 1024).toFixed(1)} kB`)
} else {
  const site = new URL('../site/', import.meta.url)
  mkdirSync(site, { recursive: true })
  writeFileSync(new URL('index.html', site), doc)
  copyFileSync(new URL('../dist/jello.global.js', import.meta.url), new URL('jello.global.js', site))
  copyFileSync(new URL('../dist/index.js', import.meta.url), new URL('jello.js', site))
  copyFileSync(new URL('../dist/jello.css', import.meta.url), new URL('jello.css', site))
  writeFileSync(new URL('.nojekyll', site), '')
  console.log('site/  index.html, jello.js, jello.global.js, jello.css')
}
