// Bundle size as an app would ship it: minified + gzip, with tree-shaking.
import { build } from 'esbuild'
import { gzipSync } from 'node:zlib'

const cases = {
  'everything': `export * from './src/index.ts'`,
  'jello() + auto() only': `export { jello, auto } from './src/index.ts'`,
  'effects only': `export { jiggle, shake, pop, hop } from './src/index.ts'`,
  'springEasing() only': `export { springEasing } from './src/index.ts'`,
  'tokens() only': `export { tokens } from './src/index.ts'`,
}

for (const [name, contents] of Object.entries(cases)) {
  const out = await build({
    stdin: { contents, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true,
    minify: true,
    format: 'esm',
    target: 'es2020',
    write: false,
  })
  const code = out.outputFiles[0].contents
  console.log(
    `${name.padEnd(24)} ${(code.length / 1024).toFixed(2).padStart(6)} kB min  ${(gzipSync(code).length / 1024).toFixed(2).padStart(5)} kB gzip`,
  )
}
