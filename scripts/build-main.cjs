/* Builds Electron main + preload bundles with esbuild. */
const esbuild = require('esbuild');
const path = require('node:path');

const production = process.argv.includes('--prod') || process.env.NODE_ENV === 'production';

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  sourcemap: !production,
  minify: production,
  legalComments: 'none',
  external: ['electron', 'better-sqlite3'],
  logLevel: 'info',
};

async function main() {
  await esbuild.build({
    ...common,
    entryPoints: [path.resolve(__dirname, '../src/main/index.ts')],
    outfile: path.resolve(__dirname, '../dist/main/index.js'),
  });
  await esbuild.build({
    ...common,
    entryPoints: [path.resolve(__dirname, '../src/preload/index.ts')],
    outfile: path.resolve(__dirname, '../dist/preload/index.cjs'),
  });
  console.log('main+preload build complete');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
