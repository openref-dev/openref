/**
 * The excision the per language figures are measured through.
 *
 * WHAT IS PROVED HERE AND WHAT IS NOT. Nothing below opens a browser, so nothing below establishes
 * what a language costs; that is a measurement and it is taken on the runner. What is established
 * is the property the measurement rests on: that a cut takes exactly the two regions one language
 * contributes and nothing else, and that a cut which cannot be located refuses instead of returning
 * a page it guessed at.
 */

import { describe, expect, it } from 'vitest';
import {
  namedNotDrawnIn,
  objectEnd,
  pageWithout,
  readSampleArray,
  readStateBlock,
  servedCodeBlockBytes,
  tabRegion,
  theSampleList,
} from '../../src/language-cost';
import type { SampleLanguage } from '@openref/samples';

const CURL: SampleLanguage = { id: 'shell', label: 'cURL', level: 1, placement: 'page' };
const HTTPIE: SampleLanguage = { id: 'bash', label: 'HTTPie', level: 1, placement: 'page' };
const DART: SampleLanguage = { id: 'dart', label: 'Dart', level: 2, placement: 'page' };

/** A tab as the server draws it. */
function tab(label: string, active: boolean): string {
  return (
    `<button class="oref-send oref-sample-tab${active ? ' oref-active' : ''}" type="button" ` +
    `role="tab" aria-selected="${active ? 'true' : 'false'}">${label}</button>`
  );
}

/**
 * A page of the shape the fixture serves: a tab strip, one drawn block, and a state block whose
 * node carries one sample per language.
 *
 * @param languages - The languages on it
 * @returns The markup
 */
function page(languages: readonly SampleLanguage[]): string {
  const samples = languages.map((language) => ({
    lang: language.id,
    label: language.label,
    sourceHtml: `<pre class="oref-code" data-oref-lang="${language.id}"><code>call ${language.id}</code></pre>`,
  }));

  const state = JSON.stringify({
    node: {
      id: 'n1',
      codeSamples: samples,
      codeSamplesElsewhere: [
        { lang: 'php', label: 'PHP' },
        { lang: 'java', label: 'Java' },
        { lang: 'ruby', label: 'Ruby' },
      ],
    },
  }).replace(/</gu, '\\u003c');

  return (
    '<!doctype html><html><body><section class="oref-section oref-section-samples">' +
    `<div class="oref-tryit-actions oref-sample-tabs" role="tablist">${languages
      .map((language, index) => tab(language.label, index === 0))
      .join('')}</div>` +
    '<div class="oref-example oref-sample"><pre class="oref-code" data-oref-lang="shell">' +
    '<code>call shell</code></pre></div></section>' +
    `<script type="application/json" id="oref-state" nonce="AAA">${state}</script></body></html>`
  );
}

describe('readStateBlock', () => {
  it('should return the json of the state block and where it sits', () => {
    // Given
    const html = page([CURL, HTTPIE, DART]);

    // When
    const block = readStateBlock(html);

    // Then
    expect(html.slice(block.start, block.end)).toBe(block.json);
    expect(theSampleList(block.json)).toEqual(['shell', 'bash', 'dart']);
  });

  it('should refuse a page with no state block rather than measure one', () => {
    // Given
    const html = '<!doctype html><html><body>no state here</body></html>';

    // When / Then
    expect(() => readStateBlock(html)).toThrow(/no application\/json state block/u);
  });
});

describe('objectEnd', () => {
  it('should close on the brace that matches, ignoring braces inside strings', () => {
    // Given
    const json = '[{"lang":"go","sourceHtml":"a { b } \\" c"},{"lang":"php"}]';

    // When
    const end = objectEnd(json, 1);

    // Then
    expect(json.slice(1, end)).toBe('{"lang":"go","sourceHtml":"a { b } \\" c"}');
  });

  it('should refuse an object that never closes', () => {
    // Given
    const json = '{"lang":"go"';

    // When / Then
    expect(() => objectEnd(json, 0)).toThrow(/never closes/u);
  });
});

describe('tabRegion and readSampleArray', () => {
  it('should span exactly the tab element of one language', () => {
    // Given
    const html = page([CURL, HTTPIE, DART]);

    // When
    const region = tabRegion(html, DART);

    // Then
    expect(html.slice(region.start, region.end)).toBe(tab('Dart', false));
  });

  it('should span the whole sample list and read every entry in its order', () => {
    // Given
    const html = page([CURL, HTTPIE, DART]);

    // When
    const list = readSampleArray(readStateBlock(html));

    // Then
    expect(list.entries.map((entry) => entry.lang)).toEqual(['shell', 'bash', 'dart']);
    expect(html.slice(list.start, list.end)).toBe(
      `[${list.entries.map((entry) => entry.text).join(',')}]`,
    );
  });

  it('should refuse a language whose tab the page does not draw', () => {
    // Given a page whose strip lost a tab while its state kept the sample
    const html = page([CURL, HTTPIE, DART]).replace(tab('Dart', false), '');

    // When / Then
    expect(() => tabRegion(html, DART)).toThrow(/exactly one was expected/u);
  });
});

