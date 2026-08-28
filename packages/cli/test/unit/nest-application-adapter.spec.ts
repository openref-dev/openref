import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApplicationBootError, ShutdownTimeoutError } from '@openref/core';
import { describe, expect, it, vi } from 'vitest';
import { loadFromNestApplication } from '../../src/cli/infrastructure/adapters/nest-application.adapter';

const FIXTURES = fileURLToPath(new URL('../mocks/from-nest/', import.meta.url));

describe('loadFromNestApplication', () => {
  it('should extract the document a named "createApp" export mounts', async () => {
    // Given
    const entry = resolve(FIXTURES, 'succeeds.mjs');

    // When
    const loaded = await loadFromNestApplication(entry);

    // Then
    expect(loaded.document.info.title).toBe('Fixture');
  });

  it('should fall back to a default export when there is no "createApp"', async () => {
    // Given
    const entry = resolve(FIXTURES, 'default-export.mjs');

    // When
    const loaded = await loadFromNestApplication(entry);

    // Then
    expect(loaded.document.info.title).toBe('DefaultExport');
  });

  it('should close the application once extraction is done', async () => {
    // Given
    const loaded = await loadFromNestApplication(resolve(FIXTURES, 'succeeds.mjs'));

    // When
    const closing = loaded.close();

    // Then
    await expect(closing).resolves.toBeUndefined();
  });

  it('should report the boot error rather than an empty document when the factory throws', async () => {
    // Given
    const entry = resolve(FIXTURES, 'boot-throws.mjs');

    // When
    const loading = loadFromNestApplication(entry);

    // Then
    await expect(loading).rejects.toBeInstanceOf(ApplicationBootError);
    await expect(loading).rejects.toThrow(/database unreachable/);
  });

  it('should report a boot error when the entry exports no usable factory', async () => {
    // Given
    const entry = resolve(FIXTURES, 'no-export.mjs');

    // When
    const loading = loadFromNestApplication(entry);

    // Then
    await expect(loading).rejects.toBeInstanceOf(ApplicationBootError);
    await expect(loading).rejects.toThrow(/exports neither/);
  });

  it('should report a boot error when the factory does not return a NestJS application', async () => {
    // Given
    const entry = resolve(FIXTURES, 'no-get-method.mjs');

    // When
    const loading = loadFromNestApplication(entry);

    // Then
    await expect(loading).rejects.toBeInstanceOf(ApplicationBootError);
    await expect(loading).rejects.toThrow(/did not return a NestJS application/);
  });

  it('should report a boot error when the application has no document mounted', async () => {
    // Given
    const entry = resolve(FIXTURES, 'no-document-mounted.mjs');

    // When
    const loading = loadFromNestApplication(entry);

    // Then
    await expect(loading).rejects.toBeInstanceOf(ApplicationBootError);
    await expect(loading).rejects.toThrow(/no document mounted/);
  });

  it('should report a boot error when the entry cannot be loaded at all', async () => {
    // Given
    const entry = resolve(FIXTURES, 'does-not-exist.mjs');

    // When
    const loading = loadFromNestApplication(entry);

    // Then
    await expect(loading).rejects.toBeInstanceOf(ApplicationBootError);
    await expect(loading).rejects.toThrow(/could not load/);
  });

  it('should force close and report it when the application does not close within its timeout', async () => {
    // Given
    const loaded = await loadFromNestApplication(resolve(FIXTURES, 'hangs-on-close.mjs'), 20);

    // When
    const closing = loaded.close();

    // Then
    await expect(closing).rejects.toBeInstanceOf(ShutdownTimeoutError);
    await expect(closing).rejects.toThrow(/did not close within 20ms/);
  });

  it('should not hold the process open once a fast close has already won the race', async () => {
    // Given fake timers, so the question is which timers are left rather than how long anything
    // took. THIS CASE USED TO ASSERT THAT `close` RETURNED IN UNDER 20 MS, AND THAT WAS WRONG
    // TWICE, which is why it is written this way and why the change is recorded in SPEC 20 under
    // `TX-CLOCK`. It was an elapsed threshold on unfixed hardware, 20 ms against a 20 ms timeout,
    // which is neither a recorded machine nor a hang catcher loose by an order of magnitude. And
    // it did not prove its own title: a timer that is never cleared holds the event loop open
    // while `close` still returns at once, so the clock reading was consistent with the defect
    // it was meant to exclude. What holds the process open is a pending timer, so a pending
    // timer is what is counted.
    vi.useFakeTimers();

    try {
      // Given the timer is really armed, asserted before anything is asserted absent: a close
      // that never settles leaves it pending, and a count of zero at the end would otherwise be
      // satisfied by a `close` that never armed one at all.
      const hanging = await loadFromNestApplication(resolve(FIXTURES, 'hangs-on-close.mjs'), 20);
      // The expectation is attached before the clock moves, not after: a rejection with nothing
      // watching it yet is an unhandled rejection, which vitest reports as an error beside a
      // passing run.
      const timedOut = expect(hanging.close()).rejects.toBeInstanceOf(ShutdownTimeoutError);
      const armed = vi.getTimerCount();
      await vi.advanceTimersByTimeAsync(20);
      await timedOut;

      // When a close that settles at once wins the same race
      const loaded = await loadFromNestApplication(resolve(FIXTURES, 'succeeds.mjs'), 20);
      await loaded.close();

      // Then
      expect(armed).toBe(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
