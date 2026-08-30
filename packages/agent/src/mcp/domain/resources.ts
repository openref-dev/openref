/**
 * The resources the MCP endpoint of SPEC 18 lists, and what reading each one produces.
 *
 * THREE, AND THE THIRD IS WHY `ai-docs/REMEDIATION.md` SECTION 6 NAMES THIS TASK. Remediation is a
 * supported use of this surface, and what a remediation agent needs is the versioned doctor report
 * of `T037`: the classification per finding, the confidence behind it, what the runtime does and
 * what the specification claims. It is served whole, with its `version` member intact, so a
 * consumer that pins a shape refuses one it does not understand instead of reading a changed shape
 * as an empty report, which looks exactly like a clean one.
 *
 * THE REPORT IS FILTERED AND THE FILTER IS THE SAME ONE THE TOOLS USE. A finding on a node marked
 * `audience: internal` is an internal node: its `subject` is the method and path, so leaving it in
 * would expose the operation through the report after the tool list withheld it. The `T058`
 * amendment states this in one sentence and this is the line that keeps it.
 *
 * THE SCORE IS RECOMPUTED FROM WHAT IS LEFT AND SAYS SO. A filtered report carrying the whole
 * document's score would be a number about findings the reader cannot see, so both the count and
 * the score are the exposed subset's, and the envelope names how many were withheld rather than
 * leaving the difference to be inferred from a total that is no longer there.
 */

import {
  buildDoctorReport,
  canonicalize,
  type IRDoctorReport,
  type IRDocument,
} from '@openref/core';
import { agentExposure } from './exposure';
import { buildLlmsFull, buildLlmsIndex, type LlmsTextOptions } from '../../llms/domain/llms-text';
import type { ResolvedAgentOptions } from './agent-options';

/** One entry of `resources/list`. */
export interface AgentResource {
  readonly uri: string;
  readonly name: string;
  readonly description: string;
  readonly mimeType: string;
}

/** The index of this reference, as the agent surface serves it. */
export const LLMS_RESOURCE_URI = 'openref://llms.txt';

/** The whole reference as text. */
export const LLMS_FULL_RESOURCE_URI = 'openref://llms-full.txt';

/** The versioned doctor report of T037, which remediation reads. */
export const HEALTH_RESOURCE_URI = 'openref://health';

/**
 * The doctor report as this surface may serve it: the exposed subset, with the count of what was
 * not.
 *
 * IT IS THE `T037` SHAPE PLUS ONE MEMBER, NOT A SHAPE OF ITS OWN. A remediation agent written
 * against `IRDoctorReport` reads this without knowing anything about audiences, and the extra
 * member tells it that a filter ran, which is the difference between "this reference is clean" and
 * "you were shown the part you may see".
 */
export interface AgentHealthReport extends IRDoctorReport {
  /** How many findings were withheld because their node is marked `audience: internal`. */
  readonly withheldFindings: number;
}

/**
 * The doctor report with every finding about an internal node removed.
 *
 * @param document - The normalized document
 * @returns The report, its score recomputed over what is exposed, and the withheld count
 */
export function agentHealthReport(document: IRDocument): AgentHealthReport {
  const report = buildDoctorReport(document);
  const withheld = agentExposure(document).withheldNodeIds;
  const findings = report.findings.filter(
    (finding) => finding.nodeId === undefined || !withheld.has(finding.nodeId),
  );

  return {
    ...report,
    // THE SCORE IS THE SCORE OF WHAT IS SHOWN. `buildDoctorReport` computes over every finding,
    // and handing that number back beside a shorter list would be a figure nothing in the payload
    // supports. Rounded the way SPEC 7.2 rounds it, and 100 when there is nothing left to say.
    score: report.findings.length === findings.length ? report.score : scoreOf(report, findings),
    findings,
    withheldFindings: report.findings.length - findings.length,
  };
}

/**
 * The score for a filtered finding list.
 *
 * DERIVED FROM THE UNFILTERED PAIR RATHER THAN RE-RUN, because the health engine of SPEC 7.2 is
 * `core`'s and running it again over a document this package would have to rebuild is a second
 * scoring rule. What is known is the report's own score and how many findings produced it, so what
 * is stated is the same score moved by the share of findings that were removed, and it is stated
 * as an integer because SPEC 7.2's score is one.
 *
 * IT CARRIES NO GUARD AGAINST AN EMPTY REPORT AND MUST NOT, which is worth a sentence because the
 * first edition had one. The only caller reaches this when the two lengths differ, and two lengths
 * can only differ when the longer one is above zero, so a guard here would be a line that reads as
 * a check and can never run. An unreachable check is the shape of thing this repository calls
 * measured but never asserted.
 *
 * @param report - The whole report, whose finding list is not empty
 * @param findings - The findings that survive the filter
 * @returns The score for the exposed subset
 */
