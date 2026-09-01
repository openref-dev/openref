import { createApp } from './main.js';

/**
 * Runs the example.
 *
 * `--port` picks the port, with 0 meaning "any free one". The address is printed as one line of
 * JSON on stdout, first, so a test reads it rather than guessing. Nothing below that line may
 * start with a brace.
 */
async function serve(): Promise<void> {
  const args = process.argv.slice(2);
  const value = (name: string): string | undefined =>
    args.find((arg) => arg.startsWith(`--${name}=`))?.split('=')[1];

  const port = Number(value('port') ?? 3200);

  const app = await createApp();
  await app.listen(port, '127.0.0.1');

  const url = await app.getUrl();

  process.stdout.write(`${JSON.stringify({ ready: true, url })}\n`);
  process.stdout.write(
    [
      '',
      '  An L0 theme: six token values, no bundle, no package',
      '',
      `  Reference   ${url}/docs`,
      '',
      '  The whole theme is src/acme.theme.ts. Delete the theme option in src/main.ts',
      '  and reload to see the default beside it.',
      '',
      '',
    ].join('\n'),
  );
}

await serve();
