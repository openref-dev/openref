import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootExampleApp, EXAMPLE_BASE_PATH, repositoryRoot } from '../../src/index';
import type { SpawnedServer } from '../../src/index';

/**
 * The README block, held against the page the demo actually serves, per BUILD T024 and SPEC 2.
 *
 * SPEC 2 says the README opens with a controller and with what the reference draws for it. That
 * block is the product's whole argument in eight lines, and it is also the single easiest thing
 * in this repository to leave behind: it is prose, nothing compiles it, and every reader who
 * evaluates OPENREF reads it before anything else. A README promising a rate limit the demo does
 * not report is the ordinary way this fails, and both files stay internally consistent while it
 * happens.
 *
 * ONE APPLICATION, NOT TWO, per the T024 amendment. `bootExampleApp` spawns the same
 * `examples/nest-minimal` that `pnpm demo` boots, from the same entry point. A fixture assembled
 * here from the same decorators would prove that the decorators work, which nobody doubts, and
 * would drift from the demo the first time either changed.
 *
 * READ OFF THE SERVED MARKUP RATHER THAN OFF THE MODEL. What the README claims is what a reader
 * sees, so the assertion goes through the rendered page: the labels in the order they are drawn,
 * and each value as its status and text. The provenance marks and the per contract `detail` are
 * deliberately not in the README block and so are not compared; the labels are compared as a
 * complete set, so a row added to the product and not to the README is a failure rather than an
 * omission nobody notices.
 */

const TIMEOUT = 120_000;

/** The page the README block is about. */
const LIST_PAGE = `${EXAMPLE_BASE_PATH}/get-orders`;

/** The demo file the README quotes from. */
const CONTROLLER = 'examples/nest-minimal/src/orders.controller.ts';

/** What an elided line in the quoted source looks like. */
const ELISION = '...';

let app: SpawnedServer;
let readme: string;
let page: string;

beforeAll(async () => {
  app = await bootExampleApp();
  readme = readFileSync(join(repositoryRoot(), 'README.md'), 'utf8');

  const response = await fetch(`${app.url}${LIST_PAGE}`);
  expect(response.status).toBe(200);
  page = await response.text();
}, TIMEOUT);

afterAll(async () => {
  await app.stop();
});

/**
 * Reads one fenced block out of the README.
 *
 * @param language - The word after the opening fence
 * @param contains - A line the wanted block carries, since the file has several per language
 * @returns The block's lines, without the fences
 * @throws Error when no block matches
 */
function block(language: string, contains: string): string[] {
  const fences = readme.split(`\`\`\`${language}\n`).slice(1);

  for (const fence of fences) {
    const body = fence.split('```')[0] ?? '';
    if (body.includes(contains)) return body.split('\n').filter((line) => line.trim() !== '');
  }

  throw new Error(`no ${language} block in README.md carrying ${contains}`);
}

/**
 * The runtime rows of the served page, as label and values.
 *
 * The markup is `dt` and `dd` pairs, and each value is one `oref-runtime-item` carrying an
 * optional status, the text, an optional note and the provenance mark. Only the status and the
 * text are read, because those are what the README block states.
 *
 * @returns The rows in the order the page draws them
 */
function servedRows(): { label: string; value: string }[] {
  const section = /<section class="oref-section oref-section-runtime">([\s\S]*?)<\/dl>/.exec(page);
  if (section === null) throw new Error('the served page carries no runtime block');

  const pairs = [
    ...(section[1] ?? '').matchAll(
      /<dt class="oref-runtime-label">(.*?)<\/dt><dd class="oref-runtime-value">(.*?)<\/dd>/g,
    ),
  ];

  return pairs.map((pair) => ({
    label: text(pair[1] ?? ''),
    value: [
      ...(pair[2] ?? '').matchAll(
        /<span class="oref-runtime-item">([\s\S]*?)(?=<span class="oref-runtime-item">|$)/g,
      ),
    ]
      .map((item) => valueOf(item[1] ?? ''))
      .join(', '),
  }));
}

/**
 * One item as the README states it: the status code and title, or the text alone.
 *
 * @param item - The item's inner markup
 * @returns Status and text, separated by a space when there is a status
 */
function valueOf(item: string): string {
  const status = /<span class="oref-status[^"]*">(.*?)<\/span>/.exec(item)?.[1] ?? '';
  const rest = item.replace(/<span class="oref-status[^"]*">.*?<\/span>/, '');
  const note = /<span class="oref-runtime-note">[\s\S]*?<\/span>/;
  const body = text(rest.replace(note, '').replace(/<abbr[\s\S]*?<\/abbr>/, ''));

  return status === '' ? body : `${text(status)} ${body}`;
}

/**
 * Markup to the text a reader sees.
 *
 * @param markup - A fragment
 * @returns Its text, with entities resolved and Vue's anchor comments removed
 */
function text(markup: string): string {
  return markup
    .replace(/<!---->/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

describe('the README block', () => {
  it(
    'should quote the demo controller line for line, in the order the file has them',
    () => {
      // Given the quoted controller and the file it is quoted from
      const quoted = block('ts', '@Controller').filter((line) => line.trim() !== ELISION);
      const source = readFileSync(join(repositoryRoot(), CONTROLLER), 'utf8');

      // When each quoted line is looked for after the one before it
      let at = -1;
      const missing: string[] = [];

      for (const line of quoted) {
        const found = source.indexOf(line.trim(), at + 1);
        if (found === -1) missing.push(line.trim());
        else at = found;
      }

      // Then, and the order matters: a README quoting real lines in an invented arrangement
      // describes an application nobody has
      expect(missing).toEqual([]);
    },
    TIMEOUT,
  );

  it(
    'should state the runtime rows the demo serves, every one of them and nothing else',
    () => {
      // Given the block's own rows, split on the column gap
      const lines = block('', 'GET /orders').filter((line) => !line.startsWith('GET '));
      const claimed = lines.map((line) => {
        const parts = line.split(/ {2,}/);

        return { label: (parts[0] ?? '').trim(), value: (parts[1] ?? '').trim() };
      });

      // When the page the README is about is read
      const served = servedRows();

      // Then every row matches, in order, and the set is complete on both sides
      expect(served).toEqual(claimed);
    },
    TIMEOUT,
  );

  it(
    'should be about the address the page is for',
    () => {
      // Given the first line of the block, which names the operation
      const heading = block('', 'GET /orders')[0] ?? '';

      // Then the page serves that operation. `oref-address` carries the method and path the
      // document declares, so a block moved to another operation stops matching here first.
      expect(page).toContain(heading.replace('GET ', ''));
      expect(page.toLowerCase()).toContain('get');
    },
    TIMEOUT,
  );
});