describe('pageWithout', () => {
  it('should leave the page the same as one served without that language', () => {
    // Given
    const all = page([CURL, HTTPIE, DART]);

    // When
    const cut = pageWithout(all, [DART]);

    // Then
    expect(cut).toBe(page([CURL, HTTPIE]));
  });

  it('should take every named language off in one cut', () => {
    // Given
    const all = page([CURL, HTTPIE, DART]);

    // When
    const cut = pageWithout(all, [HTTPIE, DART]);

    // Then
    expect(theSampleList(readStateBlock(cut).json)).toEqual(['shell']);
    expect(cut).not.toContain('HTTPie');
    expect(cut).not.toContain('Dart');
  });

  it('should charge the same bytes whichever order the languages come off in', () => {
    // Given
    const all = page([CURL, HTTPIE, DART]);
    const one = all.length - pageWithout(all, [HTTPIE]).length;
    const other = all.length - pageWithout(all, [DART]).length;

    // When
    const together = all.length - pageWithout(all, [HTTPIE, DART]).length;

    // Then: the regions are disjoint, so the parts add up to the whole
    expect(one + other).toBe(together);
  });

  it('should leave an empty list one separator short of the costs taken one at a time', () => {
    // Given a list of three, which carries two separators
    const all = page([CURL, HTTPIE, DART]);
    const singly = [CURL, HTTPIE, DART].reduce(
      (total, language) => total + (all.length - pageWithout(all, [language]).length),
      0,
    );

    // When every one of them comes off at once
    const together = all.length - pageWithout(all, [CURL, HTTPIE, DART]).length;

    // Then the three costs charge three separators between them and the list only had two
    expect(readSampleArray(readStateBlock(pageWithout(all, [CURL, HTTPIE, DART]))).entries).toEqual(
      [],
    );
    expect(singly - together).toBe(1);
  });

  it('should refuse a language the page does not carry', () => {
    // Given
    const all = page([CURL, HTTPIE]);

    // When / Then
    expect(() => pageWithout(all, [DART])).toThrow(/carries no "dart" sample/u);
  });

  it('should refuse a page carrying two sample lists, since no one strip owns the cost', () => {
    // Given a second sample list written into the same state block
    const doubled = page([CURL, HTTPIE]).replace(
      '{"node":{"id":"n1"',
      '{"other":{"codeSamples":[{"lang":"go"}]},"node":{"id":"n1"',
    );

    // When / Then
    expect(() => pageWithout(doubled, [HTTPIE])).toThrow(/2 sample lists/u);
  });
});

describe('servedCodeBlockBytes', () => {
  it('should report the one block the server draws', () => {
    // Given
    const html = page([CURL, HTTPIE]);

    // When
    const bytes = servedCodeBlockBytes(html);

    // Then
    expect(bytes).toBe(
      Buffer.byteLength(
        '<pre class="oref-code" data-oref-lang="shell"><code>call shell</code></pre>',
        'utf8',
      ),
    );
  });

  it('should report nothing rather than a guess when the page draws none', () => {
    // Given
    const html = '<!doctype html><html><body></body></html>';

    // When / Then
    expect(servedCodeBlockBytes(html)).toBeNull();
  });
});

/**
 * The languages a page names without drawing, read off the state block.
 *
 * WHY THE READER EXISTS AT ALL, and it is the same reason the tab regex does. The measurement
 * beside it reports what a page weighs, and a page that had silently dropped three languages would
 * be the lightest page this harness ever saw and would look like a success. So the names are read
 * from the data before any byte is believed, and matching the renderer's sentence would have tied
 * this harness to a wording that is none of its business.
 */
describe('namedNotDrawnIn', () => {
  it('should read the languages a page names without drawing', () => {
    // Given
    const html = page([CURL, HTTPIE, DART]);

    // When
    const named = namedNotDrawnIn(readStateBlock(html).json);

    // Then
    expect(named).toEqual([['php', 'java', 'ruby']]);
  });

  it('should read no list at all from a page that names nothing', () => {
    // Given a state block carrying only samples, which is the page of a build that drew all
    // fifteen and therefore has nothing to name.
    const json = JSON.stringify({ node: { id: 'n1', codeSamples: [] } });

    // When
    const named = namedNotDrawnIn(json);

    // Then: an empty result and not a thrown error, because naming nothing is a real state.
    expect(named).toEqual([]);
  });
});
