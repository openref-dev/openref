import { ErrorCode, ThemeContractError } from '@openref/core';
import { SLOT_NAMES, type SlotName, type ThemeDefinition } from '@openref/vue';

/**
 * The conformance checker, per SPEC 10.4 and BUILD T031.
 *
 * THIS IS WHAT MAKES THE CONTRACT REAL. A frozen registry that nobody can test against is a
 * list in a type declaration: the author of a theme discovers a slot they never filled when a
 * reader opens the page that needed it. So the contract ships with something an author runs,
 * and what it hands back is a refusal that NAMES THE SLOT, never a diff. A diff makes the
 * author work out what the difference means; a sentence naming `StreamLog` tells them what to
 * write next.
 *
 * THE LEVEL IS AN ARGUMENT BECAUSE THE CONTRACT IS DIFFERENT AT EACH ONE, per SPEC 10.1. An L1
 * theme replaces some slots and lets the rest fall through to the reference, so the only thing
 * that can be wrong is a name that is not a slot. An L2 theme is a full theme: the reference
 * ships no markup for it to fall through to, so every one of the 21 has to be filled, the page
 * shell included. Checking an L1 theme by the L2 rule would refuse every correct L1 theme, and
 * checking an L2 theme by the L1 rule would pass a theme with a hole in it.
 *
 * WHAT IT DOES NOT CHECK, SAID OUT LOUD. It does not render. A component that is present and
 * throws on mount passes here and fails in the harness, which is the other half of this package
 * and the thing that runs it against a real document. This one answers "is the contract
 * satisfied", not "does the theme work", and a checker that quietly conflated the two would
 * report a rendering bug as a contract violation.
 */

/** Theme levels this checker knows how to judge, per SPEC 10.1. */
export type ThemeLevel = 'L1' | 'L2';

/** What to check against. */
export interface ThemeConformanceOptions {
  /** The level the theme claims. An L2 theme fills every slot; an L1 theme fills some. */
  readonly level: ThemeLevel;
}

/** One thing wrong with a theme, in the words its author reads. */
export interface ThemeProblem {
  /** What kind of violation this is, so a tool can group them without parsing prose. */
  readonly kind: 'missing-slot' | 'unknown-slot' | 'duplicate-shell' | 'invalid-name' | 'bad-token';
  /** The slot, token or name this is about. */
  readonly subject: string;
  /** The sentence an author reads. It names the subject and what to do. */
  readonly message: string;
}

/** The result of checking a theme. */
export interface ThemeConformanceReport {
  readonly name: string;
  readonly level: ThemeLevel;
  readonly conforms: boolean;
  /** Slots an L2 theme has not filled, in registry order. Always empty at L1. */
  readonly missingSlots: readonly SlotName[];
  /** Names the theme filled that are not slots, in the order the theme wrote them. */
  readonly unknownSlots: readonly string[];
  readonly problems: readonly ThemeProblem[];
}

const KNOWN = new Set<string>(SLOT_NAMES);

/** A token key has to be a custom property in the `--oref-` namespace, per STANDARDS 11. */
const TOKEN_KEY = /^--oref-[a-z0-9]+(-[a-z0-9]+)*$/;

/** A theme name has to survive being a package name and a CSS class fragment. */
const THEME_NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/**
 * Checks a theme against the frozen contract.
 *
 * @param theme - The theme, as its author wrote it
 * @param options - The level the theme claims
 * @returns Everything wrong with it, or a report that says it conforms
 *
 * @example
 * const report = checkTheme(aurora, { level: 'L2' });
 * report.missingSlots; // ['StreamLog']
 */
export function checkTheme(
  theme: ThemeDefinition,
  options: ThemeConformanceOptions,
): ThemeConformanceReport {
  const problems: ThemeProblem[] = [];
  const filled = new Set(Object.keys(theme.components ?? {}));

  // `layout` FILLS `AppShell`, IT DOES NOT SIT BESIDE IT. The two were checked separately until
  // `TX-SLOTWIRE`, which is one position judged by two rules: a theme with a layout and no
  // `AppShell` component was told it was missing a slot it had written, and a theme with both was
  // told nothing at all. `resolveTheme` refuses the second, so the checker names it here rather
  // than leaving the author to meet it at load time.
  if (theme.layout !== undefined) {
    if (filled.has('AppShell')) {
      problems.push({
        kind: 'duplicate-shell',
        subject: 'AppShell',
        message:
          'this theme declares its page shell twice, as `layout` and as `components.AppShell`, ' +
          'and those are one position; keep the one that reads better and remove the other',
      });
    }

    filled.add('AppShell');
  }

  if (!THEME_NAME.test(theme.name)) {
    problems.push({
      kind: 'invalid-name',
      subject: theme.name,
      message:
        `the theme name "${theme.name}" is not usable: a name is lowercase words joined by ` +
        `hyphens, because it becomes a package name and a class name fragment`,
    });
  }

  const unknownSlots = [...filled].filter((name) => !KNOWN.has(name));
  for (const name of unknownSlots) {
    problems.push({
      kind: 'unknown-slot',
      subject: name,
      message:
        `"${name}" is not a slot, and the registry is fixed at ${String(SLOT_NAMES.length)} ` +
        `names, so nothing will ever render it; remove it or rename it to the slot you meant`,
    });
  }

  const missingSlots = options.level === 'L2' ? SLOT_NAMES.filter((name) => !filled.has(name)) : [];
  for (const name of missingSlots) {
    problems.push({
      kind: 'missing-slot',
      subject: name,
      message:
        name === 'AppShell'
          ? 'an L2 theme carries its own page shell, and this one declares none; add `layout: ' +
            "() => import('./Layout')`, which is the same position by its authoring name, or a " +
            'component under `components.AppShell`'
          : `the slot "${name}" is not filled, and an L2 theme fills all ` +
            `${String(SLOT_NAMES.length)} because the reference ships no markup of its own to ` +
            `fall back to; add a component for "${name}" or publish this as an L1 theme`,
    });
  }

  for (const key of Object.keys(theme.tokens ?? {})) {
    if (TOKEN_KEY.test(key)) continue;
    problems.push({
      kind: 'bad-token',
      subject: key,
      message:
        `the token "${key}" is not in the --oref- namespace, so nothing in the reference reads ` +
        'it; token keys are custom properties of the form --oref-{group}-{name}',
    });
  }

  return {
    name: theme.name,
    level: options.level,
    conforms: problems.length === 0,
    missingSlots,
    unknownSlots,
    problems,
  };
}

/**
 * Checks a theme and refuses it out loud.
 *
 * The refusal names every problem in the message rather than pointing at a report, because the
 * author is at a terminal and the message is what they get.
 *
 * @param theme - The theme, as its author wrote it
 * @param options - The level the theme claims
 * @returns The report, when the theme conforms
 * @throws {ThemeContractError} When anything is wrong, naming each subject
 *
 * @example
 * assertTheme(aurora, { level: 'L2' });
 */
export function assertTheme(
  theme: ThemeDefinition,
  options: ThemeConformanceOptions,
): ThemeConformanceReport {
  const report = checkTheme(theme, options);
  if (report.conforms) return report;

  const lines = report.problems.map((problem) => `  - ${problem.message}`).join('\n');
  throw new ThemeContractError(
    `theme "${theme.name}" does not satisfy the ${options.level} contract:\n${lines}`,
    ErrorCode.THEME_CONTRACT_VIOLATED,
    undefined,
    {
      theme: theme.name,
      level: options.level,
      missingSlots: [...report.missingSlots],
      unknownSlots: [...report.unknownSlots],
    },
  );
}
