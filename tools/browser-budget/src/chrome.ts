/**
 * Launching the browser the budgets are measured in.
 *
 * THE SYSTEM CHROME IS DRIVEN, NOT A DOWNLOADED ONE. `playwright-core` carries no browser and
 * no install hook, and the `ubuntu-24.04` runner already ships Google Chrome, so nothing is
 * fetched in CI or on a developer machine that has a browser. The trade is that the version
 * floats, which is why every figure this package produces records the major it was taken on
 * and why the relative check is suppressed when that major moves.
 *
 * THE LAUNCH FLAGS ARE PART OF THE MEASUREMENT and are therefore fixed here and recorded with
 * the baseline rather than passed in. A flag that changes how the renderer schedules work
 * changes TTI, so a harness that let a caller vary them would produce figures that are not
 * comparable while looking as if they were.
 */

import { chromium } from 'playwright-core';
import type { Browser } from 'playwright-core';

/**
 * Flags every measurement runs under.
 *
 * `--no-sandbox` is present because a CI container commonly cannot use the namespace sandbox,
 * and a harness that launched differently in the two places would compare two things. The rest
 * remove work that is not the page's: no first run dialog, no extensions, no background
 * network. Nothing here disables a feature the reference uses.
 */
export const CHROME_ARGS: readonly string[] = [
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-extensions',
  '--disable-background-networking',
  '--disable-component-update',
];

/** A launched browser, with the identity every figure is recorded against. */
export interface LaunchedChrome {
  readonly browser: Browser;
  /** Full version, such as `151.0.7922.76`. */
  readonly version: string;
  /** Major version, which is what the baseline is keyed on. */
  readonly major: number;
  close(): Promise<void>;
}

/**
 * Reads the major out of a Chrome version string.
 *
 * @param version - Version as the browser reports it
 * @returns The leading integer
 * @throws Error when the version does not begin with one, because an unparsed major would
 *   silently make every baseline comparison compare nothing
 */
export function majorOf(version: string): number {
  const leading = /^(\d+)\./.exec(version)?.[1];
  if (leading === undefined) {
    throw new Error(`cannot read a major version out of "${version}"`);
  }

  return Number(leading);
}

/**
 * Launches Chrome.
 *
 * `OPENREF_CHROME_PATH` names an executable explicitly; without it the system install is
 * found through the `chrome` channel. A missing browser is a hard failure with the reason,
 * never a skipped measurement: a budget nobody measured reads exactly like one that passed.
 *
 * @returns The browser and its version
 * @throws Error when no Chrome can be launched
 */
export async function launchChrome(): Promise<LaunchedChrome> {
  const executablePath = process.env.OPENREF_CHROME_PATH;

  let browser: Browser;
  try {
    browser = await chromium.launch({
      args: [...CHROME_ARGS],
      ...(executablePath === undefined ? { channel: 'chrome' } : { executablePath }),
    });
  } catch (cause) {
    throw new Error(
      'the browser budgets need Google Chrome and none could be launched. Install Chrome, or ' +
        'point OPENREF_CHROME_PATH at an executable. ' +
        `Cause: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }

  const version = browser.version();

  return {
    browser,
    version,
    major: majorOf(version),
    close: () => browser.close(),
  };
}
