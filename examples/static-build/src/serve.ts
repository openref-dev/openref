import { buildEveryTarget, OUTPUT_ROOT, TARGETS } from './build-all.js';

/**
 * Runs the example.
 *
 * NOT A SERVER, AND IT SAYS SO. Every other example boots and listens; this one builds and
 * exits, because a static build has no runtime. `dist/serve.js` exists so that
 * `pnpm --filter @openref/example-static-build start` does the same thing the others do, and
 * the output directory is what a host would upload.
 */
const code = buildEveryTarget();

if (code === 0) {
  process.stdout.write(
    [
      '',
      `  ${String(TARGETS.length)} static builds, one per hosting target`,
      '',
      `  Output      ${OUTPUT_ROOT}`,
      '',
      '  Each directory is a whole site: one directory per page with its own index.html,',
      '  the search index, llms.txt, sitemap.xml and digest named assets. Open any',
      '  index.html from the file system; there is no server to start.',
      '',
      '  Compare nginx/ and github-pages/. The first carries a generated rewrite so the',
      '  console can send through the host. The second cannot rewrite, so its pages say so.',
      '',
      '',
    ].join('\n'),
  );
}

process.exitCode = code;
