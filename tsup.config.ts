import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    dts: true,
    clean: true,
    target: 'es2020',
    treeshake: true,
  },
  {
    // <script src="jello.global.js"> → window.Jello
    entry: { jello: 'src/index.ts' },
    format: ['iife'],
    globalName: 'Jello',
    minify: true,
    target: 'es2020',
  },
])
