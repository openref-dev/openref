import { describe, expect, it } from 'vitest';
import {
  auditRunnerBinding,
  HYDRATION_MARKERS,
  RUNNER_CODE_MARKERS,
  RUNNER_WIRING_MARKERS,
} from '../../src/lib/runner-binding';
import type { BundleMarker } from '../../src/lib/runner-binding';

/** A file carrying the literals of the markers named, and nothing else. */
function carrying(markers: readonly BundleMarker[]): string {
  return markers.map((marker) => `const x=${JSON.stringify(marker.literal)};`).join('');
}

/** The shipped shape since T011-R: hydration and the key in the first paint, the runner behind it. */
const SPLIT = {
  initial: carrying([...HYDRATION_MARKERS, ...RUNNER_WIRING_MARKERS]),
  deferred: carrying(RUNNER_CODE_MARKERS),
};

describe('auditRunnerBinding', () => {
  it('should report nothing on a bundle that hydrates eagerly and runs behind a chunk', () => {
    // Given
    const sides = SPLIT;

    // When
    const audit = auditRunnerBinding(sides);

    // Then
    expect(audit.missing).toEqual([]);
    expect(audit.eager).toEqual([]);
  });

  it('should report the runner half on the bundle as it stood before T014', () => {
    // Given, the exact state this check exists to make un-re-enterable: a page that hydrates
    // and a console with nothing to send through, which passed every check there was.
    const sides = {
      initial: carrying([...HYDRATION_MARKERS, ...RUNNER_WIRING_MARKERS]),
      deferred: '',
    };

    // When
    const missing = auditRunnerBinding(sides).missing.map((marker) => marker.literal);

    // Then
    expect(missing).toEqual(RUNNER_CODE_MARKERS.map((marker) => marker.literal));
  });

  it('should report the runner as eager when it is back in what the first paint loads', () => {
    // Given, the bundle as it stood before T011-R: one file with everything in it. The console
    // works, so nothing about the console is wrong, and the whole of `@openref/runner` is
    // compiled on every page load for a feature most readers never open.
    const sides = {
      initial: carrying([...HYDRATION_MARKERS, ...RUNNER_WIRING_MARKERS, ...RUNNER_CODE_MARKERS]),
      deferred: '',
    };

    // When
    const audit = auditRunnerBinding(sides);

    // Then, present and therefore not missing, and reported by the other half of the check
    expect(audit.missing).toEqual([]);
    expect(audit.eager.map((marker) => marker.literal)).toEqual(
      RUNNER_CODE_MARKERS.map((marker) => marker.literal),
    );
  });

  it('should report the hydration half when handed the wrong file', () => {
    // Given, a graph whose first paint carries the runner package built on its own and hydrates
    // nothing. Without this half the runner check would pass over it in silence.
    const sides = { initial: '', deferred: carrying(RUNNER_CODE_MARKERS) };

    // When
    const missing = auditRunnerBinding(sides).missing.map((marker) => marker.literal);

    // Then
    expect(missing).toEqual(
      [...HYDRATION_MARKERS, ...RUNNER_WIRING_MARKERS].map((marker) => marker.literal),
    );
  });

  it('should report the key as missing when only a deferred chunk carries it', () => {
    // Given, a plausible mistake: the injection key follows the runner into the chunk. Nothing
    // then provides under it in the entry, so the console resolves a runner nobody can read.
    const sides = {
      initial: carrying(HYDRATION_MARKERS),
      deferred: carrying([...RUNNER_WIRING_MARKERS, ...RUNNER_CODE_MARKERS]),
    };

    // When
    const missing = auditRunnerBinding(sides).missing.map((marker) => marker.literal);

    // Then
    expect(missing).toEqual(RUNNER_WIRING_MARKERS.map((marker) => marker.literal));
  });

  it('should report everything on an empty graph, rather than reading it as clean', () => {
    // Given
    const sides = { initial: '', deferred: '' };

    // When
    const missing = auditRunnerBinding(sides).missing;

    // Then
    expect(missing).toHaveLength(
      HYDRATION_MARKERS.length + RUNNER_WIRING_MARKERS.length + RUNNER_CODE_MARKERS.length,
    );
  });

  it('should name what carries each marker, so a failure says what to look at', () => {
    // Given
    const markers = [...HYDRATION_MARKERS, ...RUNNER_WIRING_MARKERS, ...RUNNER_CODE_MARKERS];

    // When
    const described = markers.filter((marker) => marker.carriedBy.trim() !== '');

    // Then
    expect(described).toHaveLength(markers.length);
  });
});
