import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The voice SPEC 7.1 requires of everything a collector writes into `doctor`.
 *
 * WHY A SWEEP AND NOT A CASE PER COLLECTOR. Each collector's own unit test pins its own sentence,
 * which is what says that collector says the right thing; none of them can say that the next
 * collector will. The defect this closes was in fifteen collectors at once and reached a reader as
 * fifty words of the product explaining itself with no action in it, so the rule has to be about
 * the shape rather than about any one sentence.
 *
 * WHAT THIS PACKAGE CAN SEE, AND WHAT NOW SEES THE REST. The ecosystem collectors live in their own
 * packages and cannot be swept from here without a test in one package asserting about another's
 * source. Until `TX-REDISX-IDEMPOTENCY` that was the whole story and this header said so: each of
 * them carried the three members, each of their own unit suites pinned all three, and a fifth
 * ecosystem package could have been written in the old voice with nothing to say so. The
 * `collector-voice` gate now measures every package under `packages/` whose name marks it a
 * collector, derived from the disk rather than listed, with the same walk and the same bound, which
 * `tools/gates/test/unit/collector-voice.spec.ts` reads out of the line below and reconciles. What
 * this file still owns is the collectors of this package, which that gate does not reach.
 *
 * WHAT IS MEASURED IS WHAT A READER IS SHOWN FIRST. `reason` is the top line of the finding on the
 * health page and, once the registry has prefixed the collector's name onto it, the whole of what
 * a reader sees before they decide whether to open anything. `action` is the line under it.
 * `detail` is the disclosure, and it is deliberately unbounded: the reasoning did not have to be
 * deleted to make the first line short, and a bound on it would have deleted it slowly.
 *
 * THE BOUND IS A CHARACTER COUNT AND NOT A JUDGEMENT OF STYLE. It is set from the sentence SPEC
 * 7.1 names as the standard, `no source link template is configured, so DevTokenController.login
 * cannot be linked`, which is 88 characters, with room for a longer subject inside an
 * interpolation. What it cannot see is whether the clause says anything useful; that is what each
 * collector's own test is for.
 */

/** The root of `packages/nest`, from this file. */
const PACKAGE_ROOT = join(import.meta.dirname, '..', '..');

/** Where a `${...}` is counted as a value of ordinary length rather than as its own source text. */
const PLACEHOLDER = 'X'.repeat(20);

/**
 * The bound on a reason, in characters, per SPEC 7.1.
 *
 * MEASURED FROM THE SENTENCE THE MAINTAINER NAMED rather than chosen: the `source` row's 88
 * characters, plus room for one interpolated name longer than `DevTokenController.login`. Every
 * reason in this tree is under it with room; the shortest thing that breaks it is the old voice.
 */
const REASON_LIMIT = 140;

/** One `problems.push({ ... })` in a source file, as the sweep found it. */
interface Push {
  readonly file: string;
  readonly reason: string;
  readonly hasAction: boolean;
}

/**
 * The trees this sweep is about, per SPEC 7.1: the collectors of SPEC 6.2 and what feeds them.
 *
 * NAMED RATHER THAN GLOBBED, so that what it does not cover is a decision on the record instead of
 * an accident of a path. The event side producers of SPEC 8.3 write into the same carrier and have
 * not been moved to the three member voice; they are listed in {@link UNMOVED} below and a case
 * holds that list to what it is, so a new producer in one of those files is read rather than
 * absorbed and a new collector cannot be added anywhere this sweep does not reach.
 */
const SWEPT: readonly string[] = [
  'src/runtime/infrastructure/collectors',
  'src/runtime/application/services/collector-registry.service.ts',
  'src/runtime/application/services/runtime-pass.service.ts',
];

/**
 * The two files whose refusals become a collector's reason without being one themselves.
 *
 * THEY ARE BOUNDED AND THEY HAVE NO ACTION OF THEIR OWN. `scanHandlerReads` and `locateFunction`
 * report why they could not answer; the collector above each of them supplies what a reader does
 * about it, because that is a decision about the fact and not about the instrument. Their reasons
 * are swept because they are interpolated whole into a collector's reason, so a bound on the
 * collector alone would measure a placeholder and pass.
 */
const FEEDERS: readonly string[] = [
  'src/runtime/domain/handler-scan.ts',
  'src/runtime/infrastructure/adapters/function-location.adapter.ts',
];

/**
 * The producers of SPEC 8.3 that still write one sentence into both slots, named not smoothed.
 *
 * THEY ARE NOT A DEFECT OF THIS SLICE AND THEY ARE NOT FINE EITHER. `IRDiscoveryProblem.action` is
 * optional exactly so that a producer which has not moved keeps working: its reason is used for
 * both the message and the suggestion, which is where every producer stood before the split. What
 * a reader loses is the short first line, and the render model drops the repeat so at least the
 * sentence is printed once. The list is pinned so the next reader finds a decision here rather
 * than a gap.
 */
