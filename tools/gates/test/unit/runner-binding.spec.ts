import { describe, expect, it } from 'vitest';
import {
  auditRunnerBinding,
  HYDRATION_MARKERS,
  RUNNER_MARKERS,
} from '../../src/lib/runner-binding';

/** A bundle carrying every marker, as the shipped one does. */
const COMPLETE = [...HYDRATION_MARKERS, ...RUNNER_MARKERS]
  .map((marker) => `const x=${JSON.stringify(marker.literal)};`)
  .join('');

/** The bundle as it was between T013 and T014: hydration, no runner. */
const WITHOUT_RUNNER = HYDRATION_MARKERS.map(
  (marker) => `const x=${JSON.stringify(marker.literal)};`,
).join('');

describe('auditRunnerBinding', () => {
  it('should report nothing on a bundle carrying hydration and the runner', () => {
    // Given
    const bundle = COMPLETE;

    // When
    const audit = auditRunnerBinding(bundle);

    // Then
    expect(audit.missing).toEqual([]);
  });

  it('should report the runner half on the bundle as it stood before T014', () => {
    // Given, the exact state this check exists to make un-re-enterable: a page that hydrates
    // and a console with nothing to send through, which passed every check there was.
    const bundle = WITHOUT_RUNNER;

    // When
    const missing = auditRunnerBinding(bundle).missing.map((marker) => marker.literal);

    // Then
    expect(missing).toEqual(RUNNER_MARKERS.map((marker) => marker.literal));
  });

  it('should report the hydration half when handed the wrong file', () => {
    // Given, a file that carries the runner and hydrates nothing, such as the runner package
    // built on its own. Without this check that file would pass the runner half in silence.
    const bundle = RUNNER_MARKERS.map(
      (marker) => `const x=${JSON.stringify(marker.literal)};`,
    ).join('');

    // When
    const missing = auditRunnerBinding(bundle).missing.map((marker) => marker.literal);

    // Then
    expect(missing).toEqual(HYDRATION_MARKERS.map((marker) => marker.literal));
  });

  it('should report everything on an empty file, rather than reading it as clean', () => {
    // Given
    const bundle = '';

    // When
    const missing = auditRunnerBinding(bundle).missing;

    // Then
    expect(missing).toHaveLength(HYDRATION_MARKERS.length + RUNNER_MARKERS.length);
  });

  it('should name what carries each marker, so a failure says what to look at', () => {
    // Given
    const markers = [...HYDRATION_MARKERS, ...RUNNER_MARKERS];

    // When
    const described = markers.filter((marker) => marker.carriedBy.trim() !== '');

    // Then
    expect(described).toHaveLength(markers.length);
  });
});
