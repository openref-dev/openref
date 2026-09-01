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

  const port = Number(value('port') ?? 3300);

  const app = await createApp();
  await app.listen(port, '127.0.0.1');

  const url = await app.getUrl();

  process.stdout.write(`${JSON.stringify({ ready: true, url })}\n`);
  process.stdout.write(
    [
      '',
      '  HTTP and events from one application',
      '',
      `  HTTP        ${url}/docs`,
      `  Events      ${url}/docs/events`,
      `  AsyncAPI    ${url}/docs/events/asyncapi.json`,
      '',
      '  POST /orders publishes orders.created, and a handler in the same process',
      '  receives it. That edge is the thing neither document states on its own.',
      '',
      '',
    ].join('\n'),
  );
}

await serve();