const UNMOVED: readonly string[] = [
  'src/events/domain/asyncapi-synthesis.ts',
  'src/events/domain/channel-pairing.ts',
  'src/events/infrastructure/adapters/channel-discovery.adapter.ts',
  'src/runtime/domain/relationships.ts',
  'src/runtime/infrastructure/adapters/controller-discovery.adapter.ts',
];

/** Every `.ts` file under one path, which may itself be a file. */
function sourcesUnder(path: string): readonly string[] {
  const entries = statSync(path).isDirectory()
    ? readdirSync(path, { withFileTypes: true })
    : undefined;
  if (entries === undefined) return path.endsWith('.ts') ? [path] : [];

  const found: string[] = [];
  for (const entry of entries) found.push(...sourcesUnder(join(path, entry.name)));

  return found;
}

/**
 * Reads the value of one object member as the text it produces, following `+` concatenation.
 *
 * A WALK AND NOT A PATTERN, for the reason `parseSource` in `handler-scan.ts` gives about the same
 * problem: a reason holds commas, braces and apostrophes, so anything that stops at the first one
 * of those reads half a sentence and passes a bound it never measured.
 *
 * @param source - The whole file
 * @param from - Index just after the member's colon
 * @returns The text the member evaluates to, with every interpolation counted as a value
 */
function valueAt(source: string, from: number): string {
  let at = from;
  let text = '';
  let depth = 0;

  while (at < source.length) {
    const char = source[at];

    if (char === '{' || char === '[' || char === '(') depth += 1;
    if (char === '}' || char === ']' || char === ')') {
      if (depth === 0) break;
      depth -= 1;
    }
    if (char === ',' && depth === 0) break;

    if (char === "'" || char === '"' || char === '`') {
      const quote = char;
      at += 1;
      while (at < source.length && source[at] !== quote) {
        if (source[at] === '\\') {
          at += 2;
          continue;
        }
        if (quote === '`' && source[at] === '$' && source[at + 1] === '{') {
          let inner = 1;
          at += 2;
          while (at < source.length && inner > 0) {
            if (source[at] === '{') inner += 1;
            if (source[at] === '}') inner -= 1;
            at += 1;
          }
          text += PLACEHOLDER;
          continue;
        }
        text += source[at] ?? '';
        at += 1;
      }
    }

    at += 1;
  }

  return text;
}

/**
 * The text of the object literal a member sits in, back to the brace that opens it.
 *
 * THE LITERAL AND NOT A WINDOW OF CHARACTERS. A fixed look-back reads whatever happens to be above,
 * and above `retire` in the registry there is a JSDoc naming a parameter `subject`, which made a
 * retired collector's record look like a discovery problem. The brace is the boundary the language
 * draws, so it is the one this reads.
 *
 * @param source - The whole file
 * @param at - Index of the member name
 * @returns The literal's text from its opening brace up to that index
 */
function literalAround(source: string, at: number): string {
  let depth = 0;

  for (let back = at - 1; back >= 0; back -= 1) {
    const char = source[back];
    if (char === '}' || char === ')' || char === ']') depth += 1;
    else if (char === '{' || char === '(' || char === '[') {
      if (depth === 0) return source.slice(back, at);
      depth -= 1;
    }
  }

  return '';
}

/**
 * Every reason written under one of the swept paths, with whether an action sits beside it.
 *
 * @param paths - Paths relative to the package root
 * @param besideSubject - Whether to count only a reason that has a subject beside it, which is
 *   what makes it one of these rather than some other record this package keeps
 * @returns One entry per `reason:` member found
 */
function reasonsIn(paths: readonly string[], besideSubject: boolean): readonly Push[] {
  const found: Push[] = [];

  for (const relative of paths) {
    for (const file of sourcesUnder(join(PACKAGE_ROOT, relative))) {
      const source = readFileSync(file, 'utf8');

      for (const match of source.matchAll(/\breason:/g)) {
        const from = match.index + match[0].length;

        // A `reason` IS ONE OF THESE ONLY WHEN A `subject` IS BESIDE IT, which is the shape of
        // `IRDiscoveryProblem`, written either way round: `subject,` as a shorthand where the
        // enclosing function already has it, or `subject:` where it is built on the spot. This
        // package writes the word `reason` for other things too, a retired collector's record
        // among them, and bounding those would be measuring a different rule. An interface
        // declaration matches the same look-back and falls out below, because
        // `readonly reason: string` evaluates to no text at all. The two feeders carry no subject
        // at all, which is why they are swept without this filter.
        if (besideSubject && !/\bsubject\s*[,:?]/.test(literalAround(source, match.index))) {
          continue;
        }

        const reason = valueAt(source, from);
        if (reason === '') continue;

        // The action is the next member of the same literal, which is the order they are written
        // in. Eight hundred characters is enough to see it and not enough to reach the next one.
        found.push({
          file: file.slice(PACKAGE_ROOT.length + 1),
          reason,
          hasAction: /\n\s{2,}action:/.test(source.slice(from, from + 800)),
        });
      }
    }
  }

  return found;
}

