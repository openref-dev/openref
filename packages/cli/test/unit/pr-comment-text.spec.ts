import type { IRDiffChange, IRDiffReport } from '@openref/core';
import { describe, expect, it } from 'vitest';
import {
  operationOf,
  PR_COMMENT_LIMIT,
  PR_COMMENT_MARKER,
  renderPrComment,
  signOf,
  summarizeForComment,
  truncateComment,
} from '../../src/cli/api/commands/pr-comment-text';

/**
 * The SPEC 17.2 comment, one property per case.
 *
 * THE EXAMPLE IN SPEC 17.2 IS THE FIRST CASE and it is built from a report shaped like the one
 * that would produce it, not from the finished string: a test that compares a rendering against
 * itself proves the comparison, never the construction.
 */

function change(
  partial: Partial<IRDiffChange> & Pick<IRDiffChange, 'kind' | 'subject'>,
): IRDiffChange {
  return { classification: 'non-breaking', ...partial };
}

function report(
  breaking: readonly IRDiffChange[],
  nonBreaking: readonly IRDiffChange[] = [],
): IRDiffReport {
  return { breaking, nonBreaking };
}

describe('operationOf', () => {
  it('should read the operation out of a subject that names one after "of"', () => {
    // When / Then
    expect(operationOf('query parameter q of GET /users')).toBe('GET /users');
    expect(operationOf('property country of request body of POST /users')).toBe('POST /users');
  });

  it('should read a subject that is an operation and nothing else', () => {
    // When / Then
    expect(operationOf('DELETE /users/{id}')).toBe('DELETE /users/{id}');
  });

  it('should answer nothing for a subject whose site is a named schema', () => {
    // Given: `User` is not an operation, and this is the case that decides which block a
    // schema change is printed in
    // When / Then
    expect(operationOf('email of User')).toBeUndefined();
    expect(operationOf('User.email')).toBeUndefined();
    expect(operationOf('security scheme apiKey')).toBeUndefined();
  });
});

describe('signOf', () => {
  it('should read the sign off the kind rather than off the classification', () => {
    // Given a breaking addition and a non breaking removal, which is the pair that separates
    // the two rules
    const added = change({
      kind: 'required-property-added',
      subject: 'CreateUser.country',
      classification: 'breaking',
    });
    const removed = change({ kind: 'response-removed', subject: 'response 404 of GET /users' });

    // When / Then
    expect(signOf(added)).toBe('+');
    expect(signOf(removed)).toBe('-');
    expect(signOf(change({ kind: 'type-changed', subject: 'User.id' }))).toBe('~');
  });
});

describe('summarizeForComment', () => {
  it('should keep an added operation as added even when a change inside it also registered', () => {
    // Given
    const input = report(
      [],
      [
        change({ kind: 'operation-added', subject: 'POST /payments/refund' }),
        change({
          kind: 'optional-parameter-added',
          subject: 'query parameter dry of POST /payments/refund',
        }),
      ],
    );

    // When
    const summary = summarizeForComment(input);

    // Then
    expect(summary.operations).toEqual([{ sign: '+', subject: 'POST /payments/refund' }]);
  });

  it('should put a change with no operation in the second block, once per subject', () => {
    // Given the same schema touched twice
    const input = report([
      change({ kind: 'type-changed', subject: 'User.id', classification: 'breaking' }),
      change({ kind: 'constraints-changed', subject: 'User.id', classification: 'breaking' }),
    ]);

    // When
    const summary = summarizeForComment(input);

    // Then
    expect(summary.operations).toEqual([]);
    expect(summary.others).toEqual([{ sign: '~', subject: 'User.id' }]);
  });
});

