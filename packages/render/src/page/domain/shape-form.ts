/**
 * The value driven form: which controls one body offers, derived from the schema and from
 * what the reader has typed so far.
 *
 * THE VALUES ARE THE ONLY STATE. A branch is active because the leading value says so, not
 * because the interface remembers a press; hiding a branch erases nothing, because the map
 * outlives the derivation; and rebuilding the form is re-deriving this list, nothing else.
 *
 * THE TWO KINDS OF INVALIDITY STAY APART, per SPEC 11. A value that violates its type is
 * explained by the type: `Expected string, length 13 to 19.` A field missing because of a
 * condition is explained by the condition, never by the type:
 * `Required because country = US. This is a condition, not the type: with another value the
 * field is optional.` The difference is between a form that teaches and a form that scolds.
 */

import type { IRJsonSchema, IRSchema } from '@openref/core';
import { isSafePattern } from '@openref/core';
import {
  conditionHolds,
  conditionsOf,
  isNeverSchema,
  leadingValueOf,
  requirednessOf,
  selectingValueOf,
  type ShapeCondition,
  type ShapeRequiredness,
  type ShapeValues,
} from './shape-conditions';

/** One text input of the form. */
export interface ShapeInputControl {
  readonly kind: 'input';
  readonly path: string;
  readonly label: string;
  readonly depth: number;
  readonly requiredness: ShapeRequiredness;
  /** The short condition line, always shown on a conditional field. */
  readonly when?: string;
  /** True when the condition holds now, so the field is required at this moment. */
  readonly conditionActive?: boolean;
  /** The teaching sentence, shown while the condition holds. */
  readonly conditionReason?: string;
  /** The type violation of the current value, when it has one. */
  readonly error?: string;
  /** What the type asks for, as a placeholder. */
  readonly placeholder?: string;
}

/** The chooser that writes a leading value. */
export interface ShapeChooserControl {
  readonly kind: 'chooser';
  readonly path: string;
  /** What the block is called: the field the branches belong to. */
  readonly label: string;
  /** The property whose value selects the branch. */
  readonly leading: string;
  readonly depth: number;
  readonly options: readonly {
    readonly label: string;
    readonly value: string;
    readonly pressed: boolean;
    /** Field paths the branch owns, for counting what a switch keeps. */
    readonly ownedPaths: readonly string[];
  }[];
}

/** The pattern keys block: existing pairs plus the control that adds one. */
export interface ShapePatternControl {
  readonly kind: 'pattern';
  readonly path: string;
  readonly label: string;
  readonly depth: number;
  readonly patterns: readonly string[];
  readonly entries: readonly {
    readonly keyPath: string;
    readonly valuePath: string;
    readonly key: string;
    readonly value: string;
    /** The key against the pattern: a key condition, not a value type. */
    readonly keyError?: string;
    readonly valuePlaceholder?: string;
  }[];
}

/** The tuple block: one input per declared position, no control past a closed tail. */
export interface ShapeTupleControl {
  readonly kind: 'tuple';
  readonly path: string;
  readonly label: string;
  readonly depth: number;
  readonly closed: boolean;
  readonly positions: readonly {
    readonly path: string;
    readonly label: string;
    readonly error?: string;
  }[];
}

export type ShapeControl =
  ShapeInputControl | ShapeChooserControl | ShapePatternControl | ShapeTupleControl;

/** How deep the derivation descends, the reading half's own bound. */
const DEPTH_LIMIT = 6;

interface DeriveContext {
  readonly schemas: Readonly<Record<string, IRSchema>>;
  readonly values: ShapeValues;
  readonly controls: ShapeControl[];
  readonly refPath: string[];
}

/** Resolves a position to the body to read, following one named reference. */
function dereference(schema: IRJsonSchema, context: DeriveContext): IRJsonSchema {
  if (schema.$ref === undefined) return schema;
  return context.schemas[schema.$ref]?.normalized ?? schema;
}

