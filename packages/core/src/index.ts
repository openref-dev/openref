/**
 * Name of this package.
 *
 * Exported so that the dependency graph linter has a real edge to follow and so that
 * diagnostics can report which package produced a value.
 */
export const PACKAGE_NAME = '@openref/core';

/**
 * Version of the intermediate representation produced by this package.
 *
 * Bumped only when the IR shape changes in a way that invalidates a stored hash.
 */
export const IR_VERSION = 1;
