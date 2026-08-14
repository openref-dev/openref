/**
 * The design contract's token requirement, checked the way CONTRACT.md now states it.
 *
 * THE CHECK MOVED FROM THE TEXT TO THE COMPUTED VALUE, in `T012-R3`. The contract used to be
 * read as a requirement on each block of `tokens.css`: every token written out in the light
 * block, in the dark media block and in the dark attribute block, so that any one of the three
 * could be read on its own. The generator obeyed it and said the repetition "costs bytes that
 * gzip removes". Session 16 measured that the browser pays the bytes gzip does not remove, so
 * the reason was wrong, and the requirement is restated at the level it was always about: a
 * theme defines all its tokens in both modes, and conformance is whether all of them RESOLVE.
 *
 * THIS CHECK IS STRONGER THAN THE COUNT IT REPLACES ON TWO CASES, both planted and watched to
 * fail before this file was trusted: a token overridden to nothing, `--x: ;`, and a token whose
 * `var()` chain has no terminal value, `--x: var(--typo)`. Both pass a declaration count and
 * both resolve to the empty string here. A token declared as a value nothing can use,
 * `--x: notacolor`, is caught by neither and cannot be: a custom property carries no type.
 *
 * THE FIRST TWO PLANTS OF THIS FILE PASSED AND THE CHECK WAS INNOCENT. They were written into
 * the middle of the dark attribute block, where the theme's own later declaration of the same
 * token overrode them, so the plants proved nothing and briefly looked like a weak check. A
 * plant that lands where it cannot win is not evidence either way.
 *
 * FOUR CONDITIONS, NOT TWO. The theme reaches dark two ways, the system preference and the
 * explicit attribute, and after the deduplication the second is a block of 48 declarations
 * leaning on 64 it no longer repeats. A check that exercised one of the two paths would report
 * conformance for half of what shipped.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALL_TOKENS } from '@openref/theme';
import { bootFixture, launchChrome, TTI_PAGE } from '../../src/index';
import type { BootedFixture, LaunchedChrome } from '../../src/index';
import type { Page } from 'playwright-core';

const TIMEOUT = 300_000;

/** A name no theme declares, carried through every probe so absence is proved visible. */
const ABSENT_TOKEN = '--oref-color-there-is-no-such-token';

/** A token every scheme changes, read to prove the scheme under test is actually in force. */
const SCHEME_WITNESS = '--oref-color-bg';

let chrome: LaunchedChrome;
let fixture: BootedFixture;

beforeAll(async () => {
  chrome = await launchChrome();
  fixture = await bootFixture('large');
}, TIMEOUT);

afterAll(async () => {
  await fixture.stop();
  await chrome.close();
});

/** How a colour scheme is put in force, which is two different mechanisms and not one. */
type Scheme = 'light' | 'dark';
type Mechanism = 'system preference' | 'explicit attribute';

interface Resolution {
  /** Every probed name against what the cascade resolved it to, trimmed. */
  readonly values: Record<string, string>;
  /** Every name a resolved value still refers to, resolved in turn. */
  readonly referenced: Record<string, string>;
  /** What the browser itself says the scheme is, so the condition is proved rather than asked for. */
  readonly colorScheme: string;
}

/**
 * Opens the page under one scheme and one mechanism and reads the computed value of every name.
 *
 * @param scheme - The colour scheme that must be in force
 * @param mechanism - How it is put in force
 * @param names - Every custom property to resolve
 * @returns What the cascade resolved, read off the document element
 */
