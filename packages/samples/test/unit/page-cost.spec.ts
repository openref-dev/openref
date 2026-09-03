import { describe, expect, it } from 'vitest';
import { buildSampleRequest, generateCodeSamples, placeholderCredentials } from '../../src/index';
import { representativeInputs, representativeOperation } from '../mocks/operations';

/**
 * The figure SPEC 18 quotes for what the fifteen samples of one operation weigh.
 *
 * IT HAS A RUNNER BECAUSE IT IS A RECORD SOMEBODY WILL ACT ON. The section argues that reaching a
 * page is a decision with a price, and the price is a number; a number in a document with nothing
 * checking it is the class of claim this project keeps finding false after five slices. When an
 * emitter changes, this case reddens, and whoever changes it moves both this number and the
 * section's together.
 *
 * THE HIGHLIGHTED FIGURES ARE NOT PINNED HERE, and the reason is the boundary. Highlighting is
 * `@openref/render` and this package cannot see it. The section states how they are reproduced,
 * from this same fixture.
 */
const REPRESENTATIVE_RAW_BYTES = 7164;

describe('the representative operation the T059 section is measured from', () => {
  it('should produce fifteen samples weighing the bytes the specification states', () => {
    // Given
    const operation = representativeOperation();
    const { values } = placeholderCredentials(operation.security);
    const request = buildSampleRequest(operation, representativeInputs(), values);

    // When
    const { samples, omitted } = generateCodeSamples(request);
    const raw = samples.reduce(
      (total, sample) => total + Buffer.byteLength(sample.source, 'utf8'),
      0,
    );

    // Then
    expect(omitted).toEqual([]);
    expect(samples).toHaveLength(15);
    expect(raw).toBe(REPRESENTATIVE_RAW_BYTES);
  });

  it('should carry the credential as a placeholder and never as a value', () => {
    // Given, the fixture's one scheme, which a page would have to render
    const operation = representativeOperation();
    const { values, unsendable } = placeholderCredentials(operation.security);
    expect(unsendable).toEqual([]);

    // When
    const request = buildSampleRequest(operation, representativeInputs(), values);

    // Then
    expect(request.plan.headers.Authorization).toBe('Bearer <bearer>');
  });
});
