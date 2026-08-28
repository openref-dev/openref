import {
  createMarkdownRenderer,
  createOpenRefHighlighter,
  loadDefaultAssets,
  plainHighlighter,
  type IHighlighter,
} from '@openref/render';
import { buildSite, FsOutputStore, type BuildReport } from '@openref/static';
import { runWithDocument } from '../../application/services/run-with-document.service';
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
 * `--target` IS PARSED AND ACTED ON NOWHERE YET. It configures the proxy generation of SPEC
 * 16.2, which is `T040`'s whole task; a flag that silently did nothing would be worse than one
 * that says so, so this refuses it rather than accepting it into a build that ignores it.
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

  if (flags.has('target')) {
    context.stderr(
      'openref build: --target generates the proxy configuration of SPEC 16.2, which T040 ' +
        'builds. It is refused rather than accepted and ignored\n',
    );
    return { exitCode: EXIT_CODE.USAGE_ERROR };
  }

  const base = stringFlag(flags, 'base');

  return runWithDocument(source, context, async (document) => {
    const highlighter = await highlighterFor(context);
    const markdown = await createMarkdownRenderer({ highlighter });

    const report = await buildSite({
      document,
      store: new FsOutputStore(out),
      // RESOLVED FROM THIS MODULE, per `resolveAssetPath`'s third anchor. The default client
      // bundle is `@openref/nest/browser`, which is a dependency of this package and not of
      // `@openref/render`, where the resolver lives; anchoring here is what makes the string a
      // string rather than an edge on the other side of the boundary.
      assets: loadDefaultAssets({ resolveFrom: import.meta.url }),
      ...(base === undefined ? {} : { base }),
      highlighter,
      markdown,
    });

    context.stdout(buildReportText(report));

    return { exitCode: EXIT_CODE.SUCCESS };
  });
}

/**
 * The highlighter, or the plain one when it could not be built.
 *
 * FAIL OPEN, the same policy `ReferenceService` states for the same component: highlighting is
 * presentation, so losing it costs colour while refusing to build costs the documentation. The
 * degradation is named on stderr rather than swallowed.
 *
 * @param context - Where the notice goes
 * @returns The highlighter
 */
async function highlighterFor(context: CommandContext): Promise<IHighlighter> {
  try {
    return await createOpenRefHighlighter();
  } catch (cause) {
    context.stderr(
      `openref build: the syntax highlighter could not be built, so code blocks are plain: ${
        cause instanceof Error ? cause.message : String(cause)
      }\n`,
    );
    return plainHighlighter;
  }
}