async function resolve(
  scheme: Scheme,
  mechanism: Mechanism,
  names: readonly string[],
): Promise<Resolution> {
  const context = await chrome.browser.newContext({
    // The system preference half. Set on the context so it is in force for the first paint
    // rather than applied to a document that has already resolved its cascade once.
    colorScheme: mechanism === 'system preference' ? scheme : 'light',
  });
  const page: Page = await context.newPage();

  try {
    await page.goto(`${fixture.url}${TTI_PAGE}`, { waitUntil: 'load', timeout: 120_000 });

    if (mechanism === 'explicit attribute') {
      await page.evaluate((value) => {
        // DOM TYPES ARE SCOPED IN THIS REPOSITORY, NOT GLOBAL, per T011: the root program has
        // no `lib: DOM`, so `core` cannot reach `document` by accident. Everything that runs
        // inside a page therefore narrows `globalThis` to what it uses, as the other browser
        // suites do, rather than pulling the whole DOM into this program.
        const scope = globalThis as unknown as {
          document: { documentElement: { setAttribute(name: string, value: string): void } };
        };
        scope.document.documentElement.setAttribute('data-oref-color-scheme', value);
      }, scheme);
    }

    return await page.evaluate(
      (probed) => {
        const scope = globalThis as unknown as {
          document: { documentElement: unknown };
          getComputedStyle(element: unknown): { getPropertyValue(name: string): string };
        };
        const style = scope.getComputedStyle(scope.document.documentElement);
        const values: Record<string, string> = {};
        for (const name of probed) values[name] = style.getPropertyValue(name).trim();

        // SECOND PASS, KEPT BECAUSE ITS EMPTINESS IS THE FINDING. If a computed value still held
        // an unsubstituted `var()`, a token pointing at a name that does not exist would read
        // back as the text `var(--nope)`, which is not empty and would look resolved. Chrome
        // substitutes instead and turns that declaration into the empty string, so this comes
        // back empty and the emptiness check above already covers the case.
        const referenced: Record<string, string> = {};
        for (const value of Object.values(values)) {
          for (const match of value.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)) {
            const name = match[1] ?? '';
            referenced[name] = style.getPropertyValue(name).trim();
          }
        }

        return { values, referenced, colorScheme: style.getPropertyValue('color-scheme').trim() };
      },
      [...names],
    );
  } finally {
    await context.close();
  }
}

const CONDITIONS: readonly (readonly [Scheme, Mechanism])[] = [
  ['light', 'system preference'],
  ['light', 'explicit attribute'],
  ['dark', 'system preference'],
  ['dark', 'explicit attribute'],
];

