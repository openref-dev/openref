import { describe, expect, it } from 'vitest';
import { normalizeAsyncApiDocument, normalizeOpenApiDocument } from '@openref/core';
import { largeDocument } from '../../../../packages/render/test/mocks/documents';
import {
  CHANNEL_ADDRESS,
  CHANNEL_GREETING,
  channelSpecification,
  largeSpecification,
  TTI_NODE_COUNT,
} from '../../src/fixture/specification';
import { TTI_PAGE, TTI_PAGE_MARKER } from '../../src/study';

/**
 * The margin this repository uses when a bound catches a hang rather than budgets a latency.
 *
 * An order of magnitude over the measured maximum, which is what
 * `packages/vue/test/integration/public-surface.spec.ts`,
 * `tools/gates/test/integration/published-surface-agreement.spec.ts` and
 * `packages/theme-telltale/test/integration/corpus.spec.ts` all name, check and derive from.
 */
const MARGIN = 10;

/**
 * What the four cases below that build a thousand node document measure, on the runner.
 *
 * TWENTY SIX INSTRUMENTED COVERAGE ARTEFACTS, and every one of them already existed. Six samples
 * on 2026-09-03 and twenty on 2026-09-03 and 2026-09-04, four vCPU `ubuntu-latest`, Node 22.22.2
 * and Node 24, across an AMD EPYC 7763, an EPYC 9V45 and an EPYC 9V74 as the pool handed them out.
 *
 * THE DATA ALREADY HELD THIS CASE AND THE ANALYSIS MISSED IT, WHICH IS THE PART WORTH RECORDING.
 * When six cases were given declared bounds on 2026-09-03 the derivation read ten of these
 * artefacts and named six members of the class. `should be the same document the jsdom ceilings
 * measure, hash included` was in those same ten files at 2,696 to 6,298 ms, over vitest's five
 * second default on the worst of them, and was not named. It then timed out in 5000ms on Node 22
 * and on Node 24, and was reported afterwards as a new finding. It was not new; it was unread. The
 * remedy is the same one this repository applies to any rule with no runner: the reading lives in
 * the file, beside the bound, where a case that grows past a tenth of the bound reddens rather than
 * waiting to be noticed.
 *
 * ALL FOUR MEMBERS ARE HERE, NOT ONLY THE ONE THAT WENT RED, and this is the second half of the
 * same lesson. The other three build the same thousand node document once where the first builds
 * it twice, and at 63, 62 and 48 percent of the five second default they were the next red run
 * waiting to happen. Naming only the member that failed is how the class came to be missed twice.
 */
const MEASURED = {
  /** `should be the same document the jsdom ceilings measure, hash included`: two documents. */
  hashIncludedMs: 6_298,
  /** `should carry the node count SPEC 20 writes the budget about`. */
  nodeCountMs: 3_135,
  /** `should be a real operation of the fixture, with the text the guard looks for`. */
  realOperationMs: 3_102,
  /** `should be a page out of the middle of the navigation rather than the first`. */
  middlePageMs: 2_407,
} as const;

/**
 * The hang catcher the four generating cases declare, because their cost is the generator.
 *
 * F25, AND THE CLASS IS THE ONE `vitest.spawn-timeout.ts` NAMES rather than the class vitest's five
 * second default was chosen for. Each of these cases writes a thousand operation OpenAPI document
 * out of `largeSpecification`, runs it through the real normalizer and, in the first case, does it
 * twice so two independent generators can be compared by hash. What that costs is set by the
 * document size and by V8's coverage instrumentation, and none of it is a property of the equality
 * being asserted, which is one string comparison and one map size.
 *
 * THE MARGIN IS CHECKED AND NOT ASSERTED IN PROSE. The last case in this file holds this number to
 * {@link MARGIN} over {@link MEASURED.hashIncludedMs}. 6,298 times ten is 62,980, and the value
 * adopted is the 120,000 that `packages/vue/test/integration/public-surface.spec.ts`,
 * `tools/gates/test/integration/published-surface-agreement.spec.ts` and
 * `tools/docs-site/test/integration/documentation-examples.spec.ts` already carry for this class.
 * Adopting it lowers no bound anybody had already found they needed, which is the property
 * `vitest.spawn-timeout.ts` asks of one number for a whole class. Against the four readings it
 * lands them between 19.1 and 49.9 times their own maximum, inside the 11.6 to 63.8 spread
 * `packages/theme-telltale/test/integration/corpus.spec.ts` derived and accepted for its members.
 *
 * NOTHING HERE IS TUNED AGAINST THIS NUMBER AND NOTHING SHOULD BE. It is a hang catcher, not a
 * budget. The three channel cases at the bottom of this file generate one channel, measure 1.2 to
 * 12.1 ms over the same twenty six artefacts, declare nothing and keep vitest's default, because
 * they are the class the default was chosen for. The global default in `vitest.config.ts` does not
 * move, and neither does any package config.
 */
const GENERATOR_HANG_CATCHER_MS = 120_000;

/**
 * The generated document is the one the jsdom ceilings already use.
 *
 * `client-cost.spec.ts` in `@openref/render` bounds hydration work on a thousand nodes cheaply
 * and in every CI run, and this package measures the same page in a real browser. They are only
 * two views of one thing while they measure one document. Two generators drifting apart would
 * leave both claiming a thousand nodes and measuring different pages, and nothing would say so.
 *
 * Read across the package boundary on purpose. It is a test reading a test fixture, not an
 * import edge in `src`, so the dependency graph is untouched; `theme.spec.ts` reads the
 * renderer's source from disk for the same reason and records it.
 */
