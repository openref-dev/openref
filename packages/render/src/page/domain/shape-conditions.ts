/**
 * Conditions a schema places on its own fields, read into words and into testable clauses.
 *
 * THE TRANSLATOR IS DELIBERATELY NARROW. It reads the three forms the fixture and real
 * documents write, a `const` equality, a numeric bound, and a `dependentRequired` presence,
 * and it says so when it cannot read one: an opaque condition prints as
 * `a condition the document states` and never evaluates to true, so the form neither claims
 * a requiredness it cannot check nor invents one, per SPEC 6's rule against silent guessing.
 *
 * Both halves of the shapes page read this module: the reading half prints the words, the
 * filling half evaluates the clauses against what the reader typed.
 */

import type { IRJsonSchema, IRJsonValue } from '@openref/core';

/** One testable comparison inside a condition. */
export interface ShapeClause {
  /** Field the clause reads, by name, in the instance the schema applies to. */
  readonly field: string;
  /** How the field is compared. `opaque` compares nothing and never holds. */
  readonly test:
    'equals' | 'above' | 'at-least' | 'below' | 'at-most' | 'one-of' | 'present' | 'opaque';
  /** Value the comparison is against, absent for `present` and `opaque`. */
  readonly value?: IRJsonValue;
  /** Values for `one-of`. */
  readonly values?: readonly IRJsonValue[];
}

/** One condition: what it tests, in words and in clauses, and what it makes required. */
export interface ShapeCondition {
  /** The condition in words: `country = US`, `amountMinor > 5000`, `bic is present`. */
  readonly words: string;
  /** Every clause must hold for the condition to hold. */
  readonly clauses: readonly ShapeClause[];
  /** Names the condition makes required when it holds. */
  readonly requires: readonly string[];
  /** Property constraints that apply when the condition holds, from `then.properties`. */
  readonly thenProperties?: Readonly<Record<string, IRJsonSchema>>;
  /** Property constraints that apply when it does not, from `else.properties`. */
  readonly elseProperties?: Readonly<Record<string, IRJsonSchema>>;
}

/** How one field's requiredness reads: always, under a condition, or not at all. */
export type ShapeRequiredness = 'required' | 'conditional' | 'optional';

/** Words for a value inside a condition, quoted only as far as JSON quotes it. */
function valueWords(value: IRJsonValue | undefined): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

/** Reads one `if.properties` member into a clause, or an opaque clause when it cannot. */
function clauseOf(field: string, member: IRJsonSchema): ShapeClause {
  if (member.const !== undefined) return { field, test: 'equals', value: member.const };
  if (member.enum !== undefined) return { field, test: 'one-of', values: member.enum };
  if (member.exclusiveMinimum !== undefined) {
    return { field, test: 'above', value: member.exclusiveMinimum };
  }
  if (member.minimum !== undefined) return { field, test: 'at-least', value: member.minimum };
  if (member.exclusiveMaximum !== undefined) {
    return { field, test: 'below', value: member.exclusiveMaximum };
  }
  if (member.maximum !== undefined) return { field, test: 'at-most', value: member.maximum };
  return { field, test: 'opaque' };
}

/** The words of one clause. */
function clauseWords(clause: ShapeClause): string {
  switch (clause.test) {
    case 'equals':
      return `${clause.field} = ${valueWords(clause.value)}`;
    case 'above':
      return `${clause.field} > ${valueWords(clause.value)}`;
    case 'at-least':
      return `${clause.field} >= ${valueWords(clause.value)}`;
    case 'below':
      return `${clause.field} < ${valueWords(clause.value)}`;
    case 'at-most':
      return `${clause.field} <= ${valueWords(clause.value)}`;
    case 'one-of':
      return `${clause.field} is one of ${(clause.values ?? []).map(valueWords).join(', ')}`;
    case 'present':
      return `${clause.field} is present`;
    case 'opaque':
      return 'a condition the document states';
  }
}

/** The words of a whole condition. */
export function conditionWords(condition: ShapeCondition): string {
  return condition.clauses.map(clauseWords).join(' and ');
}

/**
 * Reads the conditions a schema states about its own instance.
 *
 * One from `if`/`then` when both exist, and one per `dependentRequired` entry. An `else`
 * carries no requiredness of its own in this model; its property constraints ride the
 * `if` condition as the branch that applies when it does not hold.
 *
 * @param schema - The object schema whose fields the conditions govern
 * @returns The conditions, empty when the schema states none
 */
