// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { hydrateReference } from '../../src/browser/index';
import { whenReached } from '../../src/browser/deferred';
import { renderHtmlDocument } from '../../src/page/domain/shell';
import { renderPage } from '../../src/render/application/services/render.service';
import { smallDocument } from '../mocks/documents';
import type { IRunnerPort } from '@openref/vue';

/**
 * The specification of the gate itself, which T011-R owes and which nothing else asserts.
 *
 * The three features are behind a dynamic import, and every way that can go wrong is silent.
 * A gate that opens on load defers nothing while looking exactly like one that works. A gate
 * that never opens leaves a feature missing from a page that renders. And a gate that opens
 * but drops the event that opened it costs the reader a second interaction, which reads as the
 * page being slow rather than as a defect.
 *
 * So four claims, and the third is the one that was wrong until 2026-08-10:
 *
 * - nothing is fetched before the reader reaches for a feature
 * - the feature arrives when the reader does reach for it
 * - one interaction is enough, not two
 * - the runner arrives with the console, and not before it
 *
 * IN JSDOM AND NOT IN A BROWSER, deliberately, because what is under test is the gate and not
 * the module graph. The claim that the shipped chunks load under the strict policy belongs to
 * the browser suite, where a real engine fetches real chunks, and it is made there.
 */

/** The node page, which is the only page carrying all three features. */
async function serveNodePage(): Promise<string> {
  const document_ = smallDocument();
  const nodeId = [...document_.nodes.keys()][0];
  if (nodeId === undefined) throw new Error('the fixture document has no nodes');

  const page = await renderPage(document_, { nodeId });

  return renderHtmlDocument(page, {
    nonce: 'r4nd0mNONCEvalue',
    assets: { stylesheets: ['/assets/theme.css'], modules: ['/assets/openref.js'] },
  });
}

/**
 * What a browser sends when a reader presses and releases on a control.
 *
 * THE WHOLE SEQUENCE, because the gate is about what happens between its first event and its
 * last: `pointerdown` opens it, and `click` is the event the palette button actually listens
 * to. Dispatching only one of them is the arrangement that hid the defect this file pins.
 *
 * @param element - What the reader pressed
 */
function press(element: Element): void {
  element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

/**
 * The send button, which is how this file tells a hydrated console from the served markup.
 *
 * NO ATTRIBUTE IS THE MARKER, since the SPEC 11 rewrite of 2026-08-14: the served button
 * carries neither `disabled` nor `aria-disabled`, because a declared disabled state hands the
 * press to whichever pipeline respects it. What separates the served state from the live ready
 * one is the notice: the load sentence stands beside Send exactly until the console mounts.
 *
 * @returns The button
 */
function sendButton(): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>('.oref-send');
  if (button === null) throw new Error('the page rendered no send button');

  return button;
}

/** The sentence beside Send, by the id that belongs to it alone. */
function sendNotice(): string | null {
  return document.getElementById('oref-tryit-notice')?.textContent ?? null;
}

/** A runner that answers nothing, since what is asserted is when it arrives. */
function stubRunner(): IRunnerPort {
  return {
    send: () => Promise.reject(new Error('not used')),
  } as unknown as IRunnerPort;
}

afterEach(() => {
  document.documentElement.innerHTML = '';
});

