/**
 * The two switches SPEC 13.2 prints for `agent`, with the default each one arrives at.
 *
 * `llmsTxt` IS ON AND `mcp` IS OFF, AND THE ASYMMETRY IS SPEC 18's OWN SENTENCE. The two text
 * files are a projection of a document this process already holds: no request leaves, no state is
 * kept, and the bytes are what the reference's own pages say. MCP is a protocol endpoint that a
 * third party agent drives, so it is a capability a host switches on rather than a reason to
 * install the package, and turning it on is a sentence somebody wrote.
 *
 * WHAT IS NOT HERE IS AUTHENTICATION, AND THAT IS THE DECISION RATHER THAN AN OMISSION. SPEC 18
 * requires authentication when MCP is on, and this package holds no credential, no token store and
 * no header convention on purpose: every route of SPEC 13.3 already passes one admission object,
 * the host's guards run inside it, and a second mechanism here would be the first place in this
 * repository that keeps somebody else's secret. `@openref/nest` therefore refuses `mcp: true` on a
 * mount that carries no guard, at boot, which is the check that makes the requirement provable
 * rather than stated. See SPEC 18.1.
 */

/** The agent surface of SPEC 18.1, as a host configures it. */
export interface AgentOptions {
  /**
   * Whether `llms.txt` and `llms-full.txt` answer. Defaults to true.
   *
   * ONE SWITCH FOR BOTH FILES, because they are one artefact at two depths: the index names the
   * addresses and the full text carries what is at them. A deployment that wants the index and not
   * the content would be asking a reader to follow links this switch just turned off.
   */
  readonly llmsTxt?: boolean;
  /** Whether the MCP endpoint answers. Defaults to false, per SPEC 18. */
  readonly mcp?: boolean;
}

/** Whether the two text files answer, when the host says nothing. */
export const DEFAULT_AGENT_LLMS_TXT = true;

/** Whether the MCP endpoint answers, when the host says nothing. */
export const DEFAULT_AGENT_MCP = false;

/** The options with both defaults filled in, which is what the surface is built from. */
export interface ResolvedAgentOptions {
  readonly llmsTxt: boolean;
  readonly mcp: boolean;
}

/**
 * Fills in both defaults SPEC 18.1 prints.
 *
 * @param options - Whatever the host wrote, if anything
 * @returns The two switches, with no member left to be decided later
 */
export function resolveAgentOptions(options: AgentOptions | undefined): ResolvedAgentOptions {
  return {
    llmsTxt: options?.llmsTxt ?? DEFAULT_AGENT_LLMS_TXT,
    mcp: options?.mcp ?? DEFAULT_AGENT_MCP,
  };
}
