import { createApp, type Platform } from './main.js';

/**
 * Runs the example.
 *
 * `--adapter=express|fastify` picks the platform and `--port` the port, with 0 meaning "any
 * free one". The chosen port is printed as one line of JSON on stdout, so a test can read it
 * rather than guess a number and race whatever else is listening on it.
 */
async function serve(): Promise<void> {
  const args = process.argv.slice(2);
  const value = (name: string): string | undefined =>
    args.find((arg) => arg.startsWith(`--${name}=`))?.split('=')[1];

  const platform: Platform = value('adapter') === 'fastify' ? 'fastify' : 'express';
  const port = Number(value('port') ?? 3000);

  const app = await createApp(platform);
  await app.listen(port, '127.0.0.1');

  const url = await app.getUrl();
  process.stdout.write(`${JSON.stringify({ ready: true, platform, url })}\n`);
}

await serve();
