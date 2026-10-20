import { build } from 'esbuild'
import { rm } from 'node:fs/promises'
await rm('lib', { recursive: true, force: true })
await build({ entryPoints: ['src/index.ts'], bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22', outfile: 'lib/index.js' })
await build({
  entryPoints: ['src/client/index.tsx'], bundle: true, platform: 'browser', format: 'cjs',
  target: 'es2022', jsx: 'automatic', external: ['react', 'react/jsx-runtime', 'react-dom', 'react-dom/client'],
  outfile: 'lib/client.js',
  banner: { js: 'window.__ModuleLoader__.load({id:"dsh-prompt-translation",factory:(require)=>{var module={exports:{}};var exports=module.exports;' },
  footer: { js: 'return module.exports;}});' },
})
