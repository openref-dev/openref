import { createApp } from './main.js';

/**
 * Runs the example.
 *
 * `--port` picks the port, with 0 meaning "any free one". The chosen address is printed as one
 * line of JSON on stdout, first, so a test reads it rather than guessing a number and racing
 * whatever else is listening. Nothing below that line may start with a brace.
 */
async function serve(): Promise<void> {
  const args = process.argv.slice(2);
  const value = (name: string): string | undefined =>
    args.find((arg) => arg.startsWith(`--${name}=`))?.split('=')[1];

  const port = Number(value('port') ?? 3100);

  const app = await createApp();
  await app.listen(port, '127.0.0.1');

  const url = await app.getUrl();

  process.stdout.write(`${JSON.stringify({ ready: true, url })}\n`);
  process.stdout.write(
    [
      '',
      '  Runtime intelligence, with one collector written by hand',
      '',
      `  Reference   ${url}/docs`,
      `  Health      ${url}/docs/health`,
      '',
      '  Open GET /inventory. Its scopes were read from a metadata key by',
      '  src/ability.collector.ts, and the page says so: derived, abilityCollector.',
      '  Then open POST /inventory/reserve, whose scope is declared, and GET',
      '  /inventory/{sku}, which is guarded and declares nothing at all.',
      '',
      '',
    ].join('\n'),
  );
}

await serve();
