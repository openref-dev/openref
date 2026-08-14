import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { INestApplication } from '@nestjs/common';

/**
 * A host portal with its own design, embedding the reference as the Web Component of
 * SPEC 10.3, in both DOM modes.
 *
 * RAW ROUTES AND NOT A CONTROLLER, deliberately. The portal is the page AROUND the reference:
 * a controller would put it under the discovery every runtime collector walks and under the
 * source link audit, and four portal handlers would read as four undocumented operations of
 * the demo's API. The page the compatibility table is about is host infrastructure, so it is
 * registered the way a host's own static layer would be, on the adapter, and only on Express,
 * which is the arm the browser suite drives.
 *
 * The stylesheet stands in for an external CSS framework the portal already uses: global
 * element rules, loud colours, its own type. In light DOM mode those rules reach into the
 * embed; in shadow mode they must not, and the browser suite asserts both directions on these
 * two pages by computed style rather than assuming them.
 */

const requireHere = createRequire(import.meta.url);

/** The element bundle, read once from the installed package the way any host would load it. */
const elementBundle = (): string =>
  readFileSync(requireHere.resolve('@openref/nest/element'), 'utf8');

/** The stand in for the portal's external CSS framework. `cursor` is the probe the suite reads. */
const FRAMEWORK_CSS = [
  '* { box-sizing: border-box; }',
  'body { margin: 2rem; font-family: Georgia, serif; }',
  'p { margin: 0 0 1rem; color: rgb(120, 30, 30); }',
  'a { color: rgb(0, 128, 0); cursor: help; }',
  'h1, h2, h3 { font-family: Georgia, serif; letter-spacing: 0.1em; }',
  'code { background: rgb(255, 240, 200); }',
].join('\n');

/**
 * One portal page, with the reference embedded in the named DOM mode.
 *
 * @param shadow - Value of the element's `shadow` attribute
 * @returns The page
 */
function portalPage(shadow: 'true' | 'false'): string {
  return (
    '<!DOCTYPE html>' +
    '<html lang="en"><head><meta charset="utf-8">' +
    '<title>Portal</title>' +
    '<link rel="stylesheet" href="/portal/framework.css">' +
    '<script type="module" src="/portal/element.js"></script>' +
    '</head><body>' +
    '<h1>The portal</h1>' +
    '<p class="portal-prose">Prose the framework styles.</p>' +
    `<openref-reference href="/docs/get-orders" shadow="${shadow}"></openref-reference>` +
    '</body></html>'
  );
}

/** A minimal express response, which is all these handlers need. */
interface PortalReply {
  type(kind: string): PortalReply;
  send(body: string): void;
}

/**
 * Registers the portal pages on the Express adapter, and does nothing on any other.
 *
 * @param app - The application, before it listens
 */
export function registerPortal(app: INestApplication): void {
  const adapter = app.getHttpAdapter();
  if (adapter.getType() !== 'express') return;

  const http = adapter.getInstance() as {
    get(path: string, handler: (request: unknown, reply: PortalReply) => void): void;
  };

  http.get('/portal/light', (_request: unknown, reply: PortalReply) => {
    reply.type('text/html; charset=utf-8').send(portalPage('false'));
  });
  http.get('/portal/shadow', (_request: unknown, reply: PortalReply) => {
    reply.type('text/html; charset=utf-8').send(portalPage('true'));
  });
  http.get('/portal/framework.css', (_request: unknown, reply: PortalReply) => {
    reply.type('text/css; charset=utf-8').send(FRAMEWORK_CSS);
  });
  http.get('/portal/element.js', (_request: unknown, reply: PortalReply) => {
    reply.type('text/javascript; charset=utf-8').send(elementBundle());
  });
}
