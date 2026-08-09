import { PACKAGE_NAME as CORE_PACKAGE } from '@openref/core';
import { PACKAGE_NAME as RENDER_PACKAGE } from '@openref/render';
import { PACKAGE_NAME as RUNNER_PACKAGE } from '@openref/runner';
import { PACKAGE_NAME as SEARCH_PACKAGE } from '@openref/search';

/**
 * Name of this package.
 *
 * Exported so that the dependency graph linter has a real edge to follow and so that
 * diagnostics can report which package produced a value.
 */
export const PACKAGE_NAME = '@openref/nest';

/**
 * Packages this package is allowed to depend on, in the order declared by STANDARDS 3.5.
 */
export const UPSTREAM_PACKAGES: readonly string[] = [
  CORE_PACKAGE,
  RENDER_PACKAGE,
  RUNNER_PACKAGE,
  SEARCH_PACKAGE,
];
