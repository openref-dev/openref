import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CLAUDE_FILE,
  CHANGESET_CONFIG_FILE,
  HELD_BACK_PACKAGES,
  PUBLISHED_PACKAGES,
  SPEC_FILE,
} from '../config.js';
import { PROJECTION_FILE, readProjection } from '../lib/projection.js';
import { runCommand } from '../lib/exec.js';
import { readOriginRemote } from '../lib/git.js';
import {
  auditChangesetGroups,
  auditHeldBack,
  auditPublishedDelivery,
  auditPublishList,
  auditSpecAgreement,
  CLAUDE_LIST_HEADINGS,
  parseDryRun,
  readSpecPackageLists,
  resolveBuildRepository,
} from '../lib/publish-list.js';
import type { HeldBackStatement } from '../lib/publish-list.js';
import { readWorkspaceManifests } from '../lib/workspace.js';
import type { Gate, GateFinding, GateResult } from '../types.js';

/**
 * A registry address nothing answers on, given to the dry run so it cannot reach one.
 *
 * IT IS THE ASSERTION AND NOT A PRECAUTION. This gate shells out to `pnpm publish`, and a rule this
 * repository holds everywhere else is that a check makes no external request. Pointing the child at
 * `127.0.0.1:1` turns that from a claim about pnpm's behaviour into a property of the run: a dry run
 * that needed the registry fails here rather than quietly reaching it. Measured 2026-09-01, it
 * prints all eleven lines and exits 0.
 */
export const UNREACHABLE_REGISTRY = 'http://127.0.0.1:1/';

/**
 * What a release would publish, held against SPEC 4, CLAUDE.md, and what a published package owes.
 *
 * IT SHELLS OUT TO THE COMMAND A RELEASE RUNS, rather than restating the rule that command
 * follows. `pnpm publish` publishes every workspace package that is not `private`, and a check
 * that reimplemented that rule would agree with itself whatever the manifests said. BUILD.md T064
 * asks for a dry run for exactly this reason: it is the only reading that can notice a package
 * became publishable by accident.
 *
 * THE DRY RUN MAKES NO NETWORK REQUEST, AND THE GATE MAKES THAT SO. See {@link
 * UNREACHABLE_REGISTRY}: the registry the child would use is set to an address nothing answers on,
 * which is both the honest thing for a check that must make no request and the assertion that it
 * makes none.
 *
 * FOUR DOCUMENTS STATE THE PUBLISHED SET BY HAND AND ALL FOUR ARE NOW READ. SPEC 4 and the
 * `PUBLISHED_PACKAGES` constant were the two this gate started with; the manifests are the third
 * and are read through the dry run. `CLAUDE.md` was the fourth and nothing opened it, so after
 * T064 published `@openref/runner` and `@openref/theme-kit` it still called both internal and its
 * published table still omitted both. It is the file every session is told to read first.
 *
 * SPEC 4 ARRIVES THROUGH THE COMMITTED PROJECTION AND THE GATE NO LONGER SKIPS. The three lists
 * that section states are lists of package names, which is data, so they ship as data and the
 * comparison runs wherever the gates run. Before the artefact this gate skipped on every clone and
 * therefore on every CI run, which left the question it exists for, whether a release would emit
 * the set the specification names, answered on one machine.
 *
 * AND A FIFTH QUESTION SINCE 2026-09-04, WHICH IS THE ONE THE OTHER FOUR CANNOT ASK. All four
 * compare statements of what a release emits, and a set difference cannot tell a name that is
 * absent on purpose from a name somebody forgot. `@openref/nuxt` is absent from the published set
 * for a measured licence reason and the maintainer's ruling that it ships after 1.0, and until that
 * day the reason lived in prose alone. `HELD_BACK_PACKAGES` records it, and `auditHeldBack`
 * reconciles that registry against the documents in both directions and against the manifests and
 * the dry run, so the absence is enforced rather than merely tolerated. None of the four lists was
 * loosened to make room: a held back package is still required to be private, still required to be
 * out of `PUBLISHED_PACKAGES`, and still required to be out of what the dry run emits.
 *
 * `CLAUDE.md` IS EXCLUDED FROM GIT THE WAY `ai-docs/` IS, which was measured rather than assumed:
 * `.git/info/exclude` names both, and `git ls-files CLAUDE.md` is empty. So a clone has neither,
 * and its absence is reported as a `warning` rather than an error or a second skip, on the
 * precedent `m7-suites` set for the third document it reads. The message says the fourth copy went
 * unread rather than passing on it, and the skip below still means what it has always meant.
 */
