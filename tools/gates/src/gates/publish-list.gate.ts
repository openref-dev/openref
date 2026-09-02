import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLAUDE_FILE, CHANGESET_CONFIG_FILE, PUBLISHED_PACKAGES, SPEC_FILE } from '../config.js';
import { aiDocsAbsentMessage, aiDocsPresent } from '../lib/ai-docs.js';
import { runCommand } from '../lib/exec.js';
import { readOriginRemote } from '../lib/git.js';
import {
  auditChangesetGroups,
  auditPublishedDelivery,
  auditPublishList,
  auditSpecAgreement,
  CLAUDE_LIST_HEADINGS,
  parseDryRun,
  readSpecPackageLists,
  resolveBuildRepository,
} from '../lib/publish-list.js';
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
 * IT SKIPS ONLY THE HALF THAT NEEDS THE PRIVATE DOCUMENTS, on the precedent `static-suites` and
 * `capability-debts` set. Two of its four questions need nothing but the tree, so on a clone it
 * still fails on an internal package about to be published and on a missing licence file, and it
 * skips only when those are clean and the documents alone went unread. An absent document reading
 * as coverage is the failure this repository keeps removing.
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

    const claudePath = join(repoRoot, CLAUDE_FILE);
    if (!existsSync(claudePath)) {
      findings.push({
        level: 'warning',
        message: `${CLAUDE_FILE} is not in this checkout, so the fourth hand written copy of the published set went unread. It is excluded from git in .git/info/exclude the way ai-docs/ is, so a clone without it is expected rather than broken; what this run does not prove is that its two tables still agree with SPEC 4 and with PUBLISHED_PACKAGES`,
      });
    } else {
      findings.push(
        ...auditSpecAgreement(
          PUBLISHED_PACKAGES,
          readSpecPackageLists(readFileSync(claudePath, 'utf8'), CLAUDE_LIST_HEADINGS),
          CLAUDE_FILE,
        ),
      );
    }

    const treeFailed = findings.some((finding) => finding.level === 'error');

    if (!aiDocsPresent(repoRoot)) {
      if (treeFailed) {
        findings.push({
          level: 'info',
          message: `${aiDocsAbsentMessage(publishListGate.title, [SPEC_FILE])} The failures above needed no document.`,
        });

        return Promise.resolve({
          id: publishListGate.id,
          title: publishListGate.title,
          status: 'fail',
          findings,
        });
      }

      findings.push({
        level: 'info',
        message: aiDocsAbsentMessage(publishListGate.title, [SPEC_FILE]),
      });

      return Promise.resolve({
        id: publishListGate.id,
        title: publishListGate.title,
        status: 'skip',
        findings,
        skipReason: 'ai-docs-absent',
      });
    }

    const specPath = join(repoRoot, SPEC_FILE);
    if (!existsSync(specPath)) {
      findings.push({ level: 'error', message: `${SPEC_FILE} is not readable` });
    } else {
      const lists = readSpecPackageLists(readFileSync(specPath, 'utf8'));
      findings.push(...auditSpecAgreement(PUBLISHED_PACKAGES, lists));
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

    const failed = findings.some((finding) => finding.level === 'error');

    return Promise.resolve({
      id: publishListGate.id,
      title: publishListGate.title,
      status: failed ? 'fail' : 'pass',
      findings,
    });
  },
};
