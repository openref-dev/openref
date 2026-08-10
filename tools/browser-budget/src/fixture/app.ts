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
import { largeSpecification, memorySpecification, TTI_NODE_COUNT } from './specification.js';
import type { Request, Response } from 'express';

/** Which document a boot serves. */
export type FixtureDocument = 'large' | 'memory';

/** Where the fixture mounts the reference. */
export const FIXTURE_BASE_PATH = '/docs';

/**
 * The policy every response carries.
 *
 * `default-src 'none'` rather than `'self'`, because the claim SPEC 19.2 makes is about what
 * the page needs rather than about what it happens to get away with. Every directive below it
 * is one this reference actually uses, and anything that appears later has to be added here
 * deliberately instead of arriving under a permissive default.
 *
 * NO `unsafe-inline` AND NO `unsafe-eval` IN EITHER OF THE TWO DIRECTIVES THAT MATTER. That is
 * the whole competitive claim, and here a browser enforces it rather than a scan.
 *
 * @param nonce - The nonce generated for this response
 * @returns The header value
 */
export function contentSecurityPolicy(nonce: string): string {
  return [
    "default-src 'none'",
    `script-src 'self' 'nonce-${nonce}'`,
    `style-src 'self' 'nonce-${nonce}'`,
    "font-src 'self'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/**
 * Builds the express application serving one document.
 *
 * @param document - Which of the two SPEC 20 documents to serve
 * @returns The application, not yet listening
 */
export function createFixture(document: FixtureDocument): express.Express {
  const app = express();

  // A NONCE PER RESPONSE, AND A REAL ONE. A fixed nonce would authorize a script written once
  // and served forever, which is the thing a nonce exists to prevent, and it would also let a
  // planted inline script inherit an attribute the harness already knows.
  app.use((_request: Request, response: Response, next: () => void) => {
    const nonce = randomBytes(16).toString('base64');
    response.locals.cspNonce = nonce;
    response.setHeader('Content-Security-Policy', contentSecurityPolicy(nonce));
    next();
  });

  OpenRefModule.setup(
    FIXTURE_BASE_PATH,
    {
      getHttpAdapter: () => ({
        getType: () => 'express',
        get: (path: string, handler: (request: unknown, reply: unknown) => void) =>
          app.get(path, handler),
      }),
    },
    {
      document: document === 'large' ? largeSpecification(TTI_NODE_COUNT) : memorySpecification(),
    },
  );

  return app;
}
