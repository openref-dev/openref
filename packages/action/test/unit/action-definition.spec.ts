import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
// READ BY MODULE PATH RATHER THAN THROUGH THE PUBLISHED INDEX, per SPEC 17.2. These two lists are
// the contract between `action.yml` and `openref pr`, and this test is their only reader outside
// the CLI; exporting them from the `openref` package to satisfy it would grow a frozen public
// surface for a test's convenience.
import { PR_INPUT_ENV, PR_OUTPUT_NAMES } from '../../../cli/src/cli/domain/pr-inputs';
import {
  ACTION_PACKAGE_ROOT,
  BRANDING_COLORS,
  fencedYamlBlocks,
  readActionDefinition,
  resolveExpression,
  resolveStepEnvironment,
  type ActionStep,
} from '../../src/index';

/**
 * `action.yml`, read as data and held to what `openref pr` actually reads.
 *
 * WHAT THIS FILE CAN AND CANNOT ESTABLISH, said here rather than left to be inferred from a green
 * run. It can establish that the definition parses, that its one step carries no substitution
 * into bash, that every input reaches the command under the environment variable name the command
 * reads, and that every declared output is one the command writes. It cannot establish that
 * GitHub accepts `using: composite`, that GitHub substitutes `${{ inputs.* }}` into `env:` the
 * way `resolveStepEnvironment` does, or that `${{ github.token }}` resolves to a token with the
 * scopes the README claims. Those three are GitHub's, and no assertion here should be read as
 * covering them.
 */

const definition = readActionDefinition(ACTION_PACKAGE_ROOT);

/** The action's one step, or a failure that says the definition has none. */
function theStep(): ActionStep {
  const step = definition.steps[0];
  if (step === undefined) throw new Error('action.yml declares no step at all');
  return step;
}

/** The one command the action runs. Pinned so a change to it is a deliberate edit here. */
const STEP_RUN = '"$OPENREF_PR_BIN" pr';

/** Environment names the step sets that are the action's own rather than the command's options. */
const ACTION_OWN_ENV: readonly string[] = ['OPENREF_PR_BIN', 'GITHUB_TOKEN'];

describe('the action definition', () => {
  it('should be a composite action with exactly one step', () => {
    // When / Then
    expect(definition.using).toBe('composite');
    expect(definition.steps).toHaveLength(1);
  });

  it('should run one pinned literal, with no expression substituted into the shell', () => {
    // Given: a `${{ }}` inside `run:` is evaluated into the script before bash sees it, which is
    // how a workflow executes a string somebody else wrote
    const step = theStep();

    // When / Then
    expect(step.run).toBe(STEP_RUN);
    expect(step.run).not.toContain('${{');
    expect(step.shell).toBe('bash');
  });

  it('should pull in no other action, first or third party', () => {
    // Given: pinning somebody else's action means pinning a sha nothing here can verify
    // When
    const used = definition.steps.filter((step) => step.uses !== undefined);

    // Then
    expect(used).toEqual([]);
  });

  it('should give the step an id, which is what its outputs are addressed through', () => {
    // When
    const id = theStep().id;

    // Then
    expect(id).toBe('review');
    for (const output of definition.outputs) {
      expect(output.value).toBe(`\${{ steps.${String(id)}.outputs.${output.name} }}`);
    }
  });

  it('should forward exactly the outputs openref pr writes', () => {
    // When
    const declared = definition.outputs.map((output) => output.name).sort();

    // Then: an output a workflow reads and nothing writes is an empty string that reads as an
    // answer, and an output written and not forwarded is unreachable
    expect(declared).toEqual([...PR_OUTPUT_NAMES].sort());
  });

  it('should carry the version of the CLI it runs, so the two are released together', () => {
    // Given: the action is published by repository tag rather than to npm, and what it runs is
    // `openref pr`. A version of its own would name a thing nobody installs.
    const read = (path: string): { version?: string; private?: boolean } =>
      JSON.parse(readFileSync(join(ACTION_PACKAGE_ROOT, path), 'utf8')) as {
        version?: string;
        private?: boolean;
      };

    // When
    const action = read('package.json');
    const cli = read('../cli/package.json');

    // Then
    expect(action.version).toBe(cli.version);
    expect(action.private).toBe(true);
  });

  it('should be in the same changesets fixed group as the CLI, which is what moves the two', () => {
    // Given: equal versions today is an effect, and this is its cause. Without the group, a
    // release bumps `openref` alone and the case above goes red instead of the action shipping.
    const config = JSON.parse(
      readFileSync(join(ACTION_PACKAGE_ROOT, '../../.changeset/config.json'), 'utf8'),
    ) as { fixed?: string[][] };

    // When
    const group = (config.fixed ?? []).find((names) => names.includes('openref'));

    // Then
    expect(group).toBeDefined();
    expect(group).toContain('@openref/action');
  });

  it('should describe every input, since a description is the whole interface a caller sees', () => {
    // When
    const undescribed = definition.inputs.filter((input) => input.description.trim() === '');

    // Then
    expect(undescribed).toEqual([]);
  });
});

