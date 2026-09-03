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
/**
 * NOTHING `T041` BUILT IS EXPORTED HERE, AND THAT IS THE POINT OF THIS COMMENT.
 *
 * The `pr` command's internals, the repository slug parser, the API origin parser, the input map
 * the action wires to, the event reader and the comment renderer, were all exported from this
 * index for one reason: so that a test in another package could read them. A published package's
 * export surface is frozen public API (STANDARDS, "Public API contracts are frozen"), and growing
 * it to serve a test commits this project to supporting about twenty names no consumer asked for.
 *
 * Every one of those tests now imports the module it is testing by path, which is what the CLI's
 * own tests already did. See SPEC 17.2, where what stays exported is written down.
 */
export type {
  CommandContext,
  CommandDefinition,
  CommandIo,
  CommandOutcome,
} from './cli/domain/command.types';
export type { DocumentSource, LoadedDocument } from './cli/domain/loaded-document.types';

// THE ERROR CLASSES A CONSUMER OF THIS PACKAGE CAN BE HANDED, RE-EXPORTED SO THEY CAN CATCH THEM.
// ADDED 2026-09-02. `runCli` never throws, by design, and turns everything into an exit code; the
// two other entry points do throw. `loadDocument` raises `UsageError` for a source it cannot read
// and lets `NormalizeError` through from the parser, and `loadFromNestApplication` raises
// `ApplicationBootError` and `ShutdownTimeoutError`. A consumer embedding either had no way to
// tell a bad path from a broken document without a second dependency.
export {
  ApplicationBootError,
  CliError,
  ErrorCode,
  NormalizeError,
  OpenRefError,
  ShutdownTimeoutError,
  UsageError,
} from '@openref/core';
