import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

/**
 * `action.yml`, read as data.
 *
 * WHY THIS PACKAGE EXISTS AT ALL, SAID PLAINLY. A workflow file is code that nothing in this
 * repository runs. Written and left there, it is exactly the class SPEC 0 calls a rule with no
 * runner: it can be wrong in any way at all and every gate stays green. So the action definition
 * is parsed here, asserted against what `openref pr` actually reads, and then executed, literal
 * `run:` string and computed `env:` together, against a temporary repository and a fake GitHub.
 *
 * WHAT THIS CANNOT DO IS SAID IN THE TESTS THEMSELVES rather than implied by a green suite. That
 * GitHub accepts `using: composite`, that it substitutes `${{ inputs.* }}` into `env:` the way
 * `resolveStepEnvironment` does, and that `${{ github.token }}` arrives as a real token are facts
 * only GitHub can establish, and the cases that touch them name that limit in their own words.
 *
 * THE EXPRESSION EVALUATOR HERE IS DELIBERATELY TINY AND REFUSES EVERYTHING ELSE. It understands
 * `${{ inputs.<name> }}` and nothing more. An expression it does not know throws rather than
 * evaluating to an empty string, because an empty string is what an unresolved expression looks
 * like from the outside and it is also what several of these inputs mean by "not given".
 */

/** One declared input. */
export interface ActionInput {
  readonly name: string;
  readonly description: string;
  readonly required: boolean;
  readonly default: string | undefined;
}

/** One declared output, and the step expression it forwards. */
export interface ActionOutput {
  readonly name: string;
  readonly description: string;
  readonly value: string;
}

/** One step of a composite action. */
export interface ActionStep {
  readonly name: string | undefined;
  readonly id: string | undefined;
  readonly shell: string | undefined;
  readonly run: string | undefined;
  readonly uses: string | undefined;
  readonly workingDirectory: string | undefined;
  readonly env: Readonly<Record<string, string>>;
}

/**
 * The marketplace listing's icon and colour.
 *
 * BOTH ARE DRAWN FROM CLOSED LISTS THAT ONLY GITHUB ENFORCES. The colour is one of eight names and
 * the icon is one of a subset of Feather's, and a value outside either is rejected at publish time
 * by the marketplace rather than by anything runnable here. So the test compares against the list
 * and says in its own words that acceptance is GitHub's to give.
 */
export interface ActionBranding {
  readonly icon: string | undefined;
  readonly color: string | undefined;
}

/** The whole action definition, reduced to what is asserted about it. */
export interface ActionDefinition {
  readonly name: string;
  readonly description: string;
  readonly author: string;
  readonly branding: ActionBranding;
  readonly using: string;
  readonly inputs: readonly ActionInput[];
  readonly outputs: readonly ActionOutput[];
  readonly steps: readonly ActionStep[];
}

/**
 * The eight colours GitHub accepts in `branding.color`.
 *
 * Written out here because the list is small, closed and not discoverable from the file itself:
 * a colour outside it makes the action unpublishable, and nothing local would notice.
 */
export const BRANDING_COLORS: readonly string[] = [
  'white',
  'yellow',
  'blue',
  'green',
  'orange',
  'red',
  'purple',
  'gray-dark',
];

/** Where `action.yml` sits, relative to this package. */
export const ACTION_FILE = 'action.yml';

/** This package's own directory, so a test does not have to guess it. */
export const ACTION_PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * Reads and parses the action definition.
 *
 * @param root - The package directory holding `action.yml`
 * @returns The definition
 * @throws {Error} When the file is missing or is not a mapping
 */
export function readActionDefinition(root: string = ACTION_PACKAGE_ROOT): ActionDefinition {
  const text = readFileSync(join(root, ACTION_FILE), 'utf8');
  const parsed: unknown = parse(text);
  const document = asRecord(parsed);

  const inputs: ActionInput[] = Object.entries(asRecord(document.inputs)).map(
    ([name, raw]): ActionInput => {
      const record = asRecord(raw);
      const fallback = record.default;
      return {
        name,
        description: asString(record.description) ?? '',
        required: record.required === true,
        default: typeof fallback === 'string' ? fallback : undefined,
      };
    },
  );

  const outputs: ActionOutput[] = Object.entries(asRecord(document.outputs)).map(
    ([name, raw]): ActionOutput => {
      const record = asRecord(raw);
      return {
        name,
        description: asString(record.description) ?? '',
        value: asString(record.value) ?? '',
      };
    },
  );

  const runs = asRecord(document.runs);
  const rawSteps = Array.isArray(runs.steps) ? runs.steps : [];

  const steps: ActionStep[] = rawSteps.map((raw): ActionStep => {
    const record = asRecord(raw);
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(asRecord(record.env))) {
      env[key] = typeof value === 'string' ? value : String(value);
    }
    return {
      name: asString(record.name),
      id: asString(record.id),
      shell: asString(record.shell),
      run: asString(record.run),
      uses: asString(record.uses),
      workingDirectory: asString(record['working-directory']),
      env,
    };
  });

  const branding = asRecord(document.branding);

  return {
    name: asString(document.name) ?? '',
    description: asString(document.description) ?? '',
    author: asString(document.author) ?? '',
    branding: { icon: asString(branding.icon), color: asString(branding.color) },
    using: asString(runs.using) ?? '',
    inputs,
    outputs,
    steps,
  };
}