describe('the deferral gate', () => {
  it('should fetch nothing at all while nobody reaches for a feature', async () => {
    // Given a hydrated page whose loaders count their own calls
    document.documentElement.innerHTML = await serveNodePage();
    const loadRunner = vi.fn(() => Promise.resolve(stubRunner()));

    // When it hydrates and is left alone
    expect(hydrateReference({ loadRunner })).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Then the server's markup is still what is in the document, untouched
    expect(loadRunner).not.toHaveBeenCalled();
    expect(document.querySelector('.oref-palette-input')).toBeNull();
    expect(sendButton().disabled).toBe(false);
    expect(sendNotice()).toBe('The console loads when you press Send.');
  });

  it('should open the palette on one press, not on the second', async () => {
    // Given
    document.documentElement.innerHTML = await serveNodePage();
    hydrateReference();

    const button = document.querySelector('.oref-palette-open');
    if (button === null) throw new Error('the palette button was not rendered');

    // When the reader presses it once
    press(button);

    // Then the palette is open, which means the click survived the load that the pointerdown
    // started. Before the interaction was recorded as a sequence, this needed a second press.
    await vi.waitFor(() => {
      expect(document.querySelector('.oref-palette-input')).not.toBeNull();
    });
  });

  it('should open the palette on the shortcut, which is a key and not a place', async () => {
    // Given
    document.documentElement.innerHTML = await serveNodePage();
    hydrateReference();

    // When
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }),
    );

    // Then
    await vi.waitFor(() => {
      expect(document.querySelector('.oref-palette-input')).not.toBeNull();
    });
  });

  it('should bring the runner with the console, and enable it in the same arrival', async () => {
    // Given
    document.documentElement.innerHTML = await serveNodePage();
    const loadRunner = vi.fn(() => Promise.resolve(stubRunner()));
    hydrateReference({ loadRunner });

    const section = document.querySelector('.oref-section-tryit');
    if (section === null) throw new Error('the try-it section was not rendered');

    // When the reader reaches for the console
    press(section);

    // Then the console arrives enabled, which is the whole of T014 read through the chunk: the
    // runner is not a second arrival a reader has to wait for after the console appears. The
    // load sentence vanishing is what marks the mount, per the SPEC 11 rewrite.
    await vi.waitFor(() => {
      expect(sendNotice()).toBeNull();
    });
    expect(sendButton().disabled).toBe(false);
    expect(loadRunner).toHaveBeenCalledTimes(1);
  });

  it('should open on a press of Send, which is the control the console is for', async () => {
    // Given, and the press is aimed at the button rather than at the region around it. THIS IS
    // F14: the served button used to carry `disabled`, so a browser generated no click on it,
    // the gate had only a pointerdown to replay and the console listens for a click.
    document.documentElement.innerHTML = await serveNodePage();
    const loadRunner = vi.fn(() => Promise.resolve(stubRunner()));
    hydrateReference({ loadRunner });

    // When
    press(sendButton());

    // Then
    await vi.waitFor(() => {
      expect(sendNotice()).toBeNull();
    });
    expect(loadRunner).toHaveBeenCalledTimes(1);
  });

  // THE CHUNK THAT NEVER ARRIVES IS PROVED IN THE BROWSER SUITE AND NOT HERE, and the reason is
  // that the failure is real rather than reportable. A loader that rejects during hydration
  // leaves Vue's `__asyncHydrate` path with an uncaught rejection, because it calls
  // `load().then(...)` with nothing after it, so the process learns about the missing chunk
  // before any assertion in this file could. That is the loud failure the done-when asks for,
  // and `first-minute.spec.ts` in `tools/browser-budget` plants it where the chunks are real:
  // the catalog is served a 404 for the console's chunk and the case has to go red.
});

describe('whenReached', () => {
  it('should record every event of the interaction and replay them in order', () => {
    // Given a region, and a gate armed over it
    document.body.innerHTML = '<div class="oref-region"><button class="inner">go</button></div>';
    const button = document.querySelector('.inner');
    if (button === null) throw new Error('the fixture button is missing');

    const gate = whenReached(
      { name: 'Fixture', selector: '.oref-region', events: ['pointerdown', 'click'] },
      document,
    );

    const seen: string[] = [];
    // Attached only now, which is what a component that has just hydrated looks like: the
    // events the reader already sent landed on markup with no listener on it.
    button.addEventListener('pointerdown', () => seen.push('pointerdown'));
    button.addEventListener('click', () => seen.push('click'));

    // When the reader presses before the chunk arrives, and the feature then mounts
    press(button);
    expect(seen).toEqual(['pointerdown', 'click']);
    seen.length = 0;
    gate.replay();

    // Then the sequence is dispatched again, in order, exactly once
    expect(seen).toEqual(['pointerdown', 'click']);
  });

  it('should disarm on replay, so a replayed event is not recorded as a new one', () => {
    // Given
    document.body.innerHTML = '<div class="oref-region"><button class="inner">go</button></div>';
    const button = document.querySelector('.inner');
    if (button === null) throw new Error('the fixture button is missing');

    const gate = whenReached(
      { name: 'Fixture', selector: '.oref-region', events: ['pointerdown', 'click'] },
      document,
    );

    const seen: string[] = [];
    button.addEventListener('click', () => seen.push('click'));

    // When
    press(button);
    seen.length = 0;
    gate.replay();
    gate.replay();

    // Then the first replay dispatched the interaction once, and the second dispatched nothing.
    // A gate still armed while it replays would have recorded its own dispatch and drained
    // forever, which is why it disarms before the first one.
    expect(seen).toEqual(['click']);
  });

  it('should ignore an event outside the region entirely', async () => {
    // Given
    document.body.innerHTML =
      '<div class="oref-region"></div><button class="elsewhere">go</button>';
    const elsewhere = document.querySelector('.elsewhere');
    if (elsewhere === null) throw new Error('the fixture button is missing');

    const gate = whenReached(
      { name: 'Fixture', selector: '.oref-region', events: ['pointerdown', 'click'] },
      document,
    );
    let opened = false;
    void gate.reached.then(() => (opened = true));

    // When
    press(elsewhere);
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Then
    expect(opened).toBe(false);
  });
});