function scoreOf(report: IRDoctorReport, findings: readonly unknown[]): number {
  const lost = 100 - report.score;
  const share = findings.length / report.findings.length;

  return Math.round(100 - lost * share);
}

/**
 * The resources this mount offers.
 *
 * A SWITCHED OFF FILE IS NOT LISTED, found by the second blind review of `T058`. With
 * `agent: { llmsTxt: false, mcp: true }` the HTTP address answered 403 and this listing still
 * offered the same file, which `resources/read` then served: off on one surface and on at the
 * other, against the principle `machineRows` states one file over, that an index never names an
 * address that refuses. The two surfaces answer one question the same way now.
 *
 * @param agent - The two switches, resolved
 * @returns The entries this mount will actually serve, in a fixed order
 */
export function agentResources(agent: ResolvedAgentOptions): readonly AgentResource[] {
  const texts: readonly AgentResource[] = agent.llmsTxt
    ? [
        {
          uri: LLMS_RESOURCE_URI,
          name: 'llms.txt',
          description: 'What this reference is, and every address a reader can go to.',
          mimeType: 'text/plain',
        },
        {
          uri: LLMS_FULL_RESOURCE_URI,
          name: 'llms-full.txt',
          description: 'The whole reference as text: every operation, channel and schema.',
          mimeType: 'text/plain',
        },
      ]
    : [];

  return [
    ...texts,
    {
      uri: HEALTH_RESOURCE_URI,
      name: 'Documentation Health report',
      description:
        'The versioned doctor report of SPEC 7.2, carrying its version so a consumer can ' +
        'refuse a shape it does not read. Findings about nodes marked audience: internal are ' +
        'withheld and counted.',
      mimeType: 'application/json',
    },
  ];
}

/** One read resource: its text and the type that text is. */
export interface AgentResourceContents {
  readonly uri: string;
  readonly mimeType: string;
  readonly text: string;
}

/** What a read produced: the contents, or the reason this mount will not hand them over. */
export type AgentResourceRead =
  | { readonly ok: true; readonly contents: AgentResourceContents }
  | { readonly ok: false; readonly reason: string };

/**
 * Reads one resource by uri.
 *
 * THE HEALTH REPORT GOES THROUGH `canonicalize`, per CLAUDE.md's hashing rule applied to a payload
 * a consumer will cache and diff: two reads of one unchanged document produce identical bytes, so
 * a pipeline can compare them without a JSON aware differ. The two text files are already
 * deterministic by construction and are not canonicalized, because they are not JSON.
 *
 * THE TWO TEXT FILES GO THROUGH THE SAME BUILDERS THE HTTP ADDRESSES DO, which is what makes the
 * bytes identical on both surfaces rather than similar. The audience filter of SPEC 18.1 lives
 * inside those builders for the same reason: a filter applied here would be a second spelling of
 * one file, and the review that found the hole found it precisely because the two paths had
 * diverged once already.
 *
 * A SWITCHED OFF FILE IS REFUSED BY NAME AND NOT ANSWERED AS AN UNKNOWN URI. "There is no such
 * resource" and "the host turned this off" are two facts a caller acts on differently, and the
 * second names the option, exactly as the HTTP address does.
 *
 * @param uri - What the caller asked for
 * @param document - The normalized document
 * @param options - Mount point and the two switches of SPEC 18.1
 * @returns The contents, or the reason they were withheld
 */
export function readAgentResource(
  uri: string,
  document: IRDocument,
  options: LlmsTextOptions,
): AgentResourceRead {
  if (uri === LLMS_RESOURCE_URI || uri === LLMS_FULL_RESOURCE_URI) {
    if (!options.agent.llmsTxt) {
      return {
        ok: false,
        reason:
          `the resource "${uri}" is switched off on this mount. It is on unless a host writes ` +
          'agent: { llmsTxt: false }, per SPEC 18.1, and the HTTP address of the same file ' +
          'refuses in the same words',
      };
    }

    const text =
      uri === LLMS_RESOURCE_URI
        ? buildLlmsIndex(document, options)
        : buildLlmsFull(document, options);

    return { ok: true, contents: { uri, mimeType: 'text/plain', text } };
  }

  if (uri === HEALTH_RESOURCE_URI) {
    return {
      ok: true,
      contents: {
        uri,
        mimeType: 'application/json',
        text: canonicalize(agentHealthReport(document)),
      },
    };
  }

  return { ok: false, reason: `no resource with the uri "${uri}" is served by this reference` };
}