export const publishListGate: Gate = {
  id: 'publish-list',
  title: 'publish list: what a release would emit, and what it owes',

  run: ({ repoRoot }): Promise<GateResult> => {
    const findings: GateFinding[] = [];
    const manifests = readWorkspaceManifests(repoRoot);

    // pnpm resolves through the workspace root, so the command is run from there.
    const dryRun = runCommand('pnpm', ['-r', 'publish', '--dry-run', '--no-git-checks'], repoRoot, {
      npm_config_registry: UNREACHABLE_REGISTRY,
    });

    if (!dryRun.ok && dryRun.stdout === '') {
      findings.push({
        level: 'error',
        message: `the publish dry run did not run: ${dryRun.stderr.trim().slice(0, 400)}`,
      });

      return Promise.resolve({
        id: publishListGate.id,
        title: publishListGate.title,
        status: 'fail',
        findings,
      });
    }

    const wouldPublish = parseDryRun(`${dryRun.stdout}\n${dryRun.stderr}`);
    const repository = resolveBuildRepository(
      process.env.GITHUB_REPOSITORY,
      readOriginRemote(repoRoot),
    );

    findings.push(...auditPublishList(wouldPublish, PUBLISHED_PACKAGES, manifests));
    findings.push(...auditPublishedDelivery(repoRoot, manifests, PUBLISHED_PACKAGES, repository));

    // WHICH DOCUMENTS ACTUALLY GOT READ, COLLECTED RATHER THAN ASSUMED. The held back audit
    // compares the registry against every document this run could open, in both directions, and a
    // document that was not there contributes nothing rather than an empty list: an unread
    // `CLAUDE.md` reporting "does not say so" would turn an expected clone into a failure, and an
    // unread one silently counted as agreeing would be the opposite mistake.
    const statements: HeldBackStatement[] = [];

    const claudePath = join(repoRoot, CLAUDE_FILE);
    if (!existsSync(claudePath)) {
      findings.push({
        level: 'warning',
        message: `${CLAUDE_FILE} is not in this checkout, so the fourth hand written copy of the published set went unread. It is excluded from git in .git/info/exclude the way ai-docs/ is, so a clone without it is expected rather than broken; what this run does not prove is that its two tables still agree with SPEC 4 and with PUBLISHED_PACKAGES, nor that its held back list still agrees with HELD_BACK_PACKAGES`,
      });
    } else {
      const claudeLists = readSpecPackageLists(
        readFileSync(claudePath, 'utf8'),
        CLAUDE_LIST_HEADINGS,
      );
      findings.push(...auditSpecAgreement(PUBLISHED_PACKAGES, claudeLists, CLAUDE_FILE));
      statements.push({ document: CLAUDE_FILE, names: claudeLists.heldBack });
    }

    const read = readProjection(repoRoot);

    if (!read.ok) {
      findings.push({ level: 'error', message: `[projection-unreadable] ${read.reason}` });
    } else {
      const lists = read.projection.data.spec.packages;

      if (lists === null) {
        findings.push({
          level: 'error',
          message: `${SPEC_FILE} carried no readable package lists when ${PROJECTION_FILE} was generated`,
        });
      } else {
        findings.push(...auditSpecAgreement(PUBLISHED_PACKAGES, lists));
        statements.push({ document: SPEC_FILE, names: lists.heldBack });
        findings.push(
          ...auditChangesetGroups(
            JSON.parse(readFileSync(join(repoRoot, CHANGESET_CONFIG_FILE), 'utf8')) as {
              readonly fixed?: readonly (readonly string[])[];
            },
            lists.published,
            manifests,
          ),
        );
      }
    }

    // THE FIFTH RECONCILIATION, AND IT IS ADDED BESIDE THE FOUR RATHER THAN INSTEAD OF ANY OF THEM.
    // The four above answer what a release emits; this one answers what it deliberately does not,
    // which none of them can, because an absence and an oversight look the same to a set
    // difference. A held back package is still absent from every list the four read, and every one
    // of those four still fails if that stops being true.
    //
    // A RUN THAT READ NO DOCUMENT SAYS SO RATHER THAN PASSING. With the registry non empty and no
    // document opened, the two direction comparison has nothing to compare against and would report
    // clean; on a clone that is the expected state for `CLAUDE.md` and never for SPEC 4, which
    // arrives through the committed projection.
    if (statements.length === 0 && HELD_BACK_PACKAGES.length > 0) {
      findings.push({
        level: 'error',
        message: `no document stating the package lists could be read, so the ${String(HELD_BACK_PACKAGES.length)} held back package(s) were compared against nothing`,
      });
    } else {
      findings.push(
        ...auditHeldBack(
          HELD_BACK_PACKAGES,
          PUBLISHED_PACKAGES,
          wouldPublish,
          manifests,
          statements,
        ),
      );
    }

    const failed = findings.some((finding) => finding.level === 'error');

    return Promise.resolve({
      id: publishListGate.id,
      title: publishListGate.title,
      status: failed ? 'fail' : 'pass',
      findings,
    });
  },
};
