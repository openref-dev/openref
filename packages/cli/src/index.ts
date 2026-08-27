import { PACKAGE_NAME as CORE_PACKAGE } from '@openref/core';

/**
 * Name of this package.
 *
 * Exported so that the dependency graph linter has a real edge to follow and so that
 * diagnostics can report which package produced a value.
 */
export const PACKAGE_NAME = 'openref';

/**
 * Packages this package is allowed to depend on, in the order declared by STANDARDS 3.5.
 */
export const UPSTREAM_PACKAGES: readonly string[] = [CORE_PACKAGE];

export { runCli } from './cli/application/services/run-cli.service';
export { loadDocument } from './cli/application/services/load-document.service';
export {
  DEFAULT_CLOSE_TIMEOUT_MS,
  loadFromNestApplication,
} from './cli/infrastructure/adapters/nest-application.adapter';
export { EXIT_CODE } from './cli/domain/exit-code.constants';
export type { ExitCode } from './cli/domain/exit-code.constants';
export type {
  CommandContext,
  CommandDefinition,
  CommandIo,
  CommandOutcome,
} from './cli/domain/command.types';
export type { DocumentSource, LoadedDocument } from './cli/domain/loaded-document.types';