/**
 * What one document supplied pattern says about one value, including that it cannot say anything.
 *
 * THE PATTERN COMES FROM SOMEBODY ELSE'S DOCUMENT AND IS NOT COMPILED RAW. Until T035 both this
 * check and the pattern key check did `new RegExp(pattern).test(...)` on the render thread: a
 * document with `"pattern": "("` threw `SyntaxError` out of a Vue render the moment a reader typed
 * a character, and with no error boundary anywhere that ends the client render; `^(a+)+$` merely
 * hung the thread. `isSafePattern` is the guard `@openref/core` already exports for the sampler,
 * refusing a nested quantifier and a very long pattern, and this is the same document.
 *
 * `unusable` IS A THIRD ANSWER AND NOT A SILENT `differs`. A reader told their value does not match
 * a pattern the page could not evaluate would go and change the value.
 *
 * @param pattern - The pattern as the document wrote it
 * @param value - What the reader typed
 * @returns Whether it matches, differs, or cannot be checked here
 */
export function patternVerdict(pattern: string, value: string): 'matches' | 'differs' | 'unusable' {
  if (!isSafePattern(pattern)) return 'unusable';

  let expression: RegExp;
  try {
    expression = new RegExp(pattern, 'u');
  } catch {
    try {
      expression = new RegExp(pattern);
    } catch {
      return 'unusable';
    }
  }

  return expression.test(value) ? 'matches' : 'differs';
}

/** The sentence a pattern that cannot be evaluated here earns, in the pattern's own terms. */
export function unusablePatternWords(pattern: string): string {
  return `This document states a pattern this page cannot check: ${pattern}.`;
}

/** The type violation of one value against one schema, in the type's own words. */
export function typeError(value: string, schema: IRJsonSchema): string | undefined {
  if (value === '') return undefined;

  const type = typeof schema.type === 'string' ? schema.type : schema.type?.[0];

  if (type === 'integer' || type === 'number') {
    const parsed = Number(value);
    if (Number.isNaN(parsed) || (type === 'integer' && !Number.isInteger(parsed))) {
      return `Expected ${type}.`;
    }
    if (schema.exclusiveMinimum !== undefined && parsed <= schema.exclusiveMinimum) {
      return `Expected ${type} > ${String(schema.exclusiveMinimum)}.`;
    }
    if (schema.minimum !== undefined && parsed < schema.minimum) {
      return `Expected ${type} >= ${String(schema.minimum)}.`;
    }
    if (schema.exclusiveMaximum !== undefined && parsed >= schema.exclusiveMaximum) {
      return `Expected ${type} < ${String(schema.exclusiveMaximum)}.`;
    }
    if (schema.maximum !== undefined && parsed > schema.maximum) {
      return `Expected ${type} <= ${String(schema.maximum)}.`;
    }
    return undefined;
  }

  if (schema.enum !== undefined) {
    const words = schema.enum.map((member) =>
      typeof member === 'string' ? member : JSON.stringify(member),
    );
    return words.includes(value) ? undefined : `Expected one of ${words.join(', ')}.`;
  }

  if (type === 'string' || type === undefined) {
    const min = schema.minLength;
    const max = schema.maxLength;
    if ((min !== undefined && value.length < min) || (max !== undefined && value.length > max)) {
      if (min !== undefined && max !== undefined) {
        return `Expected string, length ${String(min)} to ${String(max)}.`;
      }
      return min !== undefined
        ? `Expected string, length at least ${String(min)}.`
        : `Expected string, length at most ${String(max ?? 0)}.`;
    }
    if (schema.pattern !== undefined) {
      const verdict = patternVerdict(schema.pattern, value);
      if (verdict === 'unusable') return unusablePatternWords(schema.pattern);
      if (verdict === 'differs') return `Expected a value matching ${schema.pattern}.`;
    }
  }

  return undefined;
}

/** The teaching sentence of an active condition, per SPEC 11's recorded wording. */
export function conditionReason(words: string): string {
  return `Required because ${words}. This is a condition, not the type: with another value the field is optional.`;
}

/** What the type asks for, said before the reader types. */
function placeholderOf(schema: IRJsonSchema): string | undefined {
  const type = typeof schema.type === 'string' ? schema.type : schema.type?.[0];

  if (schema.enum !== undefined) {
    return schema.enum
      .map((member) => (typeof member === 'string' ? member : JSON.stringify(member)))
      .join(' | ');
  }
  if (type === 'string' && (schema.minLength !== undefined || schema.maxLength !== undefined)) {
    return `string ${String(schema.minLength ?? '')}..${String(schema.maxLength ?? '')}`;
  }
  return type;
}

