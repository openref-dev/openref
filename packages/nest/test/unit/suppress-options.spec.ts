import { describe, expect, it } from 'vitest';
import { assertRootOptions } from '../../src/api/module-options';
import type { OpenRefRootOptions } from '../../src/api/module-options';
import { specification } from '../mocks/fixtures';

/**
 * What `runtime.suppress` refuses at boot, per SPEC 7.2.
 *
 * TWO OF THE THREE FAILURE MODES REFUSE AND THE THIRD DELIBERATELY DOES NOT, and the difference is
 * the whole of the option's honesty. A rule id nobody recognises and a suppression with no reason
 * are both a host having written something that cannot mean what they meant. A suppression that
 * matched nothing is a host having written something that means exactly what they meant on a
 * deployment where the class happens to be empty, so it is reported rather than refused.
 */

function options(partial: Partial<OpenRefRootOptions> = {}): OpenRefRootOptions {
  return {
    documents: [{ id: 'public', route: '/docs', document: specification() }],
    ...partial,
  };
}

describe('assertRootOptions with runtime.suppress', () => {
  it('should accept the classes a host decided not to fix, each with a reason', () => {
    // Given the maintainer's own two, which is what the option was built for
    const good: OpenRefRootOptions = options({
      runtime: {
        suppress: [
          {
            rule: 'missing-operation-id',
            reason: 'ids are generated and the team decided to keep them',
          },
          { rule: 'missing-example', reason: 'examples live in the client SDK repository' },
        ],
      },
    });

    // When, Then
    expect(() => {
      assertRootOptions(good);
    }).not.toThrow();
  });

  it('should refuse a display code and name the rule id that carries it', () => {
    // Given, `DX030` is what the page prints and the interface cites, so it is the string a host
    // reaches for first. The union stops it at compile time; this is the same refusal at boot,
    // for a host whose options came from JSON or from a cast.
    const bad = {
      ...options(),
      runtime: { suppress: [{ rule: 'DX030', reason: 'ids are generated' }] },
    } as unknown as OpenRefRootOptions;

    // When, Then. The refusal NAMES THE CORRECT ID rather than only rejecting the wrong one,
    // because a host who wrote the display code knows the class and not its identifier.
    expect(() => {
      assertRootOptions(bad);
    }).toThrow(/missing-operation-id/);
  });

  it('should refuse an unknown rule id and list what can be suppressed', () => {
    // Given
    const bad = {
      ...options(),
      runtime: { suppress: [{ rule: 'missing-exampels', reason: 'typo' }] },
    } as unknown as OpenRefRootOptions;

    // When, Then
    expect(() => {
      assertRootOptions(bad);
    }).toThrow(/is not a drift rule/);
  });

  it('should refuse a suppression with no reason at all', () => {
    // Given, a list of rule ids with nothing beside them is indistinguishable from a list somebody
    // pasted, and the whole argument for suppressing a class is that somebody decided
    const bad = {
      ...options(),
      runtime: { suppress: [{ rule: 'missing-example' }] },
    } as unknown as OpenRefRootOptions;

    // When, Then
    expect(() => {
      assertRootOptions(bad);
    }).toThrow(/needs a reason/);
  });

  it('should refuse a suppression whose reason is empty or blank', () => {
    // Given, an empty string is the shape a host reaches for to satisfy a required field without
    // answering it, which is the silent lie this option exists to prevent
    const empty = {
      ...options(),
      runtime: { suppress: [{ rule: 'missing-example', reason: '' }] },
    } as unknown as OpenRefRootOptions;
    const blank = {
      ...options(),
      runtime: { suppress: [{ rule: 'missing-example', reason: '   ' }] },
    } as unknown as OpenRefRootOptions;

    // When, Then
    expect(() => {
      assertRootOptions(empty);
    }).toThrow(/needs a reason/);
    expect(() => {
      assertRootOptions(blank);
    }).toThrow(/needs a reason/);
  });

  it('should refuse one rule named twice rather than suppress it once and count it twice', () => {
    // Given, two entries for one class would produce two rows in the disclosure with one reason
    // each and one of them matching nothing, which reads as a class that half worked
    const bad: OpenRefRootOptions = options({
      runtime: {
        suppress: [
          { rule: 'missing-example', reason: 'examples live in the SDK' },
          { rule: 'missing-example', reason: 'and also the handbook' },
        ],
      },
    });

    // When, Then
    expect(() => {
      assertRootOptions(bad);
    }).toThrow(/names "missing-example" twice/);
  });

  it('should accept a class that will match nothing, because that is not an error', () => {
    // Given a specification with no streaming endpoint at all, so this class is empty here and
    // may well not be on the next deployment
    const good: OpenRefRootOptions = options({
      runtime: {
        suppress: [{ rule: 'stream-unspecified', reason: 'streams are documented in the wiki' }],
      },
    });

    // When, Then. It boots, and the report says `matched: 0` so nobody has to notice on their own.
    expect(() => {
      assertRootOptions(good);
    }).not.toThrow();
  });
});
