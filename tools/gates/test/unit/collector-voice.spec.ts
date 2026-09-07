import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { COLLECTOR_REASON_LIMIT } from '../../src/config.js';
import {
  collectorPackages,
  collectorVoiceGate,
  runCollectorVoiceGate,
  scanCollectors,
} from '../../src/gates/collector-voice.gate.js';
import { literalAround, valueAt } from '../../src/lib/collector-voice.js';
import { textSourceGate } from '../../src/gates/text-source.gate.js';
import { GATES } from '../../src/run.js';

/**
 * The gate that closes the hole `discovery-voice.spec.ts` named in its own header.
 *
 * WHAT THE HOLE WAS. That sweep bounds the reason of every collector inside `packages/nest` and
 * says plainly that the ecosystem collectors are in their own packages and cannot be reached from
 * there, so each is covered only by its own suite and a fifth ecosystem package could ship in the
 * old voice with nothing to say so. The case below that writes a probe into a real collector's
 * source is what proves this gate would see it.
 */

const repoRoot = join(import.meta.dirname, '..', '..', '..', '..');

/** Where a probe is written, inside a collector package so the derived set reaches it. */
const PROBE_PATH = join(repoRoot, 'packages', 'collector-casl', 'src', 'voice-probe.ts');

/** The sentence that was on the maintainer's health page, verbatim, in a problem's shape. */
const OLD_VOICE =
  'the handler binds a custom parameter decorator, whose factory receives the whole ' +
  'execution context, which is an access path no scan of the handler body can see. No ' +
  'parameter read fact was reported for this route: a scan that cannot account for the ' +
  'handler says nothing rather than guessing';

/**
 * A collector source in the old voice, written the way a real one writes a problem.
 *
 * @param reason - The reason the probe pushes
 * @param action - The action beside it, or undefined to leave it out
 * @returns TypeScript source
 */
function probeSource(reason: string, action: string | undefined): string {
  const beside = action === undefined ? '' : `\n    action: '${action}',`;

  return [
    'const problems: { subject: string; reason: string; action?: string }[] = [];',
    'export function probe(subject: string): void {',
    '  problems.push({',
    '    subject,',
    `    reason:\n      '${reason}',${beside}`,
    '  });',
    '}',
    '',
  ].join('\n');
}

afterEach(() => {
  rmSync(PROBE_PATH, { force: true });
});

describe('collectorVoiceGate', () => {
  it('should pass over the committed ecosystem collectors', () => {
    // Given the real repository
    // When
    const result = runCollectorVoiceGate({ repoRoot });

    // Then
    expect(result.findings.filter((finding) => finding.level === 'error')).toEqual([]);
    expect(result.status).toBe('pass');
  });

  it('should derive the collector set from the disk rather than from a list', () => {
    // Given, and the subject is asserted present first: a derivation that found nothing would
    // satisfy every bound below over nothing at all
    const found = collectorPackages(repoRoot);

    // When
    const scans = scanCollectors(repoRoot);

    // Then every collector package in the tree is reached, the two new ones included, and each of
    // them contributed reader text this gate measured
    expect(found.length).toBeGreaterThanOrEqual(5);
    expect(found).toContain('collector-redisx-rate-limit');
    expect(found).toContain('collector-redisx-idempotency');
    expect(scans.reduce((total, scan) => total + scan.reasons.length, 0)).toBeGreaterThanOrEqual(
      12,
    );
    expect(scans.filter((scan) => scan.pushes > 0 && scan.reasons.length === 0)).toEqual([]);
  });

  it('should redden on a reason written in the old voice, in a package no list names', () => {
    // Given the old voice pushed from inside a real ecosystem collector's source, which is the
    // exact shape nothing could see before this gate existed
    writeFileSync(PROBE_PATH, probeSource(OLD_VOICE, 'do the thing'), 'utf8');

    // When
    const result = runCollectorVoiceGate({ repoRoot });

    // Then
    expect(OLD_VOICE.length).toBeGreaterThan(COLLECTOR_REASON_LIMIT * 2);
    expect(result.status).toBe('fail');
    expect(
      result.findings.some(
        (finding) =>
          finding.level === 'error' && finding.message.startsWith('[reason-too-long] packages/'),
      ),
    ).toBe(true);
  });

  it('should redden on a reason with no action beside it', () => {
    // Given a short reason and nothing under it. `openref doctor` draws the subject and the action
    // and never the reason, so this prints the wrong half there.
    writeFileSync(
      PROBE_PATH,
      probeSource('the key holds a function, so the bucket is not known', undefined),
      'utf8',
    );

    // When
    const result = runCollectorVoiceGate({ repoRoot });

    // Then
    expect(result.status).toBe('fail');
    expect(
      result.findings.some(
        (finding) => finding.level === 'error' && finding.message.startsWith('[action-missing]'),
      ),
    ).toBe(true);
  });

  it('should read a reason that spans concatenated literals as the whole sentence', () => {
    // Given the walk itself, over the shape every long reason in these packages is written in.
    // Without this case the gate could be reading the first fragment of each one and measuring
    // nothing, which is a bound that passes over text it never finished.
    const source = "        reason:\n          'one half of it ' +\n          'and the other',\n";

    // When
    const read = valueAt(source, source.indexOf('reason:') + 'reason:'.length);

    // Then
    expect(read).toBe('one half of it and the other');
  });

  it('should take the enclosing literal and not a window of characters', () => {
    // Given a JSDoc above the member that names a subject, which is what made a retired collector's
    // record look like a discovery problem in the sweep this walk came from
    const source = '/** @param subject - a name */\nfunction retire() {\n  return { reason: 1 };';

    // When
    const around = literalAround(source, source.indexOf('reason:'));

    // Then the look back stops at the brace the language draws, so the comment is not in it
    expect(around).not.toContain('@param');
  });

  it('should measure the same bound the sweep in packages/nest measures', () => {
    // Given the other writing of this number, read out of the spec file rather than remembered.
    // Two instruments measuring one rule with two bounds would be two rules wearing one name.
    const sweep = readFileSync(
      join(repoRoot, 'packages', 'nest', 'test', 'unit', 'discovery-voice.spec.ts'),
      'utf8',
    );

    // When
    const declared = /const REASON_LIMIT = (\d+);/.exec(sweep);

    // Then
    expect(declared).not.toBeNull();
    expect(Number(declared?.[1])).toBe(COLLECTOR_REASON_LIMIT);
  });

  it('should run beside the text source gate, before anything that reads an artifact', () => {
    // Given
    const order = GATES.map((gate) => gate.id);

    // When
    const position = order.indexOf(collectorVoiceGate.id);

    // Then
    expect(order[position - 1]).toBe(textSourceGate.id);
  });
});
