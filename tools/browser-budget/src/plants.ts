/**
 * The defects a security proof plants in order to watch its own check fail.
 *
 * A CHECK THAT HAS NEVER FAILED IS NOT A CHECK. Zero inline styles, zero external requests and
 * zero policy violations are all satisfied just as well by a harness that looks at the wrong
 * page, by an event listener attached after the event, and by a browser that reports neither.
 * Every one of those reads as a clean page. So each claim in the proof suite is asserted twice:
 * once with the defect planted, where the check must fail, and once without it, where it must
 * be silent.
 *
 * THE PLANTS ARE FUNCTIONS OVER THE SERVED HTML, NOT OPTIONS OF THE FIXTURE. A fixture that
 * could be asked to emit an inline style would be a renderer with a hole in it, kept open for
 * the benefit of a test, and the next reader could not tell that hole from a defect. Rewriting
 * the response on its way into the browser leaves the shipped bytes exactly as they ship: the
 * response is refetched and refilled with the same headers, so the policy the browser enforces
 * is still the one the server sent, nonce included.
 *
 * NOTHING HERE IS REACHABLE FROM THE PACKAGE'S MEASUREMENT PATH. These are only ever passed to
 * `measurePage` by a proof.
 */

/** Where a planted external request is aimed. */
export const PLANTED_ORIGIN = 'https://cdn.openref-plant.invalid';

/**
 * A stylesheet on a third party origin, the way a font CDN arrives.
 *
 * `.invalid` is reserved by RFC 2606 and resolves nowhere, which is deliberate: the claim is
 * that the page asks for nothing outside its origin, and asking is what is observed. A plant
 * that had to be answered would make the proof depend on somebody else's uptime and would send
 * a real request from CI to a real third party, which is precisely the behaviour under test.
 *
 * @param html - The served document
 * @returns The same document with a CDN stylesheet in its head
 */
export function plantExternalStylesheet(html: string): string {
  return html.replace(
    '</head>',
    `<link rel="stylesheet" href="${PLANTED_ORIGIN}/fonts/inter.css"></head>`,
  );
}

/**
 * An inline style attribute, the construct STANDARDS 10 exists to forbid.
 *
 * A nonce can authorize a `<style>` element and can never authorize this, which is why the
 * whole project routes dynamic values through custom properties on a class. Under
 * `style-src 'self' 'nonce-...'` the browser refuses it and reports the refusal.
 *
 * @param html - The served document
 * @returns The same document with one inline style attribute in the body
 */
export function plantInlineStyleAttribute(html: string): string {
  return html.replace('<body class="oref-body">', '<body class="oref-body" style="color: red">');
}

/**
 * An inline script with no nonce.
 *
 * It writes to a global rather than doing something visible, so that the proof can also assert
 * the script did not run: a violation report with the side effect present would mean the
 * browser reported a block it did not perform.
 *
 * @param html - The served document
 * @returns The same document with one unauthorized inline script
 */
export function plantInlineScript(html: string): string {
  return html.replace(
    '</body>',
    '<script>globalThis.__openrefPlantedScriptRan = true;</script></body>',
  );
}

/** Global the planted script sets, read back to prove the block was real. */
export const PLANTED_SCRIPT_MARKER = '__openrefPlantedScriptRan';
