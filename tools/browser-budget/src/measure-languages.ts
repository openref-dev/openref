/**
 * `node tools/browser-budget/dist/measure-languages.js [--out=FILE]`
 *
 * The page the `page-bytes` budget is written about, measured with all fifteen sample languages on
 * it and again with each one taken off, in one browser on one machine.
 *
 * IT REPORTS AND IT GATES NOTHING. The ceilings are the study's to check and the record is the
 * maintainer's to write; this prints two numbers that a decision needs and nothing else. Where it
 * cannot establish one of them it fails rather than printing a figure it could not stand behind.
 *
 * THE ORDER OF THE MEASUREMENTS IS PART OF THE METHOD. The page with all fifteen is measured
 * twice, once as the fixture serves it and once through the same interception every variant goes
 * through, because a route that refilled a response would move the reported byte count for every
 * variant and leave the deltas looking clean. The two have to agree before any delta is believed.
 *
 * THE SUM IS CHECKED AGAINST THE WHOLE. The page with all fifteen taken off is measured as well,
 * and the fifteen individual costs have to add up to it. Fifteen deltas that do not sum to the one
 * measurement of removing all fifteen would mean the regions overlap or that something else on the
 * page moved with them, and either way the table would be attributing bytes it had not measured.
 */

import { writeFileSync } from 'node:fs';
import { SAMPLE_LANGUAGES } from '@openref/samples';
import { launchChrome, CHROME_ARGS } from './chrome.js';
import { currentEnvironment, type MeasurementEnvironment } from './environment.js';
import { bootFixture } from './fixture/boot.js';
import {
  pageWithout,
  readStateBlock,
  servedCodeBlockBytes,
  theSampleList,
} from './language-cost.js';
import { measurePage, type ParsedBytes } from './measure.js';
import { TTI_PAGE, TTI_PAGE_MARKER } from './study.js';
import type { LanguageCost } from './language-cost.js';

/** What this run established, as the file it writes. */
interface LanguageReport {
  readonly environment: MeasurementEnvironment;
  readonly browser: { readonly version: string; readonly major: number };
  readonly chromeArgs: readonly string[];
  readonly page: string;
  /** The three columns of `page-bytes`, with every language on the page. */
  readonly parsedBytes: ParsedBytes;
  /** Their sum, which is the quantity the budget names. */
  readonly pageBytes: number;
  /** What the fifteen cost one at a time. */
  readonly languages: readonly LanguageCost[];
  /** What they cost together, measured rather than summed. */
  readonly allFifteenBytes: number;
  /** The one server drawn code block, which belongs to no language. */
  readonly servedCodeBlockBytes: number | null;
}

const args = process.argv.slice(2);
const out = args.find((arg) => arg.startsWith('--out='))?.split('=')[1];