describe('the document TTI is measured on', () => {
  it(
    'should be the same document the jsdom ceilings measure, hash included',
    () => {
      // Given
      const fromRenderMocks = largeDocument(TTI_NODE_COUNT);

      // When
      const fromFixture = normalizeOpenApiDocument(largeSpecification(TTI_NODE_COUNT));

      // Then
      expect(fromFixture.hash).toBe(fromRenderMocks.hash);
      expect(fromFixture.nodes.size).toBe(TTI_NODE_COUNT);
    },
    GENERATOR_HANG_CATCHER_MS,
  );

  it(
    'should carry the node count SPEC 20 writes the budget about',
    () => {
      // Given, the budget says a thousand nodes, so a fixture of nine hundred would pass a
      // threshold that was never about nine hundred.
      // When
      const document = normalizeOpenApiDocument(largeSpecification(TTI_NODE_COUNT));

      // Then
      expect(TTI_NODE_COUNT).toBe(1000);
      expect(document.nodes.size).toBe(1000);
    },
    GENERATOR_HANG_CATCHER_MS,
  );

  it('should hold the bound over the readings it was taken from, by the margin it claims', () => {
    // Given, the margin was a sentence in a comment when this class was first bounded and a
    // sentence cannot go red. Both the bound and the readings live here, so a case that grows past
    // a tenth of the bound reddens this and whoever finds it moves the number or changes the claim.

    // When
    const readings = Object.values(MEASURED);

    // Then, the whole class is covered and not only the member that happened to fail. The subject
    // is asserted present first: four readings, none of them zero.
    expect(readings.length).toBe(4);
    expect(Math.min(...readings)).toBeGreaterThan(0);
    for (const reading of readings) {
      expect(GENERATOR_HANG_CATCHER_MS / reading).toBeGreaterThanOrEqual(MARGIN);
    }
  });
});

/**
 * The page the study navigates to, held to the fixture it is read off.
 *
 * A route and a marker written out by hand beside a generated document are two facts that can
 * disagree, and when they disagreed the study threw instead of measuring. That is the right
 * failure and it is a slow one: it costs a runner round trip to find out. This is the same
 * check, in the suite that runs on every push.
 */
describe('the page the study measures', () => {
  it(
    'should be a real operation of the fixture, with the text the guard looks for',
    () => {
      // Given
      const document = normalizeOpenApiDocument(largeSpecification(TTI_NODE_COUNT));
      const id = TTI_PAGE.replace('/docs/', '');

      // When
      const node = document.nodes.get(id);

      // Then
      expect(node).toBeDefined();
      expect(node?.summary).toBe(TTI_PAGE_MARKER);
    },
    GENERATOR_HANG_CATCHER_MS,
  );

  it(
    'should be a page out of the middle of the navigation rather than the first',
    () => {
      // Given, because the first page of a document is the one whose navigation slice is cheapest
      const document = normalizeOpenApiDocument(largeSpecification(TTI_NODE_COUNT));

      // When
      const position = [...document.nodes.keys()].indexOf(TTI_PAGE.replace('/docs/', ''));

      // Then
      expect(position).toBe(500);
    },
    GENERATOR_HANG_CATCHER_MS,
  );
});

/**
 * The channel page the socket console is pressed on, held to the document it is read off.
 *
 * The same guard as the one above and for the same reason: `tx-socket-console.spec.ts` writes the
 * route out by hand, the node id is the normalizer's, and two facts that can disagree should say
 * so in the suite that runs on every push rather than in a browser run.
 */
describe('the channel page the socket console is proved on', () => {
  it('should be one channel node, at the address the browser case navigates to', () => {
    // Given
    const document = normalizeAsyncApiDocument(channelSpecification('127.0.0.1:1234'));

    // When
    const node = document.nodes.get('channel-orders-created');

    // Then
    expect([...document.nodes.keys()]).toEqual(['channel-orders-created']);
    expect(node?.kind).toBe('channel');
    expect(node?.kind === 'channel' ? node.address : '').toBe(CHANNEL_ADDRESS);
  });

  it('should declare exactly one server, which a browser can open a socket to', () => {
    // Given, because a channel whose only server speaks kafka draws a console whose Connect
    // button opens nothing, and a press proved against that would be proving the refusal
    const document = normalizeAsyncApiDocument(channelSpecification('127.0.0.1:1234'));

    // When
    const node = document.nodes.get('channel-orders-created');
    const servers = node?.kind === 'channel' ? node.servers : [];

    // Then
    expect(node?.kind === 'channel' ? node.protocol : '').toBe('ws');
    expect(servers.length).toBe(1);
    expect(servers[0]?.url).toBe('ws://127.0.0.1:1234');
  });

  it('should push a greeting the channel declares a message for', () => {
    // Given, because a pushed frame that matched nothing the document describes would be a shape
    // the reference never claimed, which is not what the window is being read for
    const payload: unknown = JSON.parse(CHANNEL_GREETING);

    // When
    const document = normalizeAsyncApiDocument(channelSpecification('127.0.0.1:1234'));
    const node = document.nodes.get('channel-orders-created');
    const messages = node?.kind === 'channel' ? node.messages : [];

    // Then
    expect(messages.length).toBe(1);
    expect(payload).toEqual({ id: 'ord_1024', quantity: 2 });
  });
});
