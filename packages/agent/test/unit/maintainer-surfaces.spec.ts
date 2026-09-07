import { buildHealthReport, type IRDocument } from '@openref/core';
import {
  maintainerCollectorsCheck,
  maintainerDocument,
  maintainerObservation,
} from '../../../core/test/mocks/maintainer-document';
import { buildHealthModel } from '@openref/render';
import { describe, expect, it } from 'vitest';
import { agentHealthReport } from '../../src/mcp/domain/resources';
import { buildLlmsIndex } from '../../src/llms/domain/llms-text';

/**
 * Every surface, on the maintainer's own application, with the two classes he decided not to fix.
 *
 * IT IS A RECONSTRUCTION AND IT SAYS SO. The document is built in `@openref/core`'s mocks to the
 * profile measured on his application, 58 operations and 180 findings scoring 77, of which 111 are
 * `DX030` at 58 and `DX020` at 53. Nothing here boots his application; what is pinned is that the
 * arithmetic and every sentence built from it come out as measured on a document with those
 * numbers in it.
 *
 * THE SCORE SITS ON A ROUNDING BOUNDARY, deliberately left where it is. The weighted mean of this
 * profile is 77.49975, against a cut at 77.5, so any change to any denominator in the fixture
 * flips it to 78. That makes the 77 below an assertion about an exact profile rather than about an
 * approximation, which is what it should be.
 */

/** His document, with the two classes suppressed, exactly as `runtime.suppress` would. */
function withSuppression(): IRDocument {
  const document = maintainerDocument();

  return {
    ...document,
    health: buildHealthReport(document, {
      checks: [maintainerCollectorsCheck],
      observation: maintainerObservation,
      suppress: [
        { rule: 'missing-operation-id', reason: 'ids are generated, decided 2026-08 not to fix' },
        { rule: 'missing-example', reason: 'examples live in the client SDK repository' },
      ],
    }),
  };
}

/** His document, untouched, which is what he reads today. */
function untouched(): IRDocument {
  const document = maintainerDocument();

  return {
    ...document,
    health: buildHealthReport(document, {
      checks: [maintainerCollectorsCheck],
      observation: maintainerObservation,
    }),
  };
}

describe('the maintainer document, with DX030 and DX020 suppressed', () => {
  it('should read 180 findings and 77 percent before anything is suppressed', () => {
    // Given the reconstruction, which is the state he reads today
    const report = untouched().health;

    // When, Then. THE SUBJECT IS ASSERTED PRESENT BEFORE ANYTHING IS PROVED ABSENT.
    expect(report?.drift).toHaveLength(180);
    expect(report?.score).toBe(77);
    expect(report?.drift.filter((issue) => issue.rule === 'missing-operation-id')).toHaveLength(58);
    expect(report?.drift.filter((issue) => issue.rule === 'missing-example')).toHaveLength(53);
    expect(report?.suppression).toBeUndefined();
  });

  it('should move 111 findings and leave 69, with no stored total to disagree', () => {
    // Given
    const report = withSuppression().health;

    // When
    const drawn = report?.drift.length ?? 0;
    const moved = report?.suppression?.findings.length ?? 0;

    // Then `180 = 69 + 111` holds by construction rather than by a counter somebody remembered
    expect(drawn).toBe(69);
    expect(moved).toBe(111);
    expect(drawn + moved).toBe(180);
  });

  it('should move his score from 77 to 88 and print both', () => {
    // Given
    const report = withSuppression().health;

    // When
    const model = buildHealthModel(withSuppression(), '/docs');

    // Then
    expect(report?.suppression?.unsuppressedScore).toBe(77);
    expect(report?.suppression?.suppressedScore).toBe(88);
    expect(report?.suppression?.inverted).toBe(false);
    expect(report?.score).toBe(88);
    expect(model?.score).toBe('88% (77% unsuppressed)');
  });

  it('should say both quantities in the heading of the health page', () => {
    // Given
    const document = withSuppression();

    // When
    const model = buildHealthModel(document, '/docs');

    // Then the size of the list a reader is looking at, and the size of the one they are not
    expect(model?.title).toBe(
      'Documentation health, 58 operations, 69 findings in 15 causes, 111 suppressed by 2 classes',
    );
  });

  it('should hand the page, MCP and llms.txt one string', () => {
    // Given
    const document = withSuppression();

    // When
    const page = buildHealthModel(document, '/docs')?.score;
    const mcp = agentHealthReport(document).scoreText;
    const text = buildLlmsIndex(document, {
      basePath: '/docs',
      agent: { llmsTxt: true, mcp: false },
    });

    // Then
    expect(page).toBe('88% (77% unsuppressed)');
    expect(mcp).toBe(page);
    expect(text).toContain(
      '- [Documentation Health report](/docs/health): 88% (77% unsuppressed), ' +
        '111 suppressed by 2 classes',
    );
  });

  it('should invert his headline the moment security-drift joins the set', () => {
    // Given the same document with a third class suppressed, an `error` one this time
    const document = maintainerDocument();
    const inverted: IRDocument = {
      ...document,
      health: buildHealthReport(document, {
        checks: [maintainerCollectorsCheck],
        observation: maintainerObservation,
        suppress: [
          { rule: 'missing-operation-id', reason: 'ids are generated, decided 2026-08 not to fix' },
          { rule: 'missing-example', reason: 'examples live in the client SDK repository' },
          { rule: 'security-drift', reason: 'authorisation is enforced by the API gateway' },
        ],
      }),
    };

    // When
    const page = buildHealthModel(inverted, '/docs')?.score;
    const mcp = agentHealthReport(inverted);

    // Then. Suppressing two notes bought him 77 to 88; adding one error gives the list back four
    // more rows and the headline nothing at all, because the primary reverts to 77.
    expect(inverted.health?.suppression?.suppressedScore).toBe(90);
    expect(inverted.health?.suppression?.unsuppressedScore).toBe(77);
    expect(inverted.health?.suppression?.inverted).toBe(true);
    expect(inverted.health?.score).toBe(77);
    expect(page).toBe('77% (90% suppressed)');
    expect(mcp.scoreText).toBe(page);
    expect(mcp.score).toBe(77);
  });

  it('should draw one disclosure row per class, with the reason and the count', () => {
    // Given
    const model = buildHealthModel(withSuppression(), '/docs');

    // When
    const rows = model?.suppression?.classes.map(
      (entry) => `${entry.code} ${entry.rule} ${entry.count} ${entry.reason}`,
    );

    // Then
    expect(model?.suppression?.note).toBe('111 suppressed by 2 classes');
    expect(rows).toEqual([
      'DX030 missing-operation-id 58 ids are generated, decided 2026-08 not to fix',
      'DX020 missing-example 53 examples live in the client SDK repository',
    ]);
  });
});
