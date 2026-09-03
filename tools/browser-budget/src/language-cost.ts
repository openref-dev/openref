/**
 * What one sample language costs a page, worked out by taking it off the page.
 *
 * THE QUESTION IS MARGINAL AND SO IS THE METHOD. Dividing `page-bytes` by fifteen would answer a
 * different question, because the three columns carry a stylesheet, a bundle and a document whose
 * markup has nothing to do with samples. What is wanted is what the page would weigh without one
 * language, so that is what is built: the served page with that language's two contributions cut
 * out, handed to the browser through `measurePage`'s own `transformHtml`, and measured by the same
 * instrument that measured the page with all fifteen.
 *
 * A LANGUAGE CONTRIBUTES IN EXACTLY TWO PLACES AND BOTH ARE CUT. Its tab, which the server draws
 * into the markup, and its entry in the page state block, which carries the highlighted source the
 * tab shows. Nothing else on the page moves with the language set.
 *
 * WHAT IS DELIBERATELY NOT ATTRIBUTED TO A LANGUAGE. The server draws one code block, for the tab
 * the page opens on. That block is the price of the page carrying samples at all rather than the
 * price of the language that happens to be first, so it is reported beside the table and charged to
 * nobody. Under the same rule the page built for the opening language keeps that block: it is a
 * byte measurement of one language's removal, not a rendering the product would ever produce.
 *
 * EVERY CUT IS CHECKED BEFORE IT IS MEASURED. A region that is not found exactly once, a state
 * block that does not parse, a page carrying two sample strips, or a cut that leaves the wrong set
 * of languages behind all throw. A harness that cannot locate what it is removing cannot report a
 * cost for removing it, and reporting one anyway is the failure this file exists to avoid.
 *
 * THE SEPARATORS ARE WHY THE LIST IS REBUILT RATHER THAN CUT, and they carry one arithmetic fact
 * worth knowing before the figures are read. A list of fifteen entries has fourteen commas, so
 * taking one language off takes a comma with it, and the fifteen costs measured one at a time
 * therefore charge fifteen commas between them where the list only ever held fourteen. The sum of
 * the individual costs is one byte more than the cost of taking all fifteen off at once, exactly,
 * and a caller comparing the two accounts for that byte rather than treating it as noise.
 */

import type { SampleLanguage } from '@openref/samples';

/**
 * The page state block, which carries the highlighted source of every tab.
 *
 * `escapeJsonForScript` writes every less than sign of the model as its JSON escape on the way in,
 * so the block can be bounded by its closing tag without a parser: nothing inside it is left that
 * could open an element.
 */
const STATE_BLOCK = /<script type="application\/json" id="oref-state"[^>]*>([\s\S]*?)<\/script>/u;

/** Where the state block sits in a served page, and what it holds. */
export interface StateBlock {
  /** Offset of the first character of the JSON, inside the page. */
  readonly start: number;
  /** Offset one past its last character. */
  readonly end: number;
  readonly json: string;
}

/**
 * Finds the page state block.
 *
 * @param html - The served page
 * @returns Where the JSON sits and what it says
 * @throws Error when the page carries no state block, so nothing downstream measures a page it
 *   only assumed the shape of
 */
export function readStateBlock(html: string): StateBlock {
  const found = STATE_BLOCK.exec(html);
  const json = found?.[1];

  if (found === null || json === undefined) {
    throw new Error('the served page carries no application/json state block to read samples from');
  }

  const start = found.index + found[0].indexOf(json);

  return { start, end: start + json.length, json };
}

/** A half open byte range of the served page. */
export interface Region {
  readonly start: number;
  readonly end: number;
}

/**
 * The end of the JSON object that starts at `start`, found by counting braces outside strings.
 *
 * WRITTEN RATHER THAN PARSED BECAUSE THE OFFSETS ARE THE ANSWER. `JSON.parse` gives values and
 * loses positions, and what is wanted here is the exact span of text one entry occupies in the
 * page, escapes and all.
 *
 * @param json - The state block text
 * @param start - Offset of the opening brace
 * @returns Offset one past the matching closing brace
 * @throws Error when the object never closes
 */
