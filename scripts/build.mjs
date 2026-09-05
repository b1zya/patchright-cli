// Bundles src/cli.ts into lib/cli.js. patchright-core stays external: the daemon,
// coreBundle and help.json are resolved from node_modules at runtime.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/cli.ts'],
  outfile: 'lib/cli.js',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: false,
  logLevel: 'info',
  external: ['patchright-core', 'patchright-core/*'],
});
