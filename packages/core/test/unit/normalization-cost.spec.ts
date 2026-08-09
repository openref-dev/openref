import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { canonicalize, normalizeOpenApiDocument, parseSpecification } from '../../src/index';

/**
 * Normalization must stay proportional to its input.
 *
 * This guards a class of defect, not the one document that exposed it. Expanding every `$ref`
 * occurrence independently grew combinatorially on a graph that was both deep and wide:
 * `stripe.yaml` took 18 ms to fail at a depth limit of 24 and 18907 ms to fail at 32, a
 * thousandfold for eight more levels, and completed at no limit at all. Nothing in the suite
 * would have noticed until a document happened to be shaped badly enough to trip it.
 *
 * Two bounds, and the deterministic one carries the weight:
 *
 * - output size against input size. This is machine independent, so it can be tight. Anything
 *   superlinear inflates the produced IR long before it becomes slow enough to notice.
 * - wall clock against input size, generously. This only exists to catch a change that hangs
 *   rather than inflates, so it is set far above any real measurement and is not a benchmark.
 *
 * Measured when written, largest documents: Stripe 0.86x and 154 ms/MB, Kubernetes apps 1.85x
 * and 48 ms/MB, Twilio 1.08x and 172 ms/MB.
 */

const CORPUS = join(import.meta.dirname, '..', 'corpus');

interface ManifestEntry {
  readonly file: string;
}

/**
 * Ceiling on produced IR against source bytes.
 *
 * The constant term absorbs the fixed cost that dominates a very small document, where a few
 * hundred bytes of source produce navigation and an info block regardless.
 */
const MAX_OUTPUT_RATIO = 4;
const OUTPUT_OVERHEAD_BYTES = 8192;

/** Ceiling on normalization time, per megabyte of source. Roughly twenty times the real cost. */
const MAX_MS_PER_MB = 3000;

/** Ceiling on normalization time for any one document, whatever its size. */
const MAX_MS_PER_DOCUMENT = 30_000;

/** Documents large enough for the ratio to mean something rather than measure fixed overhead. */
const LARGE_DOCUMENT_BYTES = 100 * 1024;

function corpusFiles(): string[] {
  const manifest = JSON.parse(readFileSync(join(CORPUS, 'manifest.json'), 'utf8')) as {
    documents: ManifestEntry[];
  };
  return manifest.documents.map((entry) => entry.file).sort();
}

interface Measurement {
  readonly file: string;
  readonly inputBytes: number;
  readonly outputBytes: number;
  readonly milliseconds: number;
}

function measure(file: string): Measurement {
  const text = readFileSync(join(CORPUS, 'documents', file), 'utf8');
  const started = performance.now();
  const document = normalizeOpenApiDocument(parseSpecification(text));
  const milliseconds = performance.now() - started;

  return {
    file,
    inputBytes: Buffer.byteLength(text, 'utf8'),
    outputBytes: canonicalize({ ...document, hash: '' }).length,
    milliseconds,
  };
}

const measurements = corpusFiles().map((file) => measure(file));

describe('normalization cost', () => {
  it('should normalize every corpus document at the default depth', () => {
    // Given
    const files = corpusFiles();

    // When, every document was normalized above without a depth override
    const normalized = measurements.map((measurement) => measurement.file);

    // Then
    expect(normalized).toEqual(files);
    expect(files.length).toBeGreaterThanOrEqual(15);
  });

  it('should produce IR proportional to the source, not multiplied by it', () => {
    // Given
    const limitFor = (inputBytes: number): number =>
      inputBytes * MAX_OUTPUT_RATIO + OUTPUT_OVERHEAD_BYTES;

    // When
    const over = measurements.filter(
      (measurement) => measurement.outputBytes > limitFor(measurement.inputBytes),
    );

    // Then
    expect(
      over.map(
        (measurement) =>
          `${measurement.file}: ${String(measurement.outputBytes)} bytes from ${String(measurement.inputBytes)}`,
      ),
    ).toEqual([]);
  });

  it('should keep the ratio flat as documents grow, which superlinear expansion cannot', () => {
    // Given, the large documents are where an exponential term would show first
    const large = measurements.filter(
      (measurement) => measurement.inputBytes >= LARGE_DOCUMENT_BYTES,
    );

    // When
    const ratios = large.map((measurement) => measurement.outputBytes / measurement.inputBytes);

    // Then
    expect(large.length).toBeGreaterThanOrEqual(4);
    expect(Math.max(...ratios)).toBeLessThan(MAX_OUTPUT_RATIO);
  });

  it('should stay inside a generous wall clock ceiling, so a hang fails rather than waits', () => {
    // Given
    const budgetFor = (inputBytes: number): number =>
      Math.min(MAX_MS_PER_DOCUMENT, (inputBytes / 1_048_576) * MAX_MS_PER_MB + 1000);

    // When
    const over = measurements.filter(
      (measurement) => measurement.milliseconds > budgetFor(measurement.inputBytes),
    );

    // Then
    expect(
      over.map(
        (measurement) => `${measurement.file}: ${String(Math.round(measurement.milliseconds))} ms`,
      ),
    ).toEqual([]);
  });

  it('should store the body of a named schema once however often it is referenced', () => {
    // Given, the most referenced schema in the largest corpus document
    const largest = [...measurements].sort((a, b) => b.inputBytes - a.inputBytes)[0];
    const text = readFileSync(join(CORPUS, 'documents', largest?.file ?? ''), 'utf8');
    const document = normalizeOpenApiDocument(parseSpecification(text));
    const serialized = canonicalize({ ...document, hash: '' });

    const counted = [...document.schemas.keys()]
      .map((id) => ({ id, uses: occurrences(serialized, `"$ref":"${id}"`) }))
      .sort((a, b) => b.uses - a.uses);

    const busiest = counted[0];
    const body = document.schemas.get(busiest?.id ?? '')?.normalized;

    // When
    const bodyCopies = occurrences(serialized, canonicalize(body ?? {}));

    // Then, referenced many times over, and present exactly once. Under the previous model
    // this number was the number of use sites, which is what made the IR multiply.
    expect(busiest?.uses ?? 0).toBeGreaterThan(5);
    expect(bodyCopies).toBe(1);
  }, 120_000);
});

/** Counts non overlapping occurrences of a needle. */
function occurrences(haystack: string, needle: string): number {
  if (needle === '') return 0;
  return haystack.split(needle).length - 1;
}