describe('renderPrComment', () => {
  it('should render the SPEC 17.2 example: three signed lines, the count, and the preview', () => {
    // Given a report shaped like the one the SPEC transcript was taken from
    const input = report(
      [
        change({
          kind: 'operation-removed',
          subject: 'DELETE /payments/{id}',
          classification: 'breaking',
        }),
        change({
          kind: 'required-parameter-added',
          subject: 'query parameter mode of GET /payments/{id}',
          classification: 'breaking',
        }),
        change({ kind: 'type-changed', subject: 'Payment.amount', classification: 'breaking' }),
        change({ kind: 'property-removed', subject: 'Payment.note', classification: 'breaking' }),
      ],
      [change({ kind: 'operation-added', subject: 'POST /payments/refund' })],
    );

    // When
    const body = renderPrComment(input, { previewUrl: 'https://docs.example.com/pr-7' });

    // Then
    expect(body.split('\n')[0]).toBe(PR_COMMENT_MARKER);
    expect(body).toContain('### API changes');
    expect(body).toContain(
      [
        '```diff',
        '+ POST   /payments/refund',
        '~ GET    /payments/{id}',
        '- DELETE /payments/{id}',
        '```',
      ].join('\n'),
    );
    expect(body).toContain('4 breaking changes detected');
    expect(body).toContain('Preview: https://docs.example.com/pr-7');
  });

  it('should print schema subjects in their own block rather than among the routes', () => {
    // Given
    const input = report([
      change({ kind: 'operation-removed', subject: 'DELETE /a', classification: 'breaking' }),
      change({ kind: 'property-removed', subject: 'User.email', classification: 'breaking' }),
    ]);

    // When
    const body = renderPrComment(input);

    // Then
    expect(body).toContain('Schemas, security and servers:');
    const routes = body.slice(body.indexOf('```diff'), body.indexOf('Schemas'));
    expect(routes).toContain('- DELETE /a');
    expect(routes).not.toContain('User.email');
  });

  it('should say one breaking change in the singular', () => {
    // When
    const body = renderPrComment(
      report([
        change({ kind: 'operation-removed', subject: 'DELETE /a', classification: 'breaking' }),
      ]),
    );

    // Then
    expect(body).toContain('1 breaking change detected');
    expect(body).not.toContain('1 breaking changes');
  });

  it('should say so, and print no preview line, when there is nothing at all', () => {
    // When
    const body = renderPrComment(report([]));

    // Then
    expect(body).toContain('No changes.');
    expect(body).not.toContain('Preview:');
    expect(body).not.toContain('<details>');
  });

  it('should omit the preview line when no address is known rather than print a placeholder', () => {
    // Given a report with something in it and no preview
    const input = report([], [change({ kind: 'operation-added', subject: 'GET /a' })]);

    // When
    const body = renderPrComment(input);

    // Then
    expect(body).toContain('No breaking changes detected');
    expect(body).not.toContain('Preview');
  });

  it('should carry the whole SPEC 17.1 report inside a details block', () => {
    // Given
    const input = report([
      change({ kind: 'operation-removed', subject: 'DELETE /a', classification: 'breaking' }),
    ]);

    // When
    const body = renderPrComment(input);

    // Then
    expect(body).toContain('<details><summary>Full report</summary>');
    expect(body).toContain('BREAKING');
    expect(body).toContain('</details>');
  });

  it('should fit the limit and say how many lines it removed', () => {
    // Given more changes than any comment could hold
    const many = Array.from({ length: 400 }, (_, index) =>
      change({
        kind: 'operation-removed',
        subject: `DELETE /r${String(index)}`,
        classification: 'breaking',
      }),
    );

    // When
    const body = renderPrComment(report(many), { limit: 2000 });

    // Then
    expect(body.length).toBeLessThanOrEqual(2000);
    expect(body).toMatch(/\d+ more lines did not fit in a GitHub comment/);
  });
});

describe('truncateComment', () => {
  it('should leave a body that already fits exactly as it was', () => {
    // Given
    const body = 'one\ntwo\n';

    // When / Then
    expect(truncateComment(body, 100)).toBe(body);
  });

  it('should cut at a line boundary and reserve room for its own notice', () => {
    // Given
    const body = Array.from({ length: 200 }, (_, index) => `line ${String(index)}`).join('\n');

    // When
    const cut = truncateComment(body, 300);

    // Then
    expect(cut.length).toBeLessThanOrEqual(300);
    expect(cut).toContain('did not fit in a GitHub comment');
    expect(cut.split('\n').some((line) => line.startsWith('line 0'))).toBe(true);
  });
});

/**
 * The seventh surface `T043`'s task text names: the action against a very large pull request.
 *
 * A PULL REQUEST TOUCHING FIVE THOUSAND FILES IS A DIFF WITH THOUSANDS OF CHANGES, and the thing
 * that breaks is not the diff, it is the comment: GitHub refuses a body over
 * {@link PR_COMMENT_LIMIT}, so a run that produced one would fail at the API after doing all the
 * work. Measured here rather than asserted, and the cut is required to say that it cut.
 */
describe('renderPrComment, a pull request far larger than a comment may be', () => {
  /** A report with `count` breaking changes and as many non breaking ones. */
  const hugeReport = (count: number): IRDiffReport => ({
    breaking: Array.from({ length: count }, (_, index) => ({
      kind: 'operation-removed' as const,
      classification: 'breaking' as const,
      subject: `DELETE /service-${String(index)}/resources/{resourceId}/members`,
    })),
    nonBreaking: Array.from({ length: count }, (_, index) => ({
      kind: 'operation-added' as const,
      classification: 'non-breaking' as const,
      subject: `POST /service-${String(index)}/resources/{resourceId}/members`,
    })),
  });

  it('should stay inside the limit and say that it cut, for a diff of five thousand changes', () => {
    // Given
    const report = hugeReport(2500);

    // Then, before the assertion: the untruncated body really would be over the limit.
    expect(report.breaking.length + report.nonBreaking.length).toBe(5000);

    // When
    const body = renderPrComment(report, {});

    // Then
    expect(body.length).toBeLessThanOrEqual(PR_COMMENT_LIMIT);
    expect(body).toContain(PR_COMMENT_MARKER);
    expect(body).toMatch(/more|truncat|cut/i);
  });

  it('should still count every change in the headline, not only the ones it printed', () => {
    // Given: the number a reader acts on must be the diff's, not the comment's.
    const report = hugeReport(2500);

    // When
    const body = renderPrComment(report, {});

    // Then
    expect(body).toContain('2500 breaking changes detected');
  });

  it('should keep the preview address, which a reader needs most when the diff is huge', () => {
    // Given
    const report = hugeReport(2500);

    // When
    const body = renderPrComment(report, { previewUrl: 'https://preview.example.com/pr-1' });

    // Then
    expect(body.length).toBeLessThanOrEqual(PR_COMMENT_LIMIT);
    expect(body).toContain('Preview: https://preview.example.com/pr-1');
    expect(body).toContain('2500 breaking changes detected');
  });

  it('should leave an ordinary comment untouched, so the cut is not always on', () => {
    // Given
    const report = hugeReport(2);

    // When
    const body = renderPrComment(report, {});

    // Then
    expect(body.length).toBeLessThan(2000);
    expect(body).toContain('2 breaking changes detected');
  });
});