/**
 * The constraints one field answers to right now: its own, plus the branch of the
 * conditional that applies at the current values.
 */
function effectiveSchemaOf(
  name: string,
  member: IRJsonSchema,
  conditions: readonly ShapeCondition[],
  context: DeriveContext,
  prefix: string,
): IRJsonSchema {
  let effective = member;

  for (const condition of conditions) {
    const overlay = conditionHolds(condition, context.values, prefix)
      ? condition.thenProperties?.[name]
      : condition.elseProperties?.[name];
    if (overlay !== undefined) effective = { ...effective, ...overlay };
  }

  return effective;
}

/** Emits the input control of one scalar field. */
function pushInput(
  name: string,
  member: IRJsonSchema,
  holder: IRJsonSchema,
  conditions: readonly ShapeCondition[],
  prefix: string,
  depth: number,
  label: string,
  context: DeriveContext,
): void {
  const path = `${prefix}/${name}`;
  const { sort, when } = requirednessOf(name, holder, conditions);
  const condition = conditions.find((candidate) => candidate.requires.includes(name));
  const active = condition !== undefined && conditionHolds(condition, context.values, prefix);
  const effective = effectiveSchemaOf(name, member, conditions, context, prefix);
  const value = context.values[path] ?? '';
  const error = typeError(value, effective);
  const placeholder = placeholderOf(effective);

  context.controls.push({
    kind: 'input',
    path,
    label,
    depth,
    requiredness: sort,
    ...(when === undefined ? {} : { when }),
    ...(condition === undefined ? {} : { conditionActive: active }),
    ...(condition !== undefined && active
      ? { conditionReason: conditionReason(condition.words) }
      : {}),
    ...(error === undefined ? {} : { error }),
    ...(placeholder === undefined ? {} : { placeholder }),
  });
}

/** Emits the controls of one object schema: fields, choosers, and the active branch. */
function deriveObject(
  body: IRJsonSchema,
  prefix: string,
  depth: number,
  context: DeriveContext,
  labelPrefix = '',
  skipProperty: string | null = null,
): void {
  if (depth > DEPTH_LIMIT) return;

  const conditions = conditionsOf(body);
  const variants = body.variants ?? [];
  const branchBodies = variants.map((variant) => dereference(variant.schema, context));
  const leading = variants.length === 0 ? null : leadingValueOf(body, branchBodies);

  for (const [name, member] of Object.entries(body.properties ?? {})) {
    if (name === skipProperty) continue;
    if (member.readOnly === true) continue;

    const resolved = dereference(member, context);
    const path = `${prefix}/${name}`;
    const label = `${labelPrefix}${name}`;

    // The leading value's control is the chooser: choosing a branch writes the value.
    if (name === leading) {
      pushChooser(variants, branchBodies, name, leading, path, depth, context);
      continue;
    }

    // A property that is itself a choice: its own chooser, then its active branch.
    if ((resolved.variants?.length ?? 0) > 0) {
      const inner = resolved.variants ?? [];
      const innerBodies = inner.map((variant) => dereference(variant.schema, context));
      const innerLeading = leadingValueOf(resolved, innerBodies);
      if (innerLeading !== null) {
        pushChooser(
          inner,
          innerBodies,
          name,
          innerLeading,
          `${path}/${innerLeading}`,
          depth,
          context,
        );
      }
      continue;
    }

    if (
      resolved.patternProperties !== undefined &&
      Object.keys(resolved.patternProperties).length > 0
    ) {
      pushPattern(name, resolved, path, depth, context);
      continue;
    }

    if (resolved.prefixItems !== undefined) {
      pushTuple(name, resolved, path, depth, context);
      continue;
    }

    // A plain object flattens into dotted labels, the layout's own form: threeDSecure.version.
    if (resolved.properties !== undefined && Object.keys(resolved.properties).length > 0) {
      // The object itself may be conditionally required; its condition rides its first field,
      // where the reader will meet it.
      const { sort, when } = requirednessOf(name, body, conditions);
      const condition = conditions.find((candidate) => candidate.requires.includes(name));
      const active = condition !== undefined && conditionHolds(condition, context.values, prefix);
      const nested = conditionsOf(resolved);

      for (const [childName, child] of Object.entries(resolved.properties)) {
        if (child.readOnly === true) continue;
        const childPath = `${path}/${childName}`;
        const childValue = context.values[childPath] ?? '';
        const childRequired = requirednessOf(childName, resolved, nested);
        const error = typeError(childValue, dereference(child, context));
        const placeholder = placeholderOf(dereference(child, context));

        context.controls.push({
          kind: 'input',
          path: childPath,
          label: `${labelPrefix}${name}.${childName}`,
          depth,
          // The container's conditional requiredness is the story the reader needs; a child
          // required inside an optional container inherits the container's sort.
          requiredness: sort === 'conditional' ? 'conditional' : childRequired.sort,
          ...(when === undefined ? {} : { when }),
          ...(condition === undefined ? {} : { conditionActive: active }),
          ...(condition !== undefined && active
            ? { conditionReason: conditionReason(condition.words) }
            : {}),
          ...(error === undefined ? {} : { error }),
          ...(placeholder === undefined ? {} : { placeholder }),
        });
      }
      continue;
    }

    pushInput(name, resolved, body, conditions, prefix, depth, label, context);
  }
}

