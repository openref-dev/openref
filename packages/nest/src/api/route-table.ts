/**
 * The one loop that registers the routes of SPEC 13.3, shared by both entry points of SPEC 13.
 *
 * IT IS ONE LOOP BECAUSE TWO OF THEM HAD ALREADY DRIFTED. `setup` read `method` off the table and
 * `forRoot` did not, so the proxy of SPEC 14.5, the only route of the seventeen that is not a
 * `GET`, was registered as a `GET` on every document `forRoot` mounted: the `POST` a page sends
 * reached no route at all, and the `GET` that did exist answered a route whose whole contract is a
 * request body. Found while `TX-VIS` was putting the admission in front of the same loop, which is
 * the argument for there being one: two loops over one table agree until somebody edits one.
 *
 * NOTHING DECIDES ANYTHING HERE. What is served comes from `referenceRoutes`, who may reach it
 * comes from the admission the adapter was built with, and this walks the two.
 */

import { referenceRoutes } from '../reference/domain/routes';
import type { ReferenceRouteId } from '../reference/domain/routes';
import type {
  IReferenceHttpAdapter,
  ReferenceReply,
  ReferenceRequest,
} from '../http/application/ports/reference-http.port';

/** What one mount contributes to the loop. */
export interface RouteTableMount {
  /** Mount point, already normalized. */
  readonly basePath: string;
  /**
   * Whether the Documentation Health page answers, per SPEC 7.3.
   *
   * The route is left unregistered rather than answered with a refusal, which is the one place
   * this table differs from `_proxy` and `service`: those two exist in every mount so that "off"
   * and "no such address" stay distinguishable, and this one is a page a host turned off.
   */
  readonly health: boolean;
  /** What answers a route, which is the reference service of whichever entry point mounted it. */
  readonly handle: (id: ReferenceRouteId, request: ReferenceRequest) => Promise<ReferenceReply>;
}

/**
 * Registers every route of SPEC 13.3 for one mount.
 *
 * @param adapter - The platform adapter, already carrying this mount's admission
 * @param mount - The mount point, the health switch and what answers
 */
export function mountRouteTable(adapter: IReferenceHttpAdapter, mount: RouteTableMount): void {
  for (const { id, pattern, method } of referenceRoutes(mount.basePath)) {
    if (id === 'health' && !mount.health) continue;

    adapter[method](pattern, async (request: ReferenceRequest) => mount.handle(id, request));
  }
}
