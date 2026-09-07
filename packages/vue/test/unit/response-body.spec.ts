import { describe, expect, it } from 'vitest';
import { prettyResponseBody } from '../../src/runner';

/**
 * The one step both shipped themes take before drawing a response body.
 *
 * The bench used to draw the raw wire string on one line, beside a request body example the
 * same page had already indented. This is that asymmetry closed, and the cases below are the
 * two halves of the promise: JSON is indented, and a body that is not JSON is byte identical to
 * what arrived. The second half is the one with teeth, because a formatter that assumed would
 * corrupt exactly the body a reader opened the console to look at.
 */

describe('prettyResponseBody', () => {
  it('should indent a JSON object over several lines', () => {
    // Given a minified body, which is what an API sends
    const body = '{"id":"ord_1024","items":[{"sku":"a","qty":2}],"total":19.5}';

    // When
    const drawn = prettyResponseBody(body);

    // Then it is the same value, laid out
    expect(drawn.split('\n').length).toBeGreaterThan(5);
    expect(drawn).toContain('  "id": "ord_1024"');
    expect(JSON.parse(drawn)).toEqual(JSON.parse(body));
  });

  it('should return a body that is not JSON exactly as it arrived', () => {
    // Given the four shapes a console meets that a JSON formatter would ruin
    const bodies = [
      '<!doctype html><html><body>502 Bad Gateway</body></html>',
      'Error: connect ECONNREFUSED 10.0.0.4:8080\n    at TCPConnectWrap.afterConnect',
      'id,sku,qty\n1,a,2\n2,b,7\n',
      '',
    ];

    // When, Then, character for character rather than merely parseable
    for (const body of bodies) expect(prettyResponseBody(body)).toBe(body);
  });

  it('should leave a truncated JSON body alone rather than guessing the rest', () => {
    // Given a body cut off by a response cap, which is a body the runner really produces
    const body = '{"id":"ord_1024","items":[{"sku":"a","qt';

    // When, Then
    expect(prettyResponseBody(body)).toBe(body);
  });

  it('should carry a hostile body through unchanged, since escaping is the renderer job', () => {
    // Given a body whose text is markup. This step never produces markup and never removes any:
    // the body reaches the page as a text child, and `try-it.spec.ts` proves that end of it.
    const body = '{"note":"<img src=x onerror=alert(1)>"}';

    // When
    const drawn = prettyResponseBody(body);

    // Then the payload survives verbatim inside the indented value
    expect(drawn).toContain('<img src=x onerror=alert(1)>');
  });
});