export function conditionsOf(schema: IRJsonSchema): readonly ShapeCondition[] {
  const conditions: ShapeCondition[] = [];

  if (schema.if !== undefined && schema.then !== undefined) {
    const members = Object.entries(schema.if.properties ?? {});
    const clauses =
      members.length === 0
        ? [{ field: '', test: 'opaque' } as ShapeClause]
        : members.map(([field, member]) => clauseOf(field, member));

    const condition: ShapeCondition = {
      words: '',
      clauses,
      requires: schema.then.required ?? [],
      ...(schema.then.properties === undefined ? {} : { thenProperties: schema.then.properties }),
      ...(schema.else?.properties === undefined ? {} : { elseProperties: schema.else.properties }),
    };
    conditions.push({ ...condition, words: conditionWords(condition) });
  }

  for (const [field, names] of Object.entries(schema.dependentRequired ?? {})) {
    const condition: ShapeCondition = {
      words: '',
      clauses: [{ field, test: 'present' }],
      requires: names,
    };
    conditions.push({ ...condition, words: conditionWords(condition) });
  }

  return conditions;
}

/**
 * How one field's requiredness reads on a schema, with the designer's rule built in: a name
 * that is required only under a condition never reads as required.
 *
 * @param name - The field
 * @param schema - The object schema that declares it
 * @param conditions - The schema's conditions, from {@link conditionsOf}
 * @returns The sort, and the condition's words when the sort is conditional
 */
export function requirednessOf(
  name: string,
  schema: IRJsonSchema,
  conditions: readonly ShapeCondition[],
): { readonly sort: ShapeRequiredness; readonly when?: string } {
  if ((schema.required ?? []).includes(name)) return { sort: 'required' };

  const condition = conditions.find((candidate) => candidate.requires.includes(name));
  if (condition !== undefined) {
    return { sort: 'conditional', when: `required only when ${condition.words}` };
  }

  return { sort: 'optional' };
}

/** The values a form holds, keyed by field path. */
export type ShapeValues = Readonly<Record<string, string>>;

/**
 * The paths the form draws at the current values, or null for a caller with no form.
 *
 * THIS IS THE SCOPE THE T035 FILING ASKED FOR: the derivation knows which schema position it
 * is at, and the value map did not. Carried beside the map rather than folded into its keys,
 * because the map's keys are a public shape the browser's live form already holds values
 * under. `null` means every path counts as drawn, which is the reading a caller with no drawn
 * set can honestly make and the exact behaviour every caller had before the scope existed.
 */
export type ShapeScope = ReadonlySet<string> | null;

/**
 * What reading a condition at a scope produced: whether it holds, and what it could not see.
 *
 * ONE READING RATHER THAN TWO PASSES, AND THAT IS A SIZE DECISION AS WELL AS A CLARITY ONE.
 * The first cut returned a three valued verdict and offered a second function to list the
 * fields behind an `undrawn`, which walked the same clauses again and shipped the three
 * literals `holds`, `fails` and `undrawn` fifteen times into the browser chunk. One record
 * says both things in one walk and minifies to a boolean and an array.
 *
 * A NON EMPTY `undrawn` IS THE THIRD ANSWER THE STANDING RULE REQUIRES. A condition naming a
 * field the form does not draw at its scope is not false, it is unanswerable from this form,
 * and saying false silently is exactly the defect the filing measured on `CardMethod` one
 * level down. `holds` is never true while `undrawn` is non empty.
 */
export interface ConditionReading {
  readonly holds: boolean;
  /** Fields with no control and no container at this scope, each once, in clause order. */
  readonly undrawn: readonly string[];
}

/** Where the form draws a path: at it, under it, or nowhere. */
type Drawn = 'at' | 'under' | 'no';

/** How one path relates to what the form draws. */
function drawnAt(scope: ShapeScope, path: string): Drawn {
  if (scope === null || scope.has(path)) return 'at';

  const prefix = `${path}/`;
  for (const drawn of scope) {
    if (drawn.startsWith(prefix)) return 'under';
  }

  return 'no';
}

