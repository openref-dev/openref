/**
 * The one refusal the agent surface of SPEC 18.1 owes at boot: MCP on with nothing in front of it.
 *
 * SPEC 18 REQUIRES AUTHENTICATION WHEN MCP IS ON, AND THIS IS WHAT MAKES THAT PROVABLE RATHER THAN
 * STATED. The mechanism is the guard of SPEC 19.6, not a second one: every route of SPEC 13.3 is
 * registered through an adapter that cannot be built without a `RouteAdmission`, the host's guards
 * run inside it, and `<route>/mcp` is one of those routes by construction. So the only thing left
 * to check is that the host actually supplied a guard, and a mount that switches MCP on without
 * one does not boot.
 *
 * IT IS A BOOT REFUSAL AND NOT A PER REQUEST ONE, for the reason `admission.service.ts` gives about
 * everything on this question: the state being described is a host that believes an endpoint is
 * authenticated while it is open, and the moment to say so is while the application is still
 * starting, where the person who can fix it is watching.
 *
 * IT IS NOT A TYPE LEVEL BAN, WHICH THE BRIDGE OF SPEC 14.8 IS, and the asymmetry is the two
 * requirements being different rather than one of them being enforced less. SPEC 19.8 bans a
 * bridge under public visibility outright, so it is two arms of a union and the wrong version does
 * not compile. SPEC 18 asks for authentication, and a reference whose `visibility` is `public`
 * may still carry a guard: `admissionFor` runs whatever guard a host wrote, whatever the
 * visibility says, and refusing that combination at the type level would forbid a deployment SPEC
 * 19.6 explicitly allows.
 */

import { ErrorCode, InvalidOptionsError } from '@openref/core';
import type { AgentOptions } from '@openref/agent';
import type { GuardLike } from '../../shared/types/nest-surface';

/**
 * What the check reads: the two switches, and whatever guard the same mount declared.
 *
 * BOTH MEMBERS ADMIT `undefined` EXPLICITLY, which under `exactOptionalPropertyTypes` is not the
 * same as being optional. The callers build the pair by resolving an entry against the root
 * default, so what they hold is `AgentOptions | undefined` in a present key rather than an absent
 * key, and a type that only allowed the second would push a conditional spread into every call
 * site of a security check.
 */
export interface AgentMountOptions {
  readonly agent?: AgentOptions | undefined;
  readonly guard?: GuardLike | readonly GuardLike[] | undefined;
}

/**
 * Refuses an MCP endpoint that nothing authenticates, before any route is registered.
 *
 * THE COUNT IS WHAT DECIDES, NOT THE PRESENCE OF THE MEMBER. `guard: []` reads as guarded and
 * guards nothing, which `admission.service.ts` already refuses on its own; asking the same
 * question here in terms of the list means the two cannot disagree about what "has a guard" is.
 *
 * @param subject - How this mount is named in an error, such as the document id or the route
 * @param options - Whatever the host wrote for this mount
 * @throws {InvalidOptionsError} When MCP is switched on and no guard was supplied
 */
export function assertAgentOptions(subject: string, options: AgentMountOptions): void {
  if (options.agent?.mcp !== true) return;

  const guards = options.guard === undefined ? [] : [options.guard].flat();

  if (guards.length === 0) {
    throw new InvalidOptionsError(
      `${subject} switches the MCP endpoint on and supplies no guard, so it would answer every ` +
        'tool list and every tool call to anyone who asks. SPEC 18 makes authentication ' +
        'mandatory when MCP is on, and the mechanism is the guard of SPEC 19.6: pass guard ' +
        'beside agent.mcp, or leave agent.mcp off',
      ErrorCode.CONFIG_INVALID_OPTIONS,
      undefined,
      { subject },
    );
  }
}