export function objectEnd(json: string, start: number): number {
  let depth = 0;
  let inString = false;

  for (let index = start; index < json.length; index += 1) {
    const character = json[index];

    if (inString) {
      if (character === '\\') {
        index += 1;
        continue;
      }
      if (character === '"') inString = false;
      continue;
    }

    if (character === '"') inString = true;
    else if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }

  throw new Error(`the state block object at ${String(start)} never closes`);
}

/** Characters a regular expression reads as syntax, escaped so a label matches as text. */
function escapeForPattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/**
 * The span the tab of one language occupies in the served markup.
 *
 * @param html - The served page
 * @param language - The language whose tab to find
 * @returns Its region
 * @throws Error when the tab is absent or drawn more than once
 */
export function tabRegion(html: string, language: SampleLanguage): Region {
  const pattern = new RegExp(
    `<button class="oref-send oref-sample-tab[^"]*"[^>]*>${escapeForPattern(language.label)}</button>`,
    'gu',
  );

  const found = [...html.matchAll(pattern)];
  if (found.length !== 1) {
    throw new Error(
      `the page draws ${String(found.length)} tabs labelled "${language.label}" and exactly one ` +
        'was expected, so the markup that language costs cannot be identified',
    );
  }

  const match = found[0];
  if (match === undefined) throw new Error('unreachable: a match list of one carried no match');

  return { start: match.index, end: match.index + match[0].length };
}

/** The sample list of the page state, as text: where it sits and what is written in it. */
export interface SampleArray extends Region {
  /** One per entry, in the order the list carries them, each the exact text of that entry. */
  readonly entries: readonly { readonly lang: string; readonly text: string }[];
}

/**
 * The `codeSamples` list of the page, located in the served text rather than in a parse.
 *
 * THE LIST IS REBUILT RATHER THAN CUT, and this is the function that makes that possible. A cut
 * has to decide which comma goes with which entry, and the first entry of a list has none in front
 * of it, so a rule per entry either double counts the comma between the first two or leaves the
 * list malformed. Rebuilding the list from the entries that stay writes exactly the separators a
 * list of that length has, whichever entries went.
 *
 * @param state - Where the state block sits, as `readStateBlock` reported it
 * @returns The list, in offsets of the whole page
 * @throws Error when the page carries no list or more than one, since a per page cost is only
 *   defined where there is one strip to take a language off
 */
export function readSampleArray(state: StateBlock): SampleArray {
  const key = '"codeSamples":[';
  const occurrences = state.json.split(key).length - 1;

  if (occurrences !== 1) {
    throw new Error(
      `the page state carries ${String(occurrences)} sample lists and exactly one was expected, ` +
        'so a per page cost cannot be attributed to a language',
    );
  }

  const open = state.json.indexOf(key) + key.length - 1;
  const entries: { lang: string; text: string }[] = [];
  let cursor = open + 1;

  while (cursor < state.json.length && state.json[cursor] !== ']') {
    if (state.json[cursor] === ',') {
      cursor += 1;
      continue;
    }

    if (state.json[cursor] !== '{') {
      throw new Error(
        `the sample list carries "${String(state.json[cursor])}" where an entry was expected, so ` +
          'the harness is not reading the list it thinks it is',
      );
    }

    const end = objectEnd(state.json, cursor);
    const text = state.json.slice(cursor, end);
    const lang = /^\{"lang":"([^"]*)"/u.exec(text)?.[1];

    if (lang === undefined) {
      throw new Error('a sample list entry names no language, so nothing can be attributed to it');
    }

    entries.push({ lang, text });
    cursor = end;
  }

  if (state.json[cursor] !== ']') {
    throw new Error('the sample list never closes, so its span cannot be replaced');
  }

  return { start: state.start + open, end: state.start + cursor + 1, entries };
}

/**
 * Every `codeSamples` list the state block carries, as the language ids in it.
 *
 * WALKED RATHER THAN ADDRESSED. The model's shape is another package's to change, and a path
 * spelled here would go quietly wrong the day it moved, which is the class of failure this whole
 * harness is written against.
 *
 * @param json - The state block text
 * @returns One entry per list, each the ids in that list
 * @throws Error when the block does not parse
 */
