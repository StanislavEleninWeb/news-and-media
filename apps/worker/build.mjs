// Bundles the worker (and the workspace packages it imports) into dist/.
// Native or very large npm packages are left external and installed in the image.
import { build } from 'esbuild';

// sharp: native, installed in the image. canvas: optional linkedom peer we never use.
const external = ['sharp', 'canvas'];

await build({
  entryPoints: ['src/index.ts', 'src/cli.ts', 'src/migrate.ts'],
  outdir: 'dist',
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  sourcemap: true,
  external,
  banner: {
    // Allow bundled CommonJS dependencies to call require() inside an ESM bundle.
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  logLevel: 'info',
});
