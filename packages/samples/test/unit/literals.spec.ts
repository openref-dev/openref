import { describe, expect, it } from 'vitest';
import { buildSampleRequest, generateCodeSamples } from '../../src/index';
import { postNote, SERVER } from '../mocks/operations';

/** The sample for one language over a plain text body, which is what each case here checks. */
function sourceFor(text: string, lang: string): string {
  const request = buildSampleRequest(postNote(), {
    values: {},
    serverUrl: SERVER,
    body: { kind: 'text', text },
  });
  const { samples } = generateCodeSamples(request);

  return samples.find((sample) => sample.lang === lang)?.source ?? '';
}

describe('string literals in a generated sample', () => {
  it('should escape the Ruby interpolation opener, which would otherwise run as code', () => {
    // Given, a body a document could legitimately carry
    const body = 'total #{2 + 2}';

    // When
    const ruby = sourceFor(body, 'ruby');

    // Then
    expect(ruby).toContain('request.body = "total \\#{2 + 2}"');
  });

  it('should leave the same characters alone where the language does not interpolate', () => {
    // Given, the control for the case above
    const body = 'total #{2 + 2}';

    // When
    const python = sourceFor(body, 'python');

    // Then
    expect(python).toContain('content="total #{2 + 2}"');
  });

  it('should spell a Rust code point escape with braces, which is the only form it reads', () => {
    // Given, a control character no other escape covers
    const body = 'a\u0007b';

    // When
    const rust = sourceFor(body, 'rust');
    const java = sourceFor(body, 'java');

    // Then
    expect(rust).toContain('.body("a\\u{7}b")');
    expect(java).toContain('ofString("a\\u0007b")');
  });

  it('should never write a line terminator as a code point escape, which Java expands early', () => {
    // Given
    const body = 'first\nsecond';

    // When
    const java = sourceFor(body, 'java');

    // Then
    expect(java).toContain('ofString("first\\nsecond")');
    expect(java).not.toContain('\\u000a');
  });

  it('should escape both characters a PHP single quoted string reads', () => {
    // Given
    const body = `it's a back\\slash`;

    // When
    const php = sourceFor(body, 'php');

    // Then
    expect(php).toContain(`curl_setopt($ch, CURLOPT_POSTFIELDS, 'it\\'s a back\\\\slash');`);
  });

  it('should leave a dollar sign literal in a shell word, so no command runs', () => {
    // Given
    const body = 'cost $(rm -rf /) `whoami`';

    // When
    const shell = sourceFor(body, 'shell');

    // Then
    expect(shell).toContain(`--data-raw 'cost $(rm -rf /) \`whoami\`'`);
  });

  it('should leave non ascii text as it is, so a reader can recognise it', () => {
    // Given
    const body = 'имя';

    // When, Then
    expect(sourceFor(body, 'typescript')).toContain('body: "имя"');
    expect(sourceFor(body, 'shell')).toContain(`--data-raw 'имя'`);
  });
});