/** Whether one clause holds, given a value the caller already decided is answerable. */
function clauseHolds(clause: ShapeClause, value: string): boolean {
  switch (clause.test) {
    case 'equals':
      return value === valueWords(clause.value);
    case 'one-of':
      return (clause.values ?? []).some((member) => value === valueWords(member));
    case 'above':
      return Number(value) > Number(clause.value);
    case 'at-least':
      return Number(value) >= Number(clause.value);
    case 'below':
      return Number(value) < Number(clause.value);
    case 'at-most':
      return Number(value) <= Number(clause.value);
    // `present` is decided by the caller, which knows whether the path is a container, and an
    // opaque clause never holds, which is its documented meaning rather than a scope question.
    default:
      return false;
  }
}

/**
 * Reads a condition against the current values, at the scope the form draws.
 *
 * @param condition - The condition
 * @param values - What the reader typed, keyed by field path
 * @param prefix - Path prefix of the instance the condition's fields live in
 * @param scope - The paths the form draws, or null to count every path as drawn
 * @returns Whether it holds, and the fields it could not see
 */
export function readCondition(
  condition: ShapeCondition,
  values: ShapeValues,
  prefix: string,
  scope: ShapeScope,
): ConditionReading {
  const undrawn: string[] = [];
  let holds = true;

  for (const clause of condition.clauses) {
    const path = `${prefix}/${clause.field}`;
    const where = clause.test === 'opaque' ? 'at' : drawnAt(scope, path);

    // A container is present when anything drawn under it is filled, and answers nothing else:
    // the form offers no single control at the container's own path.
    if (where === 'under') {
      if (clause.test === 'present') {
        const under = `${path}/`;
        holds &&= Object.entries(values).some(
          ([candidate, value]) =>
            candidate.startsWith(under) && value !== '' && drawnAt(scope, candidate) === 'at',
        );
        continue;
      }
      if (!undrawn.includes(clause.field)) undrawn.push(clause.field);
      continue;
    }

    if (where === 'no') {
      if (clause.field !== '' && !undrawn.includes(clause.field)) undrawn.push(clause.field);
      continue;
    }

    const value = values[path] ?? '';
    holds &&= clause.test === 'present' ? value !== '' : value !== '' && clauseHolds(clause, value);
  }

  return { holds: holds && undrawn.length === 0, undrawn };
}

/**
 * The sentence of a condition that names what the form does not draw, per the T039 filing.
 *
 * SHORT BECAUSE IT SHIPS. This string is in the browser chunk the shapes gesture pays for, and
 * the reader already has the condition in words beside it, from `requirednessOf`. What this
 * adds is the one fact that is not there: which name has no control, and that the condition
 * therefore cannot be met here.
 */
export function undrawnConditionWords(fields: readonly string[]): string {
  return `${fields.join(', ')} is not drawn here, so this condition can never hold.`;
}

/** A schema position that admits nothing, the normalized form of `false`. */
export function isNeverSchema(schema: IRJsonSchema | undefined): boolean {
  if (schema === undefined) return false;
  const keys = Object.keys(schema);
  return keys.length === 1 && keys[0] === 'not' && Object.keys(schema.not ?? { x: 0 }).length === 0;
}

/**
 * The leading value of a `oneOf`: the property whose value selects the branch.
 *
 * The discriminator names it when the document wrote one; without one it is the property
 * every branch constrains with its own `const`, which is the same declaration made without
 * the keyword. No common property, no leading value, and the chooser has nothing to write.
 *
 * @param schema - The schema holding the variants
 * @param branches - The variant bodies, dereferenced
 * @returns The property name, or null when the branches share none
 */
export function leadingValueOf(
  schema: IRJsonSchema,
  branches: readonly IRJsonSchema[],
): string | null {
  if (schema.discriminator !== undefined) return schema.discriminator.propertyName;
  const first = branches[0];
  if (first === undefined) return null;

  const candidates = Object.entries(first.properties ?? {})
    .filter(([, member]) => member.const !== undefined)
    .map(([name]) => name);

  const shared = candidates.find((name) =>
    branches.every((branch) => branch.properties?.[name]?.const !== undefined),
  );

  return shared ?? null;
}

/**
 * The value of the leading property that selects one branch.
 *
 * @param branch - The variant body, dereferenced
 * @param leading - The leading property's name
 * @param discriminatorValue - The mapping key, when a discriminator named one
 * @returns The selecting value in words, or null when the branch does not state one
 */
export function selectingValueOf(
  branch: IRJsonSchema,
  leading: string | null,
  discriminatorValue: string | undefined,
): string | null {
  if (discriminatorValue !== undefined) return discriminatorValue;
  if (leading === null) return null;

  const constant = branch.properties?.[leading]?.const;
  return constant === undefined ? null : valueWords(constant);
}