export function sampleListsIn(json: string): string[][] {
  const lists: string[][] = [];

  const walk = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }

    if (value === null || typeof value !== 'object') return;

    for (const [key, held] of Object.entries(value)) {
      if (key === 'codeSamples' && Array.isArray(held)) {
        lists.push(
          held.map((entry) => {
            const lang = (entry as { lang?: unknown }).lang;
            return typeof lang === 'string' ? lang : '';
          }),
        );
        continue;
      }

      walk(held);
    }
  };

  walk(JSON.parse(json));

  return lists;
}

/**
 * The one list of samples a node page carries.
 *
 * @param json - The state block text
 * @returns The language ids on it
 * @throws Error when the page carries no list or more than one, since a per page cost is only
 *   defined where there is one strip to remove a language from
 */
export function theSampleList(json: string): string[] {
  const lists = sampleListsIn(json);
  const only = lists[0];

  if (lists.length !== 1 || only === undefined) {
    throw new Error(
      `the page state carries ${String(lists.length)} sample lists and exactly one was expected, ` +
        'so a per page cost cannot be attributed to a language',
    );
  }

  return only;
}

/**
 * The served page as it would be without the named languages.
 *
 * @param html - The served page, with every language on it
 * @param languages - The languages to take off
 * @returns The page without them
 * @throws Error when a region cannot be located, or when the cut leaves a state block that does
 *   not parse or that carries the wrong set of languages
 */
export function pageWithout(html: string, languages: readonly SampleLanguage[]): string {
  const state = readStateBlock(html);
  const before = theSampleList(state.json);
  const going = new Set<string>(languages.map((language) => language.id));

  for (const language of languages) {
    if (!before.includes(language.id)) {
      throw new Error(`the page carries no "${language.id}" sample, so it cannot be taken off it`);
    }
  }

  const list = readSampleArray(state);
  const kept = list.entries.filter((entry) => !going.has(entry.lang));
  const rebuilt = `[${kept.map((entry) => entry.text).join(',')}]`;

  const regions: (Region & { readonly text: string })[] = [
    { ...list, text: rebuilt },
    ...languages.map((language) => ({ ...tabRegion(html, language), text: '' })),
  ];

  // DISJOINT OR NOTHING. Two overlapping regions would be counted twice by any sum over them and
  // would cut a hole in the page besides, and a harness that cannot tell the two apart must not
  // report either.
  const ordered = [...regions].sort((left, right) => left.start - right.start);
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1];
    const current = ordered[index];
    if (previous === undefined || current === undefined) continue;
    if (current.start < previous.end) {
      throw new Error(
        'two of the regions being removed overlap, so the bytes they carry cannot be attributed',
      );
    }
  }

  let cut = html;
  for (const region of [...ordered].reverse()) {
    cut = cut.slice(0, region.start) + region.text + cut.slice(region.end);
  }

  const after = theSampleList(readStateBlock(cut).json);
  const expected = before.filter((id) => !languages.some((language) => language.id === id));

  if (after.join(',') !== expected.join(',')) {
    throw new Error(
      `the cut left [${after.join(', ')}] on the page where [${expected.join(', ')}] was expected`,
    );
  }

  return cut;
}

/** What one language was measured to cost the page it was taken off. */
export interface LanguageCost {
  readonly id: string;
  readonly label: string;
  readonly level: number;
  /** Bytes the browser reported for the page with every language on it. */
  readonly withAll: number;
  /** Bytes the browser reported for the page with this one taken off. */
  readonly without: number;
  /** The difference, which is what the language costs the page. */
  readonly bytes: number;
}

/**
 * The bytes of the one code block the server draws, which no language is charged for.
 *
 * It is the block of whichever tab the page opens on, and it stays on the page for as long as any
 * language does, so it belongs beside the table rather than in it.
 *
 * @param html - The served page
 * @returns Its byte length, or null when the page draws none
 */
export function servedCodeBlockBytes(html: string): number | null {
  const found = [
    ...html.matchAll(/<pre class="oref-code" data-oref-lang="[^"]*">[\s\S]*?<\/pre>/gu),
  ];
  const only = found[0];

  if (found.length !== 1 || only === undefined) return null;

  return Buffer.byteLength(only[0], 'utf8');
}