describe('the marketplace listing, which is the whole of what a stranger sees first', () => {
  /**
   * The Feather icons GitHub accepts, reduced to the ones this action could plausibly carry.
   *
   * ONLY GITHUB ENFORCES THIS LIST. A value outside it makes the action unpublishable, and the
   * rejection happens at the marketplace rather than in anything runnable here, so this case
   * proves the value is in the list and cannot prove the list is complete.
   */
  const ICONS: readonly string[] = ['git-pull-request', 'git-branch', 'git-commit', 'file-text'];

  it('should carry a name, a description and an author, because none of the three defaults', () => {
    // Given: an action with no name shows its repository path in the marketplace, and one with
    // no description shows nothing at all where the sentence a reader decides on belongs
    // When / Then
    expect(definition.name).toBe('OPENREF API review');
    expect(definition.description).toBe(
      'Diff a pull request against its base ref, build the static preview, and post the API change comment.',
    );
    expect(definition.author).toBe('OPENREF');
  });

  it('should brand itself with a colour from the eight GitHub allows', () => {
    // Given: the eight are a closed list, and only GitHub rejects a ninth
    // When / Then
    expect(definition.branding.color).toBe('blue');
    expect(BRANDING_COLORS).toContain(definition.branding.color);
  });

  it('should brand itself with an icon from the fixed Feather set GitHub allows', () => {
    // When / Then
    expect(definition.branding.icon).toBe('git-pull-request');
    expect(ICONS).toContain(definition.branding.icon);
  });
});

describe('the wiring between the action and the command', () => {
  const env = theStep().env;

  it('should set every environment variable openref pr reads, and no other', () => {
    // Given
    const expected = [...Object.values(PR_INPUT_ENV), ...ACTION_OWN_ENV].sort();

    // When
    const actual = Object.keys(env).sort();

    // Then: both directions. A variable the command reads and the action never sets is an option
    // a caller cannot use; one the action sets and the command never reads is dead wiring.
    expect(actual).toEqual(expected);
  });

  it('should run the step in the directory its own input names', () => {
    // Given: this was the one wiring in the file nothing read, so deleting the line or pointing
    // it elsewhere passed every test. The integration harness now resolves it and runs there.
    // When / Then
    expect(theStep().workingDirectory).toBe('${{ inputs.working-directory }}');
    expect(definition.inputs.find((input) => input.name === 'working-directory')?.default).toBe(
      '.',
    );
  });

  it('should carry every command option from an input of the same name', () => {
    // When / Then
    for (const [option, variable] of Object.entries(PR_INPUT_ENV)) {
      expect(env[variable]).toBe(`\${{ inputs.${option} }}`);
      expect(definition.inputs.map((input) => input.name)).toContain(option);
    }
  });

  it('should pass the token by environment only, and put it in no run string', () => {
    // Given: prove it is present where it belongs before proving it is absent everywhere else
    expect(env.GITHUB_TOKEN).toBe('${{ inputs.token }}');

    // When
    const runs = definition.steps.map((each) => each.run ?? '').join('\n');

    // Then
    expect(runs).not.toContain('token');
    expect(runs).not.toContain('secrets.');
  });

  it('should default the token to the workflow token rather than to a secret name', () => {
    // When
    const token = definition.inputs.find((input) => input.name === 'token');

    // Then
    expect(token?.default).toBe('${{ github.token }}');
  });

  it('should default the gate off, which is the SPEC 17.2 decision', () => {
    // Given: the first run in a pipeline that has never seen this must report, not turn red
    // When
    const gate = definition.inputs.find((input) => input.name === 'fail-on-breaking');

    // Then
    expect(gate?.default).toBe('false');
  });

  it('should point at the install the calling repository already has', () => {
    // Given: nothing is fetched at run time, so the version reviewing the pull request is the
    // version that repository pinned
    // When
    const bin = definition.inputs.find((input) => input.name === 'openref-bin');

    // Then
    expect(bin?.default).toBe('node_modules/.bin/openref');
  });

  it('should require the one input that has no defensible default', () => {
    // When
    const required = definition.inputs.filter((input) => input.required).map((one) => one.name);

    // Then
    expect(required).toEqual(['spec']);
  });
});