const report = await (async (): Promise<LanguageReport> => {
  const chrome = await launchChrome();
  const fixture = await bootFixture('large').catch(async (cause: unknown) => {
    await chrome.close();
    throw cause;
  });

  try {
    const url = `${fixture.url}${TTI_PAGE}`;
    const served = await (await fetch(url)).text();

    // THE SAME GUARD THE STUDY KEEPS, for the same reason: a fixture is allowed to change and a
    // harness measuring its 404 page would report a very small number with great confidence.
    if (!served.includes(TTI_PAGE_MARKER)) {
      throw new Error(
        `${url} does not carry "${TTI_PAGE_MARKER}", so the page being measured is not the ` +
          'thousand node operation page the page-bytes budget is written about',
      );
    }

    const onThePage = theSampleList(readStateBlock(served).json);
    const expected = SAMPLE_LANGUAGES.map((language) => language.id);
    if (onThePage.join(',') !== expected.join(',')) {
      throw new Error(
        `the page carries [${onThePage.join(', ')}] where the declared set is ` +
          `[${expected.join(', ')}], so the table would not be about the page language set`,
      );
    }

    const withAll = await measurePage(chrome.browser, { url, throttleRate: 1 });

    // THE CONTROL. The same page, through the same interception, with the transform doing
    // nothing. A byte count that moves here is a property of the instrument and would sit inside
    // every delta below.
    const control = await measurePage(chrome.browser, {
      url,
      throttleRate: 1,
      transformHtml: (html) => html,
    });

    if (control.parsedBytes.documentBytes !== withAll.parsedBytes.documentBytes) {
      throw new Error(
        `the page reads ${String(withAll.parsedBytes.documentBytes)} bytes when it is served and ` +
          `${String(control.parsedBytes.documentBytes)} through the interception every variant ` +
          'goes through, so no difference measured that way would be the language it removed',
      );
    }

    if (control.parsedBytes.documentBytes !== Buffer.byteLength(served, 'utf8')) {
      throw new Error(
        `the browser reports ${String(control.parsedBytes.documentBytes)} document bytes and the ` +
          `same response is ${String(Buffer.byteLength(served, 'utf8'))} bytes over HTTP, so the ` +
          'two instruments are not measuring one page',
      );
    }

    const languages: LanguageCost[] = [];
    for (const language of SAMPLE_LANGUAGES) {
      const variant = await measurePage(chrome.browser, {
        url,
        throttleRate: 1,
        transformHtml: (html) => pageWithout(html, [language]),
      });

      // ONLY THE DOCUMENT MAY MOVE. A stylesheet or a chunk that changed size between two runs of
      // one page would mean the variant is not the same page minus one language.
      if (
        variant.parsedBytes.cssBytes !== withAll.parsedBytes.cssBytes ||
        variant.parsedBytes.jsBytes !== withAll.parsedBytes.jsBytes
      ) {
        throw new Error(
          `taking "${language.id}" off the page moved the CSS or the JS column, so the difference ` +
            'in the document column is not what that language costs',
        );
      }

      languages.push({
        id: language.id,
        label: language.label,
        level: language.level,
        withAll: withAll.parsedBytes.documentBytes,
        without: variant.parsedBytes.documentBytes,
        bytes: withAll.parsedBytes.documentBytes - variant.parsedBytes.documentBytes,
      });
    }

    const none = await measurePage(chrome.browser, {
      url,
      throttleRate: 1,
      transformHtml: (html) => pageWithout(html, SAMPLE_LANGUAGES),
    });

    const allFifteenBytes = withAll.parsedBytes.documentBytes - none.parsedBytes.documentBytes;
    const summed = languages.reduce((total, language) => total + language.bytes, 0);

    // ONE BYTE APART, AND WHICH BYTE IS KNOWN. A list of n entries carries n-1 separators, so the
    // n costs taken one at a time charge n commas between them and taking all n off at once
    // charges n-1. Anything other than that one byte means the regions are not what they were
    // taken to be, and the table would be attributing bytes nothing measured.
    if (summed - 1 !== allFifteenBytes) {
      throw new Error(
        `the fifteen costs add up to ${String(summed)} bytes and taking all fifteen off measured ` +
          `${String(allFifteenBytes)}, which is not the one separator the two accounts differ by`,
      );
    }

    return {
      environment: currentEnvironment(),
      browser: { version: chrome.version, major: chrome.major },
      chromeArgs: CHROME_ARGS,
      page: TTI_PAGE,
      parsedBytes: withAll.parsedBytes,
      pageBytes:
        withAll.parsedBytes.documentBytes +
        withAll.parsedBytes.cssBytes +
        withAll.parsedBytes.jsBytes,
      languages,
      allFifteenBytes,
      servedCodeBlockBytes: servedCodeBlockBytes(served),
    };
  } finally {
    await fixture.stop();
    await chrome.close();
  }
})();

const lines = [
  '=== page bytes, and what each language costs the page ===',
  `environment    ${report.environment.id}`,
  `cpu            ${report.environment.cpuModel} x ${String(report.environment.cpuCount)}`,
  `chrome         ${report.browser.version} (major ${String(report.browser.major)})`,
  `page           ${report.page}`,
  '',
  `page-bytes     ${String(report.pageBytes)} bytes: ` +
    `${String(report.parsedBytes.documentBytes)} document, ` +
    `${String(report.parsedBytes.cssBytes)} CSS, ${String(report.parsedBytes.jsBytes)} JS`,
  `               fonts and the rest, which page-bytes does not count: ${String(report.parsedBytes.otherBytes)}`,
  '',
  'per language   the page with all fifteen, less the page with that one taken off',
  ...report.languages.map(
    (language) =>
      `               ${language.label.padEnd(12)} level ${String(language.level)}  ` +
      `${String(language.bytes).padStart(6)} bytes   ` +
      `page without it ${String(language.without)}`,
  ),
  `               ${'all fifteen'.padEnd(12)}          ${String(report.allFifteenBytes).padStart(6)} bytes   ` +
    `page without them ${String(report.parsedBytes.documentBytes - report.allFifteenBytes)}`,
  report.servedCodeBlockBytes === null
    ? '               the page draws no code block of its own'
    : `               the one server drawn code block, charged to no language: ` +
      `${String(report.servedCodeBlockBytes)} bytes`,
];

for (const line of lines) process.stdout.write(`${line}\n`);

if (out !== undefined) {
  writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`\nwritten to ${out}\n`);
}
