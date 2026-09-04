/**
 * Two facts about the wire suites that the suites themselves cannot state, taken off the tree.
 *
 * WHY A UNIT FILE FOR THEM. Both are properties of the harness rather than of a request: what the
 * multipart substitution actually compares, and how many wire cases exist. Neither can be asserted
 * from inside a case that needs a live server and a real binary, and the second cannot be asserted
 * from inside the file it counts.
 *
 * NEITHER FIGURE IS RETYPED FROM `ai-docs/SPEC.md`, AND NEITHER COULD BE. `ai-docs/` is excluded
 * from this repository, so a check that read the document would fail on every clone; what a check
 * here can do is derive the quantity from the tree and hold the recorded figure to it, which is the
 * shape `tools/gates/test/integration/published-form.spec.ts` already uses for byte counts.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { withoutBoundary } from '../mocks/wire';

const INTEGRATION = join(import.meta.dirname, '..', 'integration');

/**
 * The wire cases one suite declares, counted rather than remembered.
 *
 * `it` AND `it.skipIf` BOTH COUNT, because a case guarded by a proof of presence is a case: it
 * runs wherever its binary is, and SPEC 18 counts it in the denominator it states.
 *
 * @param file - Name of a suite in `test/integration`
 * @returns How many cases it declares
 */
function caseCount(file: string): number {
  const source = readFileSync(join(INTEGRATION, file), 'utf8');

  return [...source.matchAll(/^\s*it(?:\.skipIf\([^\n]*\))?\(/gmu)].length;
}

describe('the multipart substitution the wire comparison makes', () => {
  it('should tell apart two framings that the prefix rule it replaces could not', () => {
    // Given a client that frames a multipart body and adds a parameter of its own to the field,
    // beside the plan's own content type, which carries the media type and nothing else
    const plan = 'multipart/form-data';
    const invented = 'multipart/form-data; charset=utf-8; boundary=--abc';

    // When the rule the suite used until this revision is applied, the one that read the field as
    // a prefix
    const prefixRule = invented.startsWith('multipart/form-data;');

    // Then it says the two agree, which is the blindness: a parameter the client invented sits
    // inside the span the prefix never looks at.
    expect(prefixRule).toBe(true);

    // And the rule SPEC 18 now states, everything but the boundary, does not
    expect(withoutBoundary(invented)).not.toBe(withoutBoundary(plan));
    expect(withoutBoundary('multipart/form-data; boundary=--abc')).toBe(withoutBoundary(plan));
  });

  it('should excuse the boundary alone, whichever side of the field it is written on', () => {
    // Given the two framings a multipart case actually produces: one boundary from curl and one
    // from the runner, neither of which can match the other
    // When, Then
    expect(withoutBoundary('multipart/form-data; boundary=------------------------1')).toBe(
      'multipart/form-data',
    );
    expect(withoutBoundary('multipart/form-data; boundary=----formdata-undici-2')).toBe(
      'multipart/form-data',
    );
    expect(withoutBoundary('multipart/form-data;boundary=3; charset=utf-8')).toBe(
      'multipart/form-data; charset=utf-8',
    );
  });
});

describe('the wire case denominator SPEC 18 records', () => {
  it('should be the number of cases this tree actually declares, split as SPEC 18 splits it', () => {
    // Given the two suites, counted rather than remembered
    const curl = caseCount('curl-wire-equality.spec.ts');
    const tools = caseCount('tool-wire-equality.spec.ts');

    // When
    const total = curl + tools;

    // Then, the split SPEC 18 names and the total it states. The previous figure was 33 against a
    // tree holding 34, which is what a hand written denominator does: it describes the tree of the
    // day it was typed. This one is derived, so adding a case reddens here and the sentence and
    // the tree move together.
    expect(curl).toBe(7);
    expect(tools).toBe(27);
    expect(total).toBe(34);
  });
});