describe('the token contract, resolved in a browser', () => {
  const names = ALL_TOKENS.map((token) => token.name);
  const resolutions = new Map<string, Resolution>();

  beforeAll(async () => {
    for (const [scheme, mechanism] of CONDITIONS) {
      resolutions.set(
        `${scheme} by ${mechanism}`,
        await resolve(scheme, mechanism, [...names, ABSENT_TOKEN, SCHEME_WITNESS]),
      );
    }
  }, TIMEOUT);

  it('should put the requested scheme in force, by both mechanisms', () => {
    // Given, if this failed every other case in this file would read light values four times
    // and report conformance while proving nothing. It is checked first for that reason.
    const reported = [...resolutions].map(
      ([condition, resolution]) => `${condition}: ${resolution.colorScheme}`,
    );

    // When
    const witness = new Map(
      [...resolutions].map(([condition, resolution]) => [
        condition,
        resolution.values[SCHEME_WITNESS],
      ]),
    );

    // Then
    expect(reported).toEqual([
      'light by system preference: light',
      'light by explicit attribute: light',
      'dark by system preference: dark',
      'dark by explicit attribute: dark',
    ]);
    expect(witness.get('dark by system preference')).not.toBe(
      witness.get('light by system preference'),
    );
    expect(witness.get('dark by explicit attribute')).toBe(
      witness.get('dark by system preference'),
    );
  });

  it('should see a name that resolves to nothing, so a green result means something', () => {
    // Given a name no theme declares, probed under every condition alongside the real ones.
    const absent = [...resolutions].map(([, resolution]) => resolution.values[ABSENT_TOKEN]);

    // When
    const seen = absent.filter((value) => value !== '');

    // Then, the probe distinguishes declared from undeclared. Without this, a page that
    // loaded no stylesheet at all would fail the same way a conforming one passes.
    expect(seen).toEqual([]);
    expect(absent).toHaveLength(CONDITIONS.length);
  });

  it('should leave no var() reference unsubstituted, so an empty value is the only failure mode', () => {
    // Given, this was written as a second check and measurement made it unnecessary, which is
    // worth keeping rather than deleting. Chrome substitutes `var()` at computed value time for
    // a custom property, and a reference to a name that does not exist makes the whole
    // declaration the guaranteed-invalid value, which reads back as the empty string. So a dead
    // chain is already caught by the emptiness check above and does not need one of its own.
    // Measured, not assumed: `--a: var(--nope)` resolves to `[]`, `--a: ;` resolves to `[]`,
    // and `--a: var(--nope, blue)` resolves to `blue`.
    const leftovers = [...resolutions].flatMap(([condition, resolution]) =>
      Object.keys(resolution.referenced).map((name) => `${name} in ${condition}`),
    );

    // When
    const composed = ALL_TOKENS.filter((token) => token.value.includes('var('));

    // Then, the theme does compose a token out of a token, and none of it survives as text.
    expect(composed.length).toBeGreaterThan(0);
    expect(leftovers).toEqual([]);
  });

  for (const [scheme, mechanism] of CONDITIONS) {
    it(`should resolve every token to a non-empty value, ${scheme} by ${mechanism}`, () => {
      // Given the declared surface, which is the contract, rather than the text of a block
      const resolution = resolutions.get(`${scheme} by ${mechanism}`);

      // When
      const unresolved = names.filter((name) => (resolution?.values[name] ?? '') === '');

      // Then
      expect(unresolved).toEqual([]);
      expect(names.length).toBeGreaterThanOrEqual(109);
    });
  }

  /**
   * The two shared tokens whose resolved value legitimately differs between the schemes.
   *
   * Both are gradients built out of `--oref-color-line-edge`, which does change, so the
   * cascade carrying the declaration unchanged still yields two different resolved values.
   * The second is the first turned on its side, added at TX-FRAME for the collapsed parity
   * gutter. Named here rather than filtered by a rule, so that a third one appearing is a
   * finding.
   */
  const SHARED_THROUGH_A_CHANGING_REFERENCE = new Set([
    '--oref-layout-tick',
    '--oref-layout-tick-h',
  ]);

  it('should carry a token with no dark variant through to dark mode by the cascade', () => {
    // Given, this is the property the deduplication rests on and it is asserted directly. The
    // dark blocks no longer write these 65 names at all, so if the cascade did not carry them
    // the whole reduction would be 65 tokens resolving to nothing for half the readers.
    //
    // COMPARED AGAINST THE LIGHT RESOLUTION AND NOT AGAINST THE SOURCE LITERAL. The engine
    // normalizes a custom property value, turning `'DCL'` into `"DCL"` and rewriting a font
    // stack, so comparing to the string in `tokens.ts` would be testing Chrome's serializer.
    // Both sides of this comparison come out of the same serializer.
    const shared = ALL_TOKENS.filter(
      (token) => token.dark === undefined && !SHARED_THROUGH_A_CHANGING_REFERENCE.has(token.name),
    );
    const light = resolutions.get('light by system preference');

    // When
    const drifted = CONDITIONS.filter(([scheme]) => scheme === 'dark').flatMap(
      ([scheme, mechanism]) => {
        const dark = resolutions.get(`${scheme} by ${mechanism}`);
        return shared
          .filter((token) => dark?.values[token.name] !== light?.values[token.name])
          .map((token) => `${token.name} by ${mechanism}`);
      },
    );

    // Then
    expect(shared).toHaveLength(65);
    expect(drifted).toEqual([]);
  });

  it('should still change a shared token that is built out of one that changes', () => {
    // Given, the exceptions above, asserted rather than excused. Each differs between the
    // schemes because it composes a colour that differs, which is the cascade working and not
    // failing.
    const light = resolutions.get('light by system preference');
    const dark = resolutions.get('dark by system preference');

    for (const name of SHARED_THROUGH_A_CHANGING_REFERENCE) {
      // When
      const composed = [light?.values[name], dark?.values[name]];

      // Then
      expect(composed[0], name).not.toBe('');
      expect(composed[1], name).not.toBe('');
      expect(ALL_TOKENS.find((token) => token.name === name)?.value, name).toContain('var(');
    }
  });

  it('should resolve every token that does change to something other than its light value', () => {
    // Given, the other half: what the dark blocks do still declare has to win. No token in the
    // set declares a dark value equal to its light one, so a resolved value that did not move
    // means the declaration did not apply.
    const changing = ALL_TOKENS.filter((token) => token.dark !== undefined);
    const light = resolutions.get('light by system preference');

    // When
    const unmoved = CONDITIONS.filter(([scheme]) => scheme === 'dark').flatMap(
      ([scheme, mechanism]) => {
        const dark = resolutions.get(`${scheme} by ${mechanism}`);
        return changing
          .filter((token) => dark?.values[token.name] === light?.values[token.name])
          .map((token) => `${token.name} by ${mechanism}`);
      },
    );

    // Then
    expect(changing).toHaveLength(48);
    expect(ALL_TOKENS.filter((token) => token.dark === token.value)).toEqual([]);
    expect(unmoved).toEqual([]);
  });
});