/** Emits a chooser and, when its value selects a branch, the branch's own controls. */
function pushChooser(
  variants: NonNullable<IRJsonSchema['variants']>,
  branchBodies: readonly IRJsonSchema[],
  label: string,
  leading: string,
  path: string,
  depth: number,
  context: DeriveContext,
): void {
  const current = context.values[path] ?? '';
  const prefixOfFields = path.slice(0, path.lastIndexOf('/'));

  const options = variants.map((variant, index) => {
    const body = branchBodies[index] ?? variant.schema;
    const value = selectingValueOf(body, leading, variant.discriminatorValue) ?? variant.label;
    return {
      label: variant.label,
      value,
      pressed: current !== '' && current === value,
      ownedPaths: branchFieldPaths(body, leading, prefixOfFields),
    };
  });

  context.controls.push({
    kind: 'chooser',
    path,
    label,
    leading,
    depth,
    options,
  });

  const activeIndex = options.findIndex((option) => option.pressed);
  const variant = activeIndex === -1 ? undefined : variants[activeIndex];
  const body = activeIndex === -1 ? undefined : branchBodies[activeIndex];
  if (variant === undefined || body === undefined) return;

  const id = variant.schema.$ref;

  if (id !== undefined && context.refPath.includes(id)) return;
  if (id !== undefined) context.refPath.push(id);

  // The branch of a root oneOf applies to the root instance, so its fields live beside the
  // root's own; a branch of a property applies inside that property.
  const prefix = path.slice(0, path.lastIndexOf('/'));
  deriveObject(body, prefix, depth + 1, context, '', leading);

  if (id !== undefined) context.refPath.pop();
}

/** Key paths of the pattern block's entries, in the order they were added. */
function patternEntryPaths(path: string, values: ShapeValues): string[] {
  const heads = Object.keys(values)
    .filter((candidate) => candidate.startsWith(`${path}/#`) && candidate.endsWith('/key'))
    .map((candidate) => candidate.slice(0, -'/key'.length));

  return heads.sort((left, right) => {
    const a = Number(left.slice(left.lastIndexOf('#') + 1));
    const b = Number(right.slice(right.lastIndexOf('#') + 1));
    return a - b;
  });
}

/** Emits the pattern keys block. */
function pushPattern(
  name: string,
  body: IRJsonSchema,
  path: string,
  depth: number,
  context: DeriveContext,
): void {
  const patterns = Object.keys(body.patternProperties ?? {});
  const valueSchemas = Object.values(body.patternProperties ?? {});

  const entries = patternEntryPaths(path, context.values).map((head) => {
    const key = context.values[`${head}/key`] ?? '';
    const value = context.values[`${head}/value`] ?? '';
    const verdicts = patterns.map((pattern) => patternVerdict(pattern, key));
    const matches = verdicts.includes('matches');
    // A KEY IS NOT CALLED WRONG BY A PATTERN NOBODY COULD EVALUATE. When every pattern here is
    // unusable the page says so about the document instead of about the key.
    const unusable = !matches && verdicts.length > 0 && verdicts.every((one) => one === 'unusable');
    const valueSchema = valueSchemas[0];

    return {
      keyPath: `${head}/key`,
      valuePath: `${head}/value`,
      key,
      value,
      ...(key !== '' && !matches
        ? {
            keyError: unusable
              ? unusablePatternWords(patterns.join(', '))
              : `The key does not match ${patterns.join(', ')}. This is the key's condition, not the value's type.`,
          }
        : {}),
      ...(valueSchema === undefined
        ? {}
        : (() => {
            const placeholder = placeholderOf(valueSchema);
            return placeholder === undefined ? {} : { valuePlaceholder: placeholder };
          })()),
    };
  });

  context.controls.push({ kind: 'pattern', path, label: name, depth, patterns, entries });
}

