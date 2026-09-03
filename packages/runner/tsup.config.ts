import { defineConfig } from 'tsup';

/**
 * THREE ENTRIES IN ONE BUILD, AND THE "ONE BUILD" HALF IS LOAD BEARING.
 *
 * The two narrow entries of `TX-SOCKET-CONSOLE` exist so a consumer's bundler can reach one engine
 * without the other, per the comments on `src/http.ts` and `src/socket.ts`. Three separate tsup
 * invocations were tried first and are wrong, measured rather than argued: each emits a self
 * contained declaration file, so `RequestRunner` from `@openref/runner` and `RequestRunner` from
 * `@openref/runner/http` become two nominal types, and `published-surface-agreement.spec.ts`
 * printed twelve pairs that no longer assign to each other, the private members among them. Two
 * sources of one name is the thing that check exists about.
 *
 * One build shares what the entries share, in the declarations as well as in the JavaScript, so a
 * name exported from two doors is one type. What it costs is that `dist/index.d.ts` is a re-export
 * of chunk files rather than the file that declares everything, which is a fact
 * `published-errors.spec.ts` now reads the whole declaration surface for rather than assuming.
 */
export default defineConfig({
  entry: ['src/index.ts', 'src/http.ts', 'src/socket.ts'],
  format: ['esm', 'cjs'],
  target: 'node20',
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  // THE JAVASCRIPT IS NOT SPLIT, which is the whole point on that side: a chunk shared between
  // `index.js` and `socket.js` would put back the one module both entries import, which is the
  // exact shape that made a reader who pressed Send download the socket engine.
  splitting: false,
  outExtension: ({ format }) => ({ js: format === 'cjs' ? '.cjs' : '.js' }),
});
