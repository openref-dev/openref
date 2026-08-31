/**
 * The reference server the browser budgets are measured against.
 *
 * EXPRESS DIRECTLY, WITHOUT NestJS, AND THAT IS DELIBERATE. `shared/types/nest-surface.ts`
 * declares the whole coupling as three methods and one accessor, so a host is anything that
 * offers them. What is measured here is what a browser receives: the page `ReferenceService`
 * renders, the assets the catalog serves and the bundle `@openref/nest` builds, all of them
 * the shipped bytes. NestJS itself puts nothing on the wire, and booting it would add a
 * framework, a decorator and a metadata emitter to a measurement that observes none of them.
 * That the real framework satisfies this surface is proved elsewhere, by the compatibility
 * matrix and by `first-minute.spec.ts`, against a real application.
 *
 * IT ALSO SERVES THE STRICT CSP OF SPEC 19.2, which is the other half of what this fixture is
 * for. `@openref/nest` sends no policy header, by design: a policy belongs to the application.
 * So the harness needs an application that sends one, and this is it, written the way a host
 * with helmet would write it: a nonce per response, left where the adapter looks for it, and
 * `style-src` and `script-src` with no `unsafe-inline` anywhere.
 */

import { randomBytes } from 'node:crypto';
import express from 'express';
import { OpenRefModule } from '@openref/nest';
import { authorizationDocumentSurface } from './authorization-server.js';
import {
  largeSpecification,
  memorySpecification,
  PROOF_NODE_COUNT,
  TTI_NODE_COUNT,
} from './specification.js';
import type { Request, Response } from 'express';
import { contentSecurityPolicy } from '@openref/render';

/**
 * Which document a boot serves.
 *
 * `proof` is the third and it is not a budget document. The security proofs need a page, not a
 * thousand nodes, and booting the budget fixture for them would spend a minute of every run
 * normalizing a document whose size none of them is about.
 */
export type FixtureDocument = 'large' | 'memory' | 'proof';

/** Where the fixture mounts the reference. */
export const FIXTURE_BASE_PATH = '/docs';

/** How one boot is varied. */
export interface FixtureOptions {
  /**
   * Whether the responses carry the strict policy of SPEC 19.2.
   *
   * ON EVERYWHERE EXCEPT IN ONE PROOF, and that proof is the reason the switch exists. The
   * network isolation claim is that the page fetches nothing outside its origin; proving that
   * check can fail means planting a request that goes outside the origin and seeing it
   * recorded, and under this policy the browser blocks such a request before it is made. A
   * plant that never reaches the network would leave the interception looking watchful while
   * observing nothing. So the plant is seen once with the policy off, which proves the eye
   * works, and once with it on, which proves the policy stops what the eye can see.
   */
  readonly policy?: boolean;
  /**
   * Origin of the fake authorization server, when this boot serves the sign in cases.
   *
   * Absent everywhere else, and its absence is what keeps every other measurement free of five
   * operations and five security schemes it never asked for.
   */
  readonly authorizationServer?: string;
  /**
   * Whether `connect-src` names the authorization server.
   *
   * ON WHENEVER THERE IS ONE, EXCEPT IN THE PROOF THAT NEEDS IT OFF. A reference served under the
   * bare `connect-src 'self'` cannot run the exchange, and that is a fact about the policy this
   * project recommends rather than about this fixture, so it is proved rather than assumed.
   */
  readonly allowAuthorizationConnect?: boolean;
}

/**
 * The policy every response carries, re-exported from its one home.
 *
 * IT MOVED TO `@openref/render` AT `T061`, and this name stays here because this is where the
 * suites import it from. Three surfaces speak this policy now, the third being the Nuxt example
 * of SPEC 16.4, and a vocabulary spoken by more than one surface lives in one exported constant:
 * a fixture proving a browser enforces a policy that a deployment does not serve would be a proof
 * of the wrong sentence.
 */
export { contentSecurityPolicy };

/**
 * The specification one document name stands for.
 *
 * @param document - Which document to serve
 * @returns The specification, as a host would hand it to `setup`
 */
function specificationFor(
  document: FixtureDocument,
  authorizationServer?: string,
): Record<string, unknown> | string {
  if (document === 'memory') return memorySpecification();

  const base = largeSpecification(document === 'large' ? TTI_NODE_COUNT : PROOF_NODE_COUNT);
  if (authorizationServer === undefined) return base;

  const surface = authorizationDocumentSurface(authorizationServer);
  const components = base.components as Record<string, unknown>;

  return {
    ...base,
    servers: surface.servers,
    paths: { ...(base.paths as Record<string, unknown>), ...surface.paths },
    components: { ...components, securitySchemes: surface.securitySchemes },
  };
}

/**
 * Builds the express application serving one document.
 *
 * @param document - Which document to serve
 * @param options - Whether the strict policy is sent
 * @returns The application, not yet listening
 */
export function createFixture(
  document: FixtureDocument,
  options: FixtureOptions = {},
): express.Express {
  const app = express();

  // A NONCE PER RESPONSE, AND A REAL ONE. A fixed nonce would authorize a script written once
  // and served forever, which is the thing a nonce exists to prevent, and it would also let a
  // planted inline script inherit an attribute the harness already knows.
  const connect =
    options.authorizationServer !== undefined && options.allowAuthorizationConnect !== false
      ? [options.authorizationServer]
      : [];

  app.use((_request: Request, response: Response, next: () => void) => {
    const nonce = randomBytes(16).toString('base64');
    response.locals.cspNonce = nonce;
    if (options.policy !== false) {
      response.setHeader('Content-Security-Policy', contentSecurityPolicy(nonce, connect));
    }
    next();
  });

  OpenRefModule.setup(
    FIXTURE_BASE_PATH,
    {
      getHttpAdapter: () => ({
        getType: () => 'express',
        get: (path: string, handler: (request: unknown, reply: unknown) => void) =>
          app.get(path, handler),
        // The proxy route of SPEC 14.5, which this fixture registers and never enables: the
        // module mounts it on every reference, and it answers 403 until a host turns it on.
        post: (path: string, handler: (request: unknown, reply: unknown) => void) =>
          app.post(path, handler),
      }),
    },
    { document: specificationFor(document, options.authorizationServer) },
  );

  return app;
}
