// esbuild.config.js
const { build } = require('esbuild');
const {polyfillNode} = require('esbuild-plugin-polyfill-node');

const builds = [
  { entry: 'src/background/service-worker.ts', out: 'dist/background/service-worker.js', format: 'iife' },
  { entry: 'src/popup.ts', out: 'dist/popup.js', format: 'iife' },
  { entry: 'src/content/intercept.ts', out: 'dist/content/intercept.js', format: 'iife' },
  { entry: 'src/content/content.ts', out: 'dist/content/content.js', format: 'iife' },
  { entry: 'src/content/inject-api.ts', out: 'dist/content/inject-api.js', format: 'iife' },
  { entry: 'src/background/offscreen/offscreen.ts', out: 'dist/background/offscreen/offscreen.js', format: 'iife' },
];

// Common options for all builds
const commonOpts = {
  bundle: true,
  platform: 'browser',         // important: resolve browser fields and avoid node platform default
  target: ['es2020'],         // adjust to your target browsers
  sourcemap: true,
  minify: false,
  logLevel: 'info',
  plugins: [
    polyfillNode(),           // polyfills for many node builtins
  ],
  define: {
    // make conditional code behave like browser env
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
    global: 'window', // some libs expect global
  },
  loader: {
    '.ts': 'ts',
    '.svg': 'file',
    '.png': 'file',
    '.json': 'json'
  },
  // If some node builtins still appear and you want to exclude them from bundling:
  external: [
    // 'fs', 'net', 'tls'   // example: mark server-only modules as external to avoid bundling
  ],
};

(async () => {
  try {
    for (const b of builds) {
      // run each build separately so we can set different `format`/outfile pair
      await build({
        ...commonOpts,
        entryPoints: [b.entry],
        outfile: b.out,
        format: b.format,  // 'iife' in your setup — use 'esm' if you prefer for some entries
      });
      console.log(`built ${b.entry} → ${b.out}`);
    }
    console.log('All builds done');
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