/** Emits the tuple block: one input per declared position. */
function pushTuple(
  name: string,
  body: IRJsonSchema,
  path: string,
  depth: number,
  context: DeriveContext,
): void {
  const positions = (body.prefixItems ?? []).map((member, index) => {
    const positionPath = `${path}/${String(index)}`;
    const value = context.values[positionPath] ?? '';
    const error = typeError(value, member);

    return {
      path: positionPath,
      label: `[${String(index)}] ${member.title ?? (typeof member.type === 'string' ? member.type : (member.type?.join(' | ') ?? 'value'))}`,
      ...(error === undefined ? {} : { error }),
    };
  });

  context.controls.push({
    kind: 'tuple',
    path,
    label: name,
    depth,
    closed: isNeverSchema(body.items),
    positions,
  });
}

/**
 * Derives the controls one body offers at the current values.
 *
 * @param schemaId - The named schema the form fills
 * @param schemas - The page's bounded schema payload
 * @param values - What the reader has typed, keyed by field path
 * @returns The controls, in reading order
 */
export function deriveControls(
  schemaId: string,
  schemas: Readonly<Record<string, IRSchema>>,
  values: ShapeValues,
): readonly ShapeControl[] {
  const root = schemas[schemaId]?.normalized;
  if (root === undefined) return [];

  const context: DeriveContext = { schemas, values, controls: [], refPath: [schemaId] };
  deriveObject(root, '', 0, context);
  return context.controls;
}

/**
 * The field paths a branch owns: where values typed into it live.
 *
 * @param branchBody - The branch, dereferenced
 * @param leading - The leading property, which the branch does not own
 * @param prefix - Path prefix of the instance the branch applies to
 * @returns The paths, one level of object flattening included
 */
export function branchFieldPaths(
  branchBody: IRJsonSchema,
  leading: string | null,
  prefix: string,
): readonly string[] {
  const paths: string[] = [];

  for (const [name, member] of Object.entries(branchBody.properties ?? {})) {
    if (name === leading) continue;
    if (member.properties !== undefined && Object.keys(member.properties).length > 0) {
      for (const childName of Object.keys(member.properties)) {
        paths.push(`${prefix}/${name}/${childName}`);
      }
      continue;
    }
    paths.push(`${prefix}/${name}`);
  }

  return paths;
}

/**
 * The announce line of one rebuild, per SPEC 11's recorded wording.
 *
 * @param hidden - Label of the branch that left, or null when none was active
 * @param shown - Label of the branch that arrived
 * @param kept - Non-empty values of the hidden branch that the map kept
 * @returns The sentence the status line says
 */
export function announceSentence(hidden: string | null, shown: string, kept: number): string {
  if (hidden === null) return `Form rebuilt: branch ${shown} shown.`;

  return `Form rebuilt: branch ${hidden} hidden, branch ${shown} shown. Values kept from the hidden branch: ${String(kept)}.`;
}

/**
 * How many values of a hidden branch the map kept.
 *
 * @param paths - The branch's field paths, from {@link branchFieldPaths}
 * @param values - The map after the switch
 * @returns Non-empty values under those paths
 */
export function keptCount(paths: readonly string[], values: ShapeValues): number {
  // COUNTED BY PREFIX RATHER THAN BY EXACT PATH, per T035. `branchFieldPaths` flattens one object
  // level and pushes the container path for anything else, so a member carrying variants, a
  // pattern block or a tuple owns a path no control ever writes; counting exact matches announced
  // `Values kept from the hidden branch: 0` while the map held three. A branch owns everything
  // under its own path, and the sentence is about what the map kept.
  const owned = (candidate: string): boolean =>
    paths.some((path) => candidate === path || candidate.startsWith(`${path}/`));

  return Object.keys(values).filter((path) => owned(path) && (values[path] ?? '') !== '').length;
}
