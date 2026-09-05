import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootExampleApp, EXAMPLE_BASE_PATH } from '../../src/index';
import type { SpawnedServer } from '../../src/index';

/**
 * The rows TX-COLLECTORS filled, read off the pages the demo actually serves.
 *
 * The README reproduction already holds the list operation's whole scale both ways; what it
 * cannot say is what the OTHER operations draw, and two of the four facts live there: the
 * required headers row is the receipt's, at INF with the engine's `=` beside it, and the
 * explicit success code is create's. Server markup, so this is fetched rather than driven.
 */

const TIMEOUT = 300_000;

const LIST_PAGE = `${EXAMPLE_BASE_PATH}/get-orders`;
const RECEIPT_PAGE = `${EXAMPLE_BASE_PATH}/get-orders-id-receipt`;
const CREATE_PAGE = `${EXAMPLE_BASE_PATH}/post-orders`;

let app: SpawnedServer;

beforeAll(async () => {
  app = await bootExampleApp();
}, TIMEOUT);

afterAll(async () => {
  await app.stop();
});

/** One parity row's chunk of a served page. */
function rowOf(page: string, kind: string): string {
  const rows = page.split('data-oref-parity="');
  const found = rows.find((row) => row.startsWith(`${kind}"`));
  if (found === undefined) throw new Error(`the page draws no ${kind} row`);

  return found;
}

describe('the rows TX-COLLECTORS filled, on the served pages', () => {
  it(
    'should draw the receipt required headers row at INF, with the engine staying quiet',
    async () => {
      // Given the internal route, whose token header is documented required and really refused
      const response = await fetch(`${app.url}${RECEIPT_PAGE}`);
      expect(response.status).toBe(200);
      const row = rowOf(await response.text(), 'required-headers');

      // Then the runtime cell carries the inferred claim with its wording, and the gutter is
      // the engine's `=`: SP011 examined the operation and stayed quiet, because the document
      // marks the header required
      expect(row).toContain('X-Internal-Token');
      expect(row).toContain('named required in guard metadata');
      expect(row).toContain('>INF<');
      expect(row).toContain('aria-label="match"');
      expect(row).not.toContain('oref-hatch');
    },
    TIMEOUT,
  );

  it(
    'should draw the explicit success code in the response codes cell of create',
    async () => {
      // Given `@HttpCode(201)` beside a documented 201
      const response = await fetch(`${app.url}${CREATE_PAGE}`);
      expect(response.status).toBe(200);
      const row = rowOf(await response.text(), 'response-codes');

      // Then the first value is the explicit success at derived, and no FixBar closes the row
      expect(row).toContain('success 201');
      expect(row).toContain('explicit @HttpCode');
      expect(row).not.toContain('oref-fixbar');
    },
    TIMEOUT,
  );

  it(
    'should close the list unread parameters row with SP010 and keep the hatch honest',
    async () => {
      // Given the operation that declares ten inputs and binds four
      const response = await fetch(`${app.url}${LIST_PAGE}`);
      expect(response.status).toBe(200);
      const page = await response.text();

      // Then the row is a real finding closed by its code, anchored to the health page
      const unread = rowOf(page, 'unread-parameters');
      expect(unread).toContain('4 of 10 seen read');
      expect(unread).toContain('>INF<');
      expect(unread).toContain('SP010');
      expect(unread).toContain('#oref-rule-parameter-unread');

      // And the row whose fact this operation does not have says which silence it is, on a real
      // served page: the collector ran on this application and had nothing to report here, which
      // since `TX-INSTRUMENT` is a different sentence from the one a missing collector gets
      const headers = rowOf(page, 'required-headers');
      expect(headers).toContain('oref-hatch');
      expect(headers).toContain(
        'headersCollector examined this route and found no required header. The route is silent, not unmeasured.',
      );
      expect(page).not.toContain('Nothing observed here.');
      expect(page).not.toContain('does not exist yet');
      expect(page).not.toContain('nothing reads yet');

      // And the reason is on the verdict too, where a reader who is not using a screen reader
      // can reach it. `aria-label` carried it alone until this.
      expect(headers).toContain('aria-label="comparison not run"');
      expect(headers).toContain(
        'title="headersCollector examined this route and found no required header.',
      );
    },
    TIMEOUT,
  );
});