/** The one expression form this evaluator knows. */
const INPUT_EXPRESSION = /^\$\{\{\s*inputs\.([A-Za-z0-9_-]+)\s*\}\}$/;

/**
 * Resolves one `${{ inputs.<name> }}` expression against supplied values and declared defaults.
 *
 * @param expression - The whole value, which must be exactly one expression or no expression
 * @param definition - The action, for the declared defaults
 * @param values - The values a workflow passed in `with:`
 * @returns The resolved string
 * @throws {Error} When the expression is not `${{ inputs.<name> }}` of a declared input
 */
export function resolveExpression(
  expression: string,
  definition: ActionDefinition,
  values: Readonly<Record<string, string>>,
): string {
  if (!expression.includes('${{')) return expression;

  const match = INPUT_EXPRESSION.exec(expression.trim());
  if (match === null) {
    throw new Error(
      `this evaluator knows only "\${{ inputs.<name> }}" and was given ${JSON.stringify(expression)}. ` +
        "Anything else is GitHub's to evaluate, and pretending to evaluate it here would produce " +
        'an empty string that reads exactly like an input nobody set',
    );
  }

  const name = match[1] ?? '';
  const declared = definition.inputs.find((input) => input.name === name);
  if (declared === undefined) {
    throw new Error(`"${name}" is not an input this action declares`);
  }

  return values[name] ?? declared.default ?? '';
}

/**
 * Every `${{ inputs.<name> }}` inside a longer string, replaced the way GitHub replaces them.
 *
 * THIS EXISTS TO MODEL THE HAZARD, NOT TO SUPPORT IT. GitHub substitutes into a `run:` body
 * before bash ever sees it, which is what makes an interpolated input executable script. The
 * integration harness runs the step's `run:` through this, so the case that plants a shell
 * metacharacter in an input is a real test of the run string rather than a test of bash's
 * reaction to a `${{` it does not understand: with a substitution in the file the injection
 * fires, and without one it cannot.
 *
 * @param text - Any string from the definition
 * @param definition - The action, for the declared defaults
 * @param values - The values a workflow passed in `with:`
 * @returns The string with every known expression replaced
 * @throws {Error} When an expression is not `${{ inputs.<name> }}` of a declared input
 */
export function substituteExpressions(
  text: string,
  definition: ActionDefinition,
  values: Readonly<Record<string, string>>,
): string {
  const pattern = /\$\{\{[^}]*\}\}/g;
  return text.replace(pattern, (found) => resolveExpression(found, definition, values));
}

/**
 * The environment one step would receive, computed from the action's own `env:` block.
 *
 * THE TEST RUNS THE STEP WITH THIS RATHER THAN WITH A HAND WRITTEN MAP, so what is executed is
 * the wiring in `action.yml` and not a copy of it that agrees today.
 *
 * @param step - The step
 * @param definition - The action, for the declared defaults
 * @param values - The values a workflow passed in `with:`
 * @returns The environment
 * @throws {Error} When any value holds an expression this evaluator does not know
 */
export function resolveStepEnvironment(
  step: ActionStep,
  definition: ActionDefinition,
  values: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(step.env)) {
    resolved[key] = resolveExpression(value, definition, values);
  }
  return resolved;
}

/**
 * The directory one step would run in, resolved from the definition and anchored to a workspace.
 *
 * IT EXISTS BECAUSE THE ONE UNASSERTED WIRING IN `action.yml` WAS THIS LINE. `working-directory`
 * was parsed and read by nothing: the harness ran every step at the workspace root and its own
 * docstring claimed otherwise, so deleting the line or pointing it somewhere else passed the whole
 * suite. Now the harness resolves it here and runs there, and a case whose document exists only in
 * a subdirectory fails the moment the line stops working.
 *
 * A relative value is joined to the workspace, which is what GitHub does with it. An absolute one
 * is taken as it is.
 *
 * @param step - The step
 * @param definition - The action, for the declared defaults
 * @param workspace - The directory the job checked out into
 * @param values - The values a workflow passed in `with:`
 * @returns The absolute directory the step's command runs in
 * @throws {Error} When the value holds an expression this evaluator does not know
 */
export function resolveStepWorkingDirectory(
  step: ActionStep,
  definition: ActionDefinition,
  workspace: string,
  values: Readonly<Record<string, string>> = {},
): string {
  const declared = step.workingDirectory;
  if (declared === undefined || declared === '') return workspace;

  const resolved = resolveExpression(declared, definition, values);
  if (resolved === '') return workspace;

  return isAbsolute(resolved) ? resolved : join(workspace, resolved);
}

/**
 * The fenced yaml blocks of a markdown file.
 *
 * The README's example workflow is checked against the declared inputs, so the copy a reader
 * pastes is held to the same contract the action is. An example is documentation until something
 * reads it, and then it is a test.
 *
 * @param markdown - The whole file
 * @returns The body of every ```yaml block, in order
 */
export function fencedYamlBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  const pattern = /```ya?ml\n([\s\S]*?)```/g;

  let match = pattern.exec(markdown);
  while (match !== null) {
    blocks.push(match[1] ?? '');
    match = pattern.exec(markdown);
  }

  return blocks;
}
