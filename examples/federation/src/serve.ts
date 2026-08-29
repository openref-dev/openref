import { createDemo } from './main.js';
import { DEMO_CREDENTIALS } from './guards.js';

/**
 * Runs the three service demo, which is the milestone's single command.
 *
 * `--port` picks the gateway port, with 0 meaning "any free one". The chosen urls are printed
 * as one line of JSON on stdout first, so a test can read them rather than guess.
 */
async function serve(): Promise<void> {
  const args = process.argv.slice(2);
  const value = (name: string): string | undefined =>
    args.find((arg) => arg.startsWith(`--${name}=`))?.split('=')[1];

  const port = Number(value('port') ?? 4100);
  const demo = await createDemo(port);

  // THE JSON LINE IS AN INTERFACE AND THE PROSE IS NOT, the `nest-minimal` rule: the harness
  // reads the first line that parses as an object with a url, so nothing below it may start
  // with a brace.
  process.stdout.write(
    `${JSON.stringify({ ready: true, url: demo.gatewayUrl, services: demo.servicesUrl })}\n`,
  );
  process.stdout.write(
    [
      '',
      '  OPENREF federation demo: three services as one page',
      '',
      `  The federated reference   ${demo.gatewayUrl}/docs`,
      `  Billing, local            ${demo.gatewayUrl}/billing-docs`,
      `  Orders, remote            ${demo.servicesUrl}/orders-docs`,
      `  Payments, remote          ${demo.servicesUrl}/payments-docs`,
      '',
      '  One search covers all three. Each service group in the rail links its card and',
      '  carries the live status dot; stop this process and restart only the gateway to watch',
      '  a remote degrade.',
      '',
      '  Credentials for the try-it console, one session for the page:',
      `    billing    X-Api-Key: ${DEMO_CREDENTIALS.billingApiKey}`,
      `    orders     Bearer ${DEMO_CREDENTIALS.ordersBearer}`,
      `    payments   basic ${DEMO_CREDENTIALS.paymentsUser} / ${DEMO_CREDENTIALS.paymentsPassword}`,
      '',
      '',
    ].join('\n'),
  );
}

await serve();