describe('the voice of a discovery problem, per SPEC 7.1', () => {
  it('should keep every reason to one clause a reader can act on', () => {
    // Given every reason the collectors of SPEC 6.2 write, and every refusal that becomes one,
    // read off the source rather than provoked one collector at a time. WHAT USED TO HAPPEN: the
    // reason was one sentence carrying the cause, the consequence and the fix, and on the
    // maintainer's application `handlerScanCollector` reached his health page as fifty words about
    // how a scan works, on five routes at once.
    const found = [...reasonsIn(SWEPT, true), ...reasonsIn(FEEDERS, false)];

    // When, and the subject is asserted present first: this sweep really did find the reasons, so
    // an empty list cannot pass as a clean one
    expect(found.length).toBeGreaterThanOrEqual(28);
    const tooLong = found.filter((push) => push.reason.length > REASON_LIMIT);

    // Then, naming each one and its length, because a bare count sends a reader looking for which
    // sentence grew
    expect(tooLong.map((push) => `${push.file}: ${String(push.reason.length)}`)).toEqual([]);
  });

  it('should give every collector reason an action beside it rather than inside it', () => {
    // Given the collectors alone: the two feeders report why they could not answer and the
    // collector above each of them decides what a reader does about it.
    const found = reasonsIn(SWEPT, true);

    // When
    const actionless = found.filter((push) => !push.hasAction);

    // Then. The two land in different places: a browser theme draws the reason and the action one
    // under the other, and `openref doctor` draws the subject and the action and never the reason,
    // so one string in both slots is the sentence printed twice on one surface and the wrong half
    // printed on the other.
    expect(found.length).toBeGreaterThanOrEqual(16);
    expect(actionless.map((push) => push.file)).toEqual([]);
  });

  it('should hold the producers that have not moved to the list that names them', () => {
    // Given every file in this package that pushes a discovery problem, and the two lists above.
    // Without this case a new collector could be written in the old voice anywhere the sweep does
    // not walk, and both cases above would stay green over it.
    const pushing = sourcesUnder(join(PACKAGE_ROOT, 'src'))
      .filter((file) => readFileSync(file, 'utf8').includes('problems.push('))
      .map((file) => file.slice(PACKAGE_ROOT.length + 1))
      .sort();

    // When the swept trees are removed from it
    const swept = new Set(
      [...SWEPT, ...FEEDERS].flatMap((relative) =>
        sourcesUnder(join(PACKAGE_ROOT, relative)).map((file) =>
          file.slice(PACKAGE_ROOT.length + 1),
        ),
      ),
    );
    const rest = pushing.filter((file) => !swept.has(file));

    // Then what is left is exactly the event side of SPEC 8.3, which is named rather than smoothed
    expect(pushing.length).toBeGreaterThan(UNMOVED.length);
    expect(rest).toEqual([...UNMOVED].sort());
  });

  it('should redden on a reason written in the old voice', () => {
    // Given the sentence that was on the maintainer's health page, verbatim, which is the positive
    // control: without it the cases above would pass just as well over an empty rule.
    const old =
      'the handler binds a custom parameter decorator, whose factory receives the whole ' +
      'execution context, which is an access path no scan of the handler body can see. No ' +
      'parameter read fact was reported for this route: a scan that cannot account for the ' +
      'handler says nothing rather than guessing';

    // When, Then it is over the bound by more than a rounding, and the clause that replaced it is
    // under it
    expect(old.length).toBeGreaterThan(REASON_LIMIT * 2);
    expect(
      'a custom parameter decorator reads the request itself, so what the handler reads cannot be seen'
        .length,
    ).toBeLessThanOrEqual(REASON_LIMIT);
  });

  it('should read a reason that spans concatenated literals as the whole sentence', () => {
    // Given the walk itself, over the shape every long reason in this tree is written in. Without
    // this case the sweep could be reading the first fragment of each one and measuring nothing.
    const source = "        reason:\n          'one half of it ' +\n          'and the other',\n";

    // When
    const read = valueAt(source, source.indexOf('reason:') + 'reason:'.length);

    // Then
    expect(read).toBe('one half of it and the other');
  });
});