describe('resolveStepEnvironment', () => {
  it('should resolve each value from what a workflow passed', () => {
    // When
    const resolved = resolveStepEnvironment(theStep(), definition, {
      spec: 'openapi.json',
      token: 'ghs-x',
    });

    // Then
    expect(resolved.OPENREF_PR_SPEC).toBe('openapi.json');
    expect(resolved.GITHUB_TOKEN).toBe('ghs-x');
  });

  it('should fall back to the declared default rather than to an empty string', () => {
    // When
    const resolved = resolveStepEnvironment(theStep(), definition, {});

    // Then
    expect(resolved.OPENREF_PR_BIN).toBe('node_modules/.bin/openref');
    expect(resolved.OPENREF_PR_FAIL_ON_BREAKING).toBe('false');
  });

  it('should refuse an expression it does not know rather than answer an empty string', () => {
    // Given: an empty string is exactly what an unresolved expression looks like from outside,
    // and it is also what several of these inputs mean by "not given"
    // When / Then
    expect(() => resolveExpression('${{ secrets.NPM_TOKEN }}', definition, {})).toThrow(
      'knows only',
    );
    expect(() => resolveExpression('${{ inputs.nonexistent }}', definition, {})).toThrow(
      'not an input this action declares',
    );
  });

  it('should leave a plain string alone', () => {
    // When / Then
    expect(resolveExpression('node_modules/.bin/openref', definition, {})).toBe(
      'node_modules/.bin/openref',
    );
  });
});

describe('the example workflow in the README', () => {
  const readme = readFileSync(join(ACTION_PACKAGE_ROOT, 'README.md'), 'utf8');
  const blocks = fencedYamlBlocks(readme);

  it('should be there and parse as yaml', () => {
    // When / Then
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      expect(() => {
        parse(block);
      }).not.toThrow();
    }
  });

  it('should pass only inputs this action declares', () => {
    // Given: an example is documentation until something reads it, and then it is a test
    const names = new Set(definition.inputs.map((input) => input.name));
    const used: string[] = [];

    for (const block of blocks) {
      const workflow: unknown = parse(block);
      for (const step of stepsOf(workflow)) {
        const uses = typeof step.uses === 'string' ? step.uses : '';
        if (!uses.includes('packages/action')) continue;
        const inputs = step.with;
        if (typeof inputs === 'object' && inputs !== null) used.push(...Object.keys(inputs));
      }
    }

    // Then
    expect(used.length).toBeGreaterThan(0);
    for (const name of used) expect(names).toContain(name);
  });

  it('should ask for exactly the two permissions the action needs', () => {
    // When
    const permissions = blocks
      .map((block) => parse(block) as { permissions?: Record<string, string> })
      .map((workflow) => workflow.permissions)
      .find((value) => value !== undefined);

    // Then: least privilege, and written down where a reader copies it from
    expect(permissions).toEqual({ contents: 'read', 'pull-requests': 'write' });
  });
});

/** Every step of every job in a parsed workflow. */
function stepsOf(workflow: unknown): Record<string, unknown>[] {
  if (typeof workflow !== 'object' || workflow === null) return [];
  const jobs = (workflow as { jobs?: unknown }).jobs;
  if (typeof jobs !== 'object' || jobs === null) return [];

  const steps: Record<string, unknown>[] = [];
  for (const job of Object.values(jobs as Record<string, unknown>)) {
    if (typeof job !== 'object' || job === null) continue;
    const list = (job as { steps?: unknown }).steps;
    if (!Array.isArray(list)) continue;
    for (const step of list) {
      if (typeof step === 'object' && step !== null) steps.push(step as Record<string, unknown>);
    }
  }
  return steps;
}
