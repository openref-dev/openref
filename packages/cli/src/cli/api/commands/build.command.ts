import {
  BUILD_TARGETS,
  detectTarget,
  isBuildTarget,
  type BuildReport,
  type BuildTarget,
} from '@openref/static';
import { runWithDocument } from '../../application/services/run-with-document.service';
import { renderStaticSite } from '../../application/services/static-build.service';
import type { CommandContext, CommandOutcome } from '../../domain/command.types';
import { EXIT_CODE } from '../../domain/exit-code.constants';
import type { DocumentSource } from '../../domain/loaded-document.types';
import { parseArgs, stringFlag, type FlagValue } from '../argv';
import { BUILD_USAGE } from '../help';

const SOURCE_FLAGS = ['spec', 'config', 'from-nest'] as const;

function resolveSource(flags: ReadonlyMap<string, FlagValue>): DocumentSource | string {
  const given = SOURCE_FLAGS.filter((flagName) => flags.has(flagName));

  if (given.length === 0) {
    return 'one of --spec, --config or --from-nest is required';
  }
  if (given.length > 1) {
    return `only one of --spec, --config or --from-nest may be given, got ${given
      .map((flagName) => `--${flagName}`)
      .join(', ')}`;
  }

  const flagName = given[0];
  if (flagName === undefined) {
    return 'one of --spec, --config or --from-nest is required';
  }

  const value = stringFlag(flags, flagName);
  if (value === undefined) {
    return `--${flagName} needs a path`;
  }

  const kind = flagName === 'from-nest' ? 'from-nest' : flagName === 'config' ? 'config' : 'spec';
  return { kind, path: value };
}

/**
 * The lines a finished build prints.
 *
 * IT SAYS WHAT IT RENDERED AND WHAT IT CARRIED, separately, because that difference is the
 * incremental claim of SPEC 16.3 and the only place a reader can see it: every page is written
 * on every build, since a page's state block names the document hash, so counting written files
 * would report a full rebuild every time and be true and useless.
 *
 * @param report - What the build did
 * @returns The report as text
 */
export function buildReportText(report: BuildReport): string {
  const lines = [
    `Built ${String(report.rendered.length + report.carried.length)} pages`,
    `  rendered  ${String(report.rendered.length)}`,
    `  carried   ${String(report.carried.length)}`,
    `  other     ${String(report.files.length)} files`,
  ];

  if (report.removed.length > 0) {
    const noun = report.removed.length === 1 ? 'file' : 'files';
    lines.push(`  removed   ${String(report.removed.length)} ${noun} the last build wrote`);
  }

  lines.push(
    `  base      ${report.basePath === '' ? '/' : report.basePath}`,
    `  sitemap   ${report.sitemap ? 'written' : 'not written'}`,
  );

  // THE PROXY LINE SAYS WHAT THE TARGET DID, per SPEC 16.2, and only when a target was given:
  // a build that was never asked about a proxy does not report about one.
  if (report.proxy !== null) {
    const { target, upstreams, files, directTarget } = report.proxy;
    lines.push(
      `  proxy     ${target}: ${
        files.length > 0
          ? `${String(upstreams.length)} upstream${upstreams.length === 1 ? '' : 's'}, wrote ${files.join(', ')}`
          : directTarget !== null
            ? 'no rewrite capability, pages carry the direct mode warning'
            : 'nothing generated'
      }`,
    );
  }

  for (const notice of report.notices) lines.push(`\n${notice}`);

  return `${lines.join('\n')}\n`;
}

/**
 * `openref build`: the static build of SPEC 16.
 *
 * `--out` IS REQUIRED AND ITS ABSENCE IS A USAGE ERROR, per SPEC 16.3 as amended by T039: a
 * build has no defensible default directory, and picking one would mean writing files somewhere
 * the caller never named.
 *
 * `--target` GENERATES THE PROXY CONFIGURATION OF SPEC 16.2, SINCE T040. Absent means nothing
 * is generated, because a proxy is a standing gateway and never appears unasked, per SPEC 16.2;
 * `auto` reads the platform environment variables and falls back to `none` with a warning.
 */
export async function runBuild(context: CommandContext): Promise<CommandOutcome> {
  const { flags } = parseArgs(context.args, [
    'spec',
    'config',
    'from-nest',
    'out',
    'base',
    'target',
  ]);

  if (flags.has('help')) {
    context.stdout(BUILD_USAGE);
    return { exitCode: EXIT_CODE.SUCCESS };
  }

  const source = resolveSource(flags);
  if (typeof source === 'string') {
    context.stderr(`openref build: ${source}\n\n${BUILD_USAGE}`);
    return { exitCode: EXIT_CODE.USAGE_ERROR };
  }

  const out = stringFlag(flags, 'out');
  if (out === undefined) {
    context.stderr(`openref build: --out <dir> is required\n\n${BUILD_USAGE}`);
    return { exitCode: EXIT_CODE.USAGE_ERROR };
  }

  const target = resolveTarget(flags, context);
  if (typeof target === 'object' && 'usageError' in target) {
    context.stderr(`openref build: ${target.usageError}\n\n${BUILD_USAGE}`);
    return { exitCode: EXIT_CODE.USAGE_ERROR };
  }

  const base = stringFlag(flags, 'base');

  return runWithDocument(source, context, async (document) => {
    const report = await renderStaticSite({ document, out, base, target, io: context });

    context.stdout(buildReportText(report));

    return { exitCode: EXIT_CODE.SUCCESS };
  });
}

/**
 * Reads `--target`, running the `auto` detection of SPEC 16.2 where asked.
 *
 * `undefined` MEANS THE FLAG WAS NEVER GIVEN, and the build then generates nothing, per SPEC
 * 16.2's posture that a proxy never appears unasked. The `auto` fallback warning goes to stderr
 * here, because it is about the flag's resolution rather than about the build.
 *
 * @param flags - The parsed flags
 * @param context - For the environment and the warning
 * @returns The resolved target, undefined for no flag, or a usage error
 */
function resolveTarget(
  flags: ReadonlyMap<string, FlagValue>,
  context: CommandContext,
): BuildTarget | undefined | { readonly usageError: string } {
  if (!flags.has('target')) return undefined;

  const value = stringFlag(flags, 'target');
  if (value === undefined) {
    return { usageError: `--target needs a value: one of ${BUILD_TARGETS.join(', ')}, or auto` };
  }

  if (value === 'auto') {
    const detection = detectTarget(context.env ?? {});
    if (detection.warning !== undefined) context.stderr(`openref build: ${detection.warning}\n`);
    return detection.target;
  }

  if (!isBuildTarget(value)) {
    return {
      usageError: `--target does not know "${value}": one of ${BUILD_TARGETS.join(', ')}, or auto`,
    };
  }

  return value;
}
